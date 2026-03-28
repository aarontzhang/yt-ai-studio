'use client';

import { useMemo, useRef } from 'react';
import { useEditorStore } from '@/lib/useEditorStore';
import { formatTimeShort } from '@/lib/timelineUtils';

function formatSourceStatus(status: string, options?: {
  isPlayable?: boolean;
  isIndexReady?: boolean;
  hasActiveAnalysis?: boolean;
}) {
  if (status === 'missing') return 'Missing media';
  if (status === 'error') return 'Issue';
  if (options?.isIndexReady) return 'Ready';
  if (options?.hasActiveAnalysis) return 'Indexing';
  if (status === 'ready') return 'Ready';
  if (status === 'indexing' && options?.isPlayable) return 'Ready';
  if ((status === 'pending' || status === 'indexing') && options?.isPlayable) return 'Ready';
  if (status === 'indexing') return 'Indexing';
  return 'Pending';
}

export default function MediaPanel({
  onImportSources,
}: {
  onImportSources?: (files: File[]) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const sources = useEditorStore((s) => s.sources);
  const sourceRuntimeById = useEditorStore((s) => s.sourceRuntimeById);
  const sourceIndexFreshBySourceId = useEditorStore((s) => s.sourceIndexFreshBySourceId);
  const sourceIndexAnalysisBySourceId = useEditorStore((s) => s.sourceIndexAnalysisBySourceId);
  const appendClipFromSource = useEditorStore((s) => s.appendClipFromSource);

  const sourceCards = useMemo(() => (
    sources.map((source) => {
      const runtime = sourceRuntimeById[source.id];
      const freshness = sourceIndexFreshBySourceId[source.id];
      const analysis = sourceIndexAnalysisBySourceId[source.id];
      const isPlayable = Boolean(
        runtime?.objectUrl
        || runtime?.playerUrl
        || runtime?.file,
      );
      return {
        ...source,
        previewUrl: runtime?.objectUrl || runtime?.playerUrl || runtime?.processingUrl || '',
        isPlayable,
        isIndexReady: freshness?.transcript === true && freshness?.overview === true,
        hasActiveAnalysis: analysis?.status === 'queued' || analysis?.status === 'running',
      };
    })
  ), [sourceIndexAnalysisBySourceId, sourceIndexFreshBySourceId, sourceRuntimeById, sources]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--bg-panel)' }}>
      <div style={{
        height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 12px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-serif)' }}>
          Sources
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          style={{
            border: '1px solid var(--border-mid)',
            borderRadius: 6,
            background: 'rgba(255,255,255,0.04)',
            color: 'var(--fg-secondary)',
            fontSize: 11,
            padding: '5px 8px',
            cursor: 'pointer',
          }}
        >
          Import
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sourceCards.map((source) => (
          <div
            key={source.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'copyMove';
              event.dataTransfer.setData('application/x-autocut-source-id', source.id);
              event.dataTransfer.setData('text/plain', source.fileName);
            }}
            style={{
              position: 'relative',
              flexShrink: 0,
              width: '100%',
              aspectRatio: '16 / 9',
              minHeight: 150,
              borderRadius: 14,
              overflow: 'hidden',
              border: '1px solid var(--border-mid)',
              background: 'var(--bg-elevated)',
              cursor: 'grab',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.03)',
            }}
          >
            <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
              {source.previewUrl ? (
                <video
                  src={source.previewUrl}
                  draggable={false}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                  muted
                  preload="metadata"
                  playsInline
                  disablePictureInPicture
                  controls={false}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)' }}>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-serif)' }}>Waiting for media…</span>
                </div>
              )}
              {source.duration > 0 && (
                <div style={{
                  position: 'absolute', top: 8, left: 8,
                  fontSize: 10, fontFamily: 'var(--font-serif)', color: '#fff',
                  background: 'rgba(0,0,0,0.68)', padding: '2px 6px', borderRadius: 999,
                }}>
                  {formatTimeShort(source.duration)}
                </div>
              )}
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  appendClipFromSource(source.id);
                }}
                style={{
                  position: 'absolute',
                  right: 8,
                  bottom: 8,
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(16,16,16,0.72)',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 2,
                }}
                title="Append to timeline"
              >
                +
              </button>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(180deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.08) 46%, rgba(0,0,0,0.72) 100%)',
                  pointerEvents: 'none',
                }}
              />
            </div>
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                padding: '10px 44px 10px 11px',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                pointerEvents: 'none',
              }}
            >
              <p style={{ fontSize: 12, fontWeight: 600, color: '#fff', lineHeight: 1.35, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {source.fileName || 'Source video'}
              </p>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.72)', fontFamily: 'var(--font-serif)' }}>
                {formatSourceStatus(source.status, {
                  isPlayable: source.isPlayable,
                  isIndexReady: source.isIndexReady,
                  hasActiveAnalysis: source.hasActiveAnalysis,
                })}
              </span>
            </div>
          </div>
        ))}

        {sourceCards.length === 0 && (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.12)',
            borderRadius: 10,
            padding: '14px 12px',
            color: 'var(--fg-muted)',
            fontSize: 12,
            textAlign: 'center',
          }}>
            Import videos to build your source library.
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length > 0 && onImportSources) {
              void onImportSources(files);
            }
            event.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
