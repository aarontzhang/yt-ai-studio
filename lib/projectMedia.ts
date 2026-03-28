import { getSupabaseBrowser } from '@/lib/supabase/client';
import { STORAGE_FILE_LIMIT_BYTES, getFileSizeErrorMessage } from '@/lib/storageQuota';

async function readErrorMessage(response: Response) {
  const data = await response.json().catch(() => null);
  return typeof data?.error === 'string' ? data.error : `Request failed with HTTP ${response.status}`;
}

export async function uploadProjectMedia(
  file: File,
  projectId: string,
  folder: 'main' | 'sources' | 'tracks' = 'sources',
  durationSeconds?: number,
  sourceId?: string,
) {
  if (file.size > STORAGE_FILE_LIMIT_BYTES) {
    throw new Error(getFileSizeErrorMessage());
  }

  const initiateRes = await fetch('/api/uploads/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: folder,
      projectId,
      fileName: file.name,
      fileSize: file.size,
      contentType: file.type || 'video/mp4',
    }),
  });
  if (!initiateRes.ok) throw new Error(await readErrorMessage(initiateRes));

  const initiated = await initiateRes.json();
  const storagePath = initiated.storagePath as string;
  const token = initiated.token as string;

  const supabase = getSupabaseBrowser();
  const { error: uploadError } = await supabase.storage
    .from('videos')
    .uploadToSignedUrl(storagePath, token, file, { contentType: file.type || 'video/mp4' });
  if (uploadError) throw new Error(uploadError.message);

  const finalizeRes = await fetch('/api/uploads/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: folder,
      projectId,
      storagePath,
      fileName: file.name,
      fileSize: file.size,
      durationSeconds,
      sourceId,
    }),
  });
  if (!finalizeRes.ok) throw new Error(await readErrorMessage(finalizeRes));

  const finalized = await finalizeRes.json();

  return {
    storagePath,
    assetId: typeof finalized?.assetId === 'string' ? finalized.assetId : null,
    uploadedSize: typeof finalized?.uploadedSize === 'number' ? finalized.uploadedSize : null,
    quota: finalized?.quota ?? null,
  };
}

export async function createSignedUrls(paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  if (uniquePaths.length === 0) return new Map<string, string>();

  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.storage.from('videos').createSignedUrls(uniquePaths, 3600);
  if (error || !data) throw error ?? new Error('Failed to create signed URLs');

  const result = new Map<string, string>();
  for (const entry of data) {
    if (entry.path && entry.signedUrl) result.set(entry.path, entry.signedUrl);
  }
  return result;
}
