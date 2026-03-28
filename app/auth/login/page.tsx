'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import AutocutMark from '@/components/branding/AutocutMark';
import { capture } from '@/lib/analytics';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { user } = useAuth();

  useEffect(() => {
    if (user) router.replace('/projects');
  }, [router, user]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const routeError = params.get('error');
    const routeMessage = params.get('message');
    setError(routeError ?? '');
    setNotice(routeMessage ?? '');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    const supabase = getSupabaseBrowser();
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      capture('user_signed_in', { method: 'email' });
      router.push('/projects');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setNotice('');
    const supabase = getSupabaseBrowser();
    capture('user_signed_in', { method: 'google' });
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      fontFamily: 'var(--font-serif), system-ui, sans-serif',
      background: '#111111',
    }}>
      <style>{`
        .auth-input {
          width: 100%;
          padding: 11px 14px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          color: rgba(255,255,255,0.92);
          font-size: 14px;
          font-family: inherit;
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.15s;
        }
        .auth-input:focus { border-color: rgba(33,212,255,0.45); }
        .auth-input::placeholder { color: rgba(255,255,255,0.22); }
        .auth-google-btn {
          width: 100%;
          padding: 11px 14px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          cursor: pointer;
          color: rgba(255,255,255,0.82);
          font-size: 14px;
          font-family: inherit;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          font-weight: 500;
          transition: background 0.15s, border-color 0.15s;
        }
        .auth-google-btn:hover {
          background: rgba(255,255,255,0.08);
          border-color: rgba(255,255,255,0.18);
        }
        .auth-back {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 13px;
          color: rgba(255,255,255,0.35);
          text-decoration: none;
          transition: color 0.15s;
        }
        .auth-back:hover { color: rgba(255,255,255,0.65); }

        /* Hide left panel on small screens */
        @media (max-width: 768px) {
          .auth-left { display: none !important; }
          .auth-right { border-left: none !important; }
        }
      `}</style>

      {/* ── Left: branding panel ─────────────────────── */}
      <div className="auth-left" style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '40px 56px',
        borderRight: '1px solid rgba(255,255,255,0.07)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Subtle glow — centered behind the headline text */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 600,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(33,212,255,0.07) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AutocutMark size={32} withTile />
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.025em', color: 'rgba(255,255,255,0.92)' }}>
            Autocut
          </span>
        </div>

        {/* Headline */}
        <div>
          <p style={{
            fontSize: 'clamp(32px, 3vw, 48px)',
            fontWeight: 700,
            letterSpacing: '-0.035em',
            lineHeight: 1.1,
            color: 'rgba(255,255,255,0.92)',
            margin: '0 0 20px',
            maxWidth: 480,
          }}>
            Edit your videos<br />by describing them.
          </p>
          <p style={{
            fontSize: 15,
            color: 'rgba(255,255,255,0.38)',
            lineHeight: 1.65,
            margin: 0,
            maxWidth: 400,
          }}>
            Tell Autocut what to cut. It finds the moments and applies every edit directly to your timeline.
          </p>
        </div>

        {/* Bottom quote */}
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.18)', margin: 0 }}>
          © 2025 Autocut
        </p>
      </div>

      {/* ── Right: form panel ────────────────────────── */}
      <div className="auth-right" style={{
        width: '100%',
        maxWidth: 520,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 48px',
        borderLeft: '1px solid rgba(255,255,255,0.07)',
      }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          {/* Back link */}
          <Link href="/" className="auth-back" style={{ marginBottom: 40, display: 'inline-flex' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back to home
          </Link>

          {/* Heading */}
          <h1 style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            color: 'rgba(255,255,255,0.92)',
            margin: '0 0 6px',
          }}>
            Sign in
          </h1>
          <p style={{
            fontSize: 14,
            color: 'rgba(255,255,255,0.35)',
            margin: '0 0 28px',
          }}>
            Sign in to continue editing.
          </p>

          <button onClick={handleGoogle} className="auth-google-btn" style={{ marginBottom: 20 }}>
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.22)' }}>or</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="auth-input"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="auth-input"
            />

            {error && (
              <p style={{ fontSize: 13, color: '#f87171', margin: '2px 0 0', lineHeight: 1.5 }}>{error}</p>
            )}
            {notice && (
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: '2px 0 0', lineHeight: 1.5 }}>{notice}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="iridescent-button"
              style={{
                padding: '11px 14px',
                borderRadius: 8,
                cursor: loading ? 'default' : 'pointer',
                fontSize: 14,
                fontWeight: 600,
                marginTop: 4,
                fontFamily: 'inherit',
                transition: 'filter 0.15s, box-shadow 0.15s',
              }}
            >
              {loading ? 'Please wait…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
