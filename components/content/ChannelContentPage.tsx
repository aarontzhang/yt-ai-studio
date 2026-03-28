'use client';

import React, { useState } from 'react';

/* ─── Tab data ───────────────────────────────────────────────── */
const TABS = [
  'Inspiration', 'Videos', 'Shorts', 'Live', 'Posts',
  'Playlists', 'Podcasts', 'Courses', 'Promotions', 'Collaborations',
] as const;

/* ─── Mock video data ────────────────────────────────────────── */
interface VideoRow {
  id: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  duration: string;
  visibility: 'Private' | 'Unlisted' | 'Public';
  restrictions: string;
  date: string;
  dateLabel: string;
  views: number;
  comments: number;
  likes: string;
}

const MOCK_VIDEOS: VideoRow[] = [
  {
    id: '1', title: '2/7/25', description: null, thumbnail: null,
    duration: '5:59', visibility: 'Private', restrictions: 'None',
    date: 'Mar 21, 2026', dateLabel: 'Uploaded', views: 0, comments: 0, likes: '–',
  },
  {
    id: '2', title: '3/5/26 handstander', description: null, thumbnail: null,
    duration: '17:40', visibility: 'Private', restrictions: 'None',
    date: 'Mar 20, 2026', dateLabel: 'Uploaded', views: 0, comments: 0, likes: '–',
  },
  {
    id: '3', title: '3/13/26 yea', description: null, thumbnail: null,
    duration: '4:59', visibility: 'Private', restrictions: 'None',
    date: 'Mar 20, 2026', dateLabel: 'Uploaded', views: 0, comments: 0, likes: '–',
  },
  {
    id: '4', title: '3/1/26 human flagging', description: null, thumbnail: null,
    duration: '4:31', visibility: 'Private', restrictions: 'None',
    date: 'Mar 1, 2026', dateLabel: 'Uploaded', views: 1, comments: 0, likes: '–',
  },
  {
    id: '5', title: '2/11 dragon flagon', description: null, thumbnail: null,
    duration: '17:25', visibility: 'Private', restrictions: 'None',
    date: 'Feb 22, 2026', dateLabel: 'Uploaded', views: 0, comments: 0, likes: '–',
  },
  {
    id: '6', title: 'The College to Climate 30 List Video Submis...', description: null, thumbnail: null,
    duration: '12:36', visibility: 'Unlisted', restrictions: 'None',
    date: 'Feb 20, 2026', dateLabel: 'Uploaded', views: 1, comments: 0, likes: '–',
  },
  {
    id: '7', title: 'Adobe ADBE Feedback', description: null, thumbnail: null,
    duration: '8:12', visibility: 'Unlisted', restrictions: 'None',
    date: 'Feb 19, 2026', dateLabel: 'Uploaded', views: 4, comments: 0, likes: '–',
  },
];

/* ─── Visibility icon ────────────────────────────────────────── */
function VisibilityIcon({ type }: { type: string }) {
  if (type === 'Private') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16" className="text-yt-secondary mr-2 shrink-0">
        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
      </svg>
    );
  }
  // Unlisted
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16" className="text-yt-secondary mr-2 shrink-0">
      <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" />
    </svg>
  );
}

/* ─── Filter bar icon ────────────────────────────────────────── */
function FilterIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" className="text-yt-secondary">
      <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
    </svg>
  );
}

/* ─── Main component ─────────────────────────────────────────── */
interface ChannelContentPageProps {
  onOpenDetails?: () => void;
}

export default function ChannelContentPage({ onOpenDetails }: ChannelContentPageProps) {
  const [activeTab, setActiveTab] = useState<string>('Videos');

  return (
    <>
      {/* Page title */}
      <h1
        className="text-yt-primary font-yt"
        style={{ fontSize: 24, fontWeight: 400, lineHeight: '32px', marginBottom: 0 }}
      >
        Channel content
      </h1>

      {/* Tabs */}
      <div
        className="flex border-b border-yt-border"
        style={{ marginTop: 16, gap: 0 }}
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="font-yt relative bg-transparent border-none cursor-pointer"
            style={{
              fontSize: 14,
              fontWeight: 500,
              lineHeight: '20px',
              letterSpacing: '0.2px',
              padding: '12px 24px',
              color: activeTab === tab ? '#ffffff' : '#aaaaaa',
            }}
          >
            {tab}
            {activeTab === tab && (
              <span
                className="absolute bottom-0 left-0 right-0"
                style={{ height: 2, background: '#ffffff' }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center" style={{ padding: '8px 0', gap: 8 }}>
        <button
          className="flex items-center gap-2 bg-transparent border-none cursor-pointer text-yt-secondary font-yt hover:text-yt-primary"
          style={{ fontSize: 14, padding: '8px 0' }}
        >
          <FilterIcon />
          <span>Filter</span>
        </button>
      </div>

      {/* Video table */}
      <table className="w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ width: 40, padding: '8px 16px', textAlign: 'left' }}>
              <input
                type="checkbox"
                className="rounded border-yt-border-input"
                style={{ width: 18, height: 18, accentColor: '#3ea6ff' }}
              />
            </th>
            <th
              className="text-yt-secondary font-yt text-left"
              style={{
                fontSize: 12, fontWeight: 500, lineHeight: '16px',
                letterSpacing: '0.5px', padding: '8px 16px',
              }}
            >
              Video
            </th>
            <th className="text-yt-secondary font-yt text-left" style={{ fontSize: 12, fontWeight: 500, padding: '8px 16px', letterSpacing: '0.5px' }}>
              Visibility
            </th>
            <th className="text-yt-secondary font-yt text-left" style={{ fontSize: 12, fontWeight: 500, padding: '8px 16px', letterSpacing: '0.5px' }}>
              Restrictions
            </th>
            <th className="text-yt-secondary font-yt text-left" style={{ fontSize: 12, fontWeight: 500, padding: '8px 16px', letterSpacing: '0.5px' }}>
              <span className="flex items-center gap-1">
                Date
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                  <path d="M7 10l5 5 5-5z" />
                </svg>
              </span>
            </th>
            <th className="text-yt-secondary font-yt text-right" style={{ fontSize: 12, fontWeight: 500, padding: '8px 16px', letterSpacing: '0.5px' }}>
              Views
            </th>
            <th className="text-yt-secondary font-yt text-right" style={{ fontSize: 12, fontWeight: 500, padding: '8px 16px', letterSpacing: '0.5px' }}>
              Comments
            </th>
            <th className="text-yt-secondary font-yt text-right" style={{ fontSize: 12, fontWeight: 500, padding: '8px 16px', letterSpacing: '0.5px' }}>
              Likes (vs. dislikes)
            </th>
          </tr>
        </thead>
        <tbody>
          {MOCK_VIDEOS.map((video) => (
            <tr
              key={video.id}
              className="hover:bg-[#1a1a1a] transition-colors"
              style={{ borderBottom: '1px solid #2d2d2d' }}
            >
              {/* Checkbox */}
              <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                <input
                  type="checkbox"
                  style={{ width: 18, height: 18, accentColor: '#3ea6ff' }}
                />
              </td>

              {/* Video (thumbnail + title) */}
              <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                <div className="flex items-center gap-4">
                  {/* Thumbnail placeholder */}
                  <div
                    className="shrink-0 bg-yt-overlay relative"
                    style={{
                      width: 120,
                      height: 68,
                      borderRadius: 4,
                      overflow: 'hidden',
                    }}
                  >
                    {/* Duration badge */}
                    <span
                      className="absolute font-yt"
                      style={{
                        bottom: 4,
                        right: 4,
                        background: 'rgba(0,0,0,0.8)',
                        color: '#ffffff',
                        fontSize: 12,
                        fontWeight: 500,
                        padding: '1px 4px',
                        borderRadius: 2,
                        lineHeight: '16px',
                      }}
                    >
                      {video.duration}
                    </span>
                  </div>
                  <div>
                    <p
                      className="text-yt-primary font-yt cursor-pointer hover:underline"
                      style={{ fontSize: 14, fontWeight: 400, lineHeight: '20px', margin: 0 }}
                      onClick={onOpenDetails}
                    >
                      {video.title}
                    </p>
                    <p
                      className="text-yt-link font-yt cursor-pointer"
                      style={{ fontSize: 12, margin: '2px 0 0', lineHeight: '16px' }}
                    >
                      {video.description || 'Add description'}
                    </p>
                  </div>
                </div>
              </td>

              {/* Visibility */}
              <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                <div className="flex items-center">
                  <VisibilityIcon type={video.visibility} />
                  <span className="text-yt-primary font-yt" style={{ fontSize: 14 }}>
                    {video.visibility}
                  </span>
                </div>
              </td>

              {/* Restrictions */}
              <td className="text-yt-primary font-yt" style={{ fontSize: 14, padding: '12px 16px', verticalAlign: 'middle' }}>
                {video.restrictions}
              </td>

              {/* Date */}
              <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                <p className="text-yt-primary font-yt" style={{ fontSize: 14, margin: 0 }}>{video.date}</p>
                <p className="text-yt-secondary font-yt" style={{ fontSize: 12, margin: '2px 0 0' }}>{video.dateLabel}</p>
              </td>

              {/* Views */}
              <td className="text-yt-primary font-yt text-right" style={{ fontSize: 14, padding: '12px 16px', verticalAlign: 'middle' }}>
                {video.views}
              </td>

              {/* Comments */}
              <td className="text-yt-primary font-yt text-right" style={{ fontSize: 14, padding: '12px 16px', verticalAlign: 'middle' }}>
                {video.comments}
              </td>

              {/* Likes */}
              <td className="text-yt-primary font-yt text-right" style={{ fontSize: 14, padding: '12px 16px', verticalAlign: 'middle' }}>
                {video.likes}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

    </>
  );
}
