import { getSupabaseBrowser } from '@/lib/supabase/client';
import {
  STORAGE_FILE_LIMIT_BYTES,
  getFileSizeErrorMessage,
  type StorageQuotaSnapshot,
} from '@/lib/storageQuota';

export interface UploadResult {
  projectId: string;
  storagePath: string;
  quota: StorageQuotaSnapshot | null;
}

async function readErrorMessage(response: Response) {
  const data = await response.json().catch(() => null);
  return typeof data?.error === 'string' ? data.error : `Request failed with HTTP ${response.status}`;
}

export async function uploadVideoToSupabase(
  file: File,
  onProgress?: (pct: number) => void,
  durationSeconds?: number,
): Promise<UploadResult> {
  let projectId: string | null = null;

  if (file.size > STORAGE_FILE_LIMIT_BYTES) {
    throw new Error(getFileSizeErrorMessage());
  }

  const initiateRes = await fetch('/api/uploads/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'project-main',
      fileName: file.name,
      fileSize: file.size,
      contentType: file.type || 'video/mp4',
    }),
  });
  if (!initiateRes.ok) throw new Error(await readErrorMessage(initiateRes));
  const initiated = await initiateRes.json();
  projectId = initiated.projectId;
  if (!projectId) {
    throw new Error('Upload initialization failed to return a project ID');
  }
  const storagePath = initiated.storagePath as string;
  const supabase = getSupabaseBrowser();

  onProgress?.(5);

  onProgress?.(10);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uploadOptions: any = {
    upsert: false,
    contentType: file.type || 'video/mp4',
    onUploadProgress: (progress: { loaded: number; total?: number }) => {
      if (!onProgress || !progress.total) return;
      // Map the actual upload bytes to 10–95% of the overall progress
      const pct = Math.round((progress.loaded / progress.total) * 85);
      onProgress(10 + pct);
    },
  };
  const { error: uploadErr } = await supabase.storage
    .from('videos')
    .uploadToSignedUrl(storagePath, initiated.token, file, uploadOptions);

  if (uploadErr) {
    console.error('[uploadVideo] Signed upload failed:', uploadErr);
    if (projectId) {
      await fetch(`/api/projects/${projectId}`, { method: 'DELETE' }).catch(() => undefined);
    }
    if ('status' in uploadErr && uploadErr.status === 413) {
      throw new Error(getFileSizeErrorMessage());
    }
    throw new Error(`Upload failed: ${uploadErr.message}. Check that the "videos" bucket exists and allows authenticated uploads.`);
  }
  onProgress?.(100);

  const finalizeRes = await fetch('/api/uploads/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'project-main',
      projectId,
      storagePath,
      fileName: file.name,
      fileSize: file.size,
      durationSeconds,
    }),
  });
  if (!finalizeRes.ok) {
    const errorMessage = await readErrorMessage(finalizeRes);
    console.error('[uploadVideo] Failed to finalize upload:', finalizeRes.status, errorMessage);
    if (projectId && finalizeRes.status !== 413) {
      await fetch(`/api/projects/${projectId}`, { method: 'DELETE' }).catch(() => undefined);
    }
    throw new Error(errorMessage);
  }
  const finalized = await finalizeRes.json();

  return { projectId, storagePath, quota: finalized.quota ?? null };
}
