'use client';

import React from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface VideoPublishedDialogProps {
  open: boolean;
  onClose: () => void;
  videoTitle?: string;
}

const SHARE_ICONS = [
  { name: 'WhatsApp', color: '#25D366', icon: 'M' },
  { name: 'Facebook', color: '#1877F2', icon: 'f' },
  { name: 'X', color: '#000000', icon: '𝕏' },
  { name: 'Email', color: '#6D4C41', icon: '✉' },
  { name: 'Reddit', color: '#FF4500', icon: 'R' },
  { name: 'Pinterest', color: '#E60023', icon: 'P' },
];

export default function VideoPublishedDialog({ open, onClose, videoTitle = 'Untitled' }: VideoPublishedDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="p-0 gap-0 border-yt-border bg-yt-elevated"
        style={{ width: 540, maxWidth: '90vw', borderRadius: 12 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ padding: '20px 24px 0' }}>
          <DialogTitle className="font-yt text-yt-primary" style={{ fontSize: 20, fontWeight: 400, margin: 0 }}>
            Video published
          </DialogTitle>
          <button
            onClick={onClose}
            className="text-yt-secondary hover:text-yt-primary bg-transparent border-none cursor-pointer p-1"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div style={{ padding: '16px 24px 24px' }}>
          {/* Video card */}
          <div
            className="flex items-center gap-4 bg-yt-overlay rounded"
            style={{ padding: '12px 16px', marginBottom: 24 }}
          >
            {/* Thumbnail placeholder */}
            <div className="shrink-0 bg-yt-surface rounded relative" style={{ width: 120, height: 68 }}>
              <span className="absolute bottom-1 right-1 font-yt bg-black/80 text-white rounded" style={{ fontSize: 11, padding: '1px 4px' }}>0:10</span>
            </div>
            <div>
              <p className="font-yt text-yt-primary" style={{ fontSize: 14, fontWeight: 500 }}>{videoTitle}</p>
              <p className="font-yt text-yt-secondary" style={{ fontSize: 12 }}>Uploaded Mar 27, 2026</p>
            </div>
          </div>

          {/* Share a link */}
          <h3 className="font-yt text-yt-primary" style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Share a link</h3>

          {/* Social icons */}
          <div className="flex items-center justify-center gap-4" style={{ marginBottom: 24 }}>
            {SHARE_ICONS.map((social) => (
              <div key={social.name} className="flex flex-col items-center gap-2">
                <div
                  className="flex items-center justify-center rounded-full cursor-pointer"
                  style={{
                    width: 48, height: 48,
                    background: social.color,
                    fontSize: 20, fontWeight: 700,
                    color: '#ffffff',
                  }}
                >
                  {social.icon}
                </div>
                <span className="font-yt text-yt-secondary" style={{ fontSize: 12 }}>{social.name}</span>
              </div>
            ))}
          </div>

          {/* Video link */}
          <div style={{ marginBottom: 24 }}>
            <p className="font-yt text-yt-secondary" style={{ fontSize: 12, marginBottom: 8 }}>Video link</p>
            <div className="flex items-center gap-2 bg-yt-base rounded" style={{ padding: '8px 12px' }}>
              <span
                className="font-yt text-yt-link flex-1"
                style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                https://youtube.com/shorts/S9cHvfl4tYc?feature=share
              </span>
              <button className="text-yt-secondary hover:text-yt-primary bg-transparent border-none cursor-pointer p-1 shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Close button */}
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="font-yt cursor-pointer"
              style={{
                background: '#ffffff', color: '#0f0f0f',
                fontSize: 14, fontWeight: 500, padding: '8px 16px',
                borderRadius: 18, border: 'none',
              }}
            >
              Close
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
