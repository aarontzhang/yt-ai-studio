'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/lib/useEditorStore';
import { ensureMusicGenerationJob, fetchMusicCues, getLatestMusicJobForAsset, updateMusicCueStatus } from '@/lib/musicJobs';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import type { MusicCue } from '@/lib/types';

const MOOD_COLORS: Record<string, string> = {
  upbeat: '#f59e0b',
  calm: '#06b6d4',
  dramatic: '#ef4444',
  melancholic: '#8b5cf6',
  playful: '#10b981',
  suspenseful: '#f97316',
  inspirational: '#3b82f6',
  neutral: '#9ca3af',
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function MusicCueCard({
  cue,
  onAccept,
  onReject,
  onVolumeChange,
}: {
  cue: MusicCue;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onVolumeChange: (id: string, volumeDb: number) => void;
}) {
  const color = MOOD_COLORS[cue.mood] ?? '#9ca3af';
  const isSuggested = cue.status === 'suggested';
  const isAccepted = cue.status === 'accepted';
  const isRejected = cue.status === 'rejected';

  return (
    <div style={{
      padding: '8px 10px',
      borderRadius: 8,
      border: `1px solid ${isAccepted ? 'var(--accent)' : isRejected ? 'var(--border)' : 'var(--border-mid)'}`,
      background: isRejected ? 'rgba(255,255,255,0.01)' : 'rgba(255,255,255,0.03)',
      opacity: isRejected ? 0.5 : 1,
      marginBottom: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          padding: '2px 6px',
          borderRadius: 4,
          background: color + '22',
          color,
          textTransform: 'capitalize',
        }}>
          {cue.mood}
        </span>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          {cue.energy} energy
        </span>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)', marginLeft: 'auto' }}>
          {formatTime(cue.sourceStart)} – {formatTime(cue.sourceEnd)}
        </span>
      </div>

      {cue.genreHints.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 6 }}>
          {cue.genreHints.join(', ')}
        </div>
      )}

      {isSuggested && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => onAccept(cue.id)}
            style={{
              flex: 1,
              border: '1px solid var(--accent)',
              borderRadius: 6,
              background: 'rgba(59,130,246,0.1)',
              color: 'var(--accent)',
              fontSize: 11,
              padding: '4px 8px',
              cursor: 'pointer',
            }}
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => onReject(cue.id)}
            style={{
              flex: 1,
              border: '1px solid var(--border-mid)',
              borderRadius: 6,
              background: 'rgba(255,255,255,0.04)',
              color: 'var(--fg-secondary)',
              fontSize: 11,
              padding: '4px 8px',
              cursor: 'pointer',
            }}
          >
            Reject
          </button>
        </div>
      )}

      {isAccepted && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 10, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>Volume</label>
          <input
            type="range"
            min={-30}
            max={0}
            step={1}
            value={cue.volumeDb}
            onChange={(e) => onVolumeChange(cue.id, Number(e.target.value))}
            style={{ flex: 1, height: 2 }}
          />
          <span style={{ fontSize: 10, color: 'var(--fg-muted)', minWidth: 32, textAlign: 'right' }}>
            {cue.volumeDb}dB
          </span>
        </div>
      )}

      {cue.status === 'failed' && (
        <div style={{ fontSize: 10, color: '#ef4444' }}>Generation failed</div>
      )}
    </div>
  );
}

export default function MusicPanel() {
  const musicGeneration = useEditorStore((s) => s.musicGeneration);
  const setMusicGeneration = useEditorStore((s) => s.setMusicGeneration);
  const acceptMusicCue = useEditorStore((s) => s.acceptMusicCue);
  const rejectMusicCue = useEditorStore((s) => s.rejectMusicCue);
  const acceptAllMusicCues = useEditorStore((s) => s.acceptAllMusicCues);
  const rejectAllMusicCues = useEditorStore((s) => s.rejectAllMusicCues);
  const updateMusicCue = useEditorStore((s) => s.updateMusicCue);
  const clearMusic = useEditorStore((s) => s.clearMusic);
  const sources = useEditorStore((s) => s.sources);
  const currentProjectId = useEditorStore((s) => s.currentProjectId);
  const sourceIndexFreshBySourceId = useEditorStore((s) => s.sourceIndexFreshBySourceId);

  const [isGenerating, setIsGenerating] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const primarySource = sources.find((s) => s.isPrimary);
  const hasTranscript = primarySource
    ? sourceIndexFreshBySourceId[primarySource.id]?.transcript === true
    : false;
  const canGenerate = hasTranscript && musicGeneration.status === 'idle' && !isGenerating;

  const handleGenerate = useCallback(async () => {
    if (!currentProjectId || !primarySource?.assetId) return;
    setIsGenerating(true);
    try {
      const supabase = getSupabaseBrowser();
      const job = await ensureMusicGenerationJob(supabase, currentProjectId, primarySource.assetId);
      if (job) {
        setMusicGeneration({
          ...musicGeneration,
          jobId: job.jobId,
          status: job.status,
          progress: job.progress,
        });
      }
    } catch (err) {
      console.error('Failed to start music generation:', err);
    } finally {
      setIsGenerating(false);
    }
  }, [currentProjectId, musicGeneration, primarySource?.assetId, setMusicGeneration]);

  // Poll for job status while generating
  useEffect(() => {
    const jobId = musicGeneration.jobId;
    if (!jobId || !currentProjectId || !primarySource?.assetId) return;
    if (musicGeneration.status === 'idle' || musicGeneration.status === 'completed' || musicGeneration.status === 'failed') return;

    const poll = async () => {
      const supabase = getSupabaseBrowser();
      const jobState = await getLatestMusicJobForAsset(supabase, currentProjectId, primarySource.assetId!);
      if (!jobState) return;

      if (jobState.status === 'completed' || jobState.status === 'failed') {
        // Fetch the actual cues
        const cues = await fetchMusicCues(supabase, currentProjectId);
        setMusicGeneration({
          ...musicGeneration,
          status: jobState.status ?? 'completed',
          error: jobState.error ?? null,
          cues,
          progress: null,
        });
      } else {
        setMusicGeneration({
          ...musicGeneration,
          status: jobState.status ?? musicGeneration.status,
          progress: jobState.progress ?? musicGeneration.progress,
        });
      }
    };

    pollRef.current = setInterval(poll, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [musicGeneration.jobId, musicGeneration.status, currentProjectId, primarySource?.assetId, setMusicGeneration, musicGeneration]);

  const handleAccept = useCallback((cueId: string) => {
    acceptMusicCue(cueId);
    const supabase = getSupabaseBrowser();
    updateMusicCueStatus(supabase, cueId, { status: 'accepted' }).catch(console.error);
  }, [acceptMusicCue]);

  const handleReject = useCallback((cueId: string) => {
    rejectMusicCue(cueId);
    const supabase = getSupabaseBrowser();
    updateMusicCueStatus(supabase, cueId, { status: 'rejected' }).catch(console.error);
  }, [rejectMusicCue]);

  const handleVolumeChange = useCallback((cueId: string, volumeDb: number) => {
    updateMusicCue(cueId, { volumeDb });
    const supabase = getSupabaseBrowser();
    updateMusicCueStatus(supabase, cueId, { volume_db: volumeDb }).catch(console.error);
  }, [updateMusicCue]);

  const handleAcceptAll = useCallback(() => {
    acceptAllMusicCues();
    const supabase = getSupabaseBrowser();
    for (const cue of musicGeneration.cues) {
      if (cue.status === 'suggested') {
        updateMusicCueStatus(supabase, cue.id, { status: 'accepted' }).catch(console.error);
      }
    }
  }, [acceptAllMusicCues, musicGeneration.cues]);

  const handleRejectAll = useCallback(() => {
    rejectAllMusicCues();
    const supabase = getSupabaseBrowser();
    for (const cue of musicGeneration.cues) {
      if (cue.status === 'suggested') {
        updateMusicCueStatus(supabase, cue.id, { status: 'rejected' }).catch(console.error);
      }
    }
  }, [rejectAllMusicCues, musicGeneration.cues]);

  const hasSuggested = musicGeneration.cues.some((c) => c.status === 'suggested');
  const hasCues = musicGeneration.cues.length > 0;
  const isActive = musicGeneration.status !== 'idle' && musicGeneration.status !== 'completed' && musicGeneration.status !== 'failed';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--bg-panel)' }}>
      <div style={{
        height: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 10,
          color: 'var(--fg-muted)',
          fontWeight: 500,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          fontFamily: 'var(--font-serif)',
        }}>
          Background Music
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {!hasCues && !isActive && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 12 }}>
              Generate AI background music matched to your video&apos;s mood and pacing.
            </p>
            <button
              type="button"
              disabled={!canGenerate}
              onClick={handleGenerate}
              style={{
                border: '1px solid var(--accent)',
                borderRadius: 8,
                background: canGenerate ? 'var(--accent)' : 'var(--bg-secondary)',
                color: canGenerate ? '#fff' : 'var(--fg-muted)',
                fontSize: 12,
                fontWeight: 500,
                padding: '8px 16px',
                cursor: canGenerate ? 'pointer' : 'not-allowed',
                opacity: canGenerate ? 1 : 0.6,
              }}
            >
              {isGenerating ? 'Starting…' : 'Generate Background Music'}
            </button>
            {!hasTranscript && (
              <p style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 8 }}>
                Transcription must complete before generating music.
              </p>
            )}
          </div>
        )}

        {isActive && musicGeneration.progress && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontSize: 12, color: 'var(--fg-secondary)', marginBottom: 8 }}>
              {musicGeneration.progress.stage.replace(/_/g, ' ')}
            </p>
            <div style={{
              height: 4,
              borderRadius: 2,
              background: 'var(--bg-secondary)',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                borderRadius: 2,
                background: 'var(--accent)',
                width: `${Math.round((musicGeneration.progress.completed / musicGeneration.progress.total) * 100)}%`,
                transition: 'width 0.3s ease',
              }} />
            </div>
            <p style={{ fontSize: 10, color: 'var(--fg-muted)', marginTop: 6 }}>
              {musicGeneration.progress.completed} / {musicGeneration.progress.total}
            </p>
          </div>
        )}

        {musicGeneration.status === 'failed' && musicGeneration.error && (
          <div style={{ padding: '12px 0', textAlign: 'center' }}>
            <p style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>
              Music generation failed: {musicGeneration.error}
            </p>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              style={{
                border: '1px solid var(--border-mid)',
                borderRadius: 6,
                background: 'rgba(255,255,255,0.04)',
                color: 'var(--fg-secondary)',
                fontSize: 11,
                padding: '5px 10px',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {hasCues && (
          <>
            {hasSuggested && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={handleAcceptAll}
                  style={{
                    flex: 1,
                    border: '1px solid var(--accent)',
                    borderRadius: 6,
                    background: 'rgba(59,130,246,0.1)',
                    color: 'var(--accent)',
                    fontSize: 11,
                    fontWeight: 500,
                    padding: '5px 8px',
                    cursor: 'pointer',
                  }}
                >
                  Accept All
                </button>
                <button
                  type="button"
                  onClick={handleRejectAll}
                  style={{
                    flex: 1,
                    border: '1px solid var(--border-mid)',
                    borderRadius: 6,
                    background: 'rgba(255,255,255,0.04)',
                    color: 'var(--fg-secondary)',
                    fontSize: 11,
                    fontWeight: 500,
                    padding: '5px 8px',
                    cursor: 'pointer',
                  }}
                >
                  Reject All
                </button>
              </div>
            )}

            {musicGeneration.cues.map((cue) => (
              <MusicCueCard
                key={cue.id}
                cue={cue}
                onAccept={handleAccept}
                onReject={handleReject}
                onVolumeChange={handleVolumeChange}
              />
            ))}

            <button
              type="button"
              onClick={clearMusic}
              style={{
                width: '100%',
                marginTop: 10,
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--fg-muted)',
                fontSize: 11,
                padding: '5px 8px',
                cursor: 'pointer',
              }}
            >
              Remove All Music
            </button>
          </>
        )}
      </div>
    </div>
  );
}
