'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseBrowser } from '@/lib/supabase/client';
const AuthContext = createContext<{ user: User | null; initialized: boolean }>({
  user: null,
  initialized: false,
});

export function useAuth() { return useContext(AuthContext); }

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    try {
      const supabase = getSupabaseBrowser();
      supabase.auth.getUser().then(({ data }) => {
        setUser(data.user);
        setInitialized(true);
      }).catch(() => {
        setInitialized(true);
      });
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        setUser(session?.user ?? null);
        setInitialized(true);
      });
      return () => subscription.unsubscribe();
    } catch {
      // Supabase not configured — run in unauthenticated mode
      queueMicrotask(() => setInitialized(true));
    }
  }, []);

  return <AuthContext.Provider value={{ user, initialized }}>{children}</AuthContext.Provider>;
}
