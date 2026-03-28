'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase/client';

const AVATAR_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#06b6d4'];

function avatarColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatProvider(provider: unknown) {
  if (provider === 'google') return 'Google';
  if (provider === 'email') return 'Email';
  if (typeof provider !== 'string' || provider.length === 0) return 'Email';
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export default function UserProfileMenu({
  user,
  dashboardLabel = 'Go to Dashboard',
}: {
  user: User;
  dashboardLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const email = user.email ?? 'Account';
  const name = useMemo(() => {
    const metadata = user.user_metadata ?? {};
    return metadata.full_name ?? metadata.name ?? email;
  }, [email, user.user_metadata]);
  const avatarUrl = useMemo(() => {
    const metadata = user.user_metadata ?? {};
    return metadata.avatar_url ?? metadata.picture ?? null;
  }, [user.user_metadata]);
  const provider = formatProvider(user.app_metadata?.provider ?? user.identities?.[0]?.provider);
  const initial = name[0]?.toUpperCase() ?? email[0]?.toUpperCase() ?? '?';
  const showPhoto = !!avatarUrl && !imgError;

  const handleSignOut = async () => {
    await getSupabaseBrowser().auth.signOut();
    router.push('/auth/login');
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(value => !value)}
        title={email}
        style={{
          width: 30,
          height: 30,
          borderRadius: '50%',
          background: showPhoto ? 'transparent' : avatarColor(email),
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {showPhoto ? (
          <img
            src={avatarUrl}
            alt=""
            width={30}
            height={30}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={() => setImgError(true)}
          />
        ) : (
          initial
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 38,
            right: 0,
            zIndex: 100,
            minWidth: 240,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 10px 28px rgba(0,0,0,0.35)',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: showPhoto ? 'transparent' : avatarColor(email),
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {showPhoto ? (
                <img
                  src={avatarUrl}
                  alt=""
                  width={34}
                  height={34}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                initial
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <p
                style={{
                  fontSize: 12,
                  color: 'var(--fg-primary)',
                  fontWeight: 600,
                  margin: '0 0 3px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {name}
              </p>
              <p
                style={{
                  fontSize: 11,
                  color: 'var(--fg-muted)',
                  margin: '0 0 4px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {email}
              </p>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px 6px',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  fontSize: 10,
                  color: 'var(--fg-secondary)',
                }}
              >
                {provider}
              </span>
            </div>
          </div>

          <button
            onClick={() => {
              setOpen(false);
              router.push('/projects');
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '10px 14px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--fg-secondary)',
              fontSize: 12,
              textAlign: 'left',
            }}
            onMouseEnter={event => {
              event.currentTarget.style.background = 'var(--bg-elevated)';
              event.currentTarget.style.color = 'var(--fg-primary)';
            }}
            onMouseLeave={event => {
              event.currentTarget.style.background = 'none';
              event.currentTarget.style.color = 'var(--fg-secondary)';
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
            {dashboardLabel}
          </button>

          <button
            onClick={handleSignOut}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '10px 14px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--fg-secondary)',
              fontSize: 12,
              textAlign: 'left',
            }}
            onMouseEnter={event => {
              event.currentTarget.style.background = 'var(--bg-elevated)';
              event.currentTarget.style.color = '#f87171';
            }}
            onMouseLeave={event => {
              event.currentTarget.style.background = 'none';
              event.currentTarget.style.color = 'var(--fg-secondary)';
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
