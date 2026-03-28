'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NewProjectPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled Project', edit_state: {} }),
      });

      if (!res.ok || cancelled) {
        router.replace('/projects');
        return;
      }

      const { id } = await res.json();
      if (!cancelled) router.replace(`/editor?project=${id}`);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
