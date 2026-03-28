export const STORAGE_BUCKET = 'videos';
export const STORAGE_QUOTA_BYTES = 20_000_000_000;
export const STORAGE_FILE_LIMIT_BYTES = 4_000_000_000;
export const STORAGE_WARNING_RATIO = 0.8;
export const STORAGE_CRITICAL_RATIO = 0.95;
export const MAX_UPLOAD_VIDEO_DURATION_SECONDS = 2 * 60 * 60;

export type StorageQuotaWarningLevel = 'none' | 'warning' | 'critical' | 'limit';
export type ManagedUploadKind = 'project-main' | 'main' | 'sources' | 'tracks';

export interface StorageQuotaSnapshot {
  usedBytes: number;
  limitBytes: number;
  remainingBytes: number;
  usageRatio: number;
  warningLevel: StorageQuotaWarningLevel;
}

function toFiniteNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

export function sanitizeStorageName(name: string) {
  return name.replace(/[^\w.\-]+/g, '_');
}

export function buildProjectStoragePath(input: {
  userId: string;
  projectId: string;
  fileName: string;
  kind: ManagedUploadKind;
}) {
  const sanitizedFileName = sanitizeStorageName(input.fileName);
  if (input.kind === 'project-main') {
    return `${input.userId}/${input.projectId}/${sanitizedFileName}`;
  }

  return `${input.userId}/${input.projectId}/${input.kind}/${Date.now()}_${sanitizedFileName}`;
}

export function getStorageWarningLevel(usedBytes: number, limitBytes = STORAGE_QUOTA_BYTES): StorageQuotaWarningLevel {
  if (usedBytes >= limitBytes) return 'limit';
  if (usedBytes >= limitBytes * STORAGE_CRITICAL_RATIO) return 'critical';
  if (usedBytes >= limitBytes * STORAGE_WARNING_RATIO) return 'warning';
  return 'none';
}

export function buildStorageQuotaSnapshot(usedBytes: number, limitBytes = STORAGE_QUOTA_BYTES): StorageQuotaSnapshot {
  const safeUsedBytes = Math.max(0, toFiniteNumber(usedBytes));
  const safeLimitBytes = Math.max(1, toFiniteNumber(limitBytes));
  const remainingBytes = Math.max(0, safeLimitBytes - safeUsedBytes);

  return {
    usedBytes: safeUsedBytes,
    limitBytes: safeLimitBytes,
    remainingBytes,
    usageRatio: Math.min(safeUsedBytes / safeLimitBytes, 1),
    warningLevel: getStorageWarningLevel(safeUsedBytes, safeLimitBytes),
  };
}

export function projectStorageQuotaSnapshot(snapshot: StorageQuotaSnapshot, additionalBytes: number) {
  return buildStorageQuotaSnapshot(snapshot.usedBytes + Math.max(0, additionalBytes), snapshot.limitBytes);
}

export function formatStorageBytes(bytes: number) {
  const safeBytes = Math.max(0, toFiniteNumber(bytes));
  if (safeBytes >= 1_000_000_000) return `${(safeBytes / 1_000_000_000).toFixed(1)} GB`;
  if (safeBytes >= 1_000_000) return `${(safeBytes / 1_000_000).toFixed(0)} MB`;
  if (safeBytes >= 1_000) return `${(safeBytes / 1_000).toFixed(0)} KB`;
  return `${safeBytes.toFixed(0)} B`;
}

export function getQuotaErrorMessage(snapshot: StorageQuotaSnapshot) {
  return `Storage limit reached. You are using ${formatStorageBytes(snapshot.usedBytes)} of ${formatStorageBytes(snapshot.limitBytes)}. Delete older projects or media to free space before uploading more.`;
}

export function getFileSizeErrorMessage(limitBytes = STORAGE_FILE_LIMIT_BYTES) {
  return `Each uploaded video must be ${formatStorageBytes(limitBytes)} or smaller. Compress the file or split it into smaller clips before uploading.`;
}

export function getVideoDurationLimitErrorMessage() {
  return 'Autocut currently supports up to 2 hours per uploaded video.';
}

export function getQuotaWarningMessage(snapshot: StorageQuotaSnapshot) {
  const limitLabel = formatStorageBytes(snapshot.limitBytes);
  if (snapshot.warningLevel === 'critical') {
    return `Storage is almost full. ${formatStorageBytes(snapshot.remainingBytes)} remaining before the ${limitLabel} cap.`;
  }
  if (snapshot.warningLevel === 'warning') {
    return `Storage is above ${Math.round(STORAGE_WARNING_RATIO * 100)}%. ${formatStorageBytes(snapshot.remainingBytes)} remaining before uploads are blocked.`;
  }
  if (snapshot.warningLevel === 'limit') {
    return getQuotaErrorMessage(snapshot);
  }
  return '';
}
