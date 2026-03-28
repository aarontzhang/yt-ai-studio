'use client';

import YTShell from '@/components/shell/YTShell';
import ChannelContentPage from '@/components/content/ChannelContentPage';
import UploadModal from '@/components/content/UploadModal';
import VideoDetailsModal from '@/components/content/VideoDetailsModal';
import VideoPublishedDialog from '@/components/content/VideoPublishedDialog';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function ContentPageInner() {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [publishedOpen, setPublishedOpen] = useState(false);
  const searchParams = useSearchParams();

  // Auto-open stepper if coming from export
  useEffect(() => {
    if (searchParams.get('stepper') === 'open') {
      // Defer state update to avoid synchronous setState in effect
      const timer = setTimeout(() => setDetailsOpen(true), 0);
      // Clean up the URL without triggering navigation
      window.history.replaceState(null, '', '/content');
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  return (
    <YTShell onUploadClick={() => setUploadOpen(true)}>
      <ChannelContentPage
        onOpenDetails={() => setDetailsOpen(true)}
      />
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <VideoDetailsModal
        open={detailsOpen}
        onClose={() => {
          setDetailsOpen(false);
          setPublishedOpen(true);
        }}
        videoTitle="Morning Surf Session"
      />
      <VideoPublishedDialog
        open={publishedOpen}
        onClose={() => setPublishedOpen(false)}
        videoTitle="Morning Surf Session"
      />
    </YTShell>
  );
}

export default function ContentPage() {
  return (
    <Suspense>
      <ContentPageInner />
    </Suspense>
  );
}
