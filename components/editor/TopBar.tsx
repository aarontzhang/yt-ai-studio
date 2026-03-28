'use client';

import { useCallback } from 'react';
import { useEditorStore } from '@/lib/useEditorStore';
import { exportClips, isFFmpegAbortError } from '@/lib/ffmpegClient';
import { useAuth } from '@/components/auth/AuthProvider';
import UserProfileMenu from '@/components/auth/UserProfileMenu';
import AutocutMark from '@/components/branding/AutocutMark';
import { describeSourceResolutionFailure, resolveProjectSources } from '@/lib/sourceMedia';
import { capture } from '@/lib/analytics';

export default function TopBar() {
  const videoFile = useEditorStore(s => s.videoFile);
  const videoData = useEditorStore(s => s.videoData);
  const videoUrl = useEditorStore(s => s.videoUrl);
  const processingVideoUrl = useEditorStore(s => s.processingVideoUrl);
  const videoDuration = useEditorStore(s => s.videoDuration);
  const sources = useEditorStore(s => s.sources);
  const sourceRuntimeById = useEditorStore(s => s.sourceRuntimeById);
  const ffmpegJob = useEditorStore(s => s.ffmpegJob);
  const clips = useEditorStore(s => s.previewSnapshot?.clips ?? s.clips);
  const captions = useEditorStore(s => s.previewSnapshot?.captions ?? s.captions);
  const transitions = useEditorStore(s => s.previewSnapshot?.transitions ?? s.transitions);
  const textOverlays = useEditorStore(s => s.previewSnapshot?.textOverlays ?? s.textOverlays);
  const setFFmpegJob = useEditorStore(s => s.setFFmpegJob);
  const undo = useEditorStore(s => s.undo);
  const redo = useEditorStore(s => s.redo);
  const canUndo = useEditorStore(s => s.history.length > 0);
  const canRedo = useEditorStore(s => s.future.length > 0);
  const { user } = useAuth();

  const resolvedSources = resolveProjectSources({
      sources,
      runtimeBySourceId: sourceRuntimeById,
      primaryFallback: {
        videoData,
        videoFile,
        videoUrl,
        processingVideoUrl,
        videoDuration,
      },
    });
  const sourceInfoById = Object.fromEntries(resolvedSources.map((entry) => [entry.sourceId, entry]));
  const sourcesById = Object.fromEntries(
    resolvedSources.map((entry) => {
      const runtime = sourceRuntimeById[entry.sourceId];
      // Prefer the stable in-session or same-origin playback source for exports.
      // Live projects otherwise fall back to short-lived signed processing URLs,
      // which can trigger an extra cold download right when export starts.
      const exportSource = runtime?.file
        ?? runtime?.objectUrl
        ?? runtime?.playerUrl
        ?? runtime?.processingUrl
        ?? entry.source;
      return [entry.sourceId, exportSource];
    }),
  );
  const firstUnresolvedClip = clips.find((clip) => !sourcesById[clip.sourceId]) ?? null;
  const exportDisabledReason = firstUnresolvedClip
    ? (
      sourceInfoById[firstUnresolvedClip.sourceId]?.missingReason
      ?? describeSourceResolutionFailure({
        sourceId: firstUnresolvedClip.sourceId,
        fileName: sources.find((source) => source.id === firstUnresolvedClip.sourceId)?.fileName,
        status: sources.find((source) => source.id === firstUnresolvedClip.sourceId)?.status,
        storagePath: sources.find((source) => source.id === firstUnresolvedClip.sourceId)?.storagePath,
      })
    )
    : null;

  const outputReady = ffmpegJob.status === 'done';
  const canExport = clips.length > 0
    && ffmpegJob.status === 'idle'
    && !firstUnresolvedClip;

  const handleExport = useCallback(async () => {
    if (clips.length === 0) return;
    if (firstUnresolvedClip) {
      setFFmpegJob({ status: 'error', message: exportDisabledReason ?? `Missing media for source ${firstUnresolvedClip.sourceId}.` });
      return;
    }
    const abortController = new AbortController();
    const setRunningJob = (patch: Partial<{ progress: number; stage: string; isCancelling?: boolean }>) => {
      const currentJob = useEditorStore.getState().ffmpegJob;
      if (currentJob.status !== 'running') return;
      if (currentJob.isCancelling && patch.isCancelling !== true) return;
      setFFmpegJob({ ...currentJob, ...patch, status: 'running' });
    };

    const totalDurationS = clips.reduce((sum, clip) => sum + clip.sourceDuration / (clip.speed || 1), 0);
    capture('export_started', {
      clip_count: clips.length,
      total_duration_s: Math.round(totalDurationS),
      has_filters: clips.some(clip => clip.filter !== null),
      has_captions: captions.length > 0,
    });
    setFFmpegJob({ status: 'running', progress: 0, stage: 'Initializing…', isCancelling: false });
    try {
      const outputUrl = await exportClips({
        sourcesById,
        clips,
        captions,
        transitions,
        textOverlays,
        signal: abortController.signal,
        onStage: (stage) => setRunningJob({ stage }),
        onProgress: (progress) => setRunningJob({ progress }),
      });
      setFFmpegJob({ status: 'done', outputUrl });
    } catch (err) {
      if (isFFmpegAbortError(err)) {
        setFFmpegJob({ status: 'cancelled', message: 'Export canceled.' });
        return;
      }
      const msg = err instanceof Error ? err.message : (typeof err === 'string' ? err : JSON.stringify(err));
      setFFmpegJob({ status: 'error', message: msg || 'Unknown error' });
    }
  }, [captions, clips, exportDisabledReason, firstUnresolvedClip, setFFmpegJob, sourcesById, textOverlays, transitions]);

  return (
    <div
      style={{
        height: 44,
        background: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border)',
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 4 }}>
        <AutocutMark size={24} />
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--fg-primary)',
            letterSpacing: '-0.02em',
            fontFamily: 'var(--font-serif)',
          }}
        >
          Autocut
        </span>
      </div>

      <div style={{ width: 1, height: 16, background: 'var(--border-mid)' }} />

      <button
        onClick={undo}
        disabled={!canUndo}
        title="Undo (⌘Z)"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          background: 'none',
          border: 'none',
          borderRadius: 4,
          cursor: canUndo ? 'pointer' : 'default',
          color: canUndo ? 'var(--fg-secondary)' : 'var(--fg-faint)',
          transition: 'background 0.15s, color 0.15s',
        }}
        onMouseEnter={event => {
          if (canUndo) {
            event.currentTarget.style.background = 'var(--bg-elevated)';
            event.currentTarget.style.color = 'var(--fg-primary)';
          }
        }}
        onMouseLeave={event => {
          event.currentTarget.style.background = 'none';
          event.currentTarget.style.color = canUndo ? 'var(--fg-secondary)' : 'var(--fg-faint)';
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 .49-3.96" />
        </svg>
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        title="Redo (⌘⇧Z)"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          background: 'none',
          border: 'none',
          borderRadius: 4,
          cursor: canRedo ? 'pointer' : 'default',
          color: canRedo ? 'var(--fg-secondary)' : 'var(--fg-faint)',
          transition: 'background 0.15s, color 0.15s',
        }}
        onMouseEnter={event => {
          if (canRedo) {
            event.currentTarget.style.background = 'var(--bg-elevated)';
            event.currentTarget.style.color = 'var(--fg-primary)';
          }
        }}
        onMouseLeave={event => {
          event.currentTarget.style.background = 'none';
          event.currentTarget.style.color = canRedo ? 'var(--fg-secondary)' : 'var(--fg-faint)';
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-.49-3.96" />
        </svg>
      </button>

      <div style={{ flex: 1 }} />

      {outputReady ? (
        <a
          href={(ffmpegJob as { status: 'done'; outputUrl: string }).outputUrl}
          download="export-output.mp4"
          onClick={() => capture('export_downloaded', {})}
          className="iridescent-button"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--accent-ink)',
            borderRadius: 5,
            cursor: 'pointer',
            padding: '5px 14px',
            textDecoration: 'none',
            fontFamily: 'var(--font-serif)',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download
        </a>
      ) : (
        <button
          onClick={handleExport}
          disabled={!canExport}
          title={canExport ? 'Export the current timeline' : (exportDisabledReason ?? 'Export is unavailable')}
          className={canExport ? 'iridescent-button' : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 500,
            background: canExport ? undefined : 'var(--bg-elevated)',
            color: canExport ? 'var(--accent-ink)' : 'var(--fg-muted)',
            border: `1px solid ${canExport ? 'transparent' : 'var(--border-mid)'}`,
            borderRadius: 5,
            cursor: canExport ? 'pointer' : 'default',
            padding: '5px 14px',
            fontFamily: 'var(--font-serif)',
            transition: 'all 0.15s',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Export
        </button>
      )}

      {user && (
        <>
          <div style={{ width: 1, height: 16, background: 'var(--border-mid)', marginLeft: 4 }} />
          <UserProfileMenu user={user} dashboardLabel="Go to Dashboard" />
        </>
      )}
    </div>
  );
}
