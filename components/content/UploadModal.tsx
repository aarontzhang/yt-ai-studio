'use client';

import React, { useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
}

export default function UploadModal({ open, onClose }: UploadModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/')) return;
    onClose();

    // Create a new project and navigate to editor
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name.replace(/\.[^.]+$/, ''), edit_state: {} }),
      });
      if (res.ok) {
        const { id } = await res.json();
        router.push(`/editor?project=${id}`);
      } else {
        // Fallback: just navigate to editor without project
        router.push('/editor');
      }
    } catch {
      router.push('/editor');
    }
  }, [onClose, router]);

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
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="p-0 gap-0 border-yt-border bg-yt-elevated"
        style={{ width: 540, maxWidth: '90vw', borderRadius: 12 }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b border-yt-border"
          style={{ padding: '16px 24px' }}
        >
          <DialogTitle
            className="text-yt-primary font-yt"
            style={{ fontSize: 20, fontWeight: 400, lineHeight: '28px', margin: 0 }}
          >
            Upload videos
          </DialogTitle>
          <div className="flex items-center gap-2">
            {/* Screen mode icon */}
            <button
              className="text-yt-secondary hover:text-yt-primary bg-transparent border-none cursor-pointer p-1"
              aria-label="Picture-in-picture"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                <path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Drop zone */}
        <div
          className="flex flex-col items-center justify-center"
          style={{ padding: '64px 48px', gap: 16 }}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          {/* Upload icon */}
          <div
            className="flex items-center justify-center rounded-full"
            style={{
              width: 100,
              height: 100,
              background: isDragging ? 'rgba(62, 166, 255, 0.1)' : '#282828',
              transition: 'background 200ms ease',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="40" height="40" className="text-yt-secondary">
              <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z" />
            </svg>
          </div>

          <p
            className="text-yt-primary font-yt"
            style={{ fontSize: 15, fontWeight: 400, lineHeight: '22px', textAlign: 'center' }}
          >
            Drag and drop video files to upload
          </p>
          <p
            className="text-yt-secondary font-yt"
            style={{ fontSize: 13, lineHeight: '18px', textAlign: 'center' }}
          >
            Your videos will be private until you publish them.
          </p>

          {/* Select files button */}
          <button
            onClick={() => inputRef.current?.click()}
            className="font-yt cursor-pointer"
            style={{
              background: '#ffffff',
              color: '#0f0f0f',
              fontSize: 14,
              fontWeight: 500,
              lineHeight: '20px',
              letterSpacing: '0.2px',
              padding: '8px 16px',
              borderRadius: 18,
              border: 'none',
              marginTop: 8,
            }}
          >
            Select files
          </button>

          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {/* Footer — terms */}
        <div
          className="border-t border-yt-border"
          style={{ padding: '16px 24px' }}
        >
          <p
            className="text-yt-muted font-yt text-center"
            style={{ fontSize: 12, lineHeight: '16px', margin: 0 }}
          >
            By submitting your videos to YouTube, you acknowledge that you agree to YouTube&apos;s{' '}
            <span className="text-yt-link cursor-pointer">Terms of Service</span> and{' '}
            <span className="text-yt-link cursor-pointer">Community Guidelines</span>.
          </p>
          <p
            className="text-yt-muted font-yt text-center"
            style={{ fontSize: 12, lineHeight: '16px', margin: '4px 0 0' }}
          >
            Please be sure not to violate others&apos; copyright or privacy rights.{' '}
            <span className="text-yt-link cursor-pointer">Learn more</span>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
