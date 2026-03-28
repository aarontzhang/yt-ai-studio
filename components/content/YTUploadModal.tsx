'use client';

import { useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { uploadVideoToSupabase } from '@/lib/uploadVideo';
import { useEditorStore } from '@/lib/useEditorStore';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  STORAGE_FILE_LIMIT_BYTES,
  MAX_UPLOAD_VIDEO_DURATION_SECONDS,
  getFileSizeErrorMessage,
  getVideoDurationLimitErrorMessage,
} from '@/lib/storageQuota';

interface YTUploadModalProps {
  open: boolean;
  onClose: () => void;
}

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
    const timeoutId = window.setTimeout(() => finish(0), 10_000);
    tmp.preload = 'metadata';
    tmp.onloadedmetadata = () => { clearTimeout(timeoutId); finish(tmp.duration); };
    tmp.onerror = () => { clearTimeout(timeoutId); finish(0); };
    tmp.src = url;
  });
}

export default function YTUploadModal({ open, onClose }: YTUploadModalProps) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const setVideoCloud = useEditorStore(s => s.setVideoCloud);
  const { user } = useAuth();
  const router = useRouter();

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/')) return;
    if (file.size > STORAGE_FILE_LIMIT_BYTES) {
      setError(getFileSizeErrorMessage());
      return;
    }
    const duration = await readFileDuration(file);
    if (duration > MAX_UPLOAD_VIDEO_DURATION_SECONDS) {
      setError(getVideoDurationLimitErrorMessage());
      return;
    }
    if (!user) {
      setError('Sign in to upload.');
      return;
    }
    setError('');
    setProgress(0);
    try {
      const { projectId, storagePath } = await uploadVideoToSupabase(
        file,
        (pct) => setProgress(pct),
        duration,
      );
      const blobUrl = URL.createObjectURL(file);
      setVideoCloud(file, blobUrl, storagePath, projectId);
      router.push(`/editor?project=${projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgress(null);
    }
  }, [user, router, setVideoCloud]);

  const handleOpenChange = (v: boolean) => {
    if (!v && progress !== null) return;
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="p-0 gap-0 border-none"
        style={{
          width: 540,
          maxWidth: '95vw',
          background: 'var(--yt-bg-elevated, #212121)',
          borderRadius: '12px',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: '1px solid var(--yt-border)',
          }}
        >
          <DialogTitle
            style={{
              fontSize: '20px',
              fontWeight: 400,
              color: 'var(--yt-text-primary)',
              fontFamily: 'var(--font-yt)',
              margin: 0,
            }}
          >
            Upload videos
          </DialogTitle>
        </div>

        {/* Dropzone area */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const files = Array.from(e.dataTransfer.files);
            if (files[0]) void handleFile(files[0]);
          }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '64px 48px',
            gap: '16px',
          }}
        >
          {progress === null ? (
            <>
              {/* Upload icon circle */}
              <div
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: '50%',
                  background: isDragging ? 'rgba(62, 166, 255, 0.1)' : 'var(--yt-bg-surface, #282828)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 4L12 16" stroke="var(--yt-text-secondary, #aaaaaa)" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M7 9L12 4L17 9" stroke="var(--yt-text-secondary, #aaaaaa)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M20 17V19C20 20.1046 19.1046 21 18 21H6C4.89543 21 4 20.1046 4 19V17" stroke="var(--yt-text-secondary, #aaaaaa)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              {/* Primary text */}
              <div
                style={{
                  fontSize: '14px',
                  color: 'var(--yt-text-secondary, #aaaaaa)',
                  textAlign: 'center',
                  fontFamily: 'var(--font-yt)',
                }}
              >
                Drag and drop video files to upload
              </div>

              {/* Sub text */}
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--yt-text-muted, #717171)',
                  textAlign: 'center',
                  fontFamily: 'var(--font-yt)',
                }}
              >
                Your videos will be private until you publish them.
              </div>

              {/* Select files button */}
              <button
                onClick={() => inputRef.current?.click()}
                style={{
                  marginTop: '8px',
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: 500,
                  fontFamily: 'var(--font-yt)',
                  color: '#0f0f0f',
                  background: '#3ea6ff',
                  border: 'none',
                  borderRadius: '18px',
                  cursor: 'pointer',
                }}
              >
                Select files
              </button>
            </>
          ) : (
            /* Progress state */
            <div style={{ width: '100%', maxWidth: 300, textAlign: 'center' }}>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
                <div
                  style={{
                    height: '100%',
                    width: `${progress}%`,
                    background: '#3ea6ff',
                    borderRadius: 2,
                    transition: 'width 0.3s',
                  }}
                />
              </div>
              <p
                style={{
                  fontSize: '12px',
                  color: 'var(--yt-text-secondary, #aaaaaa)',
                  marginTop: '12px',
                  fontFamily: 'var(--font-yt)',
                }}
              >
                {progress < 100 ? `Uploading\u2026 ${progress}%` : 'Processing\u2026'}
              </p>
            </div>
          )}

          {/* Error message */}
          {error && (
            <p
              style={{
                fontSize: '12px',
                color: '#f87171',
                fontFamily: 'var(--font-yt)',
                marginTop: '8px',
              }}
            >
              {error}
            </p>
          )}
        </div>

        {/* Footer — Terms of Service */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--yt-border)',
            textAlign: 'center',
          }}
        >
          <p
            style={{
              fontSize: '12px',
              color: 'var(--yt-text-muted, #717171)',
              fontFamily: 'var(--font-yt)',
              lineHeight: '18px',
            }}
          >
            By submitting your videos to YouTube, you acknowledge that you agree to YouTube&apos;s{' '}
            <span style={{ color: '#3ea6ff' }}>Terms of Service</span> and{' '}
            <span style={{ color: '#3ea6ff' }}>Community Guidelines</span>.
          </p>
          <p
            style={{
              fontSize: '12px',
              color: 'var(--yt-text-muted, #717171)',
              fontFamily: 'var(--font-yt)',
              lineHeight: '18px',
              marginTop: '4px',
            }}
          >
            Please be sure not to violate others&apos; copyright or privacy rights.{' '}
            <span style={{ color: '#3ea6ff' }}>Learn more</span>
          </p>
        </div>

        {/* Hidden file input */}
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
