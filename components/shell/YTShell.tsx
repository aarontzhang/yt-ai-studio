'use client';

import React from 'react';
import YTTopBar from './YTTopBar';
import YTSidebar from './YTSidebar';

interface YTShellProps {
  children: React.ReactNode;
  onUploadClick?: () => void;
}

export default function YTShell({ children, onUploadClick }: YTShellProps) {
  return (
    <div className="min-h-screen bg-yt-base">
      {/* Fixed top bar */}
      <YTTopBar onUploadClick={onUploadClick} />

      {/* Fixed sidebar */}
      <YTSidebar />

      {/* Scrollable content area — offset from fixed top bar and sidebar */}
      <main
        className="bg-yt-base"
        style={{
          marginTop: 'var(--yt-topbar-height)',
          marginLeft: 'var(--yt-sidebar-width)',
          padding: '24px 32px',
          minHeight: 'calc(100vh - var(--yt-topbar-height))',
        }}
      >
        {children}
      </main>
    </div>
  );
}
