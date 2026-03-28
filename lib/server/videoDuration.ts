import { SupabaseClient } from '@supabase/supabase-js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { STORAGE_BUCKET } from '@/lib/storageQuota';

const execFileAsync = promisify(execFile);

export async function readStoredVideoDurationSeconds(
  supabase: Pick<SupabaseClient, 'storage'>,
  storagePath: string,
): Promise<number> {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(storagePath);
  if (error || !data) {
    throw error ?? new Error(`Failed to download ${storagePath}.`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autocut-duration-'));
  const filePath = path.join(tempDir, path.basename(storagePath) || 'video.mp4');

  try {
    const arrayBuffer = await data.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(arrayBuffer));

    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-print_format', 'json',
      '-show_entries', 'format=duration',
      filePath,
    ]);

    const parsed = JSON.parse(stdout) as { format?: { duration?: string | number } };
    const duration = Number(parsed.format?.duration ?? 0);
    return Number.isFinite(duration) ? duration : 0;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
