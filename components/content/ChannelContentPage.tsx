'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { type Project } from '@/app/projects/page';
import YTShell from '@/components/shell/YTShell';
import VideoTable from '@/components/content/VideoTable';
import YTUploadModal from '@/components/content/YTUploadModal';

const TABS = [
  'Inspiration',
  'Videos',
  'Shorts',
  'Live',
  'Posts',
  'Playlists',
  'Podcasts',
  'Courses',
  'Promotions',
  'Collaborations',
];

export default function ChannelContentPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/projects', { cache: 'no-store' });
      if (!response.ok) {
        setProjects([]);
        return;
      }
      const data = await response.json();
      setProjects(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  return (
    <YTShell onUploadClick={() => setUploadOpen(true)}>
      {/* Heading */}
      <h1
        style={{
          fontSize: '24px',
          fontWeight: 400,
          color: 'var(--yt-text-primary)',
          fontFamily: 'var(--font-yt)',
          marginBottom: '16px',
        }}
      >
        Channel content
      </h1>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--yt-border)',
          marginBottom: '0',
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            style={{
              fontSize: '14px',
              fontWeight: 500,
              color: tab === 'Videos' ? 'var(--yt-text-primary)' : 'var(--yt-text-secondary)',
              padding: '12px 24px',
              background: 'transparent',
              border: 'none',
              borderBottom: tab === 'Videos' ? '2px solid #ffffff' : '2px solid transparent',
              cursor: tab === 'Videos' ? 'pointer' : 'default',
              fontFamily: 'var(--font-yt)',
              marginBottom: '-1px',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Filter row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 0',
          color: 'var(--yt-text-secondary)',
          fontFamily: 'var(--font-yt)',
          fontSize: '14px',
        }}
      >
        {/* Funnel/filter icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
        </svg>
        <span>Filter</span>
      </div>

      {/* Video table */}
      <VideoTable projects={projects} loading={loading} />

      <YTUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </YTShell>
  );
}
