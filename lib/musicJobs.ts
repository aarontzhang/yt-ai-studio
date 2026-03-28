import { SupabaseClient } from '@supabase/supabase-js';
import type { MusicCue, MusicGenerationState } from './types';

function isMissingRelationError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';
  const message = typeof error === 'object' && error !== null && 'message' in error ? String((error as { message?: unknown }).message) : '';
  return code === '42P01' || /relation .* does not exist/i.test(message);
}

function isUniqueViolationError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';
  return code === '23505';
}

function mapJobToState(row: Record<string, unknown>): Partial<MusicGenerationState> {
  const progress = row.progress && typeof row.progress === 'object'
    ? row.progress as Record<string, unknown>
    : null;

  const statusMap: Record<string, MusicGenerationState['status']> = {
    queued: 'classifying',
    running: 'generating',
    completed: 'completed',
    failed: 'failed',
  };

  return {
    jobId: typeof row.id === 'string' ? row.id : null,
    status: statusMap[String(row.status)] ?? 'idle',
    error: typeof row.error === 'string' ? row.error : null,
    progress: progress && typeof progress.stage === 'string'
      ? {
          stage: String(progress.stage),
          completed: Number(progress.completed ?? 0),
          total: Math.max(1, Number(progress.total ?? 1)),
        }
      : null,
  };
}

function mapCueRow(row: Record<string, unknown>): MusicCue {
  return {
    id: String(row.id),
    musicSegmentId: String(row.music_segment_id),
    sourceStart: Number(row.source_start),
    sourceEnd: Number(row.source_end),
    durationSeconds: Number(row.duration_seconds),
    mood: row.mood as MusicCue['mood'],
    energy: row.energy as MusicCue['energy'],
    genreHints: Array.isArray(row.genre_hints) ? row.genre_hints.map(String) : [],
    storagePath: row.storage_path ? String(row.storage_path) : null,
    signedUrl: null,
    status: (row.status as MusicCue['status']) ?? 'suggested',
    volumeDb: row.volume_db != null ? Number(row.volume_db) : -18,
    fadeInSeconds: row.fade_in_seconds != null ? Number(row.fade_in_seconds) : 1.0,
    fadeOutSeconds: row.fade_out_seconds != null ? Number(row.fade_out_seconds) : 1.5,
  };
}

/**
 * Create a generate_music job for the given asset, or return the existing active one.
 */
export async function ensureMusicGenerationJob(
  supabase: SupabaseClient,
  projectId: string,
  assetId: string,
): Promise<MusicGenerationState | null> {
  try {
    // Check for an existing active music generation job
    const { data: existing, error: existingError } = await supabase
      .from('analysis_jobs')
      .select('id, status, error, progress')
      .eq('project_id', projectId)
      .eq('asset_id', assetId)
      .eq('job_type', 'generate_music')
      .in('status', ['queued', 'running', 'paused'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) {
      const partial = mapJobToState(existing);
      return {
        jobId: partial.jobId ?? null,
        status: partial.status ?? 'classifying',
        error: partial.error ?? null,
        segments: [],
        cues: [],
        progress: partial.progress ?? null,
      };
    }

    // Create a new job
    let inserted: Record<string, unknown> | null = null;
    try {
      const insertResult = await supabase
        .from('analysis_jobs')
        .insert({
          project_id: projectId,
          asset_id: assetId,
          job_type: 'generate_music',
          status: 'queued',
          pause_requested: false,
          progress: {
            stage: 'classifying_segments',
            completed: 0,
            total: 1,
            label: 'Queued for music generation',
            etaSeconds: null,
          },
        })
        .select('id, status, error, progress')
        .single();

      if (insertResult.error) throw insertResult.error;
      inserted = insertResult.data as Record<string, unknown> | null;
    } catch (error) {
      if (!isUniqueViolationError(error)) throw error;

      // Race condition: another request created the job concurrently
      const { data: concurrentJob, error: concurrentError } = await supabase
        .from('analysis_jobs')
        .select('id, status, error, progress')
        .eq('project_id', projectId)
        .eq('asset_id', assetId)
        .eq('job_type', 'generate_music')
        .in('status', ['queued', 'running', 'paused'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (concurrentError) throw concurrentError;
      if (concurrentJob) {
        const partial = mapJobToState(concurrentJob);
        return {
          jobId: partial.jobId ?? null,
          status: partial.status ?? 'classifying',
          error: partial.error ?? null,
          segments: [],
          cues: [],
          progress: partial.progress ?? null,
        };
      }
      throw error;
    }

    if (!inserted) return null;
    const partial = mapJobToState(inserted);
    return {
      jobId: partial.jobId ?? null,
      status: partial.status ?? 'classifying',
      error: partial.error ?? null,
      segments: [],
      cues: [],
      progress: partial.progress ?? null,
    };
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

/**
 * Get the latest music generation job state for an asset.
 */
export async function getLatestMusicJobForAsset(
  supabase: SupabaseClient,
  projectId: string,
  assetId: string,
): Promise<Partial<MusicGenerationState> | null> {
  try {
    const { data, error } = await supabase
      .from('analysis_jobs')
      .select('id, status, error, progress')
      .eq('project_id', projectId)
      .eq('asset_id', assetId)
      .eq('job_type', 'generate_music')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data ? mapJobToState(data) : null;
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

/**
 * Fetch all music cues for a project.
 */
export async function fetchMusicCues(
  supabase: SupabaseClient,
  projectId: string,
): Promise<MusicCue[]> {
  try {
    const { data, error } = await supabase
      .from('music_cues')
      .select('*')
      .eq('project_id', projectId)
      .order('source_start', { ascending: true });

    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => mapCueRow(row));
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

/**
 * Delete all music cues for a project.
 */
export async function deleteAllMusicCues(
  supabase: SupabaseClient,
  projectId: string,
): Promise<void> {
  const { error } = await supabase
    .from('music_cues')
    .delete()
    .eq('project_id', projectId);

  if (error && !isMissingRelationError(error)) throw error;
}

/**
 * Update a single music cue's status or settings.
 */
export async function updateMusicCueStatus(
  supabase: SupabaseClient,
  cueId: string,
  patch: { status?: MusicCue['status']; volume_db?: number; fade_in_seconds?: number; fade_out_seconds?: number },
): Promise<void> {
  const { error } = await supabase
    .from('music_cues')
    .update(patch)
    .eq('id', cueId);

  if (error) throw error;
}
