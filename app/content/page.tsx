'use client';

import YTShell from '@/components/shell/YTShell';
import ChannelContentPage from '@/components/content/ChannelContentPage';
import VideoDetailsModal from '@/components/content/VideoDetailsModal';
import VideoPublishedDialog from '@/components/content/VideoPublishedDialog';
import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';

function ContentPageInner() {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [publishedOpen, setPublishedOpen] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Auto-open stepper if coming from export
  useEffect(() => {
    if (searchParams.get('stepper') === 'open') {
      const timer = setTimeout(() => setDetailsOpen(true), 0);
      window.history.replaceState(null, '', '/content');
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  return (
    <YTShell onUploadClick={() => router.push('/projects')}>
      <ChannelContentPage
        onOpenDetails={() => setDetailsOpen(true)}
      />
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
