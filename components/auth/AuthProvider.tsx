'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { capture, identify, reset } from '@/lib/analytics';

const AuthContext = createContext<{ user: User | null; initialized: boolean }>({
  user: null,
  initialized: false,
});

export function useAuth() { return useContext(AuthContext); }

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setInitialized(true);
      if (data.user) {
        identify(data.user.id, { email: data.user.email ?? undefined });
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setInitialized(true);

      if (event === 'SIGNED_IN' && session?.user) {
        identify(session.user.id, { email: session.user.email ?? undefined });
        const createdMs = new Date(session.user.created_at).getTime();
        if (Date.now() - createdMs < 10_000) {
          const provider = (session.user.app_metadata?.provider as string | undefined) ?? 'email';
          capture('user_signed_up', { method: provider === 'google' ? 'google' : 'email' });
        }
      }

      if (event === 'SIGNED_OUT') {
        capture('user_signed_out', {});
        reset();
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ user, initialized }}>{children}</AuthContext.Provider>;
}
