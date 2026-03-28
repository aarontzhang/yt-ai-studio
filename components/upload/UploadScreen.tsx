'use client';

import { useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useEditorStore } from '@/lib/useEditorStore';
import { useAuth } from '@/components/auth/AuthProvider';
import UserProfileMenu from '@/components/auth/UserProfileMenu';
import { uploadVideoToSupabase } from '@/lib/uploadVideo';
import AutocutMark from '@/components/branding/AutocutMark';
import StorageQuotaBanner from '@/components/storage/StorageQuotaBanner';
import { useStorageQuota } from '@/lib/useStorageQuota';
import {
  MAX_UPLOAD_VIDEO_DURATION_SECONDS,
  STORAGE_FILE_LIMIT_BYTES,
  STORAGE_QUOTA_BYTES,
  formatStorageBytes,
  getFileSizeErrorMessage,
  getVideoDurationLimitErrorMessage,
} from '@/lib/storageQuota';
import { capture } from '@/lib/analytics';

function readFileDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const tmp = document.createElement('video');
    let settled = false;
    const finish = (duration: number) => {
      if (settled) return;
      settled = true;
      tmp.src = '';
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    // Safety timeout — if the browser never fires loadedmetadata (can happen on
    // HTTPS with certain codecs), resolve with 0 so the upload can still proceed.
    const timeoutId = window.setTimeout(() => finish(0), 10_000);
    tmp.preload = 'metadata';
    tmp.onloadedmetadata = () => { clearTimeout(timeoutId); finish(tmp.duration); };
    tmp.onerror = () => { clearTimeout(timeoutId); finish(0); };
    tmp.src = url;
  });
}

export default function UploadScreen() {
  const setVideoCloud = useEditorStore(s => s.setVideoCloud);
  const setUploadProgress = useEditorStore(s => s.setUploadProgress);
  const uploadProgress = useEditorStore(s => s.uploadProgress);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const router = useRouter();
  const { quota, loading: quotaLoading, refresh: refreshQuota } = useStorageQuota(Boolean(user));

  const explainMultipleFiles = useCallback(() => {
    setUploadError('Capped out at one video for now. Multi-file support coming soon.');
    setUploadProgress(null);
  }, [setUploadProgress]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/')) return;
    if (file.size > STORAGE_FILE_LIMIT_BYTES) {
      setUploadError(getFileSizeErrorMessage());
      setUploadProgress(null);
      return;
    }
    const duration = await readFileDuration(file);
    if (duration > MAX_UPLOAD_VIDEO_DURATION_SECONDS) {
      setUploadError(getVideoDurationLimitErrorMessage());
      setUploadProgress(null);
      return;
    }
    if (!user) {
      setUploadError('You must be signed in before uploading to Supabase.');
      setUploadProgress(null);
      return;
    }

    setUploadError('');
    setUploadProgress(0);
    capture('upload_started', {
      file_size_mb: parseFloat((file.size / 1_000_000).toFixed(2)),
      duration_s: Math.round(duration),
    });
    const uploadStartMs = performance.now();

    try {
      const { projectId, storagePath } = await uploadVideoToSupabase(
        file,
        (pct) => setUploadProgress(pct),
        duration,
      );
      await refreshQuota();
      capture('upload_completed', { upload_time_ms: Math.round(performance.now() - uploadStartMs) });
      console.log('Upload success:', { projectId, storagePath });
      const blobUrl = URL.createObjectURL(file);
      setVideoCloud(file, blobUrl, storagePath, projectId);
      router.push(`/editor?project=${projectId}`);
    } catch (err) {
      console.error('Upload error:', err);
      capture('upload_failed', { reason: err instanceof Error ? err.message : 'Upload failed' });
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
      setUploadProgress(null);
    }
  }, [router, user, setVideoCloud, setUploadProgress, refreshQuota]);

  const handleFiles = useCallback((files: File[]) => {
    const videoFiles = files.filter((file) => file.type.startsWith('video/'));
    if (videoFiles.length === 0) return;
    if (videoFiles.length > 1) {
      explainMultipleFiles();
      return;
    }
    void handleFile(videoFiles[0]);
  }, [explainMultipleFiles, handleFile]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(Array.from(e.dataTransfer.files));
  }, [handleFiles]);

  return (
    <div
      className="h-screen flex flex-col items-center justify-center"
      style={{ background: 'var(--bg-base)', position: 'relative' }}
    >
      {/* User info top-right */}
      <div style={{ position: 'absolute', top: 16, right: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
        {user && <UserProfileMenu user={user} dashboardLabel="Go to Dashboard" />}
      </div>

      {/* Logo */}
      <div className="flex items-center gap-2.5 mb-12">
        <AutocutMark size={32} />
        <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--fg-primary)', letterSpacing: '-0.02em' }}>
          Autocut
        </span>
      </div>

      <div style={{ width: 480, marginBottom: 16 }}>
        <StorageQuotaBanner
          quota={quota}
          loading={quotaLoading}
          title="Account storage"
          compact
        />
      </div>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => uploadProgress === null && inputRef.current?.click()}
        style={{
          width: 480,
          border: `1.5px dashed ${isDragging ? 'var(--accent)' : 'rgba(255,255,255,0.15)'}`,
          borderRadius: 12,
          padding: '52px 32px',
          background: isDragging ? 'var(--accent-dim)' : 'rgba(255,255,255,0.02)',
          cursor: uploadProgress !== null ? 'default' : 'pointer',
          transition: 'all 0.2s ease',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
        }}
      >
        {/* Upload icon */}
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: isDragging ? 'var(--accent-dim)' : 'rgba(255,255,255,0.04)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${isDragging ? 'var(--accent-border)' : 'rgba(255,255,255,0.08)'}`,
          transition: 'all 0.2s ease',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke={isDragging ? 'var(--accent)' : 'rgba(255,255,255,0.4)'} strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>

        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--fg-primary)', marginBottom: 6 }}>
            {isDragging ? 'Drop to import' : 'Import video'}
          </p>
          <p style={{ fontSize: 13, color: 'var(--fg-secondary)' }}>
            Drag & drop or click to browse one source video
          </p>
          <p style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 8 }}>
            Up to {formatStorageBytes(STORAGE_FILE_LIMIT_BYTES)} per video
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {['MP4', 'MOV', 'AVI', 'WEBM', 'MKV'].map(fmt => (
            <span key={fmt} style={{
              fontSize: 11, fontFamily: 'var(--font-geist-mono)',
              color: 'var(--fg-muted)',
              padding: '2px 7px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 4,
            }}>{fmt}</span>
          ))}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={e => {
            handleFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>

      {/* Progress bar */}
      {uploadProgress !== null && (
        <div style={{ width: 480, marginTop: 16 }}>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
            <div style={{ height: '100%', width: `${uploadProgress}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 0.3s' }} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 6, textAlign: 'center' }}>
            {uploadProgress < 100 ? `Uploading\u2026 ${uploadProgress}%` : 'Processing\u2026'}
          </p>
        </div>
      )}

      {/* Error */}
      {uploadError && (
        <p style={{ marginTop: 12, fontSize: 12, color: '#f87171' }}>{uploadError}</p>
      )}

      {/* Bottom hint */}
      <p style={{ marginTop: 28, fontSize: 12, color: 'var(--fg-muted)' }}>
        Powered by Claude AI · {formatStorageBytes(STORAGE_FILE_LIMIT_BYTES)} per video · {formatStorageBytes(STORAGE_QUOTA_BYTES)} total storage per account
      </p>
    </div>
  );
}
