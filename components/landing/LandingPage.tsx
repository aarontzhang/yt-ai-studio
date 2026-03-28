'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AutocutMark from '@/components/branding/AutocutMark';
import { useAuth } from '@/components/auth/AuthProvider';

const VIDEO_IMAGE = '/landing/hero-gopro-ski.jpg';
const SIGN_IN_HREF = '/auth/login';

type HeroTrackSegment = {
  w: string;
  ml?: string;
};

type HeroTrack = {
  label: string;
  segs: HeroTrackSegment[];
  color: string;
  opacity?: number;
};

type TimelineTrackSegment = {
  l: string;
  w: string;
};

type TimelineTrack = {
  label: string;
  segs: TimelineTrackSegment[];
  color: string;
  opacity?: number;
};

/* ─── Reusable window chrome ─────────────────────────────────── */

function AppWindow({
  children,
  style,
  accent = false,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  accent?: boolean;
}) {
  return (
    <div style={{
      background: '#0d0d0d',
      borderRadius: 10,
      border: accent
        ? '1px solid rgba(33, 212, 255, 0.22)'
        : '1px solid rgba(255,255,255,0.09)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      ...style,
    }}>
      {/* macOS chrome */}
      <div style={{
        height: 36,
        background: '#161616',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 7,
        flexShrink: 0,
      }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#3a3a3a' }} />
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#3a3a3a' }} />
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#3a3a3a' }} />
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          marginRight: 52,
        }}>
          <AutocutMark size={14} withTile />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.01em' }}>Autocut</span>
        </div>
      </div>
      {children}
    </div>
  );
}

/* ─── Full editor mock (hero) ────────────────────────────────── */

function HeroEditorMock() {
  const tracks: HeroTrack[] = [
    { label: 'video', segs: [{ w: '28%' }, { w: '38%', ml: '30%' }, { w: '24%', ml: '72%' }], color: 'linear-gradient(90deg,#149bff,#67e8ff)' },
    { label: 'audio', segs: [{ w: '96%' }], color: 'linear-gradient(90deg,#18acff,#82f0ff)', opacity: 0.7 },
    { label: 'text', segs: [{ w: '16%', ml: '4%' }], color: 'linear-gradient(90deg,#7c3aed,#a78bfa)' },
  ];

  return (
    <AppWindow accent style={{ flex: 1, minHeight: 0 }}>
      {/* App top bar */}
      <div style={{
        height: 38,
        background: '#141414',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 8,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 2 }}>
          {[1, 2].map(i => (
            <div key={i} style={{
              width: 22, height: 22, borderRadius: 5,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {i === 1
                ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 7L5 4l3 3" stroke="rgba(255,255,255,0.3)" strokeWidth="1.4" strokeLinecap="round" /></svg>
                : <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M8 7L5 4 2 7" stroke="rgba(255,255,255,0.3)" strokeWidth="1.4" strokeLinecap="round" /></svg>
              }
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{
          height: 22, padding: '0 10px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 5,
          display: 'flex', alignItems: 'center',
          fontSize: 10, color: 'rgba(255,255,255,0.35)',
          gap: 5,
        }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#4ade80' }} />
          Export
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left: video + timeline */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          minWidth: 0,
        }}>
          {/* Video player */}
          <div style={{ flex: 1, position: 'relative', background: '#080808', minHeight: 0, overflow: 'hidden' }}>
            <img
              src={VIDEO_IMAGE}
              alt="Video being edited"
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover',
                objectPosition: 'center top',
              }}
            />
            {/* Playback overlay */}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
              padding: '28px 10px 8px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M2 1.5l5 2.5-5 2.5V1.5z" fill="rgba(255,255,255,0.8)" />
                  </svg>
                </div>
                <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.6)' }}>0:13 / 7:42</span>
              </div>
              <div style={{ height: 2, background: 'rgba(255,255,255,0.15)', borderRadius: 1, position: 'relative' }}>
                <div style={{ width: '28%', height: '100%', background: '#21d4ff', borderRadius: 1 }} />
                <div style={{
                  position: 'absolute', top: '50%', left: '28%',
                  transform: 'translate(-50%, -50%)',
                  width: 8, height: 8, borderRadius: '50%',
                  background: '#21d4ff',
                  boxShadow: '0 0 6px rgba(33,212,255,0.7)',
                }} />
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div style={{
            height: 80,
            background: '#111111',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            padding: '8px 8px 0',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}>
            <div style={{ display: 'flex', gap: 2, marginBottom: 1, paddingLeft: 40 }}>
              {['0:00', '', '0:30', '', '1:00', '', '1:30'].map((t, i) => (
                <div key={i} style={{ flex: 1, fontSize: 8, color: 'rgba(255,255,255,0.2)' }}>{t}</div>
              ))}
            </div>
            {tracks.map(track => (
              <div key={track.label} style={{ display: 'flex', alignItems: 'center', height: 14 }}>
                <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)', width: 38, textAlign: 'right', paddingRight: 6, flexShrink: 0 }}>{track.label}</span>
                <div style={{ flex: 1, height: '100%', background: 'rgba(255,255,255,0.04)', borderRadius: 2, position: 'relative' }}>
                  {track.segs.map((seg, i) => (
                    <div key={i} style={{
                      position: 'absolute', top: 0, bottom: 0,
                      left: seg.ml ?? '0%', width: seg.w,
                      background: track.color, borderRadius: 2, opacity: track.opacity ?? 1,
                    }} />
                  ))}
                  {track.label === 'video' && (
                    <div style={{ position: 'absolute', left: '38%', top: -16, bottom: -20, width: 1, background: 'rgba(255,255,255,0.5)' }} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: chat sidebar */}
        <div style={{
          width: 230,
          display: 'flex',
          flexDirection: 'column',
          background: '#0e0e0e',
          flexShrink: 0,
        }}>
          <div style={{
            flex: 1,
            padding: '12px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            justifyContent: 'flex-end',
            overflowY: 'hidden',
          }}>
            {/* User message */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{
                background: 'rgba(255,255,255,0.07)',
                borderRadius: '8px 8px 2px 8px',
                padding: '7px 10px',
                fontSize: 11,
                color: 'rgba(255,255,255,0.75)',
                maxWidth: '88%',
                lineHeight: 1.5,
              }}>
                Cut the slower parts and keep the best turns
              </div>
            </div>

            {/* AI message */}
            <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
              <div style={{ flexShrink: 0, marginTop: 1 }}>
                <AutocutMark size={16} withTile />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 8, lineHeight: 1.5 }}>
                  Found 12 downhill moments. Ready to review.
                </div>
                <div style={{
                  background: '#1a1a1a',
                  border: '1px solid rgba(255,255,255,0.09)',
                  borderRadius: 7,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    padding: '8px 10px',
                    display: 'flex', alignItems: 'center', gap: 6,
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Delete ranges</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>12 trims</span>
                  </div>
                  <div style={{ padding: '7px 10px' }}>
                    <button style={{
                      width: '100%', padding: '6px',
                      background: 'rgba(33,212,255,0.1)',
                      border: '1px solid rgba(33,212,255,0.28)',
                      borderRadius: 5, fontSize: 11, fontWeight: 500,
                      color: '#21d4ff', cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                      Start review →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{
            padding: '8px 10px 10px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}>
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 7,
              padding: '8px 10px',
              fontSize: 10.5,
              color: 'rgba(255,255,255,0.2)',
            }}>
              Find moments, place markers, and review cuts…
            </div>
          </div>
        </div>
      </div>
    </AppWindow>
  );
}

/* ─── Chat flow mock (feature 1) ─────────────────────────────── */

function ChatFlowMock() {
  return (
    <AppWindow accent style={{ width: '100%' }}>
      <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Exchange 1: find markers */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{
            background: 'rgba(255,255,255,0.07)',
            borderRadius: '8px 8px 2px 8px',
            padding: '8px 12px', fontSize: 12,
            color: 'rgba(255,255,255,0.75)', maxWidth: '78%', lineHeight: 1.5,
          }}>
            Find every time I mention the pricing
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <AutocutMark size={16} withTile />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8, lineHeight: 1.5 }}>
              Found 3 moments. Markers placed.
            </div>
            <div style={{
              background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 7, overflow: 'hidden', maxWidth: 280,
            }}>
              <div style={{
                padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#facc15', flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Add markers</span>
                <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>@1 @2 @3</span>
              </div>
              <div style={{ padding: '0 12px 8px', display: 'flex', gap: 5 }}>
                {['@1 · 1:24', '@2 · 3:07', '@3 · 5:51'].map(m => (
                  <div key={m} style={{
                    fontSize: 10, color: '#21d4ff',
                    background: 'rgba(33,212,255,0.08)',
                    border: '1px solid rgba(33,212,255,0.2)',
                    borderRadius: 4, padding: '2px 6px',
                  }}>{m}</div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Exchange 2: delete range */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{
            background: 'rgba(255,255,255,0.07)',
            borderRadius: '8px 8px 2px 8px',
            padding: '8px 12px', fontSize: 12,
            color: 'rgba(255,255,255,0.75)', maxWidth: '78%', lineHeight: 1.5,
          }}>
            Cut the first 20 seconds, the intro is too slow
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <AutocutMark size={16} withTile />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8, lineHeight: 1.5 }}>Done.</div>
            <div style={{
              background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 7, overflow: 'hidden', maxWidth: 280,
            }}>
              <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Delete range</span>
                <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>0:00 to 0:20</span>
              </div>
              <div style={{ padding: '0 12px 8px', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                Auto-applied ✓
              </div>
            </div>
          </div>
        </div>

      </div>
    </AppWindow>
  );
}

/* ─── Timeline mock (feature 2) ─────────────────────────────── */

function TimelineMock() {
  const tracks: TimelineTrack[] = [
    {
      label: 'video',
      segs: [{ l: '0%', w: '28%' }, { l: '30%', w: '38%' }, { l: '72%', w: '24%' }],
      color: 'linear-gradient(90deg,#149bff,#67e8ff)',
    },
    {
      label: 'audio',
      segs: [{ l: '0%', w: '97%' }],
      color: 'linear-gradient(90deg,#18acff,#82f0ff)',
      opacity: 0.7,
    },
    {
      label: 'text',
      segs: [{ l: '4%', w: '18%' }, { l: '55%', w: '12%' }],
      color: 'linear-gradient(90deg,#7c3aed,#a78bfa)',
    },
  ];

  return (
    <AppWindow accent style={{ width: '100%' }}>
      <div style={{ padding: '14px 12px 18px' }}>
        {/* Ruler */}
        <div style={{
          display: 'flex', paddingLeft: 74, marginBottom: 8,
        }}>
          {['0:00', '1:00', '2:00', '3:00', '4:00', '5:00', '6:00', '7:42'].map(t => (
            <div key={t} style={{ flex: 1, fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>{t}</div>
          ))}
        </div>

        {/* Tracks */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {tracks.map(track => (
            <div key={track.label} style={{ display: 'flex', alignItems: 'center', height: 20 }}>
              <div style={{ width: 68, flexShrink: 0, fontSize: 9.5, color: 'rgba(255,255,255,0.22)', textAlign: 'right', paddingRight: 8 }}>
                {track.label}
              </div>
              <div style={{ flex: 1, height: '100%', background: 'rgba(255,255,255,0.03)', borderRadius: 3, position: 'relative' }}>
                {track.segs.map((seg, i) => (
                  <div key={i} style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: seg.l, width: seg.w,
                    background: track.color, borderRadius: 3,
                    opacity: track.opacity ?? 1,
                  }} />
                ))}
                {track.label === 'video' && (
                  <div style={{ position: 'absolute', left: '38%', top: -36, bottom: -62, width: 1, background: 'rgba(255,255,255,0.4)', zIndex: 5 }} />
                )}
              </div>
            </div>
          ))}

          {/* Markers row */}
          <div style={{ display: 'flex', alignItems: 'center', height: 18, marginTop: 2 }}>
            <div style={{ width: 68, flexShrink: 0 }} />
            <div style={{ flex: 1, position: 'relative', height: '100%' }}>
              {[{ pos: '19%', label: '@1' }, { pos: '38%', label: '@2' }, { pos: '62%', label: '@3' }].map(m => (
                <div key={m.label} style={{
                  position: 'absolute', top: '50%', left: m.pos,
                  transform: 'translate(-50%,-50%)',
                  fontSize: 8.5, fontWeight: 700, color: '#21d4ff',
                  background: 'rgba(33,212,255,0.12)',
                  border: '1px solid rgba(33,212,255,0.3)',
                  borderRadius: 3, padding: '1px 4px',
                }}>{m.label}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppWindow>
  );
}

/* ─── Main page ─────────────────────────────────────────────── */

export default function LandingPage() {
  const router = useRouter();
  const { user, initialized } = useAuth();

  useEffect(() => {
    if (!initialized || !user) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/projects', { cache: 'no-store' });
        if (!response.ok) {
          if (!cancelled) router.replace('/new');
          return;
        }

        const projects = await response.json();
        const latestProjectId = Array.isArray(projects) && typeof projects[0]?.id === 'string'
          ? projects[0].id
          : null;

        if (cancelled) return;
        router.replace(latestProjectId ? `/editor?project=${latestProjectId}` : '/new');
      } catch {
        if (!cancelled) router.replace('/new');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialized, router, user]);

  if (initialized && user) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#111111',
        color: 'rgba(255,255,255,0.92)',
        fontFamily: 'var(--font-serif), system-ui, sans-serif',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <AutocutMark size={36} withTile />
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Opening your editor…</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#111111',
      color: 'rgba(255,255,255,0.92)',
      fontFamily: 'var(--font-serif), system-ui, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      overflowX: 'hidden',
    }}>
      <style>{`
        .lp-nav { padding: 0 48px; }
        .lp-footer { padding: 20px 48px; }

        .lp-hero {
          display: grid;
          grid-template-columns: 380px 1fr;
          min-height: 100vh;
          padding: 0 64px;
          gap: 56px;
          align-items: stretch;
        }
        .lp-hero-graphic {
          padding: 86px 0 32px;
          display: flex;
          align-items: stretch;
        }

        .lp-feat {
          border-top: 1px solid rgba(255,255,255,0.05);
          display: grid;
          align-items: center;
          padding: 80px 64px;
          gap: 72px;
        }
        .lp-feat-1 { grid-template-columns: 1fr 340px; }
        .lp-feat-2 { grid-template-columns: 340px 1fr; }

        .lp-quote {
          border-top: 1px solid rgba(255,255,255,0.05);
          padding: 80px 64px;
          text-align: center;
        }

        /* ── Tablet: proportional columns ── */
        @media (max-width: 1100px) {
          .lp-hero {
            grid-template-columns: minmax(260px, 35%) 1fr;
            padding: 0 40px;
            gap: 40px;
          }
          .lp-feat {
            padding: 64px 40px;
            gap: 48px;
          }
          .lp-feat-1 { grid-template-columns: 1fr minmax(240px, 300px); }
          .lp-feat-2 { grid-template-columns: minmax(240px, 300px) 1fr; }
          .lp-quote { padding: 64px 40px; }
          .lp-nav { padding: 0 40px; }
          .lp-footer { padding: 20px 40px; }
        }

        /* ── Small tablet: equal columns ── */
        @media (max-width: 860px) {
          .lp-hero {
            grid-template-columns: 1fr 1fr;
            padding: 0 32px;
            gap: 32px;
          }
          .lp-feat {
            grid-template-columns: 1fr 1fr !important;
            padding: 56px 32px;
            gap: 40px;
          }
          .lp-quote { padding: 56px 32px; }
          .lp-nav { padding: 0 32px; }
          .lp-footer { padding: 20px 32px; }
        }

        /* ── Mobile: single column ── */
        @media (max-width: 640px) {
          .lp-hero {
            grid-template-columns: 1fr;
            padding: 0 20px 48px;
            min-height: auto;
            gap: 36px;
          }
          .lp-hero-graphic { padding: 0; }
          .lp-feat {
            grid-template-columns: 1fr !important;
            padding: 48px 20px;
            gap: 28px;
          }
          .lp-feat .lp-feat-graphic { order: 1; }
          .lp-quote { padding: 48px 20px; }
          .lp-nav { padding: 0 20px; }
          .lp-footer {
            padding: 16px 20px;
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
          }
          .lp-footer-contact {
            margin-left: 0 !important;
            text-align: left !important;
            max-width: none !important;
          }
        }
      `}</style>

      {/* ── Nav ─────────────────────────────────────────────── */}
      <nav className="lp-nav" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 54,
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        background: 'rgba(17,17,17,0.92)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <AutocutMark size={32} withTile />
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>Autocut</span>
        </div>
        <Link href={SIGN_IN_HREF} className="iridescent-button" style={{
          display: 'inline-block', padding: '8px 20px',
          borderRadius: 20, fontSize: 13, fontWeight: 600,
          textDecoration: 'none', letterSpacing: '-0.01em',
        }}>
          Sign in
        </Link>
      </nav>

      {/* ── Hero: text LEFT, graphic RIGHT ───────────────────── */}
      <section className="lp-hero">
        <div style={{
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          paddingTop: 112, paddingBottom: 48,
        }}>
          <h1 style={{
            fontSize: 'clamp(36px, 3.4vw, 56px)',
            fontWeight: 700,
            letterSpacing: '-0.035em',
            lineHeight: 1.08,
            margin: '0 0 20px',
          }}>
            Edit your videos<br />by describing them.
          </h1>
          <p style={{
            fontSize: 16, color: 'rgba(255,255,255,0.42)',
            lineHeight: 1.65, margin: '0 0 36px',
          }}>
            Tell Autocut what you want changed. Cut the filler, trim a section, place markers. It finds the right moments and applies every edit directly to your timeline.
          </p>
          <div>
            <Link href={SIGN_IN_HREF} className="iridescent-button" style={{
              display: 'inline-block', padding: '12px 28px',
              borderRadius: 24, fontSize: 14, fontWeight: 600,
              textDecoration: 'none', letterSpacing: '-0.01em',
            }}>
              Sign in →
            </Link>
          </div>
        </div>

        <div className="lp-hero-graphic">
          <HeroEditorMock />
        </div>
      </section>

      {/* ── Feature 1: graphic LEFT, text RIGHT ──────────────── */}
      <section className="lp-feat lp-feat-1">
        <div className="lp-feat-graphic">
          <ChatFlowMock />
        </div>
        <div>
          <h2 style={{
            fontSize: 'clamp(28px, 2.8vw, 42px)',
            fontWeight: 700, letterSpacing: '-0.03em',
            lineHeight: 1.1, margin: '0 0 18px',
          }}>
            Type it.<br />Review it.<br />Done.
          </h2>
          <p style={{
            fontSize: 15, color: 'rgba(255,255,255,0.42)',
            lineHeight: 1.7, margin: 0,
          }}>
            Each edit is proposed as an action card. Step through the cuts one at a time, keep what works, skip what doesn&apos;t. Nothing commits until you say so.
          </p>
        </div>
      </section>

      {/* ── Feature 2: text LEFT, graphic RIGHT ──────────────── */}
      <section className="lp-feat lp-feat-2">
        <div>
          <h2 style={{
            fontSize: 'clamp(28px, 2.8vw, 42px)',
            fontWeight: 700, letterSpacing: '-0.03em',
            lineHeight: 1.1, margin: '0 0 18px',
          }}>
            Every edit,<br />exactly placed.
          </h2>
          <p style={{
            fontSize: 15, color: 'rgba(255,255,255,0.42)',
            lineHeight: 1.7, margin: 0,
          }}>
            Cuts and text overlays land on the timeline precisely. Markers let you jump to any tagged moment before committing. You stay in control of every change.
          </p>
        </div>
        <div className="lp-feat-graphic">
          <TimelineMock />
        </div>
      </section>

      {/* ── Pull quote + CTA ─────────────────────────────────── */}
      <section className="lp-quote">
        <p style={{
          fontSize: 'clamp(24px, 3.2vw, 44px)',
          fontWeight: 600,
          letterSpacing: '-0.03em',
          lineHeight: 1.18,
          color: 'rgba(255,255,255,0.88)',
          maxWidth: 640,
          margin: '0 auto 40px',
        }}>
          The best creators spend their time creating, not clicking through timelines.
        </p>
        <Link href={SIGN_IN_HREF} className="iridescent-button" style={{
          display: 'inline-block', padding: '13px 32px',
          borderRadius: 26, fontSize: 14, fontWeight: 600,
          textDecoration: 'none', letterSpacing: '-0.01em',
        }}>
          Sign in →
        </Link>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="lp-footer" style={{
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AutocutMark size={20} withTile />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.35)' }}>Autocut</span>
        </div>
        <p className="lp-footer-contact" style={{
          margin: '0 0 0 auto',
          maxWidth: 460,
          fontSize: 14,
          fontWeight: 500,
          lineHeight: 1.45,
          letterSpacing: '-0.02em',
          textAlign: 'right',
          color: 'rgba(255,255,255,0.52)',
        }}>
          Interested? Text me, the founder, personally at{' '}
          <a
            href="tel:5087456868"
            style={{
              color: 'inherit',
              textDecoration: 'none',
            }}
          >
            508-745-6868
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
