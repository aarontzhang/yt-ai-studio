'use client';

import {
  formatStorageBytes,
  getQuotaWarningMessage,
  type StorageQuotaSnapshot,
} from '@/lib/storageQuota';

interface StorageQuotaBannerProps {
  quota: StorageQuotaSnapshot | null;
  loading?: boolean;
  title?: string;
  message?: string | null;
  compact?: boolean;
  showUsageSummary?: boolean;
}

function getColors(warningLevel: StorageQuotaSnapshot['warningLevel'] | undefined) {
  if (warningLevel === 'limit') {
    return {
      border: 'rgba(248,113,113,0.35)',
      background: 'rgba(127,29,29,0.28)',
      meter: '#f87171',
      text: '#fecaca',
      subtext: 'rgba(254,202,202,0.85)',
    };
  }
  if (warningLevel === 'critical') {
    return {
      border: 'rgba(251,191,36,0.35)',
      background: 'rgba(120,53,15,0.24)',
      meter: '#f59e0b',
      text: '#fde68a',
      subtext: 'rgba(253,230,138,0.85)',
    };
  }
  if (warningLevel === 'warning') {
    return {
      border: 'rgba(250,204,21,0.28)',
      background: 'rgba(113,63,18,0.22)',
      meter: '#eab308',
      text: '#fef08a',
      subtext: 'rgba(254,240,138,0.82)',
    };
  }
  return {
    border: 'rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.03)',
    meter: 'var(--accent)',
    text: 'var(--fg-primary)',
    subtext: 'var(--fg-secondary)',
  };
}

export default function StorageQuotaBanner({
  quota,
  loading = false,
  title = 'Storage',
  message = null,
  compact = false,
  showUsageSummary = true,
}: StorageQuotaBannerProps) {
  if (!quota && !message) return null;

  const colors = getColors(quota?.warningLevel);
  const resolvedMessage = message ?? (quota ? getQuotaWarningMessage(quota) : '');
  const shouldShowUsageSummary = Boolean(quota) && showUsageSummary;
  const progressWidth = quota ? `${quota.usedBytes > 0 ? Math.max(4, quota.usageRatio * 100) : 0}%` : '0%';
  const padding = compact ? '10px 12px' : '14px 16px';

  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        background: colors.background,
        borderRadius: compact ? 10 : 12,
        padding,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <p style={{ margin: 0, fontSize: compact ? 12 : 13, fontWeight: 600, color: colors.text }}>
            {title}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: compact ? 11 : 12, color: colors.subtext }}>
            {loading && !quota
              ? 'Loading storage usage...'
              : shouldShowUsageSummary && quota
              ? `${formatStorageBytes(quota.usedBytes)} of ${formatStorageBytes(quota.limitBytes)} used`
              : resolvedMessage}
          </p>
        </div>
        {shouldShowUsageSummary && quota && (
          <p style={{ margin: 0, fontSize: compact ? 11 : 12, color: colors.subtext }}>
            {Math.round(quota.usageRatio * 100)}%
          </p>
        )}
      </div>

      {shouldShowUsageSummary && quota && (
        <>
          <div
            style={{
              marginTop: compact ? 8 : 10,
              height: 6,
              borderRadius: 999,
              background: 'rgba(255,255,255,0.08)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: progressWidth,
                height: '100%',
                borderRadius: 999,
                background: colors.meter,
                transition: 'width 0.2s ease',
              }}
            />
          </div>
          {resolvedMessage && (
            <p style={{ margin: compact ? '8px 0 0' : '10px 0 0', fontSize: compact ? 11 : 12, color: colors.subtext }}>
              {resolvedMessage}
            </p>
          )}
        </>
      )}
    </div>
  );
}
