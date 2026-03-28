'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { type Project } from '@/app/projects/page';

interface VideoTableProps {
  projects: Project[];
  loading: boolean;
}

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));

export default function VideoTable({ projects, loading }: VideoTableProps) {
  const router = useRouter();
  const handleRowClick = useCallback((id: string) => {
    router.push(`/editor?project=${id}`);
  }, [router]);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '48px 0',
          color: 'var(--yt-text-secondary)',
          fontFamily: 'var(--font-yt)',
          fontSize: '14px',
        }}
      >
        Loading...
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '48px 0',
          color: 'var(--yt-text-secondary)',
          fontFamily: 'var(--font-yt)',
          fontSize: '14px',
        }}
      >
        No videos uploaded yet
      </div>
    );
  }

  return (
    <>
      <style>{`.yt-video-row:hover { background: #1a1a1a; }`}</style>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ width: '48px', padding: '8px 16px' }}>
              <input type="checkbox" disabled style={{ accentColor: 'var(--yt-text-secondary)', cursor: 'default' }} />
            </th>
            <th
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--yt-text-secondary)',
                textAlign: 'left',
                padding: '8px 16px',
                borderBottom: '1px solid var(--yt-border)',
                fontFamily: 'var(--font-yt)',
              }}
            >
              Video
            </th>
            <th
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--yt-text-secondary)',
                textAlign: 'left',
                padding: '8px 16px',
                borderBottom: '1px solid var(--yt-border)',
                fontFamily: 'var(--font-yt)',
              }}
            >
              Visibility
            </th>
            <th
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--yt-text-secondary)',
                textAlign: 'left',
                padding: '8px 16px',
                borderBottom: '1px solid var(--yt-border)',
                fontFamily: 'var(--font-yt)',
              }}
            >
              Restrictions
            </th>
            <th
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--yt-text-secondary)',
                textAlign: 'left',
                padding: '8px 16px',
                borderBottom: '1px solid var(--yt-border)',
                fontFamily: 'var(--font-yt)',
                whiteSpace: 'nowrap',
              }}
            >
              Date &#x2193;
            </th>
            <th
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--yt-text-secondary)',
                textAlign: 'left',
                padding: '8px 16px',
                borderBottom: '1px solid var(--yt-border)',
                fontFamily: 'var(--font-yt)',
              }}
            >
              Views
            </th>
            <th
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--yt-text-secondary)',
                textAlign: 'left',
                padding: '8px 16px',
                borderBottom: '1px solid var(--yt-border)',
                fontFamily: 'var(--font-yt)',
              }}
            >
              Comments
            </th>
            <th
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--yt-text-secondary)',
                textAlign: 'left',
                padding: '8px 16px',
                borderBottom: '1px solid var(--yt-border)',
                fontFamily: 'var(--font-yt)',
              }}
            >
              Likes (vs. dislikes)
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr
              key={project.id}
              className="yt-video-row"
              onClick={() => handleRowClick(project.id)}
              style={{ cursor: 'pointer', borderBottom: '1px solid var(--yt-border-subtle)' }}
            >
              {/* Checkbox */}
              <td style={{ width: '48px', padding: '12px 16px', verticalAlign: 'middle' }}>
                <input
                  type="checkbox"
                  disabled
                  style={{ accentColor: 'var(--yt-text-secondary)', cursor: 'default' }}
                />
              </td>

              {/* Video cell: thumbnail + title + description */}
              <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {/* Thumbnail placeholder */}
                  <div
                    style={{
                      width: 120,
                      height: 68,
                      borderRadius: 4,
                      background: 'var(--yt-bg-elevated)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    {project.thumbnailUrl ? (
                      <img
                        src={project.thumbnailUrl}
                        alt={project.name || 'Video thumbnail'}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : null}
                    {/* Play icon fallback shown when no thumbnail or img error */}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      style={{
                        color: 'var(--yt-text-secondary)',
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        pointerEvents: 'none',
                      }}
                      aria-hidden="true"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>

                  {/* Title + description */}
                  <div style={{ marginLeft: '16px' }}>
                    <div
                      style={{
                        fontSize: '14px',
                        fontWeight: 400,
                        color: 'var(--yt-text-primary)',
                        fontFamily: 'var(--font-yt)',
                        lineHeight: '20px',
                      }}
                    >
                      {project.name || 'Untitled'}
                    </div>
                    <div
                      style={{
                        fontSize: '12px',
                        color: '#3ea6ff',
                        marginTop: '2px',
                        fontFamily: 'var(--font-yt)',
                        cursor: 'pointer',
                      }}
                    >
                      Add description
                    </div>
                  </div>
                </div>
              </td>

              {/* Visibility */}
              <td
                style={{
                  fontSize: '14px',
                  color: 'var(--yt-text-primary)',
                  padding: '12px 16px',
                  verticalAlign: 'middle',
                  fontFamily: 'var(--font-yt)',
                }}
              >
                Private
              </td>

              {/* Restrictions */}
              <td
                style={{
                  fontSize: '14px',
                  color: 'var(--yt-text-primary)',
                  padding: '12px 16px',
                  verticalAlign: 'middle',
                  fontFamily: 'var(--font-yt)',
                }}
              >
                None
              </td>

              {/* Date */}
              <td
                style={{
                  fontSize: '12px',
                  color: 'var(--yt-text-secondary)',
                  padding: '12px 16px',
                  verticalAlign: 'middle',
                  fontFamily: 'var(--font-yt)',
                  whiteSpace: 'nowrap',
                }}
              >
                <div>{formatDate(project.created_at)}</div>
                <div style={{ fontSize: '12px', color: 'var(--yt-text-muted)' }}>Uploaded</div>
              </td>

              {/* Views */}
              <td
                style={{
                  fontSize: '12px',
                  color: 'var(--yt-text-secondary)',
                  padding: '12px 16px',
                  verticalAlign: 'middle',
                  fontFamily: 'var(--font-yt)',
                }}
              >
                0
              </td>

              {/* Comments */}
              <td
                style={{
                  fontSize: '12px',
                  color: 'var(--yt-text-secondary)',
                  padding: '12px 16px',
                  verticalAlign: 'middle',
                  fontFamily: 'var(--font-yt)',
                }}
              >
                0
              </td>

              {/* Likes */}
              <td
                style={{
                  fontSize: '12px',
                  color: 'var(--yt-text-secondary)',
                  padding: '12px 16px',
                  verticalAlign: 'middle',
                  fontFamily: 'var(--font-yt)',
                }}
              >
                &mdash;
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
