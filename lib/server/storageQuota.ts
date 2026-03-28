import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  STORAGE_BUCKET,
  STORAGE_QUOTA_BYTES,
  type ManagedUploadKind,
  buildStorageQuotaSnapshot,
  projectStorageQuotaSnapshot,
} from '@/lib/storageQuota';

type StorageObjectRow = {
  name: string;
  metadata: unknown;
};

type ProjectSizeRow = {
  video_size: unknown;
};

type StorageUploadRow = {
  size_bytes: unknown;
};

const STORAGE_QUERY_PAGE_SIZE = 1000;
const STORAGE_REMOVE_CHUNK_SIZE = 100;

function getStorageObjectsTable() {
  return getSupabaseAdmin().schema('storage').from('objects');
}

function readObjectSize(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') return 0;
  const size = (metadata as { size?: unknown }).size;
  if (typeof size === 'number' && Number.isFinite(size)) return size;
  if (typeof size === 'string') {
    const parsed = Number(size);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function readStoredByteCount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

function getErrorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
}

function getErrorMessage(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';
}

function isRecoverableStorageQueryError(error: unknown) {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  return (
    code === '42P01' ||
    code === 'PGRST106' ||
    code === 'PGRST116' ||
    code === '42501' ||
    /relation .*storage\.objects.* does not exist/i.test(message) ||
    /schema .*storage.* does not exist/i.test(message) ||
    /permission denied/i.test(message) ||
    /not found/i.test(message)
  );
}

async function listObjectsByPrefix(prefix: string) {
  const rows: StorageObjectRow[] = [];
  let from = 0;

  while (true) {
    const to = from + STORAGE_QUERY_PAGE_SIZE - 1;
    const { data, error } = await getStorageObjectsTable()
      .select('name, metadata')
      .eq('bucket_id', STORAGE_BUCKET)
      .like('name', `${prefix}%`)
      .range(from, to);

    if (error) throw error;

    const page = (data ?? []) as StorageObjectRow[];
    rows.push(...page);

    if (page.length < STORAGE_QUERY_PAGE_SIZE) break;
    from += STORAGE_QUERY_PAGE_SIZE;
  }

  return rows;
}

async function getProjectStorageUsageBytes(userId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from('projects')
    .select('video_size')
    .eq('user_id', userId);

  if (error) throw error;
  return ((data ?? []) as ProjectSizeRow[]).reduce((total, row) => total + readStoredByteCount(row.video_size), 0);
}

async function getTrackedStorageUsageBytes(userId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from('storage_uploads')
    .select('size_bytes')
    .eq('user_id', userId);

  if (error) throw error;
  return ((data ?? []) as StorageUploadRow[]).reduce((total, row) => total + readStoredByteCount(row.size_bytes), 0);
}

export async function getStorageObjectSize(storagePath: string) {
  try {
    const { data, error } = await getStorageObjectsTable()
      .select('name, metadata')
      .eq('bucket_id', STORAGE_BUCKET)
      .eq('name', storagePath)
      .maybeSingle();

    if (error) throw error;
    return readObjectSize((data as StorageObjectRow | null)?.metadata);
  } catch (error) {
    if (!isRecoverableStorageQueryError(error)) throw error;
    console.warn('[storageQuota] falling back from storage object size lookup', {
      storagePath,
      code: getErrorCode(error),
      message: getErrorMessage(error),
    });
    return 0;
  }
}

export async function getUserStorageUsageBytes(userId: string) {
  let projectUsage = 0;
  try {
    projectUsage = await getProjectStorageUsageBytes(userId);
  } catch (error) {
    projectUsage = 0;
    if (!isRecoverableStorageQueryError(error)) throw error;
  }

  let trackedUsage = 0;
  try {
    trackedUsage = await getTrackedStorageUsageBytes(userId);
  } catch (error) {
    if (!isRecoverableStorageQueryError(error)) throw error;
    trackedUsage = 0;
  }

  try {
    const rows = await listObjectsByPrefix(`${userId}/`);
    const objectUsage = rows.reduce((total, row) => total + readObjectSize(row.metadata), 0);
    return Math.max(objectUsage, trackedUsage, projectUsage);
  } catch (error) {
    if (!isRecoverableStorageQueryError(error)) throw error;
    console.warn('[storageQuota] falling back to project metadata for quota calculation', {
      userId,
      code: getErrorCode(error),
      message: getErrorMessage(error),
    });
    return Math.max(trackedUsage, projectUsage);
  }
}

export async function getUserStorageQuotaSnapshot(userId: string) {
  const usedBytes = await getUserStorageUsageBytes(userId);
  return buildStorageQuotaSnapshot(usedBytes, STORAGE_QUOTA_BYTES);
}

export async function getProjectedQuotaSnapshot(userId: string, additionalBytes: number) {
  const current = await getUserStorageQuotaSnapshot(userId);
  return {
    current,
    projected: projectStorageQuotaSnapshot(current, additionalBytes),
  };
}

export async function removeStorageObjects(paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  if (uniquePaths.length === 0) return;

  const admin = getSupabaseAdmin();
  for (let index = 0; index < uniquePaths.length; index += STORAGE_REMOVE_CHUNK_SIZE) {
    const chunk = uniquePaths.slice(index, index + STORAGE_REMOVE_CHUNK_SIZE);
    const { error } = await admin.storage.from(STORAGE_BUCKET).remove(chunk);
    if (error) throw error;
  }
}

export async function upsertTrackedStorageUpload(input: {
  userId: string;
  projectId: string;
  storagePath: string;
  kind: ManagedUploadKind;
  sizeBytes: number;
}) {
  const { error } = await getSupabaseAdmin()
    .from('storage_uploads')
    .upsert({
      storage_path: input.storagePath,
      user_id: input.userId,
      project_id: input.projectId,
      upload_kind: input.kind,
      size_bytes: Math.max(0, input.sizeBytes),
    }, {
      onConflict: 'storage_path',
    });

  if (!error) return;
  if (isRecoverableStorageQueryError(error)) {
    console.warn('[storageQuota] skipping tracked upload upsert', {
      storagePath: input.storagePath,
      code: getErrorCode(error),
      message: getErrorMessage(error),
    });
    return;
  }
  throw error;
}

export async function removeTrackedStorageUploads(paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  if (uniquePaths.length === 0) return;

  const { error } = await getSupabaseAdmin()
    .from('storage_uploads')
    .delete()
    .in('storage_path', uniquePaths);

  if (!error) return;
  if (isRecoverableStorageQueryError(error)) {
    console.warn('[storageQuota] skipping tracked upload removal', {
      paths: uniquePaths,
      code: getErrorCode(error),
      message: getErrorMessage(error),
    });
    return;
  }
  throw error;
}

export async function removeProjectStorageObjects(userId: string, projectId: string) {
  const rows = await listObjectsByPrefix(`${userId}/${projectId}/`);
  await removeStorageObjects(rows.map((row) => row.name));
}
