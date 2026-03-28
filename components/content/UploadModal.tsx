'use client';

import React, { useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/components/auth/AuthProvider';
import { uploadVideoToSupabase } from '@/lib/uploadVideo';

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
}

export default function UploadModal({ open, onClose }: UploadModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgressLocal] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { user } = useAuth();

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/')) return;

    if (user) {
      try {
        setIsUploading(true);
        setUploadError('');
        const { projectId } = await uploadVideoToSupabase(
          file,
          (p) => setUploadProgressLocal(Math.round(p)),
        );
        // Navigate to the editor — let it handle loading the project and video
        router.push(`/editor?project=${projectId}`);
        setTimeout(() => {
          setIsUploading(false);
          onClose();
        }, 100);
      } catch (err) {
        console.error('Upload failed:', err);
        setUploadError(err instanceof Error ? err.message : 'Upload failed. Please sign in and try again.');
        setIsUploading(false);
      }
    } else {
      onClose();
      router.push('/editor');
    }
  }, [onClose, router, user]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isUploading) onClose(); }}>
      <DialogContent
        className="p-0 gap-0 border-yt-border bg-yt-elevated"
        style={{ width: 540, maxWidth: '90vw', borderRadius: 12 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-yt-border" style={{ padding: '16px 24px' }}>
          <DialogTitle className="text-yt-primary font-yt" style={{ fontSize: 20, fontWeight: 400, lineHeight: '28px', margin: 0 }}>
            Upload videos
          </DialogTitle>
          <button className="text-yt-secondary hover:text-yt-primary bg-transparent border-none cursor-pointer p-1" aria-label="Picture-in-picture">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z" />
            </svg>
          </button>
        </div>

        {/* Drop zone */}
        <div
          className="flex flex-col items-center justify-center"
          style={{ padding: '64px 48px', gap: 16 }}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          {isUploading ? (
            <>
              <div className="flex items-center justify-center rounded-full" style={{ width: 100, height: 100, background: '#282828' }}>
                <div className="animate-spin rounded-full" style={{ width: 40, height: 40, border: '3px solid #3d3d3d', borderTopColor: '#3ea6ff' }} />
              </div>
              <p className="text-yt-primary font-yt" style={{ fontSize: 15, textAlign: 'center' }}>Uploading... {uploadProgress}%</p>
              <div style={{ width: '100%', maxWidth: 300, height: 4, background: '#3d3d3d', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${uploadProgress}%`, background: '#3ea6ff', borderRadius: 2, transition: 'width 0.3s ease' }} />
              </div>
            </>
          ) : (
            <>
              {uploadError && (
                <div className="w-full max-w-sm bg-[#ff4e45]/10 border border-[#ff4e45]/30 rounded-lg" style={{ padding: '10px 16px', marginBottom: 8 }}>
                  <p className="text-[#ff4e45] font-yt text-center" style={{ fontSize: 13, margin: 0 }}>{uploadError}</p>
                </div>
              )}
              <div className="flex items-center justify-center rounded-full" style={{ width: 100, height: 100, background: isDragging ? 'rgba(62, 166, 255, 0.1)' : '#282828', transition: 'background 200ms ease' }}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="40" height="40" className="text-yt-secondary">
                  <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z" />
                </svg>
              </div>
              <p className="text-yt-primary font-yt" style={{ fontSize: 15, textAlign: 'center' }}>Drag and drop video files to upload</p>
              <p className="text-yt-secondary font-yt" style={{ fontSize: 13, textAlign: 'center' }}>Your videos will be private until you publish them.</p>
              <button onClick={() => inputRef.current?.click()} className="font-yt cursor-pointer" style={{ background: '#ffffff', color: '#0f0f0f', fontSize: 14, fontWeight: 500, padding: '8px 16px', borderRadius: 18, border: 'none', marginTop: 8 }}>
                Select files
              </button>
            </>
          )}
          <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={handleFileSelect} />
        </div>

        {/* Footer */}
        {!isUploading && (
          <div className="border-t border-yt-border" style={{ padding: '16px 24px' }}>
            <p className="text-yt-muted font-yt text-center" style={{ fontSize: 12, lineHeight: '16px', margin: 0 }}>
              By submitting your videos to YouTube, you acknowledge that you agree to YouTube&apos;s{' '}
              <span className="text-yt-link cursor-pointer">Terms of Service</span> and{' '}
              <span className="text-yt-link cursor-pointer">Community Guidelines</span>.
            </p>
            <p className="text-yt-muted font-yt text-center" style={{ fontSize: 12, lineHeight: '16px', margin: '4px 0 0' }}>
              Please be sure not to violate others&apos; copyright or privacy rights.{' '}
              <span className="text-yt-link cursor-pointer">Learn more</span>
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
