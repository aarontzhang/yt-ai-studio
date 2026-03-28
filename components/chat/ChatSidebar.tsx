'use client';

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useEditorStore } from '@/lib/useEditorStore';
import {
  AnalysisProgress,
  AppliedActionRecord,
  ChatMessage as ChatMessageType,
  CaptionEntry,
  EditAction,
  MarkerEntry,
  SilenceCandidate,
  SourceIndexAnalysisStateMap,
  SourceIndexTaskState,
  VisualSearchSession,
} from '@/lib/types';
import { buildTimelineSilenceCandidates, formatTime, formatTimePrecise, getSourceSegmentsForTimelineRange, buildTranscriptContext, getTimelineDuration, sourceRangesForAction, projectCaptionWordsToTimeline } from '@/lib/timelineUtils';
import {
  buildReviewGroupWithUpdatedItems,
  buildReviewPreviewSnapshot,
  collapseReviewItemsToAction,
  createReviewGroup,
  EditSnapshot,
} from '@/lib/editActionUtils';
import { buildOverlappingRanges, dedupeCaptionEntries, transcribeSourceRanges } from '@/lib/transcriptionUtils';
import { buildClipSchedule, timelineTimeToSource } from '@/lib/playbackEngine';
import { resolveProjectSources } from '@/lib/sourceMedia';
import { MAIN_SOURCE_ID } from '@/lib/sourceUtils';
import { getInitialIndexingReady, isServerBackedSource } from '@/lib/sourceIndexGate';
import {
  actionsMatch,
  buildRequestChainContinuationMessage,
  RequestChainContinuationPayload,
  RequestChainTranscriptAvailability,
  serializeActionForComparison,
} from '@/lib/requestChain';
import AutocutMark from '@/components/branding/AutocutMark';
import { capture } from '@/lib/analytics';

const REVIEW_PREROLL_SECONDS = 2.5;

type ChatResponse = {
  message?: string;
  action?: EditAction | null;
  visualSearch?: VisualSearchSession | null;
  error?: string;
  retryAfterSeconds?: number;
  requestId?: string | null;
  final?: boolean;
};

type ChatRequestMessage = {
  role: 'user' | 'assistant';
  content: string;
  requestChainId?: string;
  action?: EditAction | null;
  actionType?: EditAction['type'];
  actionMessage?: string;
  actionStatus?: ChatMessageType['actionStatus'];
  actionResult?: string;
  autoApplied?: boolean;
};

type LiveMessageActionState = {
  actionMessage?: string;
  actionStatus?: ChatMessageType['actionStatus'];
  actionResult?: string;
  autoApplied?: boolean;
  isApplied: boolean;
  wasUndone: boolean;
};

type IndexingProgress = AnalysisProgress;

type ProgressCardTone = 'active' | 'completed';

type AnalysisStatusCard = {
  key: string;
  title: string;
  progress: IndexingProgress | null;
  detail?: string | null;
  secondaryLabel?: string | null;
  tone?: ProgressCardTone;
  showProgressBar?: boolean;
};

const CHAT_REQUEST_TIMEOUT_MS = 45000;
const MAX_CHAT_REQUEST_RETRIES = 2;
const CHAT_RETRY_BASE_DELAY_MS = 1500;
const MAX_CHAIN_CHAT_ROUNDS = 4;
const INLINE_REFERENCE_PATTERN = /@(?:clip|marker)\s+\d+\b/gi;

type RequestChainState = {
  requestChainId: string;
  originalRequest: string;
  remainingObjective: string | null;
  completedActions: EditAction[];
  duplicateActionBlacklist: EditAction['type'][];
  transcript: RequestChainTranscriptAvailability;
  duplicateRerunCount: number;
};

type ActiveMarkerMention = {
  query: string;
  start: number;
  end: number;
};

async function parseJsonResponse<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function postChatRequest(
  payload: {
    messages: ChatRequestMessage[];
    context: Record<string, unknown>;
  },
  ctrl: AbortController,
  onChunk?: (text: string) => void,
): Promise<ChatResponse> {
  const timeoutId = window.setTimeout(() => {
    try {
      ctrl.abort(new DOMException('The chat request timed out.', 'AbortError'));
    } catch {
      ctrl.abort();
    }
  }, CHAT_REQUEST_TIMEOUT_MS);

  try {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_CHAT_REQUEST_RETRIES; attempt += 1) {
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify(payload),
        });

        const contentType = res.headers.get('Content-Type') ?? '';
        if (contentType.includes('text/event-stream')) {
          if (!res.ok) throw new Error(`Chat request failed (${res.status}).`);
          if (!res.body) throw new Error('No response body.');

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let sseBuffer = '';
          let finalResponse: ChatResponse = {};

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });

            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() ?? '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              let event: { type: string; text?: string; message?: string; action?: EditAction | null; final?: boolean; error?: string };
              try { event = JSON.parse(line.slice(6)); } catch { continue; }

              if (event.type === 'chunk' && typeof event.text === 'string') {
                onChunk?.(event.text);
              } else if (event.type === 'done') {
                finalResponse = { message: event.message, action: event.action, final: event.final };
              } else if (event.type === 'error') {
                const raw = event.error ?? 'Stream error';
                let friendly = raw;
                try {
                  const parsed = JSON.parse(raw) as { error?: { type?: string; message?: string } };
                  if (parsed?.error?.type === 'overloaded_error' || /overload/i.test(raw)) {
                    friendly = 'The chat provider is temporarily overloaded. Please try again in a moment.';
                  } else if (parsed?.error?.message) {
                    friendly = parsed.error.message;
                  }
                } catch { /* not JSON, use as-is */ }
                throw new Error(friendly);
              }
            }
          }

          return finalResponse;
        }

        const data = await parseJsonResponse<ChatResponse>(res);
        if (!res.ok) {
          const retryAfterSeconds = Number(res.headers.get('Retry-After') ?? data?.retryAfterSeconds);
          const isRetriable = res.status === 429 || res.status >= 500;
          const errorMessage = res.status === 529 || /overloaded/i.test(data?.error ?? '')
            ? 'The chat provider is temporarily overloaded. Please try again in a moment.'
            : (data?.error ?? `Chat request failed (${res.status}).`);

          lastError = new Error(errorMessage);

          if (attempt < MAX_CHAT_REQUEST_RETRIES && isRetriable && !ctrl.signal.aborted) {
            const retryDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
              ? retryAfterSeconds * 1000
              : CHAT_RETRY_BASE_DELAY_MS * (attempt + 1);
            await sleep(retryDelay);
            continue;
          }

          if (res.status === 429) {
            capture('chat_quota_hit', {});
          }
          throw lastError;
        }
        return data ?? {};
      } catch (error) {
        const nextError = error instanceof Error ? error : new Error('Chat request failed.');
        lastError = nextError;
        if (nextError.name === 'AbortError') {
          throw nextError;
        }
        if (attempt >= MAX_CHAT_REQUEST_RETRIES || ctrl.signal.aborted) {
          throw nextError;
        }
        await sleep(CHAT_RETRY_BASE_DELAY_MS * (attempt + 1));
      }
    }

    throw lastError ?? new Error('Chat request failed.');
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : fallback;
  }
  return fallback;
}

function formatTranscriptFailureNotice(error: string | null): string {
  const normalized = error?.trim();
  if (!normalized) {
    return 'Audio transcription did not finish. Initial indexing is incomplete.';
  }
  if (normalized.includes('OPENAI_API_KEY')) {
    return 'Audio transcription is not configured on this deployment. Missing OPENAI_API_KEY. Initial indexing is incomplete.';
  }
  if (normalized === 'Unauthorized') {
    return 'Audio transcription was rejected because the current session was not authorized. Initial indexing is incomplete.';
  }
  return `${normalized} Initial indexing is incomplete.`;
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function formatCountdownLabel(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')} left`;
}

function formatRemainingLabel(totalSeconds: number | null | undefined): string {
  if (Number.isFinite(totalSeconds) && (totalSeconds ?? 0) >= 0) {
    return formatCountdownLabel(Number(totalSeconds));
  }
  return '--:-- left';
}

function getActiveMarkerMention(text: string, caret: number | null): ActiveMarkerMention | null {
  if (caret === null) return null;
  const prefix = text.slice(0, caret);
  const match = prefix.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const atIndex = prefix.lastIndexOf('@');
  if (atIndex === -1) return null;
  return {
    query: match[1] ?? '',
    start: atIndex,
    end: caret,
  };
}

function replaceMarkerMention(text: string, mention: ActiveMarkerMention, markerNumber: number): string {
  return `${text.slice(0, mention.start)}@marker ${markerNumber} ${text.slice(mention.end)}`;
}

function formatClipReferenceToken(clipNumber: number): string {
  return `@clip ${clipNumber}`;
}

function formatMarkerReferenceToken(markerNumber: number): string {
  return `@marker ${markerNumber}`;
}

function stripInlineSelectionReferences(text: string): string {
  return text
    .replace(INLINE_REFERENCE_PATTERN, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+/gm, '')
    .trimStart();
}

function upsertInlineSelectionReference(text: string, token: string): string {
  const stripped = stripInlineSelectionReferences(text).trimStart();
  return stripped.length > 0 ? `${token} ${stripped}` : `${token} `;
}

function getProgressValue(progress: IndexingProgress | null): number | null {
  if (!progress || progress.total <= 0) return null;
  return clampProgress(progress.completed / progress.total);
}

function getIndexingStageTitle(progress: IndexingProgress | null, fallback?: string | null): string {
  if (fallback) return fallback;
  if (!progress) return 'Preparing media…';

  switch (progress.stage) {
    case 'queued':
      return 'Queued…';
    case 'preparing_media':
      return 'Preparing media…';
    case 'transcribing_audio':
      return 'Transcribing audio…';
    case 'detecting_scenes':
      return 'Detecting scenes…';
    case 'choosing_representative_frames':
      return 'Analyzing sampled frames…';
    case 'describing_representative_frames':
      return 'Analyzing sampled frames…';
    case 'dense_refinement':
      return 'Dense local refinement…';
    case 'extracting_frames':
      return 'Sampling video frames…';
    case 'describing_frames':
      return 'Analyzing sampled frames…';
    case 'transcribing':
      return 'Transcribing audio…';
    default:
      return 'Preparing media…';
  }
}

function buildCompletedProgress(stage: IndexingProgress['stage']): IndexingProgress {
  return {
    stage,
    completed: 1,
    total: 1,
    label: 'Completed',
    etaSeconds: 0,
  };
}

function isServerAudioReady(
  analysis: SourceIndexAnalysisStateMap[string] | null | undefined,
  freshness: { transcript?: boolean; overview?: boolean } | null | undefined,
) {
  return freshness?.transcript === true
    || analysis?.audio?.status === 'completed'
    || analysis?.audio?.status === 'unavailable';
}

function isServerVisualReady(
  analysis: SourceIndexAnalysisStateMap[string] | null | undefined,
  freshness: { transcript?: boolean; overview?: boolean } | null | undefined,
) {
  return freshness?.overview === true
    || analysis?.visual?.status === 'completed';
}

function estimateTranscriptSeconds(duration: number): number {
  return Math.max(25, Math.min(900, 12 + duration * 0.2));
}

function normalizeKnownSourceId(sourceId?: string | null): string {
  return sourceId && sourceId.trim().length > 0 ? sourceId : MAIN_SOURCE_ID;
}

function estimateRemainingSecondsFromObservedRate(
  startedAtMs: number,
  completed: number,
  total: number,
  fallbackUnitSeconds: number,
): number {
  const remaining = Math.max(total - completed, 0);
  if (remaining <= 0) return 0;
  if (completed < Math.min(6, total)) {
    return Math.max(remaining * fallbackUnitSeconds, fallbackUnitSeconds);
  }

  const elapsedSeconds = Math.max((performance.now() - startedAtMs) / 1000, 0.001);
  const unitsPerSecond = completed / elapsedSeconds;
  if (!Number.isFinite(unitsPerSecond) || unitsPerSecond <= 0) {
    return Math.max(remaining * fallbackUnitSeconds, fallbackUnitSeconds);
  }

  return remaining / unitsPerSecond;
}

function stabilizeEtaEstimate(params: {
  reportedEtaSeconds?: number | null;
  fallbackEtaSeconds?: number | null;
  completed: number;
  total: number;
}): number | null {
  const reportedEtaSeconds = Number.isFinite(params.reportedEtaSeconds)
    ? Math.max(0, Math.round(Number(params.reportedEtaSeconds)))
    : null;
  const fallbackEtaSeconds = Number.isFinite(params.fallbackEtaSeconds)
    ? Math.max(0, Math.round(Number(params.fallbackEtaSeconds)))
    : null;

  if (reportedEtaSeconds === null) return fallbackEtaSeconds;
  if (fallbackEtaSeconds === null) return reportedEtaSeconds;

  const progressFraction = params.total > 0
    ? clampProgress(params.completed / params.total)
    : 0;
  const anchoredEtaSeconds = Math.max(reportedEtaSeconds, fallbackEtaSeconds);

  if (progressFraction <= 0.12) return anchoredEtaSeconds;
  if (progressFraction >= 0.55) return reportedEtaSeconds;

  const blend = (progressFraction - 0.12) / 0.43;
  return Math.max(1, Math.round((anchoredEtaSeconds * (1 - blend)) + (reportedEtaSeconds * blend)));
}

function formatProgressSummary(params: {
  targetProgress: number | null;
  isCompleted: boolean;
  etaSeconds?: number | null;
  detail?: string | null;
  secondaryLabel?: string | null;
}) {
  const { targetProgress, isCompleted, etaSeconds, detail } = params;
  const percentLabel = `${Math.round((targetProgress ?? 0) * 100)}%`;

  if (isCompleted) {
    return {
      summary: '100%',
      secondary: null,
    };
  }

  if (detail) {
    return {
      summary: detail,
      secondary: null,
    };
  }

  if (targetProgress === null && params.secondaryLabel) {
    return {
      summary: params.secondaryLabel,
      secondary: null,
    };
  }

  return {
    summary: `${percentLabel} • ${formatRemainingLabel(etaSeconds)}`,
    secondary: null,
  };
}

function getLiveMessageActionState(
  message: Pick<ChatMessageType, 'action' | 'actionStatus' | 'actionResult' | 'autoApplied'>,
  appliedActions: AppliedActionRecord[],
): LiveMessageActionState {
  const action = message.action;
  if (!action || action.type === 'none') {
    return {
      actionMessage: undefined,
      actionStatus: message.actionStatus,
      actionResult: message.actionResult,
      autoApplied: message.autoApplied,
      isApplied: false,
      wasUndone: false,
    };
  }

  const isApplied = appliedActions.some((record) => actionsMatch(record.action, action));
  const wasPreviouslyApplied = message.actionStatus === 'completed' || message.autoApplied === true;

  if (message.actionStatus === 'rejected') {
    return {
      actionMessage: action.message,
      actionStatus: 'rejected',
      actionResult: message.actionResult,
      autoApplied: undefined,
      isApplied: false,
      wasUndone: false,
    };
  }

  if (isApplied) {
    return {
      actionMessage: action.message,
      actionStatus: 'completed',
      actionResult: message.actionResult,
      autoApplied: message.autoApplied === true ? true : undefined,
      isApplied: true,
      wasUndone: false,
    };
  }

  if (wasPreviouslyApplied) {
    return {
      actionMessage: `Previously applied, then undone: ${action.message}`,
      actionStatus: 'pending',
      actionResult: 'Undone via undo/redo. Reapply if you still want this edit.',
      autoApplied: undefined,
      isApplied: false,
      wasUndone: true,
    };
  }

  return {
    actionMessage: action.message,
    actionStatus: message.actionStatus,
    actionResult: message.actionResult,
    autoApplied: undefined,
    isApplied: false,
    wasUndone: false,
  };
}

function buildChatRequestHistory(
  messages: ChatMessageType[],
  appliedActions: AppliedActionRecord[],
  latestUserText?: string,
  requestChainId?: string,
): ChatRequestMessage[] {
  const history: ChatRequestMessage[] = messages.map((message) => {
    const liveActionState = getLiveMessageActionState(message, appliedActions);
    return {
      role: message.role,
      content: message.content,
      requestChainId: message.requestChainId,
      action: message.action ?? null,
      actionType: message.action?.type,
      actionMessage: liveActionState.actionMessage,
      actionStatus: liveActionState.actionStatus,
      actionResult: liveActionState.actionResult,
      autoApplied: liveActionState.autoApplied,
    };
  });

  if (latestUserText) {
    history.push({ role: 'user', content: latestUserText, requestChainId });
  }

  return history;
}

function normalizeRequestObjective(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildContinuationPayload(
  chainState: RequestChainState,
  trigger: RequestChainContinuationPayload['trigger'],
  explicitInstruction?: string | null,
): string {
  return buildRequestChainContinuationMessage({
    requestChainId: chainState.requestChainId,
    originalRequest: chainState.originalRequest,
    remainingObjective: chainState.remainingObjective,
    completedActions: chainState.completedActions.map((action) => ({
      type: action.type,
      signature: serializeActionForComparison(action),
      summary: action.message,
    })),
    duplicateActionBlacklist: chainState.duplicateActionBlacklist,
    transcript: chainState.transcript,
    trigger,
    explicitInstruction: normalizeRequestObjective(explicitInstruction),
  });
}

function buildSilenceCandidatePayload(): SilenceCandidate[] {
  const state = useEditorStore.getState();
  const rawCaptions = state.sourceTranscriptCaptions;
  if (!rawCaptions || rawCaptions.length === 0) return [];

  return buildTimelineSilenceCandidates(state.clips, rawCaptions, state.aiSettings.silenceRemoval);
}

function buildWordBoundaryPayload(): Array<{ start: number; end: number }> {
  const state = useEditorStore.getState();
  const rawCaptions = state.sourceTranscriptCaptions;
  if (!rawCaptions || rawCaptions.length === 0) return [];
  return projectCaptionWordsToTimeline(state.clips, rawCaptions)
    .map((word) => ({ start: word.startTime, end: word.endTime }));
}

function getAssistantFallbackMessage(action?: EditAction | null): string {
  switch (action?.type) {
    case 'transcribe_request':
      return 'I need a transcript for that section before I can finish the edit.';
    case 'delete_range':
    case 'delete_ranges':
      return 'I found the section to remove.';
    default:
      return 'I checked that section, but I need a clearer target before making an edit.';
  }
}

function formatSourceScopedProgressLabel(params: {
  sourceIndex: number;
  totalSources: number;
  fileName: string;
  actionLabel: string;
  completed: number;
  total: number;
}): string {
  const { sourceIndex, totalSources, fileName, actionLabel, completed, total } = params;
  return `Clip ${sourceIndex}/${totalSources} • ${fileName} • ${actionLabel} ${completed}/${Math.max(total, 1)}`;
}

function buildServerAnalysisStatusCards(params: {
  sources: Array<{
    sourceId: string;
    fileName: string;
    status: string;
    duration: number;
    storagePath: string | null;
    assetId: string | null;
  }>;
  analysisBySourceId: SourceIndexAnalysisStateMap;
  freshnessBySourceId: Record<string, { transcript?: boolean; overview?: boolean } | null | undefined>;
}): AnalysisStatusCard[] {
  const isVisualPreparationStage = (stage: IndexingProgress['stage']) => (
    stage === 'preparing_media'
    || stage === 'detecting_scenes'
  );

  const estimateTaskEtaSeconds = (
    kind: 'audio' | 'visual',
    duration: number,
    task: SourceIndexTaskState,
    progress: IndexingProgress | null,
  ) => {
    if (task.status === 'completed' || task.status === 'unavailable') return 0;

    const completedFraction = progress
      ? (getProgressValue(progress) ?? 0)
      : clampProgress(task.completed / Math.max(task.total, 1));
    const remainingFraction = 1 - completedFraction;
    if (remainingFraction <= 0) return 0;

    return Math.max(1, Math.round(estimateTranscriptSeconds(duration) * remainingFraction));
  };

  const buildFallbackTask = (
    kind: 'audio' | 'visual',
    source: { status: string },
    freshness: { transcript?: boolean; overview?: boolean } | null,
  ): SourceIndexTaskState => {
    if (source.status === 'missing') {
      return {
        status: 'failed',
        completed: 0,
        total: 1,
        etaSeconds: null,
        reason: 'Source media is missing.',
      };
    }
    if (source.status === 'error') {
      return {
        status: 'failed',
        completed: 0,
        total: 1,
        etaSeconds: null,
        reason: 'Upload failed.',
      };
    }
    const isReady = kind === 'audio' ? freshness?.transcript === true : freshness?.overview === true;
    return {
      status: isReady ? 'completed' : 'queued',
      completed: isReady ? 1 : 0,
      total: 1,
      etaSeconds: null,
      reason: null,
    };
  };

  const getDisplayTask = (
    kind: 'audio' | 'visual',
    source: { status: string },
    task: SourceIndexTaskState | null | undefined,
    freshness: { transcript?: boolean; overview?: boolean } | null,
  ): SourceIndexTaskState => {
    const isReady = kind === 'audio' ? freshness?.transcript === true : freshness?.overview === true;
    if (isReady) {
      const total = Math.max(task?.total ?? 1, 1);
      return {
        status: 'completed',
        completed: total,
        total,
        etaSeconds: null,
        reason: null,
      };
    }
    return task ?? buildFallbackTask(kind, source, freshness);
  };

  const trackedSources = params.sources.filter((source) => (
    Boolean(
      isServerBackedSource(source)
      || params.analysisBySourceId[source.sourceId]
    )
  ));
  if (trackedSources.length === 0) return [];

  const getTaskProgressStage = (
    kind: 'audio' | 'visual',
    analysis: SourceIndexAnalysisStateMap[string] | null | undefined,
  ): IndexingProgress['stage'] => {
    const stage = analysis?.progress?.stage;
    if (kind === 'audio') {
      return stage === 'transcribing_audio' || stage === 'transcribing'
        ? stage
        : 'transcribing_audio';
    }
    return stage === 'preparing_media'
      || stage === 'detecting_scenes'
      || stage === 'choosing_representative_frames'
      || stage === 'describing_representative_frames'
      ? stage
      : 'describing_representative_frames';
  };

  const buildAggregateCard = (kind: 'audio' | 'visual'): AnalysisStatusCard => {
    const taskEntries = trackedSources.map((source) => {
      const analysis = params.analysisBySourceId[source.sourceId] ?? null;
      const freshness = params.freshnessBySourceId[source.sourceId] ?? null;
      const task = getDisplayTask(kind, source, kind === 'audio' ? analysis?.audio : analysis?.visual, freshness);
      const progress = analysis?.progress?.stage === 'transcribing_audio' || analysis?.progress?.stage === 'transcribing'
        ? analysis.progress
        : null;
      const fallbackEtaSeconds = estimateTaskEtaSeconds(kind, source.duration, task, progress);
      return {
        analysis,
        fallbackEtaSeconds,
        progress,
        task,
        stage: getTaskProgressStage(kind, analysis),
      };
    });
    const tasks = taskEntries.map((entry) => entry.task);
    const total = tasks.length;
    const completed = tasks.filter((task) => (
      task.status === 'completed' || (kind === 'audio' && task.status === 'unavailable')
    )).length;
    const title = kind === 'audio' ? 'Video analysis' : 'Visual analysis';
    const completedStage = kind === 'audio' ? 'transcribing' : 'describing_frames';
    const firstReason = tasks.find((task) => task.reason)?.reason ?? null;
    const hasObservedProgress = taskEntries.some((entry) => {
      const fraction = entry.progress
        ? (getProgressValue(entry.progress) ?? 0)
        : clampProgress(entry.task.completed / Math.max(entry.task.total, 1));
      return fraction > 0 && fraction < 1;
    });
    const aggregateStatus = tasks.some((task) => task.status === 'running')
      || hasObservedProgress
      ? 'running'
      : tasks.some((task) => task.status === 'paused')
        ? 'paused'
        : tasks.some((task) => task.status === 'failed')
          ? 'failed'
          : 'queued';

    if (completed >= total) {
      return {
        key: `${kind}-analysis`,
        title,
        progress: buildCompletedProgress(completedStage),
        tone: 'completed',
      };
    }

    const progressFraction = taskEntries.reduce((sum, entry) => {
      if (entry.task.status === 'completed' || (kind === 'audio' && entry.task.status === 'unavailable')) {
        return sum + 1;
      }
      if (entry.progress) {
        return sum + (getProgressValue(entry.progress) ?? 0);
      }
      return sum + clampProgress(entry.task.completed / Math.max(entry.task.total, 1));
    }, 0) / Math.max(total, 1);

    const activeEntry = taskEntries.find((entry) => entry.task.status === 'running')
      ?? taskEntries.find((entry) => entry.task.status === 'paused')
      ?? taskEntries.find((entry) => {
        const fraction = entry.progress
          ? (getProgressValue(entry.progress) ?? 0)
          : clampProgress(entry.task.completed / Math.max(entry.task.total, 1));
        return fraction > 0 && fraction < 1;
      })
      ?? taskEntries.find((entry) => entry.task.status === 'queued')
      ?? taskEntries[0];
    const activeStage = activeEntry?.progress?.stage
      ?? activeEntry?.stage
      ?? (kind === 'audio' ? 'transcribing_audio' : 'describing_representative_frames');
    const averageEtaSeconds = aggregateStatus === 'failed'
      ? null
      : Math.max(...taskEntries.map((entry) => Math.max(
          entry.progress?.etaSeconds
            ?? entry.task.etaSeconds
            ?? entry.fallbackEtaSeconds
            ?? 0,
          0,
        )), 0) || null;

    const activeEtaSeconds = activeEntry
      ? stabilizeEtaEstimate({
          reportedEtaSeconds: activeEntry.progress?.etaSeconds
            ?? activeEntry.task.etaSeconds
            ?? averageEtaSeconds,
          fallbackEtaSeconds: activeEntry.fallbackEtaSeconds ?? averageEtaSeconds,
          completed: activeEntry.progress?.completed ?? activeEntry.task.completed,
          total: Math.max(activeEntry.progress?.total ?? activeEntry.task.total, 1),
        })
      : null;

    return {
      key: `${kind}-analysis`,
      title,
      progress: {
          stage: activeStage,
          completed: Math.round(progressFraction * 1000),
          total: 1000,
          label: aggregateStatus === 'paused'
            ? 'Video analysis paused'
            : aggregateStatus === 'failed'
            ? 'Video analysis issue'
              : 'Transcribing audio',
          etaSeconds: activeEtaSeconds,
        },
      secondaryLabel: aggregateStatus === 'failed'
        ? 'Issue'
        : aggregateStatus === 'paused'
          ? 'Paused'
          : aggregateStatus === 'queued'
            ? 'Waiting to start'
            : getIndexingStageTitle({
                stage: activeStage,
                completed: activeEntry?.task.completed ?? 0,
                total: Math.max(activeEntry?.task.total ?? 1, 1),
                label: null,
                etaSeconds: activeEntry?.task.etaSeconds ?? null,
              }),
      detail: aggregateStatus === 'failed' ? 'Video analysis could not be completed. Please try again.' : null,
    };
  };

  return [
    buildAggregateCard('audio'),
  ];
}

function isMarkerMutationAction(action?: EditAction | null): action is EditAction {
  return action?.type === 'add_marker'
    || action?.type === 'add_markers'
    || action?.type === 'update_marker'
    || action?.type === 'remove_marker';
}

function getMarkerActionResult(action: EditAction): string {
  if (action.type === 'add_marker') return 'Marker added.';
  if (action.type === 'add_markers') {
    const count = action.markers?.length ?? 0;
    return `${count} marker${count === 1 ? '' : 's'} added.`;
  }
  if (action.type === 'update_marker') return 'Marker updated.';
  if (action.type === 'remove_marker') return 'Marker removed.';
  return 'Marker updated.';
}

function getMarkerPrimaryLabel(marker: Pick<MarkerEntry, 'number'>): string {
  return formatMarkerReferenceToken(marker.number);
}

function getMarkerSecondaryLabel(marker: Pick<MarkerEntry, 'timelineTime' | 'label'>): string {
  return marker.label?.trim() || formatChatTime(marker.timelineTime);
}

function getReviewItemCount(action?: EditAction | null): number {
  if (!action || action.type === 'none') return 0;
  if (action.type === 'delete_ranges') return action.ranges?.length ?? 0;
  if (action.type === 'add_captions') return action.captions?.length ?? (action.transcriptRange ? 1 : 0);
  if (action.type === 'add_transition') return action.transitions?.length ?? 0;
  if (action.type === 'add_markers') return action.markers?.length ?? 0;
  if (action.type === 'add_text_overlay') return action.textOverlays?.length ?? 0;
  return 1;
}

function getMarkerActionSeekTime(
  action: EditAction,
  existingMarkers: MarkerEntry[],
): number | null {
  if (action.type === 'add_marker') {
    return typeof action.marker?.timelineTime === 'number' ? action.marker.timelineTime : null;
  }
  if (action.type === 'add_markers') {
    const firstMarker = action.markers?.find((marker) => typeof marker.timelineTime === 'number');
    return typeof firstMarker?.timelineTime === 'number' ? firstMarker.timelineTime : null;
  }
  if (action.type === 'update_marker') {
    if (typeof action.marker?.timelineTime === 'number') return action.marker.timelineTime;
    if (!action.markerId) return null;
    return existingMarkers.find((marker) => marker.id === action.markerId)?.timelineTime ?? null;
  }
  if (action.type === 'remove_marker') {
    if (!action.markerId) return null;
    return existingMarkers.find((marker) => marker.id === action.markerId)?.timelineTime ?? null;
  }
  return null;
}

function getReviewAnchorTime(snapshot: EditSnapshot, action: EditAction): number | null {
  if (action.type === 'split_clip') {
    return action.splitTime ?? null;
  }

  if (action.type === 'delete_range') {
    return action.deleteStartTime ?? null;
  }

  if (action.type === 'delete_ranges') {
    return action.ranges?.[0]?.start ?? null;
  }

  if (action.type === 'add_captions') {
    return action.captions?.[0]?.startTime ?? action.transcriptRange?.startTime ?? null;
  }

  if (action.type === 'add_transition') {
    return action.transitions?.[0]?.atTime ?? null;
  }

  if (action.type === 'add_text_overlay') {
    return action.textOverlays?.[0]?.startTime ?? null;
  }

  if (action.type === 'replace_text_overlay') {
    return action.textOverlays?.[0]?.startTime ?? null;
  }

  if (
    action.type === 'delete_clip'
    || action.type === 'reorder_clip'
    || action.type === 'set_clip_speed'
    || action.type === 'set_clip_volume'
    || action.type === 'set_clip_filter'
  ) {
    const clipIndex = action.clipIndex ?? 0;
    const schedule = buildClipSchedule(snapshot.clips, snapshot.transitions);
    return schedule[clipIndex]?.timelineStart ?? null;
  }

  return null;
}

function getReviewSeekTime(snapshot: EditSnapshot, action: EditAction): number | null {
  const anchor = getReviewAnchorTime(snapshot, action);
  if (anchor === null) return null;
  const timelineDuration = getTimelineDuration(snapshot.clips, snapshot.transitions);
  return Math.max(0, Math.min(Math.max(0, timelineDuration), anchor - REVIEW_PREROLL_SECONDS));
}

function getReviewApplyResult(action: EditAction, reviewCount: number): string {
  if (action.type === 'add_captions') {
    const count = action.captions?.length ?? 0;
    return count > 0
      ? `Added ${count} caption${count === 1 ? '' : 's'}.`
      : 'Added captions.';
  }

  if (action.type === 'add_transition') {
    const count = action.transitions?.length ?? 0;
    return `Added ${count} transition${count === 1 ? '' : 's'}.`;
  }

  if (action.type === 'add_markers') {
    const count = action.markers?.length ?? 0;
    return `${count} marker${count === 1 ? '' : 's'} added.`;
  }

  if (action.type === 'add_text_overlay') {
    const count = action.textOverlays?.length ?? 0;
    return `Added ${count} text overlay${count === 1 ? '' : 's'}.`;
  }

  if (reviewCount > 1) {
    return `Committed ${reviewCount} changes.`;
  }

  return 'Change applied.';
}

function formatChatTime(seconds: number): string {
  return Math.abs(seconds - Math.round(seconds)) < 0.001
    ? formatTime(seconds)
    : formatTimePrecise(seconds);
}

function upsertMarkersFromVisualSearch(
  query: string,
  session: VisualSearchSession | null | undefined,
  addMarker: ReturnType<typeof useEditorStore.getState>['addMarker'],
) {
  if (!session) return;
  const proposalRanges = session.proposal?.timelineRanges ?? [];
  const fallbackRanges = proposalRanges.length > 0
    ? []
    : session.candidates.slice(0, 3).map((candidate) => ({
        timelineStart: candidate.sourceStart,
        timelineEnd: candidate.sourceEnd,
      }));
  const ranges = proposalRanges.length > 0 ? proposalRanges : fallbackRanges;
  if (ranges.length === 0) return;

  const existing = useEditorStore.getState().markers;
  ranges.forEach((range, index) => {
    const timelineTime = range.timelineStart;
    const alreadyExists = existing.some((marker) => (
      marker.note === query && Math.abs(marker.timelineTime - timelineTime) < 0.1
    ));
    if (alreadyExists) return;
    addMarker({
      timelineTime,
      label: `Finding ${index + 1}`,
      createdBy: 'ai',
      status: 'open',
      linkedRange: { startTime: range.timelineStart, endTime: range.timelineEnd },
      confidence: session.confidenceBand === 'high' ? 0.9 : session.confidenceBand === 'medium' ? 0.7 : 0.5,
      note: query,
    });
  });
}

// ─── Action card config ────────────────────────────────────────────────────────
function getActionMeta(action: EditAction): { label: string; color: string; summary: string } {
  switch (action.type) {
    case 'split_clip':
      return {
        label: 'Split clip',
        color: '#f59e0b',
        summary: action.splitTime !== undefined ? `at ${formatChatTime(action.splitTime)}` : '',
      };
    case 'delete_clip':
      return {
        label: `Delete clip ${(action.clipIndex ?? 0) + 1}`,
        color: '#ef4444',
        summary: '',
      };
    case 'delete_range':
      return {
        label: 'Cut range',
        color: '#ef4444',
        summary: action.deleteStartTime !== undefined && action.deleteEndTime !== undefined
          ? `${formatChatTime(action.deleteStartTime)} → ${formatChatTime(action.deleteEndTime)}`
          : '',
      };
    case 'delete_ranges':
      return {
        label: `Cut ${action.ranges?.length ?? 0} section${(action.ranges?.length ?? 0) !== 1 ? 's' : ''}`,
        color: '#ef4444',
        summary: `${action.ranges?.length ?? 0} range${(action.ranges?.length ?? 0) !== 1 ? 's' : ''}`,
      };
    case 'set_clip_speed':
      return {
        label: `Speed clip ${(action.clipIndex ?? 0) + 1}`,
        color: '#f87171',
        summary: action.speed !== undefined ? `${action.speed}×` : '',
      };
    case 'set_clip_volume':
      return {
        label: `Volume clip ${(action.clipIndex ?? 0) + 1}`,
        color: '#34d399',
        summary: [
          action.volume !== undefined ? `${Math.round(action.volume * 100)}%` : '',
          action.fadeIn ? `fade in ${action.fadeIn}s` : '',
          action.fadeOut ? `fade out ${action.fadeOut}s` : '',
        ].filter(Boolean).join(', '),
      };
    case 'set_clip_filter':
      return {
        label: `Filter clip ${(action.clipIndex ?? 0) + 1}`,
        color: '#818cf8',
        summary: action.filter?.type ?? 'none',
      };
    case 'transcribe_request': {
      const seg = action.segments?.[0];
      return {
        label: 'Transcribe audio',
        color: '#f59e0b',
        summary: seg ? `${formatChatTime(seg.startTime)} → ${formatChatTime(seg.endTime)}` : '',
      };
    }
    case 'update_ai_settings':
      return {
        label: 'Update AI settings',
        color: '#facc15',
        summary: 'Defaults updated',
      };
    case 'add_captions':
      {
        const summary = action.transcriptRange
          ? `${formatChatTime(action.transcriptRange.startTime)} → ${formatChatTime(action.transcriptRange.endTime)}`
          : 'Subtitle track';
        if (action.transcriptRange && !action.captions?.length) {
          return {
            label: 'Add captions',
            color: '#f59e0b',
            summary,
          };
        }
        const captionCount = action.captions?.length ?? 0;
        return {
          label: `Add ${captionCount} caption${captionCount !== 1 ? 's' : ''}`,
          color: '#f59e0b',
          summary,
        };
      }
    case 'reorder_clip':
      return {
        label: `Move clip ${(action.clipIndex ?? 0) + 1}`,
        color: '#38bdf8',
        summary: action.newIndex === 0 ? 'to front' : `to position ${(action.newIndex ?? 0) + 1}`,
      };
    case 'add_transition':
      return {
        label: `Add ${action.transitions?.length ?? 0} transition${(action.transitions?.length ?? 0) !== 1 ? 's' : ''}`,
        color: 'rgba(255,255,255,0.6)',
        summary: (action.transitions ?? []).map(t => t.type).join(', '),
      };
    case 'add_marker':
      return {
        label: 'Add marker',
        color: '#facc15',
        summary: action.marker?.timelineTime !== undefined ? formatChatTime(action.marker.timelineTime) : '',
      };
    case 'add_markers':
      return {
        label: `Add ${action.markers?.length ?? 0} marker${(action.markers?.length ?? 0) !== 1 ? 's' : ''}`,
        color: '#facc15',
        summary: 'Review findings',
      };
    case 'add_text_overlay':
      return {
        label: `Add ${action.textOverlays?.length ?? 0} text overlay${(action.textOverlays?.length ?? 0) !== 1 ? 's' : ''}`,
        color: '#a78bfa',
        summary: 'Text track',
      };
    default:
      return { label: 'Edit', color: 'var(--accent)', summary: '' };
  }
}

function ReviewCheckboxButton({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      data-checked={checked ? 'true' : 'false'}
      className="chat-review-checkbox"
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
    >
      <span className="chat-review-checkbox__box" aria-hidden="true">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            width: 14,
            height: 14,
            opacity: checked ? 1 : 0,
            transform: checked ? 'scale(1)' : 'scale(0.72)',
            transition: 'opacity 140ms ease, transform 140ms ease',
          }}
        >
          <path
            d="M3.5 8.4L6.4 11.2L12.5 4.8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}

function ActionDetails({ action }: { action: EditAction }) {
  if (action.type === 'delete_ranges') {
    const ranges = action.ranges ?? [];
    return (
      <div style={{ padding: '6px 12px 8px', display: 'flex', flexDirection: 'column' }}>
        {ranges.map((r, i) => (
          <div key={i} style={{
            padding: '4px 0',
            borderBottom: i < ranges.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
          }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 10, color: 'var(--fg-muted)' }}>
              {formatChatTime(r.start)} – {formatChatTime(r.end)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (action.type === 'split_clip') {
    return (
      <div style={{ padding: '6px 12px 8px' }}>
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 10, color: 'var(--fg-secondary)' }}>
          Split at {action.splitTime !== undefined ? formatChatTime(action.splitTime) : '—'}
        </span>
      </div>
    );
  }

  if (action.type === 'delete_range') {
    return (
      <div style={{ padding: '6px 12px 8px' }}>
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 10, color: 'var(--fg-secondary)' }}>
          Remove {action.deleteStartTime !== undefined ? formatChatTime(action.deleteStartTime) : '—'} – {action.deleteEndTime !== undefined ? formatChatTime(action.deleteEndTime) : '—'}
        </span>
      </div>
    );
  }

  if (action.type === 'set_clip_speed') {
    return (
      <div style={{ padding: '6px 12px 8px' }}>
        <span style={{
          fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-serif)',
          color: (action.speed ?? 1) > 1 ? '#f87171' : '#60a5fa',
        }}>
          {action.speed}×
        </span>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)', marginLeft: 6 }}>
          {(action.speed ?? 1) > 1 ? 'fast forward' : (action.speed ?? 1) < 1 ? 'slow motion' : 'normal'}
        </span>
      </div>
    );
  }

  if (action.type === 'set_clip_volume') {
    return (
      <div style={{ padding: '6px 12px 8px' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--fg-primary)' }}>
            Level: <strong>{Math.round((action.volume ?? 1) * 100)}%</strong>
          </span>
          {action.fadeIn ? <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>fade in {action.fadeIn}s</span> : null}
          {action.fadeOut ? <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>fade out {action.fadeOut}s</span> : null}
        </div>
      </div>
    );
  }

  if (action.type === 'set_clip_filter') {
    const f = action.filter;
    return (
      <div style={{ padding: '6px 12px 8px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{
            width: 28, height: 18, borderRadius: 3,
            background: f?.type === 'bw' ? 'linear-gradient(90deg, #888, #ccc)' :
                        f?.type === 'warm' ? 'linear-gradient(90deg, #c76b2e, #e8a950)' :
                        f?.type === 'cool' ? 'linear-gradient(90deg, #2e6bc7, #50a0e8)' :
                        f?.type === 'vintage' ? 'linear-gradient(90deg, #8B6914, #c9a227)' :
                        f?.type === 'cinematic' ? 'linear-gradient(90deg, #1a1a3e, #4a2080)' :
                        'rgba(255,255,255,0.1)',
          }} />
          <span style={{ fontSize: 12, color: 'var(--fg-primary)', fontWeight: 500 }}>
            {f?.type ?? 'none'}
          </span>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
            {Math.round((f?.intensity ?? 1) * 100)}%
          </span>
        </div>
      </div>
    );
  }

  if (action.type === 'add_captions') {
    if (!action.captions?.length && action.transcriptRange) {
      return (
        <div style={{ padding: '6px 12px 8px' }}>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 10, color: 'var(--fg-secondary)' }}>
            Transcript-backed captions for {formatChatTime(action.transcriptRange.startTime)} to {formatChatTime(action.transcriptRange.endTime)}.
          </span>
        </div>
      );
    }
    return (
      <div style={{ padding: '6px 12px 8px', display: 'flex', flexDirection: 'column' }}>
        {(action.captions ?? []).map((c, i) => (
          <div key={i} style={{
            padding: '3px 0',
            borderBottom: i < (action.captions ?? []).length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
          }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 10, color: 'var(--fg-muted)', marginRight: 6 }}>
              {formatChatTime(c.startTime)}
            </span>
            <span style={{ fontSize: 11, color: 'var(--fg-secondary)' }}>{c.text}</span>
          </div>
        ))}
      </div>
    );
  }

  if (action.type === 'update_ai_settings') {
    const settings = action.settings;
    const details = [
      settings?.silenceRemoval?.paddingSeconds !== undefined ? `silence padding ${settings.silenceRemoval.paddingSeconds}s` : '',
      settings?.silenceRemoval?.minDurationSeconds !== undefined ? `min silence ${settings.silenceRemoval.minDurationSeconds}s` : '',
      settings?.frameInspection?.defaultFrameCount !== undefined ? `inspect ${settings.frameInspection.defaultFrameCount} frames` : '',
      settings?.frameInspection?.overviewIntervalSeconds !== undefined ? `long-video coarse spacing ~${settings.frameInspection.overviewIntervalSeconds}s` : '',
      settings?.frameInspection?.maxOverviewFrames !== undefined ? `max ${settings.frameInspection.maxOverviewFrames} coarse frames` : '',
      settings?.captions?.wordsPerCaption !== undefined ? `${settings.captions.wordsPerCaption} words per caption` : '',
      settings?.transitions?.defaultDuration !== undefined ? `${settings.transitions.defaultDuration}s transitions` : '',
      settings?.textOverlays?.defaultFontSize !== undefined ? `${settings.textOverlays.defaultFontSize}px text` : '',
    ].filter(Boolean);
    return (
      <div style={{ padding: '6px 12px 8px' }}>
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 10, color: 'var(--fg-secondary)' }}>
          {details.length > 0 ? details.join(', ') : 'AI editing defaults updated for future requests.'}
        </span>
      </div>
    );
  }

  if (action.type === 'add_transition') {
    return (
      <div style={{ padding: '6px 12px 8px' }}>
        {(action.transitions ?? []).map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 10, color: 'var(--fg-muted)' }}>
              {formatChatTime(t.atTime)}
            </span>
            <span style={{ fontSize: 10, color: 'var(--fg-secondary)' }}>{t.type}</span>
            <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{t.duration}s</span>
          </div>
        ))}
      </div>
    );
  }

  if (action.type === 'add_marker' || action.type === 'add_markers') {
    const markers = action.type === 'add_marker' ? [action.marker] : action.markers;
    return (
      <div style={{ padding: '6px 12px 8px' }}>
        {(markers ?? []).filter(Boolean).map((marker, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 10, color: 'var(--fg-secondary)' }}>
              {typeof marker?.number === 'number' ? getMarkerPrimaryLabel({ number: marker.number }) : `Marker ${i + 1}`}
            </span>
            <span style={{ fontSize: 10, color: 'var(--fg-secondary)' }}>
              {marker?.timelineTime !== undefined ? formatChatTime(marker.timelineTime) : '—'}
            </span>
            {marker?.label && <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{marker.label}</span>}
          </div>
        ))}
      </div>
    );
  }

  if (action.type === 'add_text_overlay') {
    return (
      <div style={{ padding: '6px 12px 8px', display: 'flex', flexDirection: 'column' }}>
        {(action.textOverlays ?? []).map((t, i) => (
          <div key={i} style={{
            padding: '2px 0',
            borderBottom: i < (action.textOverlays ?? []).length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
          }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 10, color: 'var(--fg-muted)', marginRight: 6 }}>
              {formatChatTime(t.startTime)}–{formatChatTime(t.endTime)}
            </span>
            <span style={{ fontSize: 11, color: 'var(--fg-secondary)' }}>{t.text}</span>
            <span style={{ fontSize: 10, color: 'var(--fg-muted)', marginLeft: 5 }}>({t.position})</span>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

// ─── Markdown renderer ─────────────────────────────────────────────────────────
function renderMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

function MarkerAwareText({ text }: { text: string }) {
  const markers = useEditorStore(s => s.markers);
  const clips = useEditorStore(s => s.previewSnapshot?.clips ?? s.clips);
  const transitions = useEditorStore(s => s.previewSnapshot?.transitions ?? s.transitions);
  const requestSeek = useEditorStore(s => s.requestSeek);
  const setSelectedItem = useEditorStore(s => s.setSelectedItem);
  const schedule = useMemo(() => buildClipSchedule(clips, transitions), [clips, transitions]);
  const parts = text.split(/(@clip\s+\d+|@marker\s+\d+|(?:marker|bookmark)\s+\d+|@\d+)/gi);

  return parts.map((part, index) => {
    const clipMatch = part.match(/@clip\s+(\d+)/i);
    if (clipMatch) {
      const clipNumber = Number(clipMatch[1]);
      const clipIndex = clipNumber - 1;
      const clip = clips[clipIndex];
      const clipStartTime = schedule[clipIndex]?.timelineStart;
      if (!clip || clipStartTime === undefined) return <span key={index}>{part}</span>;
      return (
        <button
          key={index}
          onClick={() => {
            setSelectedItem({ type: 'clip', id: clip.id });
            requestSeek(clipStartTime);
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            margin: '0 2px',
            padding: '1px 6px',
            borderRadius: 999,
            border: '1px solid rgba(56,189,248,0.28)',
            background: 'rgba(56,189,248,0.12)',
            color: '#7dd3fc',
            fontSize: 11,
            fontFamily: 'var(--font-serif)',
            cursor: 'pointer',
          }}
        >
          {formatClipReferenceToken(clipNumber)}
        </button>
      );
    }

    const markerMatch = part.match(/@marker\s+(\d+)|(?:marker\s+|bookmark\s+|@)(\d+)/i);
    if (!markerMatch) return <span key={index}>{renderMarkdown(part)}</span>;
    const markerNumber = Number(markerMatch[1] ?? markerMatch[2]);
    const marker = markers.find((entry) => entry.number === markerNumber);
    if (!marker) return <span key={index}>{part}</span>;

    const label = /^@\d+$/.test(part.trim())
      ? formatMarkerReferenceToken(marker.number)
      : part.trim().replace(/^bookmark/i, 'marker');

    return (
      <button
        key={index}
        onClick={() => {
          setSelectedItem({ type: 'marker', id: marker.id });
          requestSeek(marker.timelineTime);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          margin: '0 2px',
          padding: '1px 6px',
          borderRadius: 999,
          border: '1px solid rgba(250,204,21,0.28)',
          background: 'rgba(250,204,21,0.12)',
          color: '#fde68a',
          fontSize: 11,
          fontFamily: 'var(--font-serif)',
          cursor: 'pointer',
        }}
      >
        {label}
      </button>
    );
  });
}

function AutoAvatar({ size = 28 }: { size?: number }) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: 10,
      background: '#0A0A0A',
      border: '1px solid rgba(255,255,255,0.12)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
      flexShrink: 0,
    }}>
      <AutocutMark
        size={Math.max(16, Math.round(size * 0.78))}
        withTile={false}
      />
    </div>
  );
}

function AutoIdentity({
  subtitle,
}: {
  subtitle?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span style={{
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--fg-primary)',
        fontFamily: 'var(--font-serif)',
        letterSpacing: 0.1,
      }}>
        Auto
      </span>
      {subtitle && (
        <span style={{
          fontSize: 10,
          color: 'var(--fg-muted)',
          fontFamily: 'var(--font-serif)',
          whiteSpace: 'nowrap',
        }}>
          {subtitle}
        </span>
      )}
    </div>
  );
}

// ─── Message bubbles ───────────────────────────────────────────────────────────
function UserMessage({ msg }: { msg: ChatMessageType }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', marginBottom: 8 }}>
      <div style={{
        display: 'inline-block',
        maxWidth: '72%',
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '10px 10px 2px 10px',
        padding: '8px 12px',
        fontSize: 13,
        color: 'var(--fg-primary)',
        lineHeight: 1.55,
        fontFamily: 'var(--font-serif)',
        marginLeft: 'auto',
        textAlign: 'left',
        wordBreak: 'break-word',
      }}>
        <MarkerAwareText text={msg.content} />
      </div>
    </div>
  );
}

function AssistantMessage({
  msg,
  onTranscriptReady,
  onActionResolved,
}: {
  msg: ChatMessageType;
  onTranscriptReady: (messageId: string) => Promise<void>;
  onActionResolved: (messageId: string, action: EditAction, actionResult?: string | null) => Promise<void>;
}) {
  const videoUrl = useEditorStore(s => s.videoUrl);
  const processingVideoUrl = useEditorStore(s => s.processingVideoUrl);
  const videoFile = useEditorStore(s => s.videoFile);
  const videoData = useEditorStore(s => s.videoData);
  const videoDuration = useEditorStore(s => s.videoDuration);
  const sources = useEditorStore(s => s.sources);
  const sourceRuntimeById = useEditorStore(s => s.sourceRuntimeById);
  const clips = useEditorStore(s => s.previewSnapshot?.clips ?? s.clips);
  const previewOwnerId = useEditorStore(s => s.previewOwnerId);
  const commitPreviewSnapshot = useEditorStore(s => s.commitPreviewSnapshot);
  const activeReviewSession = useEditorStore(s => s.activeReviewSession);
  const activeReviewFocusItemId = useEditorStore(s => s.activeReviewFocusItemId);
  const setActiveReviewSession = useEditorStore(s => s.setActiveReviewSession);
  const setActiveReviewFocusItemId = useEditorStore(s => s.setActiveReviewFocusItemId);
  const requestSeek = useEditorStore(s => s.requestSeek);
  const applyStoredAction = useEditorStore(s => s.applyAction);
  const recordAppliedAction = useEditorStore(s => s.recordAppliedAction);
  const updateMessage = useEditorStore(s => s.updateMessage);
  const appliedActions = useEditorStore(s => s.appliedActions);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [reviewResult, setReviewResult] = useState<string | null>(null);
  const [transcriptionDone, setTranscriptionDone] = useState(false);

  const setBackgroundTranscript = useEditorStore(s => s.setBackgroundTranscript);
  const setTranscriptProgress = useEditorStore(s => s.setTranscriptProgress);
  const existingSourceTranscriptCaptions = useEditorStore(s => s.sourceTranscriptCaptions);
  const availableSourcesById = useMemo(
    () => new Map(resolveProjectSources({
      sources,
      runtimeBySourceId: sourceRuntimeById,
      primaryFallback: {
        videoData,
        videoFile,
        videoUrl,
        processingVideoUrl,
        videoDuration,
      },
    }).map((entry) => [entry.sourceId, entry])),
    [processingVideoUrl, sourceRuntimeById, sources, videoData, videoDuration, videoFile, videoUrl],
  );
  const addMessage = useEditorStore(s => s.addMessage);

  const action = msg.action;
  const hasAction = action && action.type !== 'none';
  const activeReviewAction = action ?? null;
  const anotherReviewActive = previewOwnerId !== null && previewOwnerId !== msg.id;
  const reviewSessionForMessage = activeReviewSession?.ownerId === msg.id ? activeReviewSession : null;
  const reviewSteps = reviewSessionForMessage?.items ?? [];
  const liveActionState = useMemo(
    () => getLiveMessageActionState(msg, appliedActions),
    [appliedActions, msg],
  );
  const actionPreviouslyApplied = liveActionState.isApplied;
  const actionResolved = liveActionState.actionStatus === 'completed'
    || liveActionState.actionStatus === 'rejected';
  const reviewableAction = !!action
    && action.type !== 'none'
    && action.type !== 'transcribe_request'
    && action.type !== 'update_ai_settings';
  const batchReviewActive = !!reviewSessionForMessage && reviewableAction;
  const meta = activeReviewAction ? getActionMeta(activeReviewAction) : null;
  const reviewableItemCount = getReviewItemCount(action);
  const actionResultText = liveActionState.actionResult ?? (
    liveActionState.actionStatus === 'rejected'
      ? 'No changes applied.'
      : liveActionState.autoApplied
        ? 'Auto-applied ✓'
        : actionPreviouslyApplied
          ? 'Already applied.'
          : null
  );

  useEffect(() => () => {
    if (useEditorStore.getState().activeReviewSession?.ownerId === msg.id) {
      useEditorStore.getState().setActiveReviewSession(null);
    }
  }, [msg.id]);

  useEffect(() => {
    if (!actionPreviouslyApplied || msg.actionStatus === 'completed' || msg.actionStatus === 'rejected') return;
    updateMessage(msg.id, { actionStatus: 'completed', actionResult: actionResultText ?? 'Already applied.' });
  }, [actionPreviouslyApplied, actionResultText, msg.actionStatus, msg.id, updateMessage]);

  const reviewedAction = useMemo(
    () => (reviewSessionForMessage ? collapseReviewItemsToAction(reviewSessionForMessage) : null),
    [reviewSessionForMessage],
  );
  const allReviewItemsChecked = reviewSteps.length > 0 && reviewSteps.every((item) => item.checked);
  const checkedReviewCount = reviewSteps.filter((item) => item.checked).length;

  const startReview = useCallback(() => {
    if (
      !action
      || !reviewableAction
      || anotherReviewActive
    ) return;
    const state = useEditorStore.getState();
    const baseSnapshot: EditSnapshot = {
      clips: state.clips,
      captions: state.captions,
      transitions: state.transitions,
      markers: state.markers,
      textOverlays: state.textOverlays,
    };
    const nextReviewGroup = createReviewGroup(msg.id, action, baseSnapshot, {
      sourceTranscriptCaptions: existingSourceTranscriptCaptions,
    });
    if (!nextReviewGroup) return;
    setReviewResult(null);
    setActiveReviewSession(nextReviewGroup);
    const reviewSeekTime = getReviewSeekTime(baseSnapshot, action);
    if (reviewSeekTime !== null) requestSeek(reviewSeekTime);
  }, [action, anotherReviewActive, existingSourceTranscriptCaptions, msg.id, requestSeek, reviewableAction, setActiveReviewSession]);

  const cancelReview = useCallback(() => {
    setActiveReviewSession(null);
    setReviewResult(null);
  }, [setActiveReviewSession]);

  const toggleReviewAll = useCallback((checked: boolean) => {
    if (!reviewSessionForMessage) return;
    const nextGroup = buildReviewGroupWithUpdatedItems(
      reviewSessionForMessage,
      (items) => items.map((item) => ({ ...item, checked })),
    );
    setActiveReviewSession(nextGroup);
    setReviewResult(null);
  }, [reviewSessionForMessage, setActiveReviewSession]);

  const toggleReviewItem = useCallback((itemId: string, checked: boolean) => {
    if (!reviewSessionForMessage) return;
    const nextGroup = buildReviewGroupWithUpdatedItems(
      reviewSessionForMessage,
      (items) => items.map((item) => (item.id === itemId ? { ...item, checked } : item)),
    );
    setActiveReviewSession(nextGroup);
    setReviewResult(null);
  }, [reviewSessionForMessage, setActiveReviewSession]);

  const focusReviewItem = useCallback((itemId: string) => {
    if (!reviewSessionForMessage) return;
    const target = reviewSessionForMessage.items.find((item) => item.id === itemId);
    if (!target) return;
    setActiveReviewFocusItemId(itemId);
    const anchor = target.anchorTime;
    if (anchor !== null) {
      const previewSnapshot = buildReviewPreviewSnapshot(reviewSessionForMessage);
      const removedDurationBeforeAnchor = target.action.type === 'delete_range'
        ? reviewSessionForMessage.items.reduce((sum, item) => {
            if (!item.checked || item.id === target.id || item.action.type !== 'delete_range') return sum;
            const start = item.action.deleteStartTime ?? 0;
            const end = item.action.deleteEndTime ?? 0;
            return end <= anchor ? sum + Math.max(0, end - start) : sum;
          }, 0)
        : 0;
      const adjustedAnchor = Math.max(0, anchor - removedDurationBeforeAnchor);
      const reviewSeekTime = target.action.type === 'delete_range'
        ? Math.max(0, adjustedAnchor - REVIEW_PREROLL_SECONDS)
        : (getReviewSeekTime(previewSnapshot, target.action) ?? Math.max(0, adjustedAnchor - REVIEW_PREROLL_SECONDS));
      requestSeek(reviewSeekTime);
    }
  }, [requestSeek, reviewSessionForMessage, setActiveReviewFocusItemId]);

  const handleApplyReviewedAction = useCallback(() => {
    if (!reviewSessionForMessage || !reviewedAction) return;
    const nextSnapshot = buildReviewPreviewSnapshot(reviewSessionForMessage);
    const sourceRanges = sourceRangesForAction(reviewSessionForMessage.baseSnapshot.clips, reviewedAction);
    const result = getReviewApplyResult(reviewedAction, checkedReviewCount);
    commitPreviewSnapshot(nextSnapshot);
    recordAppliedAction(reviewedAction, result, {
      sourceRanges,
      requestChainId: msg.requestChainId,
    });
    updateMessage(msg.id, {
      actionStatus: 'completed',
      actionResult: result,
    });
    capture('chat_action_applied', { action_count: checkedReviewCount, action_types: [reviewedAction.type] });
    if (reviewedAction.type === 'set_clip_filter' && reviewedAction.filter) {
      capture('filter_applied', { filter_name: reviewedAction.filter.type });
    }
    if (reviewedAction.type === 'delete_ranges' && reviewedAction.ranges) {
      capture('silence_removed', { silence_count: reviewedAction.ranges.length });
    }
    setActiveReviewSession(null);
    setActiveReviewFocusItemId(null);
    setReviewResult(result);
    void onActionResolved(msg.id, reviewedAction, result);
  }, [checkedReviewCount, commitPreviewSnapshot, msg.id, msg.requestChainId, onActionResolved, recordAppliedAction, reviewSessionForMessage, reviewedAction, setActiveReviewFocusItemId, setActiveReviewSession, updateMessage]);

  const handleTranscribe = useCallback(async () => {
    if (!action || action.type !== 'transcribe_request') return;
    const seg = action.segments?.[0];
    if (!seg) return;

    setIsTranscribing(true);
    setTranscribeError(null);
    try {
      // Map the timeline range to source segments so timestamps reflect the current edit state
      const sourceSegs = getSourceSegmentsForTimelineRange(clips, seg.startTime, seg.endTime);
      if (sourceSegs.length === 0) throw new Error('No source segments found for requested range');

      const state = useEditorStore.getState();
      const rangesBySource = new Map<string, Array<{ startTime: number; endTime: number }>>();
      sourceSegs.forEach((sourceSeg) => {
        const ranges = buildOverlappingRanges(sourceSeg.sourceStart, sourceSeg.sourceStart + sourceSeg.sourceDuration);
        const existing = rangesBySource.get(sourceSeg.sourceId) ?? [];
        rangesBySource.set(sourceSeg.sourceId, [...existing, ...ranges]);
      });

      const totalChunks = [...rangesBySource.values()].reduce((sum, ranges) => sum + ranges.length, 0);
      if (totalChunks === 0) throw new Error('No source ranges found for requested transcript');
      let completedChunks = 0;
      const rawCaptions: CaptionEntry[] = [];
      setTranscriptProgress({ completed: 0, total: totalChunks });

      for (const [sourceId, ranges] of rangesBySource) {
        const sourceEntry = availableSourcesById.get(sourceId);
        if (!sourceEntry?.source) {
          throw new Error(`Missing media source for transcript request (${sourceId}).`);
        }
        const captionsForSource = await transcribeSourceRanges(
          sourceEntry.source,
          ranges,
          state.aiSettings.captions.wordsPerCaption,
          {
            sourceId,
            onProgress: ({ completed }) => {
              setTranscriptProgress({ completed: completedChunks + completed, total: totalChunks });
            },
          },
        );
        completedChunks += ranges.length;
        rawCaptions.push(...captionsForSource);
      }

      const mergedCaptions = dedupeCaptionEntries([...(existingSourceTranscriptCaptions ?? []), ...rawCaptions]);
      const transcriptText = buildTranscriptContext(clips, mergedCaptions);
      setBackgroundTranscript(transcriptText, 'done', mergedCaptions, null, { markFresh: false });
      addMessage({
        role: 'assistant',
        content: `Transcript ready for ${formatTime(seg.startTime)} to ${formatTime(seg.endTime)}. Continuing with your request.`,
        requestChainId: msg.requestChainId,
      });
      setTranscriptionDone(true);
      updateMessage(msg.id, { actionStatus: 'completed', actionResult: 'Transcript ready ✓' });
      await onTranscriptReady(msg.id);
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsTranscribing(false);
    }
  }, [action, addMessage, availableSourcesById, clips, existingSourceTranscriptCaptions, msg.id, msg.requestChainId, onTranscriptReady, setBackgroundTranscript, setTranscriptProgress, updateMessage]);

  const handleApplySettings = useCallback(() => {
    if (!action || action.type !== 'update_ai_settings') return;
    applyStoredAction(action);
    recordAppliedAction(action, action.message, { requestChainId: msg.requestChainId });
    updateMessage(msg.id, { actionStatus: 'completed', actionResult: 'AI settings updated.' });
    setReviewResult('AI settings updated.');
    void onActionResolved(msg.id, action, 'AI settings updated.');
  }, [action, applyStoredAction, msg.id, msg.requestChainId, onActionResolved, recordAppliedAction, updateMessage]);

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 10, width: '100%', marginBottom: 10 }}>
      <AutoAvatar />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', maxWidth: '72%' }}>
        <div style={{ marginBottom: 6 }}>
          <AutoIdentity />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
          <div style={{
            display: 'inline-block',
            fontSize: 13,
            color: 'var(--fg-secondary)',
            lineHeight: 1.65,
            fontFamily: 'var(--font-serif)',
            padding: '10px 12px',
            borderRadius: '10px 10px 10px 2px',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.025))',
            border: '1px solid rgba(255,255,255,0.07)',
            maxWidth: '100%',
            alignSelf: 'flex-start',
            textAlign: 'left',
            wordBreak: 'break-word',
          }}>
            <MarkerAwareText text={msg.content} />
          </div>
        </div>

        {hasAction && meta && (
          <div style={{
            marginTop: 10,
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 7,
            overflow: 'hidden',
            background: 'var(--bg-elevated)',
            width: '100%',
          }}>
            <div style={{
              padding: '7px 12px',
              background: 'rgba(255,255,255,0.03)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              display: 'flex', alignItems: 'center', gap: 8,
              cursor: reviewableAction && !anotherReviewActive ? 'pointer' : 'default',
            }}
              onClick={() => {
                if (!reviewableAction) return;
                if (batchReviewActive) {
                  setActiveReviewFocusItemId(null);
                  return;
                }
                startReview();
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
              <span style={{
                fontSize: 12, color: 'var(--fg-primary)', fontWeight: 600,
                fontFamily: 'var(--font-serif)',
              }}>
                {meta.label}
              </span>
              {meta.summary && (
                <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-serif)' }}>
                  - {meta.summary}
                </span>
              )}
            </div>

            <ActionDetails action={activeReviewAction!} />
            {batchReviewActive && reviewSteps.length > 0 && (
              <div style={{ padding: '8px 12px 10px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 10,
                    fontSize: 11,
                    color: 'var(--fg-secondary)',
                    fontFamily: 'var(--font-serif)',
                    cursor: 'pointer',
                  }}
                  onClick={() => toggleReviewAll(!allReviewItemsChecked)}
                >
                  <ReviewCheckboxButton
                    checked={allReviewItemsChecked}
                    onChange={toggleReviewAll}
                    ariaLabel={allReviewItemsChecked ? 'Deselect all proposed edits' : 'Select all proposed edits'}
                  />
                  <span>Select all</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--fg-muted)' }}>{checkedReviewCount}/{reviewSteps.length} selected</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {reviewSteps.map((item) => {
                    const isFocused = activeReviewFocusItemId === item.id;
                    return (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '10px 12px',
                          borderRadius: 12,
                          border: isFocused ? '1px solid rgba(33,212,255,0.34)' : '1px solid rgba(255,255,255,0.08)',
                          background: isFocused
                            ? 'linear-gradient(180deg, rgba(33,212,255,0.12), rgba(255,255,255,0.04))'
                            : 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))',
                          boxShadow: isFocused ? '0 0 0 1px rgba(33,212,255,0.08)' : 'inset 0 1px 0 rgba(255,255,255,0.03)',
                        }}
                      >
                        <ReviewCheckboxButton
                          checked={item.checked}
                          onChange={(checked) => toggleReviewItem(item.id, checked)}
                          ariaLabel={`${item.checked ? 'Deselect' : 'Select'} ${item.label}`}
                        />
                        <button
                          type="button"
                          onClick={() => focusReviewItem(item.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            flex: 1,
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            textAlign: 'left',
                            color: 'inherit',
                            fontFamily: 'inherit',
                          }}
                        >
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                            <span style={{ fontSize: 11, color: 'var(--fg-primary)', fontWeight: 600, fontFamily: 'var(--font-serif)' }}>
                              {item.label}
                            </span>
                            <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-serif)', lineHeight: 1.45 }}>
                              {item.summary || item.action.message}
                            </span>
                          </span>
                          <span style={{
                            fontSize: 10,
                            color: isFocused ? 'var(--accent-strong)' : 'var(--fg-muted)',
                            fontFamily: 'var(--font-serif)',
                            flexShrink: 0,
                          }}>
                            {isFocused ? 'Previewing' : 'Preview'}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {actionResolved ? (
              <div style={{
                padding: '8px 12px',
                borderTop: '1px solid rgba(255,255,255,0.05)',
              }}>
                <span style={{
                  fontSize: 11,
                  color: 'var(--fg-muted)',
                  fontFamily: 'var(--font-serif)',
                }}>
                  {actionResultText ?? 'Completed.'}
                </span>
              </div>
            ) : reviewResult ? (
              <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-serif)' }}>
                  {reviewResult}
                </span>
              </div>
            ) : (
              <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                {reviewableAction && reviewableItemCount > 0 && activeReviewAction && (
                  <p style={{ fontSize: 10, color: 'var(--fg-muted)', margin: '0 0 8px', fontFamily: 'var(--font-serif)' }}>
                    {batchReviewActive
                      ? `Previewing ${reviewSteps.length} proposed change${reviewSteps.length === 1 ? '' : 's'}. Apply commits only the checked edits.`
                      : `Review ${reviewableItemCount} proposed change${reviewableItemCount === 1 ? '' : 's'} at once.`}
                  </p>
                )}
                {liveActionState.wasUndone && (
                  <p style={{ fontSize: 10, color: 'var(--fg-muted)', margin: '0 0 8px', fontFamily: 'var(--font-serif)' }}>
                    This edit was undone from the timeline, so it can be applied again.
                  </p>
                )}
                {anotherReviewActive && !batchReviewActive && reviewableAction && (
                  <p style={{ fontSize: 10, color: 'var(--fg-muted)', margin: '0 0 8px', fontFamily: 'var(--font-serif)' }}>
                    Finish the active review before opening another one.
                  </p>
                )}
                {action?.type === 'update_ai_settings' ? (
                  <button
                    onClick={handleApplySettings}
                    style={{
                      width: '100%', padding: '5px 0',
                      fontSize: 12, fontWeight: 500,
                      background: 'var(--accent)',
                      border: 'none',
                      color: '#000',
                      borderRadius: 4, cursor: 'pointer',
                      fontFamily: 'var(--font-serif)',
                      transition: 'all 0.15s',
                    }}
                  >
                    Apply settings
                  </button>
                ) : action?.type === 'transcribe_request' ? (
                  <>
                    {transcribeError && (
                      <p style={{ fontSize: 11, color: '#f87171', margin: '0 0 6px', fontFamily: 'var(--font-serif)' }}>
                        {transcribeError}
                      </p>
                    )}
                    <button
                      onClick={handleTranscribe}
                      disabled={isTranscribing || transcriptionDone}
                      style={{
                        width: '100%', padding: '5px 0',
                        fontSize: 12, fontWeight: 500,
                        background: isTranscribing || transcriptionDone ? 'rgba(255,255,255,0.06)' : 'var(--accent)',
                        border: 'none',
                        color: isTranscribing || transcriptionDone ? 'var(--fg-muted)' : '#000',
                        borderRadius: 4, cursor: isTranscribing || transcriptionDone ? 'default' : 'pointer',
                        fontFamily: 'var(--font-serif)',
                        transition: 'all 0.15s',
                      }}
                    >
                      {isTranscribing ? 'Transcribing…' : transcriptionDone ? 'Transcript ready ✓' : 'Transcribe'}
                    </button>
                  </>
                ) : batchReviewActive ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={handleApplyReviewedAction}
                      disabled={!reviewedAction}
                      style={{
                        flex: 1,
                        padding: '5px 0',
                        fontSize: 12,
                        fontWeight: 500,
                        background: reviewedAction ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                        border: 'none',
                        color: reviewedAction ? '#000' : 'var(--fg-muted)',
                        borderRadius: 4,
                        cursor: reviewedAction ? 'pointer' : 'default',
                        fontFamily: 'var(--font-serif)',
                      }}
                    >
                      {reviewedAction ? 'Apply selected' : 'No edits selected'}
                    </button>
                    <button
                      onClick={cancelReview}
                      style={{
                        flex: 1,
                        padding: '5px 0',
                        fontSize: 12,
                        fontWeight: 500,
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: 'var(--fg-secondary)',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontFamily: 'var(--font-serif)',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={startReview}
                    disabled={anotherReviewActive}
                    style={{
                      width: '100%', padding: '5px 0',
                      fontSize: 12, fontWeight: 500,
                      background: anotherReviewActive ? 'rgba(255,255,255,0.06)' : 'var(--accent)',
                      border: 'none',
                      color: anotherReviewActive ? 'var(--fg-muted)' : '#000',
                      borderRadius: 4, cursor: anotherReviewActive ? 'default' : 'pointer',
                      fontFamily: 'var(--font-serif)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {reviewableItemCount > 1 ? 'Review changes' : 'Review change'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Thinking indicator ────────────────────────────────────────────────────────
function ThinkingIndicator({ status }: { status?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 10, width: '100%' }}>
      <AutoAvatar />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, alignItems: 'flex-start', width: '100%', maxWidth: '72%' }}>
        <AutoIdentity subtitle="Thinking..." />
        <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
          <div style={{
            display: 'inline-flex',
            gap: 3,
            padding: '10px 12px',
            borderRadius: '10px 10px 10px 2px',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.025))',
            border: '1px solid rgba(255,255,255,0.07)',
            width: 'fit-content',
          }}>
            {[0, 1, 2].map(i => (
              <div key={i} className="dot-bar" style={{
                width: 3, height: 14,
                background: 'rgba(255,255,255,0.25)',
                borderRadius: 2,
                animationDelay: `${i * 0.15}s`,
              }} />
            ))}
          </div>
        </div>
        {status && (
          <span style={{
            fontSize: 10,
            color: 'var(--fg-muted)',
            fontFamily: 'var(--font-serif)',
            lineHeight: 1.4,
            paddingLeft: 2,
          }}>
            {status}
          </span>
        )}
      </div>
    </div>
  );
}

function ProgressStatusCard({
  title,
  progress,
  detail,
  secondaryLabel,
  tone = 'active',
  showProgressBar = true,
}: {
  title: string;
  progress: IndexingProgress | null;
  detail?: string | null;
  secondaryLabel?: string | null;
  tone?: ProgressCardTone;
  showProgressBar?: boolean;
}) {
  const targetProgress = getProgressValue(progress);
  const isCompleted = tone === 'completed';

  return (
    <div style={{
      marginLeft: 22,
      padding: '14px 15px',
      borderRadius: 10,
      border: '1px solid rgba(255,255,255,0.08)',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.02))',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 14 }}>
        {isCompleted && (
          <div style={{
            width: 14,
            height: 14,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(33,212,255,0.92)',
            flexShrink: 0,
          }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
            </svg>
          </div>
        )}
        <span style={{
          fontSize: 13,
          color: 'var(--fg-primary)',
          fontFamily: 'var(--font-serif)',
          fontWeight: 500,
        }}>
          {title}
        </span>
      </div>
      {!isCompleted && showProgressBar && (
        <div style={{
          width: '100%',
          height: 5,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.06)',
          overflow: 'hidden',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
        }}>
          <div style={{
            width: `${Math.max((targetProgress ?? 0.06) * 100, 4)}%`,
            height: '100%',
            background: 'linear-gradient(90deg, rgba(33,212,255,0.78), rgba(125,211,252,1))',
            boxShadow: '0 0 18px rgba(33,212,255,0.22)',
            transition: 'width 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
          }} />
        </div>
      )}
      <LiveProgressSummary
        progress={progress}
        targetProgress={targetProgress}
        isCompleted={isCompleted}
        detail={detail}
        secondaryLabel={secondaryLabel}
      />
    </div>
  );
}

function LiveProgressSummary({
  progress,
  targetProgress,
  isCompleted,
  detail,
  secondaryLabel,
}: {
  progress: IndexingProgress | null;
  targetProgress: number | null;
  isCompleted: boolean;
  detail?: string | null;
  secondaryLabel?: string | null;
}) {
  const [nowMs, setNowMs] = useState(0);
  const [etaAnchor, setEtaAnchor] = useState<{ key: string; deadlineAtMs: number | null }>({
    key: '',
    deadlineAtMs: null,
  });
  const etaAnchorKey = `${detail ?? ''}|${isCompleted ? '1' : '0'}|${progress?.stage ?? ''}|${progress?.completed ?? ''}|${progress?.total ?? ''}|${progress?.etaSeconds ?? 'null'}`;

  useEffect(() => {
    const nextEtaSeconds = progress?.etaSeconds ?? null;
    const timeoutId = window.setTimeout(() => {
      setEtaAnchor({
        key: etaAnchorKey,
        deadlineAtMs: Number.isFinite(nextEtaSeconds) && (nextEtaSeconds ?? 0) >= 0 && !isCompleted && !detail
          ? Date.now() + (Number(nextEtaSeconds) * 1000)
          : null,
      });
      setNowMs(Date.now());
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [detail, etaAnchorKey, isCompleted, progress?.etaSeconds]);

  useEffect(() => {
    if (etaAnchor.key !== etaAnchorKey || etaAnchor.deadlineAtMs === null || isCompleted || detail) return;

    const updateNow = () => {
      setNowMs(Date.now());
    };
    const intervalId = window.setInterval(() => {
      updateNow();
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [detail, etaAnchor.deadlineAtMs, etaAnchor.key, etaAnchorKey, isCompleted]);

  const liveEtaSeconds = etaAnchor.key !== etaAnchorKey || etaAnchor.deadlineAtMs === null
    ? (progress?.etaSeconds ?? null)
    : Math.max(0, Math.ceil((etaAnchor.deadlineAtMs - nowMs) / 1000));

  const { summary, secondary } = formatProgressSummary({
    targetProgress,
    isCompleted,
    etaSeconds: liveEtaSeconds,
    detail,
    secondaryLabel,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-serif)' }}>
        {summary}
      </span>
      {secondary && (
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.34)', fontFamily: 'var(--font-serif)' }}>
          {secondary}
        </span>
      )}
    </div>
  );
}

function StatusNoticeCard({
  title,
  detail,
  tone = 'info',
}: {
  title: string;
  detail: string;
  tone?: 'info' | 'error';
}) {
  const isError = tone === 'error';

  return (
    <div style={{
      marginLeft: 22,
      padding: '12px 13px',
      borderRadius: 10,
      border: isError ? '1px solid rgba(248,113,113,0.28)' : '1px solid rgba(255,255,255,0.08)',
      background: isError
        ? 'linear-gradient(180deg, rgba(127,29,29,0.22), rgba(69,10,10,0.14))'
        : 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.02))',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <span style={{
        fontSize: 11,
        color: isError ? '#fca5a5' : 'var(--fg-secondary)',
        fontFamily: 'var(--font-serif)',
      }}>
        {title}
      </span>
      <span style={{
        fontSize: 10,
        color: isError ? 'rgba(254,202,202,0.9)' : 'rgba(255,255,255,0.38)',
        fontFamily: 'var(--font-serif)',
        lineHeight: 1.5,
      }}>
        {detail}
      </span>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({
}: Record<string, never>) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '32px 16px', gap: 8, textAlign: 'center',
    }}>
      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-primary)', margin: 0, fontFamily: 'var(--font-serif)' }}>
        Find moments. Tag them. Review the cut.
      </p>
      <p style={{ fontSize: 12, color: 'var(--fg-muted)', margin: 0, lineHeight: 1.6, fontFamily: 'var(--font-serif)' }}>
        Describe the event you want to find, then review the markers and proposed cuts before applying them.
      </p>
    </div>
  );
}

// ─── Main sidebar ──────────────────────────────────────────────────────────────
export default function ChatSidebar() {
  const [input, setInput] = useState('');
  const [activeMarkerMention, setActiveMarkerMention] = useState<ActiveMarkerMention | null>(null);
  const [highlightedMarkerIndex, setHighlightedMarkerIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const requestChainStateRef = useRef<Record<string, RequestChainState>>({});

  const messages = useEditorStore(s => s.messages);
  const isChatLoading = useEditorStore(s => s.isChatLoading);
  const addMessage = useEditorStore(s => s.addMessage);
  const updateMessage = useEditorStore(s => s.updateMessage);
  const removeMessage = useEditorStore(s => s.removeMessage);
  const setIsChatLoading = useEditorStore(s => s.setIsChatLoading);
  const videoDuration = useEditorStore(s => s.videoDuration);
  const clips = useEditorStore(s => s.clips);
  const markers = useEditorStore(s => s.markers);
  const selectedItem = useEditorStore(s => s.selectedItem);
  const clearChatHistory = useEditorStore(s => s.clearChatHistory);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [loadingPhaseId, setLoadingPhaseId] = useState<string | null>(null);

  const videoUrl = useEditorStore(s => s.videoUrl);
  const processingVideoUrl = useEditorStore(s => s.processingVideoUrl);
  const videoData = useEditorStore(s => s.videoData);
  const videoFile = useEditorStore(s => s.videoFile);
  const sources = useEditorStore(s => s.sources);
  const sourceRuntimeById = useEditorStore(s => s.sourceRuntimeById);
  const transcriptStatus = useEditorStore(s => s.transcriptStatus);
  const transcriptError = useEditorStore(s => s.transcriptError);
  const transcriptProgress = useEditorStore(s => s.transcriptProgress);
  const transcriptStartedAtRef = useRef<number | null>(null);
  const sourceIndexFreshBySourceId = useEditorStore(s => s.sourceIndexFreshBySourceId);
  const sourceIndexAnalysis = useEditorStore(s => s.sourceIndexAnalysis);
  const sourceIndexAnalysisBySourceId = useEditorStore(s => s.sourceIndexAnalysisBySourceId);
  const currentProjectId = useEditorStore(s => s.currentProjectId);
  const setVisualSearchSession = useEditorStore(s => s.setVisualSearchSession);
  const addMarker = useEditorStore(s => s.addMarker);
  const applyStoredAction = useEditorStore(s => s.applyAction);
  const recordAppliedAction = useEditorStore(s => s.recordAppliedAction);
  const requestSeek = useEditorStore(s => s.requestSeek);
  const previewOwnerId = useEditorStore(s => s.previewOwnerId);
  const reviewLocked = previewOwnerId !== null;
  const mainTimelineDuration = useMemo(() => getTimelineDuration(clips), [clips]);
  const availableSources = useMemo(() => (
    resolveProjectSources({
      sources,
      runtimeBySourceId: sourceRuntimeById,
      primaryFallback: {
        videoData,
        videoFile,
        videoUrl,
        processingVideoUrl,
        videoDuration,
      },
    }).filter((entry) => entry.source && entry.duration > 0)
  ), [processingVideoUrl, sourceRuntimeById, sources, videoData, videoDuration, videoFile, videoUrl]);
  const useServerSourceIndex = Boolean(
    currentProjectId
    && sources.some((source) => (
      isServerBackedSource(source)
      || Boolean(sourceIndexAnalysisBySourceId[source.id])
    )),
  );
  const trackedServerSources = useMemo(() => (
    availableSources.filter((source) => (
      isServerBackedSource(source)
      || Boolean(sourceIndexAnalysisBySourceId[source.sourceId])
    ))
  ), [availableSources, sourceIndexAnalysisBySourceId]);
  const initialIndexingReady = useMemo(
    () => getInitialIndexingReady(sources, sourceIndexAnalysisBySourceId, sourceIndexFreshBySourceId),
    [sourceIndexAnalysisBySourceId, sourceIndexFreshBySourceId, sources],
  );
  useEffect(() => {
    requestChainStateRef.current = {};
  }, [currentProjectId]);

  useEffect(() => {
    if (transcriptStatus === 'loading' && (transcriptProgress === null || transcriptProgress.completed === 0)) {
      transcriptStartedAtRef.current = performance.now();
    } else if (transcriptStatus !== 'loading') {
      transcriptStartedAtRef.current = null;
    }
  }, [transcriptStatus, transcriptProgress]);

  const selectedClipContext = useMemo(() => {
    if (!selectedItem || selectedItem.type !== 'clip') return null;
    const index = clips.findIndex((clip) => clip.id === selectedItem.id);
    if (index < 0) return null;
    return {
      id: clips[index].id,
      index,
      number: index + 1,
    };
  }, [clips, selectedItem]);
  const selectedMarkerContext = useMemo(() => {
    if (!selectedItem || selectedItem.type !== 'marker') return null;
    return markers.find((marker) => marker.id === selectedItem.id) ?? null;
  }, [markers, selectedItem]);
  const composerSelectionToken = useMemo(() => {
    if (selectedClipContext) return formatClipReferenceToken(selectedClipContext.number);
    if (selectedMarkerContext) return formatMarkerReferenceToken(selectedMarkerContext.number);
    return null;
  }, [selectedClipContext, selectedMarkerContext]);
  const markerSuggestions = useMemo(() => {
    if (!activeMarkerMention) return [];
    const query = activeMarkerMention.query.trim().toLowerCase().replace(/^marker\s+/, '');
    return [...markers]
      .sort((a, b) => a.number - b.number)
      .filter((marker) => {
        if (!query) return true;
        const label = marker.label?.toLowerCase() ?? '';
        return marker.number.toString().startsWith(query) || label.includes(query);
      })
      .slice(0, 6);
  }, [activeMarkerMention, markers]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isChatLoading]);

  useEffect(() => {
    setHighlightedMarkerIndex(0);
  }, [activeMarkerMention?.query, markerSuggestions.length]);

  const buildCurrentTranscript = useCallback(() => {
    const freshState = useEditorStore.getState();
    const rawCaptions = freshState.sourceTranscriptCaptions;
    if (rawCaptions && rawCaptions.length > 0) {
      return buildTranscriptContext(freshState.clips, rawCaptions);
    }
    return freshState.backgroundTranscript;
  }, []);

  const updateRequestChainState = useCallback((
    requestChainId: string,
    updater: (current: RequestChainState) => RequestChainState,
  ) => {
    const current = requestChainStateRef.current[requestChainId];
    if (!current) return null;
    const next = updater(current);
    requestChainStateRef.current[requestChainId] = next;
    return next;
  }, []);

  const recordCompletedChainAction = useCallback((requestChainId: string | undefined, action: EditAction) => {
    if (!requestChainId || action.type === 'none') return null;
    return updateRequestChainState(requestChainId, (current) => ({
      ...current,
      completedActions: [...current.completedActions, action],
      duplicateRerunCount: 0,
      remainingObjective: current.remainingObjective,
      duplicateActionBlacklist: [],
      transcript: {
        ...current.transcript,
        missing: !current.transcript.canonicalAvailable && !current.transcript.requestedDuringChain,
      },
    }));
  }, [updateRequestChainState]);

  const runSingleTurn = useCallback(async (
    history: ChatRequestMessage[],
    ctrl: AbortController,
    requestChainId?: string,
  ) => {
    if (!initialIndexingReady) return;
    const latestUserInput = [...history].reverse().find((entry) => entry.role === 'user')?.content ?? '';
    let nextHistory = [...history];
    let producedVisibleResponse = false;
    let streamingMessageId: string | null = null;
    let streamingAccumulated = '';

    for (let round = 0; round < MAX_CHAIN_CHAT_ROUNDS; round++) {
      streamingMessageId = null;
      streamingAccumulated = '';

      if (!initialIndexingReady) break;
      if (stopRequestedRef.current) break;
      const freshState = useEditorStore.getState();
      const chainState = requestChainId ? requestChainStateRef.current[requestChainId] ?? null : null;
      const currentClips = freshState.clips;
      const currentTranscript = buildCurrentTranscript();
      const silenceCandidates = buildSilenceCandidatePayload();
      const transcriptAvailability = chainState?.transcript ?? {
        canonicalAvailable: Boolean((freshState.sourceTranscriptCaptions ?? []).length),
        requestedDuringChain: false,
        missing: !(freshState.sourceTranscriptCaptions && freshState.sourceTranscriptCaptions.length > 0),
      };

      const onChunk = (text: string) => {
        streamingAccumulated += text;
        if (!streamingMessageId) {
          streamingMessageId = addMessage({
            role: 'assistant',
            content: streamingAccumulated,
            requestChainId,
            isStreaming: true,
          });
        } else {
          updateMessage(streamingMessageId, { content: streamingAccumulated });
        }
      };

      const { message = '', action, visualSearch, final: isFinal } = await postChatRequest({
        messages: nextHistory,
        context: {
          projectId: freshState.currentProjectId,
          visualSearchSession: freshState.visualSearchSession,
          videoDuration: getTimelineDuration(currentClips),
          clipCount: currentClips.length,
          clips: currentClips.map((c, i) => ({
            id: c.id,
            index: i,
            sourceId: c.sourceId,
            sourceStart: c.sourceStart,
            sourceDuration: c.sourceDuration,
            speed: c.speed,
          })),
          markers: freshState.markers.map((marker) => ({
            id: marker.id,
            number: marker.number,
            timelineTime: marker.timelineTime,
            label: marker.label ?? null,
            status: marker.status,
            linkedRange: marker.linkedRange ?? null,
            note: marker.note ?? null,
          })),
          textOverlayCount: freshState.textOverlays.length,
          transcript: currentTranscript,
          transcriptAvailability,
          silenceCandidates,
          wordBoundaries: buildWordBoundaryPayload(),
          settings: freshState.aiSettings,
          appliedActions: freshState.appliedActions,
        },
      }, ctrl, onChunk);

      setVisualSearchSession(visualSearch ?? null);
      if (visualSearch) {
        capture('visual_search_performed', {
          query_length: latestUserInput.length,
          has_results: (visualSearch.candidates?.length ?? 0) > 0,
        });
      }
      const markerAction = isMarkerMutationAction(action);
      if (!markerAction) {
        upsertMarkersFromVisualSearch(latestUserInput, visualSearch, addMarker);
      }
      const assistantMessage = streamingAccumulated.trim() || message.trim() || getAssistantFallbackMessage(action);
      const duplicateCompletedAction = requestChainId && action && action.type !== 'none' && chainState
        ? chainState.completedActions.find((completedAction) => actionsMatch(completedAction, action)) ?? null
        : null;

      if (duplicateCompletedAction && round < MAX_CHAIN_CHAT_ROUNDS - 1) {
        const requestChainKey = requestChainId;
        const duplicateAction = action;
        if (!requestChainKey || !duplicateAction || duplicateAction.type === 'none') {
          continue;
        }
        const nextChainState = updateRequestChainState(requestChainKey, (current) => ({
          ...current,
          duplicateRerunCount: current.duplicateRerunCount + 1,
          duplicateActionBlacklist: current.duplicateActionBlacklist.includes(duplicateAction.type)
            ? current.duplicateActionBlacklist
            : [...current.duplicateActionBlacklist, duplicateAction.type],
        }));

        if (nextChainState) {
          if (streamingMessageId) { removeMessage(streamingMessageId); streamingMessageId = null; }
          nextHistory = [
            ...nextHistory,
            {
              role: 'assistant',
              content: assistantMessage,
              requestChainId: requestChainKey,
              action: duplicateAction,
              actionType: duplicateAction.type,
              actionMessage: duplicateAction.message,
              actionStatus: 'completed',
              actionResult: 'Duplicate of an already completed chain step.',
            },
            {
              role: 'user',
              content: buildContinuationPayload(
                nextChainState,
                'duplicate_action_retry',
                'That action is already complete. Continue only the unfinished objective with a different next step or return an explicit failure.',
              ),
              requestChainId: requestChainKey,
            },
          ];
          continue;
        }
      }

      const markerActionPreviouslyApplied = markerAction && action
        ? freshState.appliedActions.some((record) => actionsMatch(record.action, action))
        : false;
      const hasPendingAction = !!action && action.type !== 'none';
      const nextActionStatus = markerAction
        ? 'completed'
        : hasPendingAction
          ? 'pending'
          : undefined;

      if (markerAction && action && !markerActionPreviouslyApplied) {
        applyStoredAction(action);
        recordAppliedAction(action, action.message, { requestChainId });
        recordCompletedChainAction(requestChainId, action);
        const markerSeekTime = getMarkerActionSeekTime(action, freshState.markers);
        if (markerSeekTime !== null) requestSeek(markerSeekTime);
      }

      if (requestChainId && action?.type === 'transcribe_request') {
        updateRequestChainState(requestChainId, (current) => ({
          ...current,
          transcript: {
            ...current.transcript,
            requestedDuringChain: true,
            missing: true,
          },
        }));
      }

      const finalMessageProps = {
        role: 'assistant' as const,
        content: assistantMessage,
        requestChainId,
        action: action ?? undefined,
        visualSearch: visualSearch ?? undefined,
        autoApplied: markerAction && !markerActionPreviouslyApplied ? true : undefined,
        actionStatus: nextActionStatus as 'pending' | 'completed' | 'rejected' | undefined,
        actionResult: markerAction && action
          ? markerActionPreviouslyApplied
            ? 'Already applied.'
            : getMarkerActionResult(action)
          : undefined,
        final: isFinal,
        isStreaming: false,
      };

      if (streamingMessageId) {
        updateMessage(streamingMessageId, finalMessageProps);
      } else {
        addMessage(finalMessageProps);
      }
      producedVisibleResponse = true;
      return;
    }

    if (!producedVisibleResponse) {
      const fallbackContent = 'I inspected that section but did not finish with a concrete edit. The frame search was too broad and needs a narrower visual target.';
      if (streamingMessageId) {
        updateMessage(streamingMessageId, { content: fallbackContent, isStreaming: false });
      } else {
        addMessage({
          role: 'assistant',
          content: fallbackContent,
          requestChainId,
        });
      }
    }
  }, [addMarker, addMessage, applyStoredAction, buildCurrentTranscript, initialIndexingReady, recordAppliedAction, recordCompletedChainAction, removeMessage, requestSeek, setVisualSearchSession, updateMessage, updateRequestChainState]);

  const continueRequestChain = useCallback(async (
    requestChainId: string,
    trigger: RequestChainContinuationPayload['trigger'],
    explicitInstruction: string,
  ) => {
    if (!initialIndexingReady) return;
    const storeState = useEditorStore.getState();
    if (storeState.isChatLoading || storeState.previewOwnerId !== null) return;
    const chainState = requestChainStateRef.current[requestChainId];
    if (!chainState) return;

    setIsChatLoading(true);
    setLoadingStatus(trigger === 'transcript_ready' ? 'Continuing with transcript…' : 'Continuing remaining request…');
    setLoadingPhaseId('continuing_remaining_step');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    stopRequestedRef.current = false;

    try {
      const history = buildChatRequestHistory(
        useEditorStore.getState().messages,
        useEditorStore.getState().appliedActions,
        buildContinuationPayload(chainState, trigger, explicitInstruction),
        requestChainId,
      );
      await runSingleTurn(history, ctrl, requestChainId);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        addMessage({
          role: 'assistant',
          content: `Network error: ${err instanceof Error ? err.message : 'Unknown'}`,
          requestChainId,
        });
      }
    } finally {
      setIsChatLoading(false);
      setLoadingStatus('');
      setLoadingPhaseId(null);
    }
  }, [addMessage, initialIndexingReady, runSingleTurn, setIsChatLoading]);

  const handleSendSingle = useCallback(async () => {
    const text = input.trim();
    if (!text || isChatLoading || reviewLocked || !initialIndexingReady) return;
    const requestChainId = crypto.randomUUID();
    requestChainStateRef.current[requestChainId] = {
      requestChainId,
      originalRequest: text,
      remainingObjective: null,
      completedActions: [],
      duplicateActionBlacklist: [],
      transcript: {
        canonicalAvailable: Boolean((useEditorStore.getState().sourceTranscriptCaptions ?? []).length),
        requestedDuringChain: false,
        missing: !(useEditorStore.getState().sourceTranscriptCaptions?.length),
      },
      duplicateRerunCount: 0,
    };

    setInput('');
    setActiveMarkerMention(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    addMessage({ role: 'user', content: text, requestChainId });
    capture('chat_message_sent', { message_length: text.length, has_analysis: useServerSourceIndex });
    setIsChatLoading(true);
    setLoadingStatus('');
    setLoadingPhaseId(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    stopRequestedRef.current = false;

    try {
      const history = buildChatRequestHistory(messages, useEditorStore.getState().appliedActions, text, requestChainId);
      await runSingleTurn(history, ctrl, requestChainId);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        capture('chat_request_failed', { reason: err instanceof Error ? err.message : 'Unknown' });
        addMessage({
          role: 'assistant',
          content: `Network error: ${err instanceof Error ? err.message : 'Unknown'}`,
          requestChainId,
        });
      }
    } finally {
      setIsChatLoading(false);
      setLoadingStatus('');
      setLoadingPhaseId(null);
    }
  }, [addMessage, initialIndexingReady, input, isChatLoading, messages, reviewLocked, runSingleTurn, setIsChatLoading, useServerSourceIndex]);

  const handleTranscriptReady = useCallback(async (messageId: string) => {
    if (!initialIndexingReady) return;
    const storeState = useEditorStore.getState();
    if (storeState.isChatLoading || storeState.previewOwnerId !== null) return;
    const currentMessages = useEditorStore.getState().messages;
    const assistantMessage = currentMessages.find((message) => message.id === messageId && message.role === 'assistant');
    const requestChainId = assistantMessage?.requestChainId;
    if (!requestChainId) return;
    const chainState = requestChainStateRef.current[requestChainId];
    if (!chainState || chainState.transcript.canonicalAvailable || !chainState.transcript.requestedDuringChain) {
      return;
    }
    const nextChainState = updateRequestChainState(requestChainId, (current) => ({
      ...current,
      transcript: {
        ...current.transcript,
        canonicalAvailable: true,
        missing: false,
      },
      duplicateRerunCount: 0,
    }));
    if (!nextChainState) return;
    await continueRequestChain(
      requestChainId,
      'transcript_ready',
      'The transcript is now ready. Continue the original request, using the completed-action history to skip anything already done.',
    );
  }, [continueRequestChain, initialIndexingReady, updateRequestChainState]);

  const handleActionResolved = useCallback(async (
    messageId: string,
    action: EditAction,
    actionResult?: string | null,
  ) => {
    const currentMessages = useEditorStore.getState().messages;
    const assistantMessage = currentMessages.find((message) => message.id === messageId && message.role === 'assistant');
    const requestChainId = assistantMessage?.requestChainId;
    if (!requestChainId) return;
    const nextChainState = recordCompletedChainAction(requestChainId, action);
    if (!nextChainState || action.type === 'transcribe_request') return;
    if (assistantMessage?.final === true) return;
    await continueRequestChain(
      requestChainId,
      'action_resolved',
      actionResult?.trim()
        ? `${actionResult.trim()} Continue only the unfinished remainder of the original request.`
        : 'The approved edit was applied. Continue only the unfinished remainder of the original request.',
    );
  }, [continueRequestChain, recordCompletedChainAction]);

  const handleStop = useCallback(() => {
    stopRequestedRef.current = true;
    const ctrl = abortRef.current;
    abortRef.current = null;
    if (ctrl) {
      try {
        ctrl.abort(new DOMException('User stopped the current request', 'AbortError'));
      } catch {
        // Some runtimes reject custom abort reasons; fall back to a plain abort.
        try {
          ctrl.abort();
        } catch {
          // Ignore stop failures and just reset local loading state.
        }
      }
    }
    setIsChatLoading(false);
    setLoadingStatus('');
    setLoadingPhaseId(null);
  }, [setIsChatLoading]);

  const handleClearChat = useCallback(() => {
    if (isChatLoading || reviewLocked || messages.length === 0) return;
    requestChainStateRef.current = {};
    clearChatHistory();
    setInput('');
    setActiveMarkerMention(null);
    setHighlightedMarkerIndex(0);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [clearChatHistory, isChatLoading, messages.length, reviewLocked]);

  const hasVideoSource = availableSources.length > 0;
  const usingServerSourceIndex = useServerSourceIndex;
  const transcriptFailed = transcriptStatus === 'error';
  const estimatedTranscriptEta = estimateTranscriptSeconds(mainTimelineDuration || videoDuration);
  const observedTranscriptRemainingEta =
    transcriptProgress && transcriptProgress.total > 0 && transcriptStartedAtRef.current !== null
      ? estimateRemainingSecondsFromObservedRate(
          transcriptStartedAtRef.current,
          transcriptProgress.completed,
          transcriptProgress.total,
          estimatedTranscriptEta / Math.max(transcriptProgress.total, 1),
        )
      : null;
  const estimatedTranscriptRemainingEta = stabilizeEtaEstimate({
    reportedEtaSeconds: observedTranscriptRemainingEta,
    fallbackEtaSeconds: estimatedTranscriptEta,
    completed: transcriptProgress?.completed ?? 0,
    total: Math.max(transcriptProgress?.total ?? 1, 1),
  });
  const transcriptUnavailableNotice = hasVideoSource && !usingServerSourceIndex && transcriptFailed
    ? formatTranscriptFailureNotice(transcriptError)
    : null;
  const frameAnalysisErrorNotice = hasVideoSource && sourceIndexAnalysis?.status === 'failed' && sourceIndexAnalysis.error
    ? `${sourceIndexAnalysis.error} Initial indexing is still incomplete.`
    : null;
  const analysisStatusCards: AnalysisStatusCard[] = [];
  if (hasVideoSource) {
    if (usingServerSourceIndex) {
      analysisStatusCards.push(...buildServerAnalysisStatusCards({
        sources: trackedServerSources,
        analysisBySourceId: sourceIndexAnalysisBySourceId,
        freshnessBySourceId: sourceIndexFreshBySourceId,
      }));
    } else if (transcriptStatus === 'loading') {
      analysisStatusCards.push({
        key: 'audio-analysis',
        title: 'Video analysis',
        progress: {
          stage: 'transcribing',
          completed: transcriptProgress?.completed ?? 0,
          total: transcriptProgress?.total ?? 1,
          label: transcriptProgress && transcriptProgress.total > 0
            ? `Transcribing audio ${Math.min(transcriptProgress.completed, transcriptProgress.total)}/${transcriptProgress.total}`
            : 'Transcribing audio',
          etaSeconds: estimatedTranscriptRemainingEta,
        },
        secondaryLabel: 'Transcribing audio…',
      });
    } else if (!usingServerSourceIndex && transcriptStatus === 'error') {
      analysisStatusCards.push({
        key: 'audio-analysis',
        title: 'Video analysis',
        progress: transcriptProgress
          ? {
              stage: 'transcribing',
              completed: transcriptProgress.completed,
              total: Math.max(transcriptProgress.total, 1),
              label: 'Video analysis issue',
              etaSeconds: null,
            }
          : null,
        detail: transcriptError ?? 'Video analysis did not finish.',
        secondaryLabel: 'Issue',
      });
    } else if (!usingServerSourceIndex && transcriptStatus === 'done') {
      analysisStatusCards.push({
        key: 'audio-analysis',
        title: 'Video analysis',
        progress: buildCompletedProgress('transcribing'),
        tone: 'completed',
      });
    }
  }
  const audioAnalysisReady = !hasVideoSource
    || (usingServerSourceIndex
      ? trackedServerSources.every((source) => isServerAudioReady(
        sourceIndexAnalysisBySourceId[source.sourceId],
        sourceIndexFreshBySourceId[source.sourceId],
      ))
      : transcriptStatus === 'done');
  const mediaPreparationBlockingSend = hasVideoSource && !audioAnalysisReady;
  const audioAnalysisBlockingSend = analysisStatusCards.some((card) => (
    card.title === 'Video analysis' && card.tone !== 'completed'
  ));
  const composerInputDisabled = isChatLoading || reviewLocked;
  const composerMuted = composerInputDisabled || mediaPreparationBlockingSend || audioAnalysisBlockingSend;
  const canSubmitMessage = input.trim().length > 0
    && !composerInputDisabled
    && !mediaPreparationBlockingSend
    && !audioAnalysisBlockingSend;
  const activeLoadingPhaseId = loadingPhaseId ?? (mediaPreparationBlockingSend ? 'initial_indexing_required' : null);

  const resizeComposer = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      const nextHeight = Math.min(ta.scrollHeight, 96);
      ta.style.height = `${Math.max(nextHeight, 22)}px`;
      ta.style.overflowY = ta.scrollHeight > 96 ? 'auto' : 'hidden';
    }
  }, []);

  useEffect(() => {
    resizeComposer();
  }, [input, resizeComposer]);

  const syncActiveMarkerMention = useCallback((value: string, caret: number | null) => {
    setActiveMarkerMention(getActiveMarkerMention(value, caret));
  }, []);

  const focusComposer = useCallback((selectionStart?: number, selectionEnd?: number) => {
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      if (selectionStart !== undefined) {
        ta.selectionStart = selectionStart;
        ta.selectionEnd = selectionEnd ?? selectionStart;
      }
      resizeComposer();
    });
  }, [resizeComposer]);

  useEffect(() => {
    if (!composerSelectionToken) return;
    setInput((current) => {
      const next = upsertInlineSelectionReference(current, composerSelectionToken);
      return next === current ? current : next;
    });
    setActiveMarkerMention(null);
    focusComposer();
  }, [composerSelectionToken, focusComposer, selectedItem]);

  const applyMarkerSuggestion = useCallback((marker: MarkerEntry) => {
    if (!activeMarkerMention) return;
    const nextValue = replaceMarkerMention(input, activeMarkerMention, marker.number);
    const nextCaret = activeMarkerMention.start + `@marker ${marker.number} `.length;
    setInput(nextValue);
    setActiveMarkerMention(null);
    focusComposer(nextCaret);
  }, [activeMarkerMention, focusComposer, input]);

  const handleSend = useCallback(() => {
    if (!canSubmitMessage) return;
    handleSendSingle();
  }, [canSubmitMessage, handleSendSingle]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (reviewLocked) return;
    if (markerSuggestions.length > 0 && activeMarkerMention) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedMarkerIndex((current) => Math.min(current + 1, markerSuggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedMarkerIndex((current) => Math.max(current - 1, 0));
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        applyMarkerSuggestion(markerSuggestions[highlightedMarkerIndex] ?? markerSuggestions[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setActiveMarkerMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    syncActiveMarkerMention(e.target.value, e.target.selectionStart);
    resizeComposer();
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%',
      background: 'var(--bg-panel)',
    }} data-loading-phase={activeLoadingPhaseId ?? undefined}>
      {/* Header */}
      <div style={{
        minHeight: 52,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 14px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <AutoAvatar size={30} />
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)', fontFamily: 'var(--font-serif)' }}>
              Auto
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleClearChat}
          disabled={isChatLoading || reviewLocked || messages.length === 0}
          aria-label="Clear chat"
          title="Clear chat"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 10px',
            height: 28,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 999,
            color: isChatLoading || reviewLocked || messages.length === 0 ? 'rgba(255,255,255,0.24)' : 'var(--fg-secondary)',
            cursor: isChatLoading || reviewLocked || messages.length === 0 ? 'default' : 'pointer',
            transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
            flexShrink: 0,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16" />
            <path d="M9 7V4h6v3" />
            <path d="M7 7l1 12h8l1-12" />
            <path d="M10 11v5" />
            <path d="M14 11v5" />
          </svg>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-serif)' }}>Clear chat</span>
        </button>

      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '14px 12px' }}>
        {(analysisStatusCards.length > 0 || transcriptUnavailableNotice || frameAnalysisErrorNotice) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: messages.length === 0 ? 18 : 12 }}>
            {analysisStatusCards.map((card) => (
              <ProgressStatusCard
                key={card.key}
                title={card.title}
                progress={card.progress}
                detail={card.detail}
                secondaryLabel={card.secondaryLabel}
                tone={card.tone}
                showProgressBar={card.showProgressBar}
              />
            ))}
            {transcriptUnavailableNotice && (
              <StatusNoticeCard
                title="Audio analysis issue"
                detail={transcriptUnavailableNotice}
                tone="error"
              />
            )}
            {frameAnalysisErrorNotice && (
              <StatusNoticeCard
                title="Visual analysis issue"
                detail={frameAnalysisErrorNotice}
                tone="error"
              />
            )}
          </div>
        )}
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.map(msg => msg.role === 'user'
              ? <UserMessage key={msg.id} msg={msg} />
              : <AssistantMessage key={msg.id} msg={msg} onTranscriptReady={handleTranscriptReady} onActionResolved={handleActionResolved} />
            )}
            {isChatLoading && !messages.some(m => m.isStreaming) && <ThinkingIndicator status={loadingStatus || undefined} />}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        flexShrink: 0,
        padding: '7px 10px 9px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-panel)',
      }}>
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 6,
          background: 'var(--bg-elevated)',
          border: `1px solid ${composerMuted ? 'rgba(255,255,255,0.06)' : 'var(--border-mid)'}`,
          borderRadius: 8,
          padding: '7px 11px 8px',
          minHeight: 56,
          transition: 'border-color 0.2s ease, opacity 0.2s ease',
          opacity: composerMuted ? 0.82 : 1,
        }}>
          {activeMarkerMention && markerSuggestions.length > 0 && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: '4px',
              borderRadius: 8,
              background: 'rgba(0,0,0,0.18)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}>
              {markerSuggestions.map((marker, index) => {
                const isHighlighted = index === highlightedMarkerIndex;
                return (
                  <button
                    key={marker.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyMarkerSuggestion(marker)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: 'none',
                      background: isHighlighted ? 'rgba(250,204,21,0.16)' : 'transparent',
                      color: isHighlighted ? '#fde68a' : 'var(--fg-secondary)',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-serif)',
                      fontSize: 11,
                      textAlign: 'left',
                    }}
                  >
                    <span>{getMarkerPrimaryLabel(marker)}</span>
                    <span style={{ flex: 1, color: 'var(--fg-primary)' }}>
                      {getMarkerSecondaryLabel(marker)}
                    </span>
                    <span style={{ color: 'var(--fg-muted)' }}>{formatChatTime(marker.timelineTime)}</span>
                  </button>
                );
              })}
            </div>
          )}
          {reviewLocked && (
            <p style={{ fontSize: 10, color: 'var(--fg-muted)', margin: 0, fontFamily: 'var(--font-serif)' }}>
              Finish the active edit review before sending another request.
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 34 }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onClick={(event) => syncActiveMarkerMention(event.currentTarget.value, event.currentTarget.selectionStart)}
              onKeyUp={(event) => syncActiveMarkerMention(event.currentTarget.value, event.currentTarget.selectionStart)}
              placeholder={
                reviewLocked
                  ? 'Finish the active review…'
                  : isChatLoading
                    ? 'Autocut is working…'
                    : mediaPreparationBlockingSend
                      ? 'Media is loading. You can type…'
                    : 'Ask about the video or review cuts…'
              }
              rows={1}
              disabled={composerInputDisabled}
              style={{
                resize: 'none',
                overflowY: 'hidden',
                background: 'transparent',
                border: 'none',
                color: composerInputDisabled ? 'var(--fg-muted)' : 'var(--fg-primary)',
                fontSize: 13,
                lineHeight: 1.45,
                minHeight: 24,
                maxHeight: 96,
                width: '100%',
                fontFamily: 'var(--font-serif)',
                flex: 1,
                padding: '1px 0 0',
              }}
            />
            {isChatLoading ? (
              <button
                onClick={handleStop}
                style={{
                  width: 28, height: 28,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1.5px solid rgba(255,255,255,0.18)',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  flexShrink: 0,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
              >
                <div style={{ width: 8, height: 8, borderRadius: 1.5, background: 'rgba(255,255,255,0.8)' }} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSubmitMessage}
                style={{
                  width: 28, height: 28,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: canSubmitMessage ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                  border: 'none', borderRadius: 6,
                  cursor: canSubmitMessage ? 'pointer' : 'default',
                  flexShrink: 0,
                  transition: 'background 0.15s',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill={canSubmitMessage ? '#000' : 'rgba(255,255,255,0.25)'}>
                  <line x1="22" y1="2" x2="11" y2="13" stroke={canSubmitMessage ? '#000' : 'rgba(255,255,255,0.25)'} strokeWidth="2" fill="none"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
