'use client';

import YTShell from '@/components/shell/YTShell';
import ChannelContentPage from '@/components/content/ChannelContentPage';
import UploadModal from '@/components/content/UploadModal';
import VideoDetailsModal from '@/components/content/VideoDetailsModal';
import VideoPublishedDialog from '@/components/content/VideoPublishedDialog';
import { useState } from 'react';

export default function ContentPage() {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [publishedOpen, setPublishedOpen] = useState(false);

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
        videoTitle="0923"
      />
      <VideoPublishedDialog
        open={publishedOpen}
        onClose={() => setPublishedOpen(false)}
        videoTitle="0923"
      />
    </YTShell>
  );
}
