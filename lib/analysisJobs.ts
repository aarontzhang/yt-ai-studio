import { SupabaseClient } from '@supabase/supabase-js';
import { MediaAsset } from './types';

function isMissingRelationError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';
  const message = typeof error === 'object' && error !== null && 'message' in error ? String((error as { message?: unknown }).message) : '';
  return code === '42P01' || /relation .* does not exist/i.test(message);
}

function isUniqueViolationError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';
  return code === '23505';
}

function mapAsset(row: Record<string, unknown>): MediaAsset {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    storagePath: String(row.storage_path),
    sourceDuration: row.duration_seconds == null ? null : Number(row.duration_seconds),
    fps: row.fps == null ? null : Number(row.fps),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    status: row.status as MediaAsset['status'],
    createdAt: String(row.created_at),
    indexedAt: row.indexed_at ? String(row.indexed_at) : null,
  };
}

export async function ensurePrimaryMediaAsset(
  supabase: SupabaseClient,
  projectId: string,
  storagePath: string,
): Promise<MediaAsset> {
  const { data: existing, error: fetchError } = await supabase
    .from('media_assets')
    .select('*')
    .eq('project_id', projectId)
    .eq('storage_path', storagePath)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (existing) return mapAsset(existing);

  const { data: inserted, error: insertError } = await supabase
    .from('media_assets')
    .insert({
      project_id: projectId,
      storage_path: storagePath,
      status: 'pending',
    })
    .select('*')
    .single();

  if (insertError || !inserted) {
    throw insertError ?? new Error('Failed to create media asset');
  }

  return mapAsset(inserted);
}

export async function getPrimaryMediaAsset(
  supabase: SupabaseClient,
  projectId: string,
): Promise<MediaAsset | null> {
  const { data, error } = await supabase
    .from('media_assets')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
  return data ? mapAsset(data) : null;
}

export async function ensurePrimaryMediaAssetIfSupported(
  supabase: SupabaseClient,
  projectId: string,
  storagePath: string,
): Promise<MediaAsset | null> {
  try {
    return await ensurePrimaryMediaAsset(supabase, projectId, storagePath);
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

