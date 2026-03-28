'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import posthog from 'posthog-js';

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY || process.env.NODE_ENV !== 'production') return;
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      api_host: '/ingest',
      ui_host: 'https://us.posthog.com',
      autocapture: false,
      capture_pageview: false,
      capture_performance: false,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY || process.env.NODE_ENV !== 'production') return;
    posthog.capture('$pageview', { $current_url: window.location.href });
  }, [pathname]);

  return <>{children}</>;
}
