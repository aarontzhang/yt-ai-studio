'use client';

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import {
  AnalysisProgress,
  AppliedActionRecord,
  AIEditingSettings,
  CaptionEntry,
  ChatMessage,
  ColorFilter,
  EditAction,
  IndexedVideoFrame,
  MarkerEntry,
  ProjectSource,
  SourceIndex,
  SourceIndexAnalysisState,
  SourceIndexAnalysisStateMap,
  SourceIndexTaskState,
  SourceIndexState,
  SourceIndexedFrame,
  TextOverlayEntry,
  TransitionEntry,
  VideoClip,
  VisualSearchSession,
} from './types';
import {
  actionChangesTimelineStructure,
  applyActionToSnapshot,
  buildReviewPreviewSnapshot,
  deleteRangeFromClips,
  EditReviewGroup,
  EditSnapshot,
  sanitizeTimelineClips,
  splitClipsAtTime,
} from './editActionUtils';
import {
  DEFAULT_AI_EDITING_SETTINGS,
  mergeAISettings,
  resolveAIEditingSettings,
} from './aiSettings';
import {
  buildTranscriptContext,
  formatTimePrecise,
  projectSourceFramesToTimeline,
  projectSourceFramesToTimelineAll,
} from './timelineUtils';
import { MAIN_SOURCE_ID, normalizeSourceId } from './sourceUtils';
import { buildClipSchedule, getTimelineDuration, normalizeTransitionEntries } from './playbackEngine';
import type { SourceRuntimeMediaMap } from './sourceMedia';
import {
  buildProjectSourceAliasMap,
  buildProjectSources,
  canonicalizeProjectSourceId,
} from './projectSources';
import { normalizeTextOverlayEntry } from './textOverlays';

export type { EditSnapshot } from './editActionUtils';

export type TranscriptStatus = 'idle' | 'loading' | 'done' | 'error';
export type TranscriptProgress = {
  completed: number;
  total: number;
} | null;

export const SOURCE_INDEX_VERSION = 'source-index-v2';
export type SourceIndexStateMap = Record<string, SourceIndexState>;

export type FFmpegJob =
  | { status: 'idle' }
  | { status: 'running'; progress: number; stage: string; isCancelling?: boolean }
  | { status: 'done'; outputUrl: string }
  | { status: 'cancelled'; message: string }
  | { status: 'error'; message: string };

export type SelectedItem = {
  type: 'clip' | 'caption' | 'text' | 'transition' | 'marker';
  id: string;
} | null;

export type ImportedSourceDraft = {
  id?: string;
  fileName: string;
  duration: number;
  isPrimary?: boolean;
  status?: ProjectSource['status'];
  storagePath?: string | null;
  assetId?: string | null;
  runtime?: Partial<NonNullable<SourceRuntimeMediaMap[string]>>;
};

function makeClip(sourceId: string, sourceStart: number, sourceDuration: number): VideoClip {
  return {
    id: uuidv4(),
    sourceId,
    sourceStart,
    sourceDuration,
    speed: 1,
    volume: 1,
    filter: null,
    fadeIn: 0,
    fadeOut: 0,
  };
}

function createProjectSource(input: ImportedSourceDraft): ProjectSource {
  return {
    id: input.id ?? uuidv4(),
    fileName: input.fileName,
    storagePath: input.storagePath ?? null,
    assetId: input.assetId ?? null,
    duration: Math.max(0, input.duration),
    status: input.status ?? 'pending',
    isPrimary: input.isPrimary === true,
  };
}

function buildHydratedSources(input: {
  persistedSources?: unknown[];
  projectStoragePath?: string | null;
  projectVideoFilename?: string | null;
  projectDuration?: number;
  referencedSourceIds?: Iterable<string>;
}): ProjectSource[] {
  return buildProjectSources({
    persistedSources: input.persistedSources,
    projectStoragePath: input.projectStoragePath,
    projectVideoFilename: input.projectVideoFilename,
    projectDuration: input.projectDuration,
    referencedSourceIds: input.referencedSourceIds,
    fallbackId: () => uuidv4(),
  });
}

function getPrimarySource(sources: ProjectSource[]): ProjectSource | null {
  return sources.find((source) => source.id === MAIN_SOURCE_ID)
    ?? sources.find((source) => source.isPrimary)
    ?? sources[0]
    ?? null;
}

function normalizeLoadedClip(
  clip: Partial<VideoClip> & { sourcePath?: unknown },
  fallbackSourceId: string,
  sourceIdAliases: Map<string, string>,
): VideoClip | null {
  if (typeof clip.id !== 'string') return null;
  if (!Number.isFinite(clip.sourceStart) || !Number.isFinite(clip.sourceDuration)) return null;
  const sourceId = canonicalizeProjectSourceId(clip.sourceId, sourceIdAliases, fallbackSourceId) ?? fallbackSourceId;

  return {
    id: clip.id,
    sourceId,
    sourceStart: clip.sourceStart!,
    sourceDuration: clip.sourceDuration!,
    speed: Number.isFinite(clip.speed) && clip.speed! > 0 ? clip.speed! : 1,
    volume: Number.isFinite(clip.volume) ? clip.volume! : 1,
    filter: clip.filter ?? null,
    fadeIn: Number.isFinite(clip.fadeIn) ? clip.fadeIn! : 0,
    fadeOut: Number.isFinite(clip.fadeOut) ? clip.fadeOut! : 0,
  };
}

function normalizeCaptionEntry(
  entry: Partial<CaptionEntry>,
  validSourceIds: Set<string>,
  sourceIdAliases: Map<string, string>,
): CaptionEntry | null {
  if (!Number.isFinite(entry.startTime) || !Number.isFinite(entry.endTime) || typeof entry.text !== 'string') {
    return null;
  }
  const normalizedSourceId = canonicalizeProjectSourceId(entry.sourceId, sourceIdAliases);
  const words = Array.isArray(entry.words)
    ? entry.words.flatMap((word) => {
        if (
          !word
          || typeof word !== 'object'
          || !Number.isFinite(word.startTime)
          || !Number.isFinite(word.endTime)
          || typeof word.text !== 'string'
        ) {
          return [];
        }
        return [{
          startTime: word.startTime,
          endTime: word.endTime,
          text: word.text,
        }];
      })
    : undefined;
  return {
    id: typeof entry.id === 'string' ? entry.id : undefined,
    sourceId: normalizedSourceId && validSourceIds.has(normalizedSourceId)
      ? normalizedSourceId
      : undefined,
    startTime: entry.startTime!,
    endTime: entry.endTime!,
    text: entry.text!,
    words,
    renderStyle: entry.renderStyle === 'rolling_word' || entry.renderStyle === 'static'
      ? entry.renderStyle
      : undefined,
  };
}

function normalizeTransitionEntry(entry: Partial<TransitionEntry>): TransitionEntry | null {
  const rawType = entry.type;
  if (
    rawType !== 'fade_black'
    && rawType !== 'crossfade'
    && rawType !== 'dissolve'
    && rawType !== 'wipe'
  ) {
    return null;
  }
  if (!Number.isFinite(entry.duration)) return null;
  const atTime = Number.isFinite(entry.atTime) ? entry.atTime! : 0;
  return {
    id: typeof entry.id === 'string' ? entry.id : undefined,
    afterClipId: typeof entry.afterClipId === 'string' ? entry.afterClipId : undefined,
    atTime,
    type: 'fade_black',
    duration: Math.max(0.05, entry.duration!),
  };
}

function normalizeTransitionState(
  clips: VideoClip[],
  transitions: Array<Partial<TransitionEntry>> | null | undefined,
): TransitionEntry[] {
  return normalizeTransitionEntries(
    clips,
    transitions
      ?.map((entry) => normalizeTransitionEntry(entry))
      .filter((entry): entry is TransitionEntry => !!entry) ?? [],
  );
}

function normalizeOverviewFrame(
  entry: Partial<SourceIndexedFrame>,
  validSourceIds: Set<string>,
  fallbackSourceId: string,
  sourceIdAliases: Map<string, string>,
): SourceIndexedFrame | null {
  if (!Number.isFinite(entry.sourceTime)) return null;
  const sourceId = canonicalizeProjectSourceId(entry.sourceId, sourceIdAliases, fallbackSourceId);
  return {
    sourceId: sourceId && validSourceIds.has(sourceId) ? sourceId : fallbackSourceId,
    sourceTime: entry.sourceTime!,
    description: typeof entry.description === 'string' ? entry.description : undefined,
    image: typeof entry.image === 'string' ? entry.image : undefined,
    assetId: normalizeSourceId(entry.assetId) ?? null,
    indexedAt: typeof entry.indexedAt === 'string' ? entry.indexedAt : null,
    sampleKind: entry.sampleKind === 'scene_rep' || entry.sampleKind === 'coarse_window_rep' || entry.sampleKind === 'window_250ms'
      ? entry.sampleKind
      : undefined,
    score: Number.isFinite(entry.score) ? entry.score : null,
    sceneId: typeof entry.sceneId === 'string' ? entry.sceneId : null,
  };
}

function normalizeAnalysisProgress(entry: Partial<AnalysisProgress> | null | undefined): AnalysisProgress | null {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.stage !== 'string') return null;
  if (!Number.isFinite(entry.completed) || !Number.isFinite(entry.total)) return null;
  return {
    stage: entry.stage as AnalysisProgress['stage'],
    completed: Number(entry.completed),
    total: Math.max(1, Number(entry.total)),
    label: typeof entry.label === 'string' ? entry.label : null,
    etaSeconds: Number.isFinite(entry.etaSeconds) ? Number(entry.etaSeconds) : null,
  };
}

function normalizeSourceIndexTaskState(
  value: Partial<SourceIndexTaskState> | null | undefined,
): SourceIndexTaskState | null {
  if (!value || typeof value !== 'object') return null;
  const status = value.status;
  if (
    status !== 'queued'
    && status !== 'running'
    && status !== 'paused'
    && status !== 'completed'
    && status !== 'failed'
    && status !== 'unavailable'
  ) {
    return null;
  }

  const completed = Number.isFinite(value.completed) ? Number(value.completed) : 0;
  const total = Number.isFinite(value.total) ? Math.max(1, Number(value.total)) : 1;
  return {
    status,
    completed,
    total,
    etaSeconds: Number.isFinite(value.etaSeconds) ? Number(value.etaSeconds) : null,
    reason: typeof value.reason === 'string' ? value.reason : null,
  };
}

function normalizeSourceIndexAnalysisState(
  value: Partial<SourceIndexAnalysisState> | null | undefined,
): SourceIndexAnalysisState | null {
  if (!value || typeof value !== 'object') return null;
  return {
    jobId: typeof value.jobId === 'string' ? value.jobId : null,
    status: value.status === 'queued' || value.status === 'running' || value.status === 'paused' || value.status === 'completed' || value.status === 'failed'
      ? value.status
      : null,
    error: typeof value.error === 'string' ? value.error : null,
    pauseRequested: value.pauseRequested === true,
    progress: normalizeAnalysisProgress(value.progress ?? null),
    audio: normalizeSourceIndexTaskState(value.audio ?? null),
    visual: normalizeSourceIndexTaskState(value.visual ?? null),
  };
}

function normalizeSourceIndexAnalysisStateMap(
  value: SourceIndexAnalysisStateMap | null | undefined,
): SourceIndexAnalysisStateMap {
  if (!value || typeof value !== 'object') return {};
  return Object.entries(value).reduce<SourceIndexAnalysisStateMap>((acc, [sourceId, analysis]) => {
    const normalized = normalizeSourceIndexAnalysisState(analysis);
    if (normalized) {
      acc[sourceId] = normalized;
    }
    return acc;
  }, {});
}

function buildInitialSourceIndexState(
  sources: ProjectSource[] = [],
  overrides?: SourceIndexStateMap,
): SourceIndexStateMap {
  const keys = sources.length > 0 ? sources.map((source) => source.id) : [MAIN_SOURCE_ID];
  return keys.reduce<SourceIndexStateMap>((acc, sourceId) => {
    acc[sourceId] = overrides?.[sourceId] ?? {
      overview: false,
      transcript: false,
      version: SOURCE_INDEX_VERSION,
    };
    return acc;
  }, {});
}

function patchSourceIndexState(
  current: SourceIndexStateMap,
  sourceId: string,
  patch: Partial<SourceIndexState>,
): SourceIndexStateMap {
  const existing = current[sourceId] ?? {
    overview: false,
    transcript: false,
    version: SOURCE_INDEX_VERSION,
  };
  return {
    ...current,
    [sourceId]: {
      ...existing,
      ...patch,
      version: patch.version ?? existing.version ?? SOURCE_INDEX_VERSION,
    },
  };
}

function mergeSourceIndexStateMap(
  current: SourceIndexStateMap,
  incoming: SourceIndexStateMap | null | undefined,
  sources: ProjectSource[],
): SourceIndexStateMap {
  let next = buildInitialSourceIndexState(sources, current);
  if (!incoming) return next;
  for (const sourceId of Object.keys(incoming)) {
    next = patchSourceIndexState(next, sourceId, incoming[sourceId] ?? {});
  }
  return next;
}

function buildDerivedIndexState(
  clips: VideoClip[],
  transitions: TransitionEntry[],
  aiSettings: AIEditingSettings,
  sourceTranscriptCaptions: CaptionEntry[] | null,
  sourceOverviewFrames: SourceIndexedFrame[] | null,
) {
  const backgroundTranscript = sourceTranscriptCaptions && sourceTranscriptCaptions.length > 0
    ? buildTranscriptContext(clips, sourceTranscriptCaptions, transitions)
    : null;
  const analysisOverviewFrames = sourceOverviewFrames && sourceOverviewFrames.length > 0
    ? projectSourceFramesToTimelineAll(clips, sourceOverviewFrames, transitions)
    : [];
  const displayOverviewFrames = sourceOverviewFrames && sourceOverviewFrames.length > 0
    ? projectSourceFramesToTimeline(clips, sourceOverviewFrames, aiSettings.frameInspection, transitions)
    : [];
  return {
    backgroundTranscript,
    analysisOverviewFrames: analysisOverviewFrames.length > 0 ? analysisOverviewFrames : null,
    displayOverviewFrames: displayOverviewFrames.length > 0 ? displayOverviewFrames : null,
    projectedOverviewFrames: displayOverviewFrames.length > 0 ? displayOverviewFrames : null,
    timelineProjectionFresh: true,
  };
}

function replaceEntriesForSource<T extends { sourceId?: string | null }>(
  current: T[] | null,
  sourceId: string,
  incoming: T[] | null,
): T[] | null {
  const preserved = (current ?? []).filter((entry) => normalizeSourceId(entry.sourceId) !== sourceId);
  const merged = [...preserved, ...(incoming ?? [])];
  return merged.length > 0 ? merged : null;
}

function replaceEntriesForSources<T extends { sourceId?: string | null }>(
  current: T[] | null,
  incoming: T[] | null,
): T[] | null {
  if (!incoming) return current;
  const sourceIds = new Set(
    incoming
      .map((entry) => normalizeSourceId(entry.sourceId))
      .filter((sourceId): sourceId is string => !!sourceId),
  );
  const preserved = (current ?? []).filter((entry) => {
    const sourceId = normalizeSourceId(entry.sourceId);
    return !sourceId || !sourceIds.has(sourceId);
  });
  const merged = [...preserved, ...incoming];
  return merged.length > 0 ? merged : null;
}

function hasEntriesForSource<T extends { sourceId?: string | null }>(
  entries: T[] | null | undefined,
  sourceId: string,
) {
  return (entries ?? []).some((entry) => normalizeSourceId(entry.sourceId) === sourceId);
}

function mergeHydratedEntriesForSources<T extends { sourceId?: string | null }>(
  current: T[] | null,
  incoming: T[] | null,
  sourceIds: string[],
  preservedSourceIds?: Set<string>,
): T[] | null {
  if (incoming === null) {
    return preservedSourceIds && preservedSourceIds.size > 0
      ? current
      : null;
  }

  let next = current;
  for (const sourceId of sourceIds) {
    const incomingForSource = incoming.filter((entry) => normalizeSourceId(entry.sourceId) === sourceId);
    if (incomingForSource.length > 0) {
      next = replaceEntriesForSource(next, sourceId, incomingForSource);
      continue;
    }
    if (!preservedSourceIds?.has(sourceId)) {
      next = replaceEntriesForSource(next, sourceId, null);
    }
  }
  return next;
}

function filterTaggedMarkerIds(taggedMarkerIds: string[], markers: MarkerEntry[]): string[] {
  const markerIds = new Set(markers.map((marker) => marker.id));
  return taggedMarkerIds.filter((id) => markerIds.has(id));
}

function filterTaggedClipIds(taggedClipIds: string[], clips: VideoClip[]): string[] {
  const clipIds = new Set(clips.map((clip) => clip.id));
  return taggedClipIds.filter((id) => clipIds.has(id));
}

function normalizeSelectedItem(
  selectedItem: SelectedItem,
  markers: MarkerEntry[],
  clips: VideoClip[],
  captions?: CaptionEntry[],
  textOverlays?: TextOverlayEntry[],
  transitions?: TransitionEntry[],
): SelectedItem {
  if (!selectedItem) return selectedItem;
  if (selectedItem.type === 'marker') {
    return markers.some((marker) => marker.id === selectedItem.id) ? selectedItem : null;
  }
  if (selectedItem.type === 'clip') {
    return clips.some((clip) => clip.id === selectedItem.id) ? selectedItem : null;
  }
  if (selectedItem.type === 'caption') {
    return (captions ?? []).some((caption) => caption.id === selectedItem.id) ? selectedItem : null;
  }
  if (selectedItem.type === 'text') {
    return (textOverlays ?? []).some((overlay) => overlay.id === selectedItem.id) ? selectedItem : null;
  }
  if (selectedItem.type === 'transition') {
    return (transitions ?? []).some((transition) => transition.id === selectedItem.id) ? selectedItem : null;
  }
  return selectedItem;
}

function clearReviewStatePatch() {
  return {
    activeReviewSession: null as EditReviewGroup | null,
    activeReviewFocusItemId: null as string | null,
    previewSnapshot: null as EditSnapshot | null,
    previewOwnerId: null as string | null,
  };
}

function buildBaseEditorState(input?: {
  videoFile?: File | null;
  videoUrl?: string;
  processingVideoUrl?: string;
  videoName?: string;
  currentProjectId?: string | null;
  storagePath?: string | null;
  sources?: ProjectSource[];
  sourceRuntimeById?: SourceRuntimeMediaMap;
  videoDuration?: number;
}): Pick<
  EditorState,
  | 'videoFile'
  | 'videoUrl'
  | 'processingVideoUrl'
  | 'videoName'
  | 'videoData'
  | 'videoDuration'
  | 'sources'
  | 'sourceRuntimeById'
  | 'currentTime'
  | 'requestedSeekTime'
  | 'pendingAction'
  | 'clips'
  | 'captions'
  | 'transitions'
  | 'markers'
  | 'textOverlays'
  | 'previewSnapshot'
  | 'previewOwnerId'
  | 'selectedItem'
  | 'taggedMarkerIds'
  | 'taggedClipIds'
  | 'activeReviewSession'
  | 'activeReviewFocusItemId'
  | 'history'
  | 'future'
  | 'isChatLoading'
  | 'aiSettings'
  | 'appliedActions'
  | 'ffmpegJob'
  | 'currentProjectId'
  | 'storagePath'
  | 'uploadProgress'
  | 'saveStatus'
  | 'zoom'
  | 'playbackActive'
  | 'backgroundTranscript'
  | 'transcriptStatus'
  | 'transcriptError'
  | 'transcriptProgress'
  | 'sourceTranscriptCaptions'
  | 'sourceOverviewFrames'
  | 'analysisOverviewFrames'
  | 'displayOverviewFrames'
  | 'projectedOverviewFrames'
  | 'sourceIndexFreshBySourceId'
  | 'timelineProjectionFresh'
  | 'visualSearchSession'
  | 'sourceIndex'
  | 'sourceIndexAnalysis'
  | 'sourceIndexAnalysisBySourceId'
> {
  return {
    videoFile: input?.videoFile ?? null,
    videoUrl: input?.videoUrl ?? '',
    processingVideoUrl: input?.processingVideoUrl ?? input?.videoUrl ?? '',
    videoName: input?.videoName ?? '',
    videoData: null,
    videoDuration: input?.videoDuration ?? 0,
    sources: input?.sources ?? [],
    sourceRuntimeById: input?.sourceRuntimeById ?? {},
    currentTime: 0,
    requestedSeekTime: null,
    pendingAction: null,
    clips: [],
    captions: [],
    transitions: [],
    markers: [],
    textOverlays: [],
    previewSnapshot: null,
    previewOwnerId: null,
    selectedItem: null,
    taggedMarkerIds: [],
    taggedClipIds: [],
    activeReviewSession: null,
    activeReviewFocusItemId: null,
    history: [],
    future: [],
    isChatLoading: false,
    aiSettings: DEFAULT_AI_EDITING_SETTINGS,
    appliedActions: [],
    ffmpegJob: { status: 'idle' },
    currentProjectId: input?.currentProjectId ?? null,
    storagePath: input?.storagePath ?? null,
    uploadProgress: null,
    saveStatus: 'idle',
    zoom: 1,
    playbackActive: false,
    backgroundTranscript: null,
    transcriptStatus: 'idle',
    transcriptError: null,
    transcriptProgress: null,
    sourceTranscriptCaptions: null,
    sourceOverviewFrames: null,
    analysisOverviewFrames: null,
    displayOverviewFrames: null,
    projectedOverviewFrames: null,
    sourceIndexFreshBySourceId: buildInitialSourceIndexState(input?.sources),
    timelineProjectionFresh: true,
    visualSearchSession: null,
    sourceIndex: null,
    sourceIndexAnalysis: null,
    sourceIndexAnalysisBySourceId: {},
  };
}

interface EditorState {
  videoFile: File | null;
  videoUrl: string;
  processingVideoUrl: string;
  videoName: string;
  videoData: Uint8Array | null;
  videoDuration: number;
  sources: ProjectSource[];
  sourceRuntimeById: SourceRuntimeMediaMap;
  currentTime: number;
  requestedSeekTime: number | null;
  pendingAction: EditAction | null;
  clips: VideoClip[];
  captions: CaptionEntry[];
  transitions: TransitionEntry[];
  markers: MarkerEntry[];
  textOverlays: TextOverlayEntry[];
  previewSnapshot: EditSnapshot | null;
  previewOwnerId: string | null;
  selectedItem: SelectedItem;
  taggedMarkerIds: string[];
  taggedClipIds: string[];
  activeReviewSession: EditReviewGroup | null;
  activeReviewFocusItemId: string | null;
  history: EditSnapshot[];
  future: EditSnapshot[];
  messages: ChatMessage[];
  isChatLoading: boolean;
  aiSettings: AIEditingSettings;
  appliedActions: AppliedActionRecord[];
  ffmpegJob: FFmpegJob;
  currentProjectId: string | null;
  storagePath: string | null;
  uploadProgress: number | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  zoom: number;
  playbackActive: boolean;
  backgroundTranscript: string | null;
  transcriptStatus: TranscriptStatus;
  transcriptError: string | null;
  transcriptProgress: TranscriptProgress;
  sourceTranscriptCaptions: CaptionEntry[] | null;
  sourceOverviewFrames: SourceIndexedFrame[] | null;
  analysisOverviewFrames: IndexedVideoFrame[] | null;
  displayOverviewFrames: IndexedVideoFrame[] | null;
  projectedOverviewFrames: IndexedVideoFrame[] | null;
  sourceIndexFreshBySourceId: SourceIndexStateMap;
  timelineProjectionFresh: boolean;
  visualSearchSession: VisualSearchSession | null;
  sourceIndex: SourceIndex | null;
  sourceIndexAnalysis: SourceIndexAnalysisState | null;
  sourceIndexAnalysisBySourceId: SourceIndexAnalysisStateMap;
  importSources: (
    sources: ImportedSourceDraft[],
    options?: { insertAtTime?: number; shouldAppendClips?: boolean },
  ) => ProjectSource[];
  appendClipFromSource: (sourceId: string) => void;
  insertClipFromSource: (sourceId: string, timelineTime: number) => void;
  insertClipsFromSources: (sourceIds: string[], timelineTime: number) => void;
  updateSource: (sourceId: string, patch: Partial<ProjectSource>) => void;
  updateSourceRuntime: (sourceId: string, patch: Partial<NonNullable<SourceRuntimeMediaMap[string]>>) => void;
  setVideoFile: (file: File) => void;
  setSourceDuration: (sourceId: string, duration: number) => void;
  setVideoDuration: (duration: number) => void;
  setCurrentTime: (time: number) => void;
  requestSeek: (time: number) => void;
  clearRequestedSeek: () => void;
  setPendingAction: (action: EditAction | null) => void;
  setPreviewSnapshot: (ownerId: string, snapshot: EditSnapshot) => void;
  clearPreviewSnapshot: (ownerId?: string) => void;
  commitPreviewSnapshot: (snapshot: EditSnapshot) => void;
  splitClipAtTime: (timelineTime: number) => void;
  deleteRangeAtTime: (startTime: number, endTime: number) => void;
  deleteClip: (clipId: string) => void;
  reorderClip: (clipId: string, newIndex: number) => void;
  trimClip: (clipId: string, newSourceStart: number, newSourceDuration: number) => void;
  trimClipWithHistory: (clipId: string, newSourceStart: number, newSourceDuration: number) => void;
  setClipSpeed: (clipId: string, speed: number) => void;
  setClipVolume: (clipId: string, volume: number, fadeIn?: number, fadeOut?: number) => void;
  setClipFilter: (clipId: string, filter: ColorFilter | null) => void;
  setClipFade: (clipId: string, fadeIn: number, fadeOut: number) => void;
  applyAction: (action: EditAction) => void;
  undo: () => void;
  redo: () => void;
  pushHistory: (snap: EditSnapshot) => void;
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => string;
  updateMessage: (id: string, patch: Partial<Omit<ChatMessage, 'id' | 'timestamp'>>) => void;
  removeMessage: (id: string) => void;
  setIsChatLoading: (v: boolean) => void;
  clearChatHistory: () => void;
  clearMessages: () => void;
  setAISettings: (settings: Partial<AIEditingSettings>) => void;
  recordAppliedAction: (
    action: EditAction,
    summary: string,
    metadata?: {
      sourceRanges?: AppliedActionRecord['sourceRanges'];
      requestChainId?: string;
    },
  ) => void;
  setFFmpegJob: (job: FFmpegJob) => void;
  setVideoCloud: (file: File, blobUrl: string, storagePath: string, projectId: string) => void;
  setProjectVideoFile: (file: File, projectId: string, storagePath?: string | null) => void;
  loadProject: (
    editState: {
      clips?: unknown[];
      captions?: unknown[];
      transitions?: unknown[];
      markers?: unknown[];
      textOverlays?: unknown[];
      messages?: unknown[];
      appliedActions?: unknown[];
      aiSettings?: unknown;
      backgroundTranscript?: unknown;
      transcriptStatus?: unknown;
      transcriptError?: unknown;
      sourceTranscriptCaptions?: unknown[];
      sourceOverviewFrames?: unknown[];
      sourceIndexFreshBySourceId?: unknown;
      rawTranscriptCaptions?: unknown[];
      videoFrames?: unknown[];
      videoDuration?: number;
      sourceIndex?: unknown;
      sources?: unknown[];
    },
    project: {
      projectId: string;
      videoUrl: string;
      processingVideoUrl?: string;
      storagePath: string | null;
      videoFilename?: string | null;
      duration?: number;
      sources?: unknown[];
    }
  ) => void;
  setUploadProgress: (pct: number | null) => void;
  setSaveStatus: (status: 'idle' | 'saving' | 'saved' | 'error') => void;
  setStoragePath: (path: string) => void;
  setZoom: (zoom: number) => void;
  setPlaybackActive: (active: boolean) => void;
  setBackgroundTranscript: (
    text: string | null,
    status: TranscriptStatus,
    rawCaptions?: CaptionEntry[],
    errorMessage?: string | null,
    options?: { markFresh?: boolean },
  ) => void;
  setTranscriptProgress: (progress: TranscriptProgress) => void;
  setSourceOverviewFrames: (
    sourceId: string,
    frames: SourceIndexedFrame[] | null,
    options?: { fresh?: boolean; assetId?: string | null; indexedAt?: string | null },
  ) => void;
  hydrateSourceIndex: (payload: {
    sourceTranscriptCaptions?: CaptionEntry[] | null;
    sourceOverviewFrames?: SourceIndexedFrame[] | null;
    sourceIndexFreshBySourceId?: SourceIndexStateMap;
    analysis?: SourceIndexAnalysisState | null;
    analysisBySourceId?: SourceIndexAnalysisStateMap;
  }) => void;
  setSourceIndexAnalysis: (analysis: SourceIndexAnalysisState | null) => void;
  setVisualSearchSession: (session: VisualSearchSession | null) => void;
  setSourceIndex: (index: SourceIndex | null) => void;
  addMarker: (marker: Omit<MarkerEntry, 'id' | 'number'> & { id?: string; number?: number }) => string;
  updateMarker: (id: string, patch: Partial<Omit<MarkerEntry, 'id'>>) => void;
  removeMarker: (id: string) => void;
  createMarkerAtTime: (timelineTime: number, options?: { label?: string; createdBy?: 'ai' | 'human'; linkedMessageId?: string | null }) => string;
  resetEditor: () => void;
  setSelectedItem: (item: SelectedItem) => void;
  setTaggedMarkerIds: (ids: string[]) => void;
  toggleTaggedMarker: (id: string) => void;
  clearTaggedMarkers: () => void;
  setTaggedClipIds: (ids: string[]) => void;
  toggleTaggedClip: (id: string) => void;
  clearTaggedClips: () => void;
  setActiveReviewSession: (session: EditReviewGroup | null) => void;
  setActiveReviewFocusItemId: (itemId: string | null) => void;
  deleteSelectedItem: () => void;
  updateCaption: (id: string, patch: { startTime?: number; endTime?: number }) => void;
  updateTextOverlay: (id: string, patch: { startTime?: number; endTime?: number }) => void;
  updateTransition: (id: string, patch: Partial<TransitionEntry>) => void;
}

type EditorStoreWithSnapshot = EditorState & {
  _snapshot: () => EditSnapshot;
};

function revokeSourceRuntimeUrls(sourceRuntimeById: SourceRuntimeMediaMap) {
  Object.values(sourceRuntimeById).forEach((runtime) => {
    if (runtime?.objectUrl) {
      URL.revokeObjectURL(runtime.objectUrl);
    }
  });
}

function buildPrimaryMirrorState(
  sources: ProjectSource[],
  sourceRuntimeById: SourceRuntimeMediaMap,
  currentProjectId: string | null,
): Pick<EditorState, 'videoFile' | 'videoUrl' | 'processingVideoUrl' | 'videoName' | 'videoDuration' | 'storagePath' | 'sources' | 'sourceRuntimeById' | 'currentProjectId'> {
  const primarySource = getPrimarySource(sources);
  const runtime = primarySource ? sourceRuntimeById[primarySource.id] : undefined;
  return {
    videoFile: runtime?.file ?? null,
    videoUrl: runtime?.objectUrl || runtime?.playerUrl || '',
    processingVideoUrl: runtime?.processingUrl || runtime?.objectUrl || runtime?.playerUrl || '',
    videoName: primarySource?.fileName ?? '',
    videoDuration: primarySource?.duration ?? 0,
    storagePath: primarySource?.storagePath ?? null,
    sources,
    sourceRuntimeById,
    currentProjectId,
  };
}

function buildClampedTimelineControlState(
  currentTime: number,
  requestedSeekTime: number | null,
  clips: VideoClip[],
  transitions: TransitionEntry[],
) {
  const totalTimelineDuration = Math.max(0, getTimelineDuration(clips, transitions));
  return {
    currentTime: Math.max(0, Math.min(currentTime, totalTimelineDuration)),
    requestedSeekTime: requestedSeekTime === null
      ? null
      : Math.max(0, Math.min(requestedSeekTime, totalTimelineDuration)),
  };
}

function findInsertionIndex(
  clips: VideoClip[],
  transitions: TransitionEntry[],
  timelineTime: number,
) {
  const clipSchedule = buildClipSchedule(clips, transitions);
  const epsilon = 1e-6;
  for (let index = 0; index < clipSchedule.length; index += 1) {
    const entry = clipSchedule[index];
    if (timelineTime <= entry.timelineStart + epsilon) {
      return index;
    }
  }
  return clips.length;
}

function insertClipsAtTimelineTime(
  clips: VideoClip[],
  transitions: TransitionEntry[],
  sourceIds: string[],
  sourceById: Map<string, ProjectSource>,
  timelineTime: number,
): VideoClip[] {
  const splitClips = splitClipsAtTime(clips, timelineTime);
  const insertionIndex = findInsertionIndex(splitClips, transitions, timelineTime);
  const insertedClips = sourceIds
    .map((sourceId) => sourceById.get(sourceId))
    .filter((source): source is ProjectSource => !!source && source.duration > 0)
    .map((source) => makeClip(source.id, 0, source.duration));

  if (insertedClips.length === 0) return splitClips;
  return [
    ...splitClips.slice(0, insertionIndex),
    ...insertedClips,
    ...splitClips.slice(insertionIndex),
  ];
}

export const useEditorStore = create<EditorState>((set, get) => ({
  ...buildBaseEditorState(),
  messages: [],

  _snapshot: (): EditSnapshot => {
    const s = get();
    return {
      clips: s.clips,
      captions: s.captions,
      transitions: s.transitions,
      markers: s.markers,
      textOverlays: s.textOverlays,
      appliedActions: s.appliedActions,
    };
  },

  importSources: (drafts, options) => {
    if (drafts.length === 0) return [];

    const currentState = get();
    const snap = (currentState as EditorStoreWithSnapshot)._snapshot();
    const nextSources = [...currentState.sources];
    const nextRuntimeById: SourceRuntimeMediaMap = { ...currentState.sourceRuntimeById };
    const addedSources: ProjectSource[] = [];
    const hadSources = currentState.sources.length > 0;

    drafts.forEach((draft, index) => {
      const shouldBePrimary = (!hadSources && nextSources.length === 0 && index === 0) || draft.isPrimary === true;
      const source = createProjectSource({
        ...draft,
        id: shouldBePrimary ? MAIN_SOURCE_ID : draft.id,
        isPrimary: shouldBePrimary,
        status: draft.status ?? (draft.runtime?.file ? 'pending' : 'ready'),
      });
      if (nextSources.some((existing) => existing.id === source.id)) {
        return;
      }
      if (shouldBePrimary) {
        for (const existing of nextSources) {
          existing.isPrimary = false;
        }
      }
      nextSources.push(source);
      nextRuntimeById[source.id] = {
        file: draft.runtime?.file ?? null,
        objectUrl: draft.runtime?.objectUrl ?? '',
        playerUrl: draft.runtime?.playerUrl ?? '',
        processingUrl: draft.runtime?.processingUrl ?? draft.runtime?.objectUrl ?? '',
      };
      addedSources.push(source);
    });

    if (addedSources.length === 0) return [];

    const sourceById = new Map(nextSources.map((source) => [source.id, source]));
    const insertedSourceIds = addedSources.map((source) => source.id);
    const shouldAppendClips = options?.shouldAppendClips !== false;
    const nextClips = shouldAppendClips
      ? (Number.isFinite(options?.insertAtTime)
          ? insertClipsAtTimelineTime(currentState.clips, currentState.transitions, insertedSourceIds, sourceById, options!.insertAtTime!)
          : [...currentState.clips, ...insertedSourceIds
              .map((sourceId) => sourceById.get(sourceId))
              .filter((source): source is ProjectSource => !!source && source.duration > 0)
              .map((source) => makeClip(source.id, 0, source.duration))])
      : currentState.clips;
    const nextTransitions = shouldAppendClips
      ? normalizeTransitionState(nextClips, currentState.transitions)
      : currentState.transitions;
    const nextSourceIndexState = buildInitialSourceIndexState(nextSources, currentState.sourceIndexFreshBySourceId);
    const primaryMirror = buildPrimaryMirrorState(nextSources, nextRuntimeById, currentState.currentProjectId);

    set((state) => ({
      ...primaryMirror,
      clips: nextClips,
      transitions: nextTransitions,
      history: shouldAppendClips && state.clips.length > 0 ? [...state.history, snap] : state.history,
      future: shouldAppendClips ? [] : state.future,
      markers: shouldAppendClips ? [] : state.markers,
      taggedMarkerIds: shouldAppendClips ? [] : state.taggedMarkerIds,
      taggedClipIds: filterTaggedClipIds(state.taggedClipIds, nextClips),
      selectedItem: normalizeSelectedItem(
        shouldAppendClips && state.selectedItem?.type === 'marker' ? null : state.selectedItem,
        shouldAppendClips ? [] : state.markers,
        nextClips,
        state.captions,
        state.textOverlays,
        nextTransitions,
      ),
      ...clearReviewStatePatch(),
      sourceIndexFreshBySourceId: nextSourceIndexState,
      ...buildDerivedIndexState(
        nextClips,
        nextTransitions,
        state.aiSettings,
        state.sourceTranscriptCaptions,
        state.sourceOverviewFrames,
      ),
    }));

    return addedSources;
  },

  appendClipFromSource: (sourceId) => {
    const state = get();
    const source = state.sources.find((entry) => entry.id === sourceId);
    if (!source || source.duration <= 0) return;
    const snap = (state as EditorStoreWithSnapshot)._snapshot();
    const nextClips = [...state.clips, makeClip(source.id, 0, source.duration)];
    const nextTransitions = normalizeTransitionState(nextClips, state.transitions);
    set((current) => ({
      history: [...current.history, snap],
      future: [],
      clips: nextClips,
      transitions: nextTransitions,
      markers: [],
      taggedMarkerIds: [],
      taggedClipIds: filterTaggedClipIds(current.taggedClipIds, nextClips),
      selectedItem: normalizeSelectedItem(current.selectedItem?.type === 'marker' ? null : current.selectedItem, [], nextClips, current.captions, current.textOverlays, nextTransitions),
      ...clearReviewStatePatch(),
      ...buildDerivedIndexState(
        nextClips,
        nextTransitions,
        current.aiSettings,
        current.sourceTranscriptCaptions,
        current.sourceOverviewFrames,
      ),
    }));
  },

  insertClipFromSource: (sourceId, timelineTime) => {
    get().insertClipsFromSources([sourceId], timelineTime);
  },

  insertClipsFromSources: (sourceIds, timelineTime) => {
    const state = get();
    const sourceById = new Map(state.sources.map((source) => [source.id, source]));
    const nextClips = insertClipsAtTimelineTime(state.clips, state.transitions, sourceIds, sourceById, timelineTime);
    if (nextClips === state.clips) return;
    const snap = (state as EditorStoreWithSnapshot)._snapshot();
    const nextTransitions = normalizeTransitionState(nextClips, state.transitions);
    set((current) => ({
      history: [...current.history, snap],
      future: [],
      clips: nextClips,
      transitions: nextTransitions,
      markers: [],
      taggedMarkerIds: [],
      taggedClipIds: filterTaggedClipIds(current.taggedClipIds, nextClips),
      selectedItem: normalizeSelectedItem(current.selectedItem?.type === 'marker' ? null : current.selectedItem, [], nextClips, current.captions, current.textOverlays, nextTransitions),
      ...clearReviewStatePatch(),
      ...buildDerivedIndexState(
        nextClips,
        nextTransitions,
        current.aiSettings,
        current.sourceTranscriptCaptions,
        current.sourceOverviewFrames,
      ),
    }));
  },

  updateSource: (sourceId, patch) => {
    const state = get();
    const normalizedPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as Partial<ProjectSource>;
    const nextSources = state.sources.map((source) => (
      source.id === sourceId
        ? { ...source, ...normalizedPatch, id: source.id, isPrimary: normalizedPatch.isPrimary ?? source.isPrimary }
        : { ...source, isPrimary: normalizedPatch.isPrimary === true ? false : source.isPrimary }
    ));
    const previousRuntime = state.sourceRuntimeById[sourceId];
    const nextRuntimeById: SourceRuntimeMediaMap = {
      ...state.sourceRuntimeById,
      [sourceId]: {
        file: previousRuntime?.file ?? null,
        objectUrl: previousRuntime?.objectUrl ?? '',
        playerUrl: previousRuntime?.objectUrl
          || previousRuntime?.playerUrl
          || (normalizedPatch.storagePath && state.currentProjectId
            ? `/api/projects/${state.currentProjectId}/media?sourceId=${encodeURIComponent(sourceId)}`
            : ''),
        processingUrl: previousRuntime?.processingUrl ?? '',
      },
    };
    const primaryMirror = buildPrimaryMirrorState(nextSources, nextRuntimeById, state.currentProjectId);
    set({
      ...primaryMirror,
      sourceIndexFreshBySourceId: mergeSourceIndexStateMap(state.sourceIndexFreshBySourceId, null, nextSources),
    });
  },

  updateSourceRuntime: (sourceId, patch) => {
    const state = get();
    const previousRuntime = state.sourceRuntimeById[sourceId];
    if (patch.objectUrl && previousRuntime?.objectUrl && previousRuntime.objectUrl !== patch.objectUrl) {
      URL.revokeObjectURL(previousRuntime.objectUrl);
    }
    const nextRuntimeById: SourceRuntimeMediaMap = {
      ...state.sourceRuntimeById,
      [sourceId]: {
        file: patch.file ?? previousRuntime?.file ?? null,
        objectUrl: patch.objectUrl ?? previousRuntime?.objectUrl ?? '',
        playerUrl: patch.playerUrl ?? previousRuntime?.playerUrl ?? '',
        processingUrl: patch.processingUrl ?? previousRuntime?.processingUrl ?? '',
      },
    };
    const primaryMirror = buildPrimaryMirrorState(state.sources, nextRuntimeById, state.currentProjectId);
    set(primaryMirror);
  },

  setVideoFile: (file) => {
    revokeSourceRuntimeUrls(get().sourceRuntimeById);
    const url = URL.createObjectURL(file);
    const source = createProjectSource({
      id: MAIN_SOURCE_ID,
      fileName: file.name,
      duration: 0,
      isPrimary: true,
      status: 'pending',
    });
    set((state) => ({
      ...buildBaseEditorState({
        ...buildPrimaryMirrorState([source], {
          [MAIN_SOURCE_ID]: {
            file,
            objectUrl: url,
            playerUrl: url,
            processingUrl: url,
          },
        }, state.currentProjectId),
      }),
      messages: state.messages,
    }));
  },

  setSourceDuration: (sourceId, duration) => set((state) => {
    const nextSources = state.sources.map((source) => (
      source.id === sourceId ? { ...source, duration } : source
    ));
    const primaryMirror = buildPrimaryMirrorState(nextSources, state.sourceRuntimeById, state.currentProjectId);
    const clipsAreEmpty = state.clips.length === 0 && sourceId === MAIN_SOURCE_ID && duration > 0;
    const nextClips = clipsAreEmpty ? [makeClip(MAIN_SOURCE_ID, 0, duration)] : state.clips;
    const nextTransitions = clipsAreEmpty ? normalizeTransitionState(nextClips, state.transitions) : state.transitions;
    return {
      ...primaryMirror,
      clips: nextClips,
      transitions: nextTransitions,
      ...buildDerivedIndexState(
        nextClips,
        nextTransitions,
        state.aiSettings,
        state.sourceTranscriptCaptions,
        state.sourceOverviewFrames,
      ),
    };
  }),

  setVideoDuration: (duration) => {
    get().setSourceDuration(MAIN_SOURCE_ID, duration);
  },

  setCurrentTime: (time) => set({ currentTime: time }),
  requestSeek: (time) => set({ requestedSeekTime: Math.max(0, time) }),
  clearRequestedSeek: () => set({ requestedSeekTime: null }),
  setPendingAction: (action) => set({ pendingAction: action }),
  setPreviewSnapshot: (ownerId, snapshot) => set({ previewSnapshot: snapshot, previewOwnerId: ownerId }),
  clearPreviewSnapshot: (ownerId) => set((state) => {
    if (ownerId && state.previewOwnerId && state.previewOwnerId !== ownerId) return state;
    return {
      previewSnapshot: null,
      previewOwnerId: null,
      activeReviewSession: ownerId && state.activeReviewSession?.ownerId !== ownerId
        ? state.activeReviewSession
        : null,
      activeReviewFocusItemId: ownerId && state.activeReviewSession?.ownerId !== ownerId
        ? state.activeReviewFocusItemId
        : null,
    };
  }),
  commitPreviewSnapshot: (snapshot) => {
    const current = (get() as unknown as EditorStoreWithSnapshot)._snapshot();
    set((state) => ({
      ...snapshot,
      history: [...state.history, current],
      future: [],
      pendingAction: null,
      selectedItem: normalizeSelectedItem(state.selectedItem, snapshot.markers, snapshot.clips, snapshot.captions, snapshot.textOverlays, snapshot.transitions),
      taggedMarkerIds: filterTaggedMarkerIds(state.taggedMarkerIds, snapshot.markers),
      taggedClipIds: filterTaggedClipIds(state.taggedClipIds, snapshot.clips),
      ...buildClampedTimelineControlState(
        state.currentTime,
        state.requestedSeekTime,
        snapshot.clips,
        snapshot.transitions,
      ),
      ...clearReviewStatePatch(),
      ...buildDerivedIndexState(
        snapshot.clips,
        snapshot.transitions,
        state.aiSettings,
        state.sourceTranscriptCaptions,
        state.sourceOverviewFrames,
      ),
    }));
  },

  splitClipAtTime: (timelineTime) => {
    const { clips } = get();
    const newClips = splitClipsAtTime(clips, timelineTime);
    if (newClips === clips) return;
    const snap = (get() as EditorStoreWithSnapshot)._snapshot();
    const action: EditAction = {
      type: 'split_clip',
      splitTime: timelineTime,
      message: `Split clip at ${formatTimePrecise(timelineTime)}`,
    };

    const nextTransitions = normalizeTransitionState(newClips, get().transitions);
    set((state) => ({
      history: [...state.history, snap],
      future: [],
      clips: newClips,
      transitions: nextTransitions,
      markers: [],
      taggedMarkerIds: [],
      taggedClipIds: filterTaggedClipIds(state.taggedClipIds, newClips),
      selectedItem: normalizeSelectedItem(state.selectedItem?.type === 'marker' ? null : state.selectedItem, [], newClips, state.captions, state.textOverlays, nextTransitions),
      ...clearReviewStatePatch(),
      ...buildDerivedIndexState(
        newClips,
        nextTransitions,
        state.aiSettings,
        state.sourceTranscriptCaptions,
        state.sourceOverviewFrames,
      ),
      appliedActions: [
        ...state.appliedActions.slice(-24),
        { id: uuidv4(), timestamp: Date.now(), action, summary: action.message },
      ],
    }));
  },

  deleteRangeAtTime: (startTime, endTime) => {
    const { clips } = get();
    const newClips = deleteRangeFromClips(clips, startTime, endTime);
    if (newClips === clips) return;
    const snap = (get() as EditorStoreWithSnapshot)._snapshot();
    const nextTransitions = normalizeTransitionState(newClips, get().transitions);
    set((state) => ({
      history: [...state.history, snap],
      future: [],
      clips: newClips,
      transitions: nextTransitions,
      markers: [],
      taggedMarkerIds: [],
      taggedClipIds: filterTaggedClipIds(state.taggedClipIds, newClips),
      selectedItem: normalizeSelectedItem(state.selectedItem?.type === 'marker' ? null : state.selectedItem, [], newClips, state.captions, state.textOverlays, nextTransitions),
      ...clearReviewStatePatch(),
      ...buildDerivedIndexState(
        newClips,
        nextTransitions,
        state.aiSettings,
        state.sourceTranscriptCaptions,
        state.sourceOverviewFrames,
      ),
    }));
  },

  deleteClip: (clipId) => {
    const snap = (get() as EditorStoreWithSnapshot)._snapshot();
    set((state) => {
      const nextClips = state.clips.filter((clip) => clip.id !== clipId);
      const nextTransitions = normalizeTransitionState(nextClips, state.transitions);
      return {
        history: [...state.history, snap],
        future: [],
        clips: nextClips,
        transitions: nextTransitions,
        markers: [],
        taggedMarkerIds: [],
        taggedClipIds: filterTaggedClipIds(state.taggedClipIds, nextClips),
        selectedItem: null,
        ...clearReviewStatePatch(),
        ...buildDerivedIndexState(
          nextClips,
          nextTransitions,
          state.aiSettings,
          state.sourceTranscriptCaptions,
          state.sourceOverviewFrames,
        ),
      };
    });
  },

  reorderClip: (clipId, newIndex) => {
    const snap = (get() as EditorStoreWithSnapshot)._snapshot();
    const { clips } = get();
    const idx = clips.findIndex((clip) => clip.id === clipId);
    if (idx === -1) return;
    const nextClips = [...clips];
    const [removed] = nextClips.splice(idx, 1);
    nextClips.splice(Math.max(0, Math.min(nextClips.length, newIndex)), 0, removed);
    const nextTransitions = normalizeTransitionState(nextClips, get().transitions);
    set((state) => ({
      history: [...state.history, snap],
      future: [],
      clips: nextClips,
      transitions: nextTransitions,
      markers: [],
      taggedMarkerIds: [],
      taggedClipIds: filterTaggedClipIds(state.taggedClipIds, nextClips),
      selectedItem: normalizeSelectedItem(state.selectedItem?.type === 'marker' ? null : state.selectedItem, [], nextClips, state.captions, state.textOverlays, nextTransitions),
      ...clearReviewStatePatch(),
      ...buildDerivedIndexState(
        nextClips,
        nextTransitions,
        state.aiSettings,
        state.sourceTranscriptCaptions,
        state.sourceOverviewFrames,
      ),
    }));
  },

  trimClip: (clipId, newSourceStart, newSourceDuration) => {
    set((state) => {
      const nextClips = state.clips.map((clip) => (
        clip.id === clipId
          ? { ...clip, sourceStart: newSourceStart, sourceDuration: newSourceDuration }
          : clip
      ));
      const nextTransitions = normalizeTransitionState(nextClips, state.transitions);
      return {
        clips: nextClips,
        transitions: nextTransitions,
        markers: [],
        taggedMarkerIds: [],
        taggedClipIds: filterTaggedClipIds(state.taggedClipIds, nextClips),
        selectedItem: normalizeSelectedItem(state.selectedItem?.type === 'marker' ? null : state.selectedItem, [], nextClips, state.captions, state.textOverlays, nextTransitions),
        ...clearReviewStatePatch(),
        ...buildDerivedIndexState(
          nextClips,
          nextTransitions,
          state.aiSettings,
          state.sourceTranscriptCaptions,
          state.sourceOverviewFrames,
        ),
      };
    });
  },

  trimClipWithHistory: (clipId, newSourceStart, newSourceDuration) => {
    const snap = (get() as EditorStoreWithSnapshot)._snapshot();
    set((state) => {
      const nextClips = state.clips.map((clip) => (
        clip.id === clipId
          ? { ...clip, sourceStart: newSourceStart, sourceDuration: newSourceDuration }
          : clip
      ));
      const nextTransitions = normalizeTransitionState(nextClips, state.transitions);
      return {
        history: [...state.history, snap],
        future: [],
        clips: nextClips,
        transitions: nextTransitions,
        markers: [],
        taggedMarkerIds: [],
        taggedClipIds: filterTaggedClipIds(state.taggedClipIds, nextClips),
        selectedItem: normalizeSelectedItem(state.selectedItem?.type === 'marker' ? null : state.selectedItem, [], nextClips, state.captions, state.textOverlays, nextTransitions),
        ...clearReviewStatePatch(),
        ...buildDerivedIndexState(
          nextClips,
          nextTransitions,
          state.aiSettings,
          state.sourceTranscriptCaptions,
          state.sourceOverviewFrames,
        ),
      };
    });
  },

  setClipSpeed: (clipId, speed) => {
    const snap = (get() as EditorStoreWithSnapshot)._snapshot();
    set((state) => {
      const nextClips = state.clips.map((clip) => (
        clip.id === clipId
          ? { ...clip, speed: Math.max(0.1, Math.min(10, speed)) }
          : clip
      ));
      const nextTransitions = normalizeTransitionState(nextClips, state.transitions);
      return {
        history: [...state.history, snap],
        future: [],
        clips: nextClips,
        transitions: nextTransitions,
        markers: [],
        taggedMarkerIds: [],
        taggedClipIds: filterTaggedClipIds(state.taggedClipIds, nextClips),
        selectedItem: normalizeSelectedItem(state.selectedItem?.type === 'marker' ? null : state.selectedItem, [], nextClips, state.captions, state.textOverlays, nextTransitions),
        ...clearReviewStatePatch(),
        ...buildDerivedIndexState(
          nextClips,
          nextTransitions,
          state.aiSettings,
          state.sourceTranscriptCaptions,
          state.sourceOverviewFrames,
        ),
      };
    });
  },

  setClipVolume: (clipId, volume, fadeIn, fadeOut) => {
    const snap = (get() as EditorStoreWithSnapshot)._snapshot();
    set((state) => ({
      history: [...state.history, snap],
      future: [],
      clips: state.clips.map((clip) => (
        clip.id === clipId
          ? {
              ...clip,
              volume,
              ...(fadeIn !== undefined ? { fadeIn } : {}),
              ...(fadeOut !== undefined ? { fadeOut } : {}),
            }
          : clip
      )),
    }));
  },

  setClipFilter: (clipId, filter) => {
    const snap = (get() as EditorStoreWithSnapshot)._snapshot();
    set((state) => ({
      history: [...state.history, snap],
      future: [],
      clips: state.clips.map((clip) => (
        clip.id === clipId ? { ...clip, filter } : clip
      )),
    }));
  },

  setClipFade: (clipId, fadeIn, fadeOut) => {
    const snap = (get() as EditorStoreWithSnapshot)._snapshot();
    set((state) => ({
      history: [...state.history, snap],
      future: [],
      clips: state.clips.map((clip) => (
        clip.id === clipId ? { ...clip, fadeIn, fadeOut } : clip
      )),
    }));
  },

  applyAction: (action) => {
    if (action.type === 'none') return;
    const snap = (get() as EditorStoreWithSnapshot)._snapshot();
    const sourceTranscriptCaptions = get().sourceTranscriptCaptions;
    if (action.type === 'update_ai_settings') {
      set((state) => {
        const aiSettings = mergeAISettings(state.aiSettings, action.settings);
        return {
          aiSettings,
          pendingAction: null,
          ...clearReviewStatePatch(),
          ...buildDerivedIndexState(
            state.clips,
            state.transitions,
            aiSettings,
            state.sourceTranscriptCaptions,
            state.sourceOverviewFrames,
          ),
        };
      });
      return;
    }
    const next = applyActionToSnapshot(snap, action, { sourceTranscriptCaptions });
    if (next === snap) return;
    set((state) => ({
      ...next,
      history: [...state.history, snap],
      future: [],
      pendingAction: null,
      selectedItem: normalizeSelectedItem(
        actionChangesTimelineStructure(action) ? null : state.selectedItem,
        next.markers,
        next.clips,
        next.captions,
        next.textOverlays,
        next.transitions,
      ),
      taggedMarkerIds: filterTaggedMarkerIds(state.taggedMarkerIds, next.markers),
      taggedClipIds: filterTaggedClipIds(state.taggedClipIds, next.clips),
      ...buildClampedTimelineControlState(
        state.currentTime,
        state.requestedSeekTime,
        next.clips,
        next.transitions,
      ),
      ...clearReviewStatePatch(),
      ...(actionChangesTimelineStructure(action)
        ? buildDerivedIndexState(
            next.clips,
            next.transitions,
            state.aiSettings,
            state.sourceTranscriptCaptions,
            state.sourceOverviewFrames,
          )
        : {}),
    }));
  },

  undo: () => {
    const { history, future } = get();
    if (history.length === 0) return;
    const snap = (get() as EditorStoreWithSnapshot)._snapshot();
    const prev = history[history.length - 1];
    set({
      ...prev,
      history: history.slice(0, -1),
      future: [snap, ...future],
      appliedActions: prev.appliedActions ?? get().appliedActions,
      pendingAction: null,
      selectedItem: null,
      taggedMarkerIds: [],
      taggedClipIds: [],
      ...buildClampedTimelineControlState(
        get().currentTime,
        get().requestedSeekTime,
        prev.clips,
        prev.transitions,
      ),
      ...clearReviewStatePatch(),
      ...buildDerivedIndexState(
        prev.clips,
        prev.transitions,
        get().aiSettings,
        get().sourceTranscriptCaptions,
        get().sourceOverviewFrames,
      ),
    });
  },

  redo: () => {
    const { history, future } = get();
    if (future.length === 0) return;
    const snap = (get() as EditorStoreWithSnapshot)._snapshot();
    const next = future[0];
    set({
      ...next,
      history: [...history, snap],
      future: future.slice(1),
      appliedActions: next.appliedActions ?? get().appliedActions,
      pendingAction: null,
      selectedItem: null,
      taggedMarkerIds: [],
      taggedClipIds: [],
      ...buildClampedTimelineControlState(
        get().currentTime,
        get().requestedSeekTime,
        next.clips,
        next.transitions,
      ),
      ...clearReviewStatePatch(),
      ...buildDerivedIndexState(
        next.clips,
        next.transitions,
        get().aiSettings,
        get().sourceTranscriptCaptions,
        get().sourceOverviewFrames,
      ),
    });
  },

  pushHistory: (snap) => set((state) => ({ history: [...state.history, snap], future: [] })),

  addMessage: (msg) => {
    const id = uuidv4();
    set((state) => ({
      messages: [...state.messages, { ...msg, id, timestamp: Date.now() }],
    }));
    return id;
  },

  updateMessage: (id, patch) => set((state) => ({
    messages: state.messages.map((message) => (
      message.id === id ? { ...message, ...patch } : message
    )),
  })),

  removeMessage: (id) => set((state) => ({
    messages: state.messages.filter((message) => message.id !== id),
  })),

  setIsChatLoading: (v) => set({ isChatLoading: v }),

  clearChatHistory: () => set(() => ({
    messages: [],
    appliedActions: [],
    visualSearchSession: null,
    pendingAction: null,
    taggedMarkerIds: [],
    taggedClipIds: [],
    ...clearReviewStatePatch(),
  })),

  clearMessages: () => set((state) => {
    const nextClips = state.videoDuration > 0 ? [makeClip(MAIN_SOURCE_ID, 0, state.videoDuration)] : [];
    return {
      messages: [],
      appliedActions: [],
      visualSearchSession: null,
      pendingAction: null,
      clips: nextClips,
      captions: [],
      transitions: [],
      markers: [],
      textOverlays: [],
      selectedItem: null,
      taggedMarkerIds: [],
      taggedClipIds: [],
      ...clearReviewStatePatch(),
      ...buildDerivedIndexState(
        nextClips,
        [],
        state.aiSettings,
        state.sourceTranscriptCaptions,
        state.sourceOverviewFrames,
      ),
    };
  }),

  setAISettings: (settings) => set((state) => {
    const aiSettings = mergeAISettings(state.aiSettings, settings);
    return {
      aiSettings,
      ...buildDerivedIndexState(
        state.clips,
        state.transitions,
        aiSettings,
        state.sourceTranscriptCaptions,
        state.sourceOverviewFrames,
      ),
    };
  }),

  recordAppliedAction: (action, summary, metadata) => set((state) => ({
    appliedActions: [
      ...state.appliedActions.slice(-24),
      {
        id: uuidv4(),
        timestamp: Date.now(),
        requestChainId: metadata?.requestChainId,
        action,
        summary,
        sourceRanges: metadata?.sourceRanges,
      },
    ],
  })),

  setFFmpegJob: (job) => set({ ffmpegJob: job }),

  setVideoCloud: (file, blobUrl, storagePath, projectId) => {
    revokeSourceRuntimeUrls(get().sourceRuntimeById);
    const source = createProjectSource({
      id: MAIN_SOURCE_ID,
      fileName: file.name,
      duration: 0,
      isPrimary: true,
      status: 'pending',
      storagePath,
    });
    set((state) => ({
      ...buildBaseEditorState({
        ...buildPrimaryMirrorState([source], {
          [MAIN_SOURCE_ID]: {
            file,
            objectUrl: blobUrl,
            playerUrl: blobUrl,
            processingUrl: blobUrl,
          },
        }, projectId),
      }),
      messages: state.messages,
    }));
  },

  setProjectVideoFile: (file, projectId, storagePath = null) => {
    revokeSourceRuntimeUrls(get().sourceRuntimeById);
    const url = URL.createObjectURL(file);
    const source = createProjectSource({
      id: MAIN_SOURCE_ID,
      fileName: file.name,
      duration: 0,
      isPrimary: true,
      status: 'pending',
      storagePath,
    });
    set((state) => ({
      ...buildBaseEditorState({
        ...buildPrimaryMirrorState([source], {
          [MAIN_SOURCE_ID]: {
            file,
            objectUrl: url,
            playerUrl: url,
            processingUrl: url,
          },
        }, projectId),
      }),
      messages: state.messages,
    }));
  },

  loadProject: (editState, project) => {
    const { videoUrl, processingVideoUrl, storagePath, projectId, videoFilename, duration } = project;
    const existingState = get();
    const persistedDuration = typeof editState.videoDuration === 'number' && editState.videoDuration > 0 ? editState.videoDuration : 0;
    const effectiveDuration = (typeof duration === 'number' && duration > 0) ? duration : persistedDuration;
    const rawClips = Array.isArray(editState.clips) ? editState.clips : [];
    const persistedSources = Array.isArray(editState.sources) ? editState.sources : project.sources;
    const hydratedSourceBase = buildHydratedSources({
      persistedSources,
      projectStoragePath: storagePath,
      projectVideoFilename: videoFilename ?? null,
      projectDuration: effectiveDuration,
    });
    const baseSourceIdAliases = buildProjectSourceAliasMap(hydratedSourceBase);
    const referencedSourceIds = rawClips
      .map((clip) => canonicalizeProjectSourceId((clip as Partial<VideoClip>).sourceId, baseSourceIdAliases))
      .filter((sourceId): sourceId is string => !!sourceId);
    const hydratedSources = buildHydratedSources({
      persistedSources,
      projectStoragePath: storagePath,
      projectVideoFilename: videoFilename ?? null,
      projectDuration: effectiveDuration,
      referencedSourceIds,
    });
    const sourceIdAliases = buildProjectSourceAliasMap(hydratedSources);
    const validSourceIds = new Set(hydratedSources.map((source) => source.id));
    const fallbackSourceId = getPrimarySource(hydratedSources)?.id ?? MAIN_SOURCE_ID;
    const nextRuntimeById: SourceRuntimeMediaMap = {};

    for (const source of hydratedSources) {
      const existingSource = existingState.sources.find((entry) => entry.id === source.id);
      const existingRuntime = existingState.currentProjectId === projectId
        ? existingState.sourceRuntimeById[source.id]
        : undefined;
      const canReuseLocalSource = Boolean(
        existingRuntime
        && (
          !source.storagePath
          || !existingSource?.storagePath
          || existingSource.storagePath === source.storagePath
        ),
      );
      const fallbackPlayerUrl = source.storagePath
        ? `/api/projects/${projectId}/media?sourceId=${encodeURIComponent(source.id)}`
        : '';
      const primaryProcessingUrl = source.id === MAIN_SOURCE_ID ? (processingVideoUrl ?? videoUrl) : '';

      nextRuntimeById[source.id] = {
        file: canReuseLocalSource ? existingRuntime?.file ?? null : null,
        objectUrl: canReuseLocalSource ? existingRuntime?.objectUrl ?? '' : '',
        playerUrl: canReuseLocalSource && existingRuntime?.objectUrl
          ? existingRuntime.objectUrl
          : (existingRuntime?.playerUrl || fallbackPlayerUrl),
        processingUrl: canReuseLocalSource
          ? (existingRuntime?.processingUrl || existingRuntime?.objectUrl || '')
          : (existingRuntime?.processingUrl || primaryProcessingUrl),
      };
    }

    const clips = sanitizeTimelineClips(rawClips
      .map((clip) => normalizeLoadedClip(
        clip as Partial<VideoClip> & { sourcePath?: unknown },
        fallbackSourceId,
        sourceIdAliases,
      ))
      .filter((clip): clip is VideoClip => !!clip));
    const hydratedClips = clips.length > 0
      ? clips
      : (effectiveDuration > 0 ? [makeClip(MAIN_SOURCE_ID, 0, effectiveDuration)] : []);

    const rawTranscriptCaptions = Array.isArray(editState.sourceTranscriptCaptions)
      ? editState.sourceTranscriptCaptions
      : Array.isArray(editState.rawTranscriptCaptions)
        ? editState.rawTranscriptCaptions
        : null;
    const sourceTranscriptCaptions = rawTranscriptCaptions
      ?.map((entry) => normalizeCaptionEntry(
        entry as Partial<CaptionEntry>,
        validSourceIds,
        sourceIdAliases,
      ))
      .filter((entry): entry is CaptionEntry => !!entry) ?? null;

    const rawOverviewFrames = Array.isArray(editState.sourceOverviewFrames)
      ? editState.sourceOverviewFrames
      : Array.isArray(editState.videoFrames)
        ? (editState.videoFrames as Array<Partial<IndexedVideoFrame>>)
            .filter((frame) => frame?.kind === 'overview')
            .map((frame) => ({
              sourceId: normalizeSourceId(frame.sourceId) ?? MAIN_SOURCE_ID,
              sourceTime: frame.sourceTime,
              description: frame.description,
              image: frame.image,
              assetId: null,
              indexedAt: null,
            }))
        : null;
    const sourceOverviewFrames = rawOverviewFrames
      ?.map((entry) => normalizeOverviewFrame(
        entry as Partial<SourceIndexedFrame>,
        validSourceIds,
        fallbackSourceId,
        sourceIdAliases,
      ))
      .filter((entry): entry is SourceIndexedFrame => !!entry) ?? null;

    const persistedFreshness = buildInitialSourceIndexState(hydratedSources);
    if (editState.sourceIndexFreshBySourceId && typeof editState.sourceIndexFreshBySourceId === 'object') {
      const canonicalFreshnessBySourceId = Object.entries(
        editState.sourceIndexFreshBySourceId as Record<string, Partial<SourceIndexState>>,
      ).reduce<Record<string, Partial<SourceIndexState>>>((acc, [sourceId, entry]) => {
        const canonicalSourceId = canonicalizeProjectSourceId(sourceId, sourceIdAliases);
        if (!canonicalSourceId) return acc;
        acc[canonicalSourceId] = {
          ...(acc[canonicalSourceId] ?? {}),
          ...entry,
        };
        return acc;
      }, {});
      for (const source of hydratedSources) {
        const rawEntry = canonicalFreshnessBySourceId[source.id];
        if (!rawEntry) continue;
        persistedFreshness[source.id] = {
          overview: rawEntry.overview === true,
          transcript: rawEntry.transcript === true,
          version: typeof rawEntry.version === 'string' ? rawEntry.version : SOURCE_INDEX_VERSION,
          assetId: normalizeSourceId(rawEntry.assetId) ?? null,
          indexedAt: typeof rawEntry.indexedAt === 'string' ? rawEntry.indexedAt : null,
        };
      }
    }

    const aiSettings = resolveAIEditingSettings(editState.aiSettings as Partial<AIEditingSettings> | undefined);
    const normalizedTransitions = normalizeTransitionState(
      hydratedClips,
      (editState.transitions as Array<Partial<TransitionEntry>> | undefined) ?? [],
    );
    const derivedIndexState = buildDerivedIndexState(
      hydratedClips,
      normalizedTransitions,
      aiSettings,
      sourceTranscriptCaptions,
      sourceOverviewFrames,
    );
    const hasTranscriptCaptions = Boolean(sourceTranscriptCaptions && sourceTranscriptCaptions.length > 0);
    const persistedTranscriptError = typeof editState.transcriptError === 'string'
      ? editState.transcriptError
      : null;
    const nextFreshness = mergeSourceIndexStateMap(persistedFreshness, null, hydratedSources);
    for (const source of hydratedSources) {
      nextFreshness[source.id] = {
        ...nextFreshness[source.id],
        overview: nextFreshness[source.id]?.overview
          || !!sourceOverviewFrames?.some((frame) => frame.sourceId === source.id),
        transcript: nextFreshness[source.id]?.transcript
          || !!sourceTranscriptCaptions?.some((caption) => caption.sourceId === source.id),
      };
    }
    const primaryMirror = buildPrimaryMirrorState(hydratedSources, nextRuntimeById, projectId);

    set({
      ...buildBaseEditorState({
        ...primaryMirror,
      }),
      clips: hydratedClips,
      captions: ((editState.captions as Partial<CaptionEntry>[] | undefined) ?? [])
        .map((entry) => normalizeCaptionEntry(entry, validSourceIds, sourceIdAliases))
        .filter((entry): entry is CaptionEntry => !!entry),
      transitions: normalizedTransitions,
      markers: (editState.markers as MarkerEntry[] | undefined) ?? [],
      textOverlays: ((editState.textOverlays as Partial<TextOverlayEntry>[] | undefined) ?? [])
        .map((entry) => normalizeTextOverlayEntry(entry))
        .filter((entry): entry is TextOverlayEntry => !!entry),
      messages: ((editState.messages as ChatMessage[] | undefined) ?? []).map((message) => ({
        ...message,
        requestChainId: typeof message.requestChainId === 'string' ? message.requestChainId : undefined,
      })),
      appliedActions: ((editState.appliedActions as AppliedActionRecord[] | undefined) ?? []).map((entry) => ({
        ...entry,
        requestChainId: typeof entry.requestChainId === 'string' ? entry.requestChainId : undefined,
        sourceRanges: entry.sourceRanges?.map((range) => ({
          ...range,
          sourceId: canonicalizeProjectSourceId(range.sourceId, sourceIdAliases, MAIN_SOURCE_ID) ?? MAIN_SOURCE_ID,
        })),
      })),
      aiSettings,
      backgroundTranscript: derivedIndexState.backgroundTranscript ?? (
        typeof editState.backgroundTranscript === 'string' ? editState.backgroundTranscript : null
      ),
      // Persist the last failure message for debugging, but do not lock the
      // project into a permanent non-retrying transcript error after reload.
      transcriptStatus: hasTranscriptCaptions ? 'done' : 'idle',
      transcriptError: hasTranscriptCaptions ? null : persistedTranscriptError,
      sourceTranscriptCaptions,
      sourceOverviewFrames: sourceOverviewFrames && sourceOverviewFrames.length > 0 ? sourceOverviewFrames : null,
      analysisOverviewFrames: derivedIndexState.analysisOverviewFrames,
      displayOverviewFrames: derivedIndexState.displayOverviewFrames,
      projectedOverviewFrames: derivedIndexState.projectedOverviewFrames,
      sourceIndexFreshBySourceId: nextFreshness,
      timelineProjectionFresh: derivedIndexState.timelineProjectionFresh,
      sourceIndex: (editState.sourceIndex as SourceIndex | null | undefined) ?? null,
      sourceIndexAnalysisBySourceId: {},
    });
  },

  setUploadProgress: (pct) => set({ uploadProgress: pct }),
  setSaveStatus: (status) => set({ saveStatus: status }),
  setStoragePath: (path) => set((state) => {
    const nextSources = state.sources.map((source) => (
      source.id === MAIN_SOURCE_ID ? { ...source, storagePath: path } : source
    ));
    return buildPrimaryMirrorState(nextSources, state.sourceRuntimeById, state.currentProjectId);
  }),
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(20, zoom)) }),
  setPlaybackActive: (active) => set({ playbackActive: active }),

  resetEditor: () => {
    revokeSourceRuntimeUrls(get().sourceRuntimeById);
    set({
      ...buildBaseEditorState(),
      messages: [],
    });
  },

  setSelectedItem: (item) => set({ selectedItem: item }),
  setTaggedMarkerIds: (ids) => set(() => ({ taggedMarkerIds: [...new Set(ids)] })),
  toggleTaggedMarker: (id) => set((state) => ({
    taggedMarkerIds: state.taggedMarkerIds.includes(id)
      ? state.taggedMarkerIds.filter((markerId) => markerId !== id)
      : [...state.taggedMarkerIds, id],
  })),
  clearTaggedMarkers: () => set({ taggedMarkerIds: [] }),
  setTaggedClipIds: (ids) => set(() => ({ taggedClipIds: [...new Set(ids)] })),
  toggleTaggedClip: (id) => set((state) => ({
    taggedClipIds: state.taggedClipIds.includes(id)
      ? state.taggedClipIds.filter((clipId) => clipId !== id)
      : [...state.taggedClipIds, id],
  })),
  clearTaggedClips: () => set({ taggedClipIds: [] }),
  setActiveReviewSession: (session) => set(() => ({
    activeReviewSession: session,
    activeReviewFocusItemId: null,
    previewSnapshot: session ? buildReviewPreviewSnapshot(session) : null,
    previewOwnerId: session?.ownerId ?? null,
  })),
  setActiveReviewFocusItemId: (itemId) => set({ activeReviewFocusItemId: itemId }),

  deleteSelectedItem: () => {
    const state = get();
    if (!state.selectedItem) return;
    const snap = (state as EditorStoreWithSnapshot)._snapshot();
    const { type, id } = state.selectedItem;
    const newHistory = [...state.history, snap];
    if (type === 'clip') {
      const nextClips = state.clips.filter((clip) => clip.id !== id);
      const nextTransitions = normalizeTransitionState(nextClips, state.transitions);
      set({
        history: newHistory,
        future: [],
        clips: nextClips,
        transitions: nextTransitions,
        markers: [],
        taggedMarkerIds: [],
        taggedClipIds: filterTaggedClipIds(state.taggedClipIds, nextClips),
        selectedItem: null,
        ...clearReviewStatePatch(),
        ...buildDerivedIndexState(
          nextClips,
          nextTransitions,
          state.aiSettings,
          state.sourceTranscriptCaptions,
          state.sourceOverviewFrames,
        ),
      });
      return;
    }
    if (type === 'caption') {
      const captions = state.captions.filter((entry) => entry.id !== id);
      set({
        history: newHistory,
        future: [],
        captions,
        selectedItem: null,
        ...clearReviewStatePatch(),
      });
      return;
    }
    if (type === 'text') {
      const textOverlays = state.textOverlays.filter((entry) => entry.id !== id);
      set({
        history: newHistory,
        future: [],
        textOverlays,
        selectedItem: null,
        ...clearReviewStatePatch(),
      });
      return;
    }
    if (type === 'transition') {
      const nextTransitions = normalizeTransitionState(
        state.clips,
        state.transitions.filter((entry) => entry.id !== id),
      );
      set({
        history: newHistory,
        future: [],
        transitions: nextTransitions,
        selectedItem: null,
        ...clearReviewStatePatch(),
        ...buildDerivedIndexState(
          state.clips,
          nextTransitions,
          state.aiSettings,
          state.sourceTranscriptCaptions,
          state.sourceOverviewFrames,
        ),
      });
      return;
    }
    set({
      history: newHistory,
      future: [],
      markers: state.markers.filter((marker) => marker.id !== id),
      selectedItem: null,
      taggedMarkerIds: state.taggedMarkerIds.filter((markerId) => markerId !== id),
      ...clearReviewStatePatch(),
    });
  },

  updateCaption: (id, patch) => set((state) => ({
    captions: state.captions.map((caption) => (
      caption.id === id ? { ...caption, ...patch } : caption
    )),
    ...clearReviewStatePatch(),
  })),

  updateTextOverlay: (id, patch) => set((state) => ({
    textOverlays: state.textOverlays.map((overlay) => (
      overlay.id === id ? { ...overlay, ...patch } : overlay
    )),
    ...clearReviewStatePatch(),
  })),

  updateTransition: (id, patch) => set((state) => {
    const nextTransitions = normalizeTransitionState(
      state.clips,
      state.transitions.map((transition) => (
        transition.id === id ? { ...transition, ...patch } : transition
      )),
    );
    return {
      transitions: nextTransitions,
      ...clearReviewStatePatch(),
      ...buildDerivedIndexState(
        state.clips,
        nextTransitions,
        state.aiSettings,
        state.sourceTranscriptCaptions,
        state.sourceOverviewFrames,
      ),
    };
  }),

  addMarker: (marker) => {
    const id = marker.id ?? uuidv4();
    const snap = (get() as EditorStoreWithSnapshot)._snapshot();
    const nextNumber = marker.number ?? (
      get().markers.length === 0
        ? 1
        : Math.max(...get().markers.map((entry) => entry.number)) + 1
    );
    set((state) => ({
      history: [...state.history, snap],
      future: [],
      markers: [
        ...state.markers,
        {
          id,
          number: nextNumber,
          timelineTime: marker.timelineTime,
          label: marker.label,
          createdBy: marker.createdBy,
          status: marker.status,
          linkedRange: marker.linkedRange,
          linkedMessageId: marker.linkedMessageId ?? undefined,
          confidence: marker.confidence ?? null,
          note: marker.note,
        },
      ],
      selectedItem: { type: 'marker', id },
      ...clearReviewStatePatch(),
    }));
    return id;
  },

  updateMarker: (id, patch) => {
    const snap = (get() as EditorStoreWithSnapshot)._snapshot();
    set((state) => ({
      history: [...state.history, snap],
      future: [],
      markers: state.markers.map((marker) => (
        marker.id === id
          ? { ...marker, ...patch, number: patch.number ?? marker.number, timelineTime: patch.timelineTime ?? marker.timelineTime }
          : marker
      )),
      ...clearReviewStatePatch(),
    }));
  },

  removeMarker: (id) => {
    const snap = (get() as EditorStoreWithSnapshot)._snapshot();
    set((state) => ({
      history: [...state.history, snap],
      future: [],
      markers: state.markers.filter((marker) => marker.id !== id),
      taggedMarkerIds: state.taggedMarkerIds.filter((markerId) => markerId !== id),
      selectedItem: state.selectedItem?.type === 'marker' && state.selectedItem.id === id ? null : state.selectedItem,
      ...clearReviewStatePatch(),
    }));
  },

  createMarkerAtTime: (timelineTime, options) => get().addMarker({
    timelineTime,
    label: options?.label,
    createdBy: options?.createdBy ?? 'human',
    status: 'open',
    linkedMessageId: options?.linkedMessageId ?? undefined,
    confidence: null,
  }),

  setBackgroundTranscript: (text, status, rawCaptions, errorMessage, options) => set((state) => {
    const validSourceIds = new Set(state.sources.map((source) => source.id));
    const sourceIdAliases = buildProjectSourceAliasMap(state.sources);
    const normalizedCaptions = rawCaptions
      ?.map((entry) => normalizeCaptionEntry(entry, validSourceIds, sourceIdAliases))
      .filter((entry): entry is CaptionEntry => !!entry) ?? undefined;
    const shouldMarkTranscriptFresh = options?.markFresh ?? (normalizedCaptions !== undefined);
    const nextSourceTranscriptCaptions = normalizedCaptions !== undefined
      ? replaceEntriesForSources(state.sourceTranscriptCaptions, normalizedCaptions)
      : state.sourceTranscriptCaptions;
    let nextFreshness = state.sourceIndexFreshBySourceId;
    if (normalizedCaptions !== undefined && shouldMarkTranscriptFresh) {
      const sourceIds = new Set(
        normalizedCaptions
          .map((entry) => entry.sourceId)
          .filter((sourceId): sourceId is string => typeof sourceId === 'string' && sourceId.length > 0),
      );
      for (const sourceId of sourceIds) {
        nextFreshness = patchSourceIndexState(nextFreshness, sourceId, { transcript: true });
      }
    }
    return {
      backgroundTranscript: nextSourceTranscriptCaptions !== undefined && nextSourceTranscriptCaptions !== null
        ? buildTranscriptContext(state.clips, nextSourceTranscriptCaptions, state.transitions)
        : text,
      transcriptStatus: status,
      transcriptError: status === 'error'
        ? (errorMessage?.trim() || state.transcriptError || 'Audio transcription did not finish.')
        : null,
      transcriptProgress: status === 'loading' ? state.transcriptProgress : null,
      ...(normalizedCaptions !== undefined ? { sourceTranscriptCaptions: nextSourceTranscriptCaptions } : {}),
      ...(normalizedCaptions !== undefined && shouldMarkTranscriptFresh ? {
        sourceIndexFreshBySourceId: nextFreshness,
      } : {}),
    };
  }),

  setTranscriptProgress: (progress) => set({ transcriptProgress: progress }),

  setSourceOverviewFrames: (sourceId, frames, options) => set((state) => {
    const validSourceIds = new Set(state.sources.map((source) => source.id));
    const fallbackSourceId = getPrimarySource(state.sources)?.id ?? MAIN_SOURCE_ID;
    const sourceIdAliases = buildProjectSourceAliasMap(state.sources);
    const normalizedFrames = frames
      ?.map((entry) => normalizeOverviewFrame(entry, validSourceIds, fallbackSourceId, sourceIdAliases))
      .filter((entry): entry is SourceIndexedFrame => !!entry) ?? null;
    const nextSourceOverviewFrames = replaceEntriesForSource(state.sourceOverviewFrames, sourceId, normalizedFrames);
    return {
      sourceOverviewFrames: nextSourceOverviewFrames,
      sourceIndexFreshBySourceId: patchSourceIndexState(state.sourceIndexFreshBySourceId, sourceId, {
        overview: options?.fresh ?? false,
        assetId: options?.assetId,
        indexedAt: options?.indexedAt,
      }),
      ...buildDerivedIndexState(
        state.clips,
        state.transitions,
        state.aiSettings,
        state.sourceTranscriptCaptions,
        nextSourceOverviewFrames,
      ),
    };
  }),

  hydrateSourceIndex: (payload) => set((state) => {
    const validSourceIds = new Set(state.sources.map((source) => source.id));
    const fallbackSourceId = getPrimarySource(state.sources)?.id ?? MAIN_SOURCE_ID;
    const sourceIdAliases = buildProjectSourceAliasMap(state.sources);
    const analysis = normalizeSourceIndexAnalysisState(payload.analysis);
    const analysisBySourceId = normalizeSourceIndexAnalysisStateMap(payload.analysisBySourceId);
    const audioStates = Object.values(analysisBySourceId).map((entry) => entry.audio).filter((entry): entry is NonNullable<typeof entry> => !!entry);
    const isAnalysisActive = analysis?.status === 'queued' || analysis?.status === 'running'
      || audioStates.some((entry) => entry.status === 'queued' || entry.status === 'running');
    const normalizedIncomingTranscriptCaptions = payload.sourceTranscriptCaptions
      ?.map((entry) => normalizeCaptionEntry(entry, validSourceIds, sourceIdAliases))
      .filter((entry): entry is CaptionEntry => !!entry) ?? null;
    const normalizedIncomingOverviewFrames = payload.sourceOverviewFrames
      ?.map((entry) => normalizeOverviewFrame(entry, validSourceIds, fallbackSourceId, sourceIdAliases))
      .filter((entry): entry is SourceIndexedFrame => !!entry) ?? null;
    const sourceIds = state.sources.map((source) => source.id);

    const preservedTranscriptSources = new Set<string>();
    const preservedOverviewSources = new Set<string>();
    for (const sourceId of sourceIds) {
      if (
        isAnalysisActive
        && !hasEntriesForSource(normalizedIncomingTranscriptCaptions, sourceId)
        && hasEntriesForSource(state.sourceTranscriptCaptions, sourceId)
      ) {
        preservedTranscriptSources.add(sourceId);
      }
      if (
        isAnalysisActive
        && !hasEntriesForSource(normalizedIncomingOverviewFrames, sourceId)
        && hasEntriesForSource(state.sourceOverviewFrames, sourceId)
      ) {
        preservedOverviewSources.add(sourceId);
      }
    }

    const sourceTranscriptCaptions = payload.sourceTranscriptCaptions !== undefined
      ? mergeHydratedEntriesForSources(
          state.sourceTranscriptCaptions,
          normalizedIncomingTranscriptCaptions,
          sourceIds,
          preservedTranscriptSources,
        )
      : state.sourceTranscriptCaptions;
    const sourceOverviewFrames = payload.sourceOverviewFrames !== undefined
      ? mergeHydratedEntriesForSources(
          state.sourceOverviewFrames,
          normalizedIncomingOverviewFrames,
          sourceIds,
          preservedOverviewSources,
        )
      : state.sourceOverviewFrames;
    let sourceIndexFreshBySourceId = mergeSourceIndexStateMap(
      state.sourceIndexFreshBySourceId,
      payload.sourceIndexFreshBySourceId,
      state.sources,
    );
    for (const sourceId of sourceIds) {
      if (hasEntriesForSource(sourceTranscriptCaptions, sourceId)) {
        sourceIndexFreshBySourceId = patchSourceIndexState(sourceIndexFreshBySourceId, sourceId, {
          transcript: true,
        });
      }
      if (hasEntriesForSource(sourceOverviewFrames, sourceId)) {
        sourceIndexFreshBySourceId = patchSourceIndexState(sourceIndexFreshBySourceId, sourceId, {
          overview: true,
        });
      }
    }
    const hasTranscriptCaptions = Boolean(sourceTranscriptCaptions && sourceTranscriptCaptions.length > 0);
    const hasQueuedOrRunningAudio = audioStates.some((entry) => entry.status === 'queued' || entry.status === 'running');
    const hasTerminalAudioFailure = audioStates.some((entry) => entry.status === 'failed' || entry.status === 'unavailable');
    const transcriptStatus = hasTranscriptCaptions
      ? (hasQueuedOrRunningAudio ? 'loading' : 'done')
      : hasQueuedOrRunningAudio
        ? 'loading'
        : hasTerminalAudioFailure
          ? 'error'
          : state.transcriptStatus;
    const transcriptError = hasTerminalAudioFailure
      ? audioStates.find((entry) => entry.status === 'failed' || entry.status === 'unavailable')?.reason ?? state.transcriptError
      : state.transcriptError;
    return {
      sourceTranscriptCaptions,
      sourceOverviewFrames,
      sourceIndexFreshBySourceId,
      sourceIndexAnalysis: analysis ?? state.sourceIndexAnalysis,
      sourceIndexAnalysisBySourceId: analysisBySourceId,
      ...buildDerivedIndexState(
        state.clips,
        state.transitions,
        state.aiSettings,
        sourceTranscriptCaptions,
        sourceOverviewFrames,
      ),
      transcriptStatus,
      transcriptError,
    };
  }),

  setSourceIndexAnalysis: (analysis) => set({
    sourceIndexAnalysis: normalizeSourceIndexAnalysisState(analysis),
  }),

  setVisualSearchSession: (session) => set({ visualSearchSession: session }),

  setSourceIndex: (index) => set({ sourceIndex: index }),
}));
