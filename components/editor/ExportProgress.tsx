'use client';

import { useCallback } from 'react';

import { cancelActiveFFmpegJob } from '@/lib/ffmpegClient';
import { useEditorStore } from '@/lib/useEditorStore';

export default function ExportProgress() {
  const ffmpegJob = useEditorStore(s => s.ffmpegJob);
  const setFFmpegJob = useEditorStore(s => s.setFFmpegJob);

  const handleCancel = useCallback(() => {
    const currentJob = useEditorStore.getState().ffmpegJob;
    if (currentJob.status !== 'running' || currentJob.isCancelling) return;
    setFFmpegJob({ ...currentJob, status: 'running', stage: 'Cancelling…', isCancelling: true });
    cancelActiveFFmpegJob();
  }, [setFFmpegJob]);

  if (ffmpegJob.status === 'idle') return null;

  const isDone = ffmpegJob.status === 'done';
  const isError = ffmpegJob.status === 'error';
  const isRunning = ffmpegJob.status === 'running';
  const isCancelled = ffmpegJob.status === 'cancelled';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.75)',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        width: 360,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-mid)',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: isDone
              ? 'rgba(58,170,110,0.15)'
              : isError
              ? 'rgba(229,58,58,0.15)'
              : isCancelled
              ? 'rgba(255,255,255,0.08)'
              : 'rgba(0,196,204,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {isDone && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3aaa6e" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            )}
            {isError && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e53a3a" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            )}
            {isCancelled && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--fg-secondary)" strokeWidth="2.2">
                <path d="M6 6l12 12M18 6L6 18"/>
              </svg>
            )}
            {isRunning && (
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  border: '2px solid rgba(0,196,204,0.25)',
                  borderTopColor: 'var(--teal)',
                  animation: 'spinExportIndicator 0.9s linear infinite',
                }}
              />
            )}
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-primary)' }}>
            {isDone
              ? 'Export complete'
              : isError
              ? 'Export failed'
              : isCancelled
              ? 'Export canceled'
              : ffmpegJob.isCancelling
              ? 'Cancelling export…'
              : 'Exporting…'}
          </span>
        </div>

        {/* Body */}
        <div style={{ padding: '20px' }}>
          {isRunning && (
            <>
              <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 12 }}>
                {ffmpegJob.stage}
              </p>
              {/* Indeterminate bar while loading WASM (progress = 0), real bar during processing */}
              <div style={{
                height: 4, background: 'rgba(255,255,255,0.08)',
                borderRadius: 2, overflow: 'hidden', position: 'relative',
              }}>
                {ffmpegJob.progress === 0 ? (
                  // Animated indeterminate bar
                  <div style={{
                    position: 'absolute', top: 0, left: '-40%',
                    width: '40%', height: '100%',
                    background: 'linear-gradient(90deg, transparent, var(--teal), transparent)',
                    borderRadius: 2,
                    animation: 'slideIndeterminate 1.4s ease-in-out infinite',
                  }} />
                ) : (
                  <div style={{
                    height: '100%', width: `${ffmpegJob.progress}%`,
                    background: 'var(--teal)', borderRadius: 2,
                    transition: 'width 0.3s ease',
                  }} />
                )}
              </div>
              <p style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 8, textAlign: 'right' }}>
                {ffmpegJob.progress > 0 ? `${ffmpegJob.progress}%` : 'Please wait…'}
              </p>
              <style>{`
                @keyframes slideIndeterminate {
                  0%   { left: -40%; }
                  100% { left: 110%; }
                }
                @keyframes spinExportIndicator {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
            </>
          )}

          {isError && (
            <p style={{ fontSize: 13, color: 'rgba(229,58,58,0.9)', lineHeight: 1.5 }}>
              {ffmpegJob.message}
            </p>
          )}

          {isCancelled && (
            <p style={{ fontSize: 13, color: 'var(--fg-secondary)', lineHeight: 1.5 }}>
              {ffmpegJob.message}
            </p>
          )}

          {isDone && (
            <p style={{ fontSize: 13, color: 'var(--fg-secondary)', lineHeight: 1.5 }}>
              Your video is ready to download.
            </p>
          )}
        </div>

        {/* Footer */}
        {(isDone || isError || isCancelled || isRunning) && (
          <div style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex', gap: 8, justifyContent: 'flex-end',
          }}>
            {isRunning ? (
              <button
                onClick={handleCancel}
                disabled={ffmpegJob.isCancelling}
                style={{
                  padding: '7px 14px',
                  fontSize: 13,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: ffmpegJob.isCancelling ? 'var(--fg-faint)' : 'var(--fg-secondary)',
                  borderRadius: 6,
                  cursor: ffmpegJob.isCancelling ? 'default' : 'pointer',
                }}
              >
                {ffmpegJob.isCancelling ? 'Cancelling…' : 'Cancel export'}
              </button>
            ) : (
              <button
                onClick={() => setFFmpegJob({ status: 'idle' })}
                style={{
                  padding: '7px 14px', fontSize: 13,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--fg-secondary)', borderRadius: 6, cursor: 'pointer',
                }}
              >
                Close
              </button>
            )}
            {isDone && (
              <a
                href={(ffmpegJob as { status: 'done'; outputUrl: string }).outputUrl}
                download="export-output.mp4"
                style={{
                  padding: '7px 16px', fontSize: 13, fontWeight: 500,
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: 'var(--fg-primary)',
                  borderRadius: 6, textDecoration: 'none',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
