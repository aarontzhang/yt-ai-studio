'use client';

import { useEffect, useRef } from 'react';
import { useEditorStore } from '@/lib/useEditorStore';

function persistSourceOverviewFrame(frame: {
  sourceTime: number;
  sourceId: string;
  description?: string;
  image?: string;
  assetId?: string | null;
  indexedAt?: string | null;
}) {
  return {
    sourceTime: frame.sourceTime,
    sourceId: frame.sourceId,
    description: frame.description ?? '',
    ...(frame.image ? { image: frame.image } : {}),
    ...(frame.assetId ? { assetId: frame.assetId } : {}),
    ...(frame.indexedAt ? { indexedAt: frame.indexedAt } : {}),
  };
}

export function buildProjectEditState(state: ReturnType<typeof useEditorStore.getState>) {
  return {
    clips: state.clips,
    captions: state.captions,
    transitions: state.transitions,
    markers: state.markers,
    textOverlays: state.textOverlays,
    messages: state.messages,
    appliedActions: state.appliedActions,
    aiSettings: state.aiSettings,
    backgroundTranscript: state.backgroundTranscript,
    transcriptStatus: state.transcriptStatus,
    transcriptError: state.transcriptError,
    sources: state.sources,
    sourceTranscriptCaptions: state.sourceTranscriptCaptions,
    sourceOverviewFrames: (state.sourceOverviewFrames ?? [])
      .filter(frame => !!frame.description?.trim() || !!frame.image)
      .map(persistSourceOverviewFrame),
    sourceIndexFreshBySourceId: state.sourceIndexFreshBySourceId,
    sourceIndex: state.sourceIndex,
    videoDuration: state.videoDuration,
  };
}

export async function saveProjectEditState(
  projectId: string,
  state: ReturnType<typeof useEditorStore.getState>,
) {
  const editState = buildProjectEditState(state);
  const res = await fetch(`/api/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edit_state: editState }),
  });
  if (!res.ok) {
    throw new Error('Save failed');
  }
}

export function useAutoSave() {
  const clips = useEditorStore(s => s.clips);
  const captions = useEditorStore(s => s.captions);
  const transitions = useEditorStore(s => s.transitions);
  const markers = useEditorStore(s => s.markers);
  const textOverlays = useEditorStore(s => s.textOverlays);
  const messages = useEditorStore(s => s.messages);
  const appliedActions = useEditorStore(s => s.appliedActions);
  const aiSettings = useEditorStore(s => s.aiSettings);
  const backgroundTranscript = useEditorStore(s => s.backgroundTranscript);
  const transcriptStatus = useEditorStore(s => s.transcriptStatus);
  const transcriptError = useEditorStore(s => s.transcriptError);
  const sources = useEditorStore(s => s.sources);
  const sourceTranscriptCaptions = useEditorStore(s => s.sourceTranscriptCaptions);
  const sourceOverviewFrames = useEditorStore(s => s.sourceOverviewFrames);
  const sourceIndexFreshBySourceId = useEditorStore(s => s.sourceIndexFreshBySourceId);
  const sourceIndex = useEditorStore(s => s.sourceIndex);
  const videoDuration = useEditorStore(s => s.videoDuration);
  const currentProjectId = useEditorStore(s => s.currentProjectId);
  const setSaveStatus = useEditorStore(s => s.setSaveStatus);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!currentProjectId) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    setSaveStatus('saving');
    timerRef.current = setTimeout(async () => {
      try {
        const state = useEditorStore.getState();
        await saveProjectEditState(currentProjectId, state);
        setSaveStatus('saved');
        setTimeout(() => {
          if (useEditorStore.getState().saveStatus === 'saved') {
            setSaveStatus('idle');
          }
        }, 2000);
      } catch {
        setSaveStatus('error');
      }
    }, 1500);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [clips, captions, transitions, markers, textOverlays, messages, appliedActions, aiSettings, backgroundTranscript, transcriptStatus, transcriptError, sources, sourceTranscriptCaptions, sourceOverviewFrames, sourceIndexFreshBySourceId, sourceIndex, videoDuration, currentProjectId, setSaveStatus]);
}
