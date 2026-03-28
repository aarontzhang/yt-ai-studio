'use client';

import { useCallback, useEffect, useState } from 'react';
import type { StorageQuotaSnapshot } from '@/lib/storageQuota';

export function useStorageQuota(enabled = true) {
  const [quota, setQuota] = useState<StorageQuotaSnapshot | null>(null);
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setQuota(null);
      setLoading(false);
      return null;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/storage/quota', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Failed to load quota (${response.status})`);
      const data = await response.json();
      const nextQuota = (data?.quota ?? null) as StorageQuotaSnapshot | null;
      setQuota(nextQuota);
      return nextQuota;
    } catch (error) {
      console.warn('Failed to load storage quota:', error);
      return null;
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    quota,
    loading,
    refresh,
    setQuota,
  };
}
