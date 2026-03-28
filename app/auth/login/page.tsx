'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import YouTubeAIStudioMark from '@/components/branding/YouTubeAIStudioMark';
export default function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
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

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next);
    setError('');
    setNotice('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    const supabase = getSupabaseBrowser();
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setNotice('Check your email for a confirmation link to complete sign-up.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push('/projects');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
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
          <YouTubeAIStudioMark size={32} />
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.025em', color: 'rgba(255,255,255,0.92)' }}>
            YouTube AI Studio
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
            AI-powered video editing, natively integrated into your upload workflow.
          </p>
        </div>

        {/* Bottom quote */}
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.18)', margin: 0 }}>
          © 2025 YouTube AI Studio
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
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </h1>
          <p style={{
            fontSize: 14,
            color: 'rgba(255,255,255,0.35)',
            margin: '0 0 28px',
          }}>
            {mode === 'signin' ? 'Sign in to continue.' : 'Create an account to get started.'}
          </p>

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
              {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', margin: '20px 0 0', textAlign: 'center' }}>
            {mode === 'signin' ? (
              <>
                Don&apos;t have an account?{' '}
                <button
                  onClick={() => switchMode('signup')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(33,212,255,0.75)', fontSize: 13, padding: 0, fontFamily: 'inherit' }}
                >
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  onClick={() => switchMode('signin')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(33,212,255,0.75)', fontSize: 13, padding: 0, fontFamily: 'inherit' }}
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
