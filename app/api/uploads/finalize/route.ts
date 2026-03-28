import { NextRequest, NextResponse } from 'next/server';
import { ensureAssetIndexingJob, ensurePrimaryMediaAssetIfSupported } from '@/lib/analysisJobs';
import {
  buildProjectSources,
  extractReferencedSourceIdsFromClips,
  upsertProjectSource,
} from '@/lib/projectSources';
import {
  getStorageObjectSize,
  getUserStorageQuotaSnapshot,
  removeStorageObjects,
  removeTrackedStorageUploads,
  upsertTrackedStorageUpload,
} from '@/lib/server/storageQuota';
import { readStoredVideoDurationSeconds } from '@/lib/server/videoDuration';
import { getSupabaseServer } from '@/lib/supabase/server';
import {
  MAX_UPLOAD_VIDEO_DURATION_SECONDS,
  STORAGE_QUOTA_BYTES,
  getQuotaErrorMessage,
  getVideoDurationLimitErrorMessage,
  type ManagedUploadKind,
} from '@/lib/storageQuota';
import { enforceRateLimit, enforceSameOrigin, getRateLimitIdentity } from '@/lib/server/requestSecurity';
import { MAIN_SOURCE_ID, normalizeSourceId } from '@/lib/sourceUtils';

function isUploadKind(value: unknown): value is ManagedUploadKind {
  return value === 'project-main' || value === 'main' || value === 'sources' || value === 'tracks';
}

function isExpectedStoragePath(userId: string, projectId: string, kind: ManagedUploadKind, storagePath: string) {
  if (!storagePath.startsWith(`${userId}/${projectId}/`)) return false;
  if (kind === 'project-main') {
    const remainder = storagePath.slice(`${userId}/${projectId}/`.length);
    return remainder.length > 0 && !remainder.includes('/');
  }
  return storagePath.includes(`/${kind}/`);
}

export async function POST(request: NextRequest) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) return csrfError;

  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rateLimitError = enforceRateLimit({
    key: `uploads-finalize:${getRateLimitIdentity(request.headers, user.id)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimitError) return rateLimitError;

  const body = await request.json().catch(() => ({}));
  const kind = body.kind;
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const storagePath = typeof body.storagePath === 'string' ? body.storagePath : '';
  const fileName = typeof body.fileName === 'string' ? body.fileName : null;
  const fileSize = typeof body.fileSize === 'number' && Number.isFinite(body.fileSize) ? Math.max(0, body.fileSize) : null;
  const requestedSourceId = normalizeSourceId(body.sourceId);
  const clientDurationSeconds = typeof body.durationSeconds === 'number' && Number.isFinite(body.durationSeconds)
    ? Math.max(0, body.durationSeconds)
    : null;

  if (!isUploadKind(kind) || !projectId || !storagePath || !isExpectedStoragePath(user.id, projectId, kind, storagePath)) {
    return NextResponse.json({ error: 'Invalid finalize request' }, { status: 400 });
  }
  if (kind === 'sources' && !requestedSourceId) {
    return NextResponse.json({ error: 'Missing source ID for uploaded source' }, { status: 400 });
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, video_path, video_filename, edit_state')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single();

  if (projectError || !project) {
    return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 });
  }

  let uploadedSize = await getStorageObjectSize(storagePath);
  if (uploadedSize <= 0 && fileSize && fileSize > 0) {
    uploadedSize = fileSize;
  }
  if (uploadedSize <= 0) {
    return NextResponse.json({ error: 'Uploaded file not found' }, { status: 404 });
  }

  try {
    await upsertTrackedStorageUpload({
      userId: user.id,
      projectId,
      storagePath,
      kind,
      sizeBytes: uploadedSize,
    });
  } catch (trackError) {
    console.error('[uploads.finalize] failed to track storage upload', trackError);
  }

  let quota: Awaited<ReturnType<typeof getUserStorageQuotaSnapshot>> | null = null;
  try {
    quota = await getUserStorageQuotaSnapshot(user.id);
  } catch (quotaError) {
    console.error('[uploads.finalize] failed to get quota snapshot', quotaError);
  }
  if (quota && quota.usedBytes > STORAGE_QUOTA_BYTES) {
    await removeStorageObjects([storagePath]);
    await removeTrackedStorageUploads([storagePath]);

    if (kind === 'project-main') {
      await supabase.from('projects').delete().eq('id', projectId).eq('user_id', user.id);
    }

    return NextResponse.json({
      error: getQuotaErrorMessage(quota),
      quota,
    }, { status: 413 });
  }

  const rejectOverlongUpload = async () => {
    await removeStorageObjects([storagePath]);
    await removeTrackedStorageUploads([storagePath]);

    if (kind === 'project-main') {
      await supabase.from('projects').delete().eq('id', projectId).eq('user_id', user.id);
    }

    return NextResponse.json({
      error: getVideoDurationLimitErrorMessage(),
    }, { status: 413 });
  };

  let effectiveDurationSeconds = clientDurationSeconds ?? 0;
  try {
    const probedDurationSeconds = await readStoredVideoDurationSeconds(supabase, storagePath);
    effectiveDurationSeconds = probedDurationSeconds > 0
      ? probedDurationSeconds
      : (clientDurationSeconds ?? 0);
    if (effectiveDurationSeconds > MAX_UPLOAD_VIDEO_DURATION_SECONDS) {
      return rejectOverlongUpload();
    }
  } catch (durationError) {
    console.warn('[uploads.finalize] failed to validate uploaded video duration; continuing with client-side duration fallback', durationError);
    if ((clientDurationSeconds ?? 0) > MAX_UPLOAD_VIDEO_DURATION_SECONDS) {
      return rejectOverlongUpload();
    }
  }

  let assetId: string | null = null;
  if (kind === 'project-main' || kind === 'main') {
    const { data: latestProject, error: latestProjectError } = await supabase
      .from('projects')
      .select('video_path, video_filename, edit_state')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();
    if (latestProjectError || !latestProject) {
      return NextResponse.json({ error: latestProjectError?.message ?? 'Project not found' }, { status: 404 });
    }

    const nextSources = upsertProjectSource(
      buildProjectSources({
        persistedSources: Array.isArray(latestProject.edit_state?.sources) ? latestProject.edit_state.sources : [],
        projectStoragePath: latestProject.video_path,
        projectVideoFilename: latestProject.video_filename,
        referencedSourceIds: extractReferencedSourceIdsFromClips(latestProject.edit_state?.clips),
      }),
      MAIN_SOURCE_ID,
      {
        fileName: fileName?.trim() || latestProject.video_filename?.trim() || 'Main video',
        storagePath,
        assetId: null,
        duration: effectiveDurationSeconds,
        status: 'pending',
        isPrimary: true,
      },
    );
    const { error: updateError } = await supabase
      .from('projects')
      .update({
        video_path: storagePath,
        video_filename: fileName,
        video_size: uploadedSize,
        edit_state: {
          ...(latestProject.edit_state ?? {}),
          sources: nextSources,
        },
      })
      .eq('id', projectId)
      .eq('user_id', user.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    try {
      const asset = await ensurePrimaryMediaAssetIfSupported(supabase, projectId, storagePath);
      assetId = asset?.id ?? null;
      if (asset?.id) {
        await ensureAssetIndexingJob(supabase, projectId, asset.id);
      }
    } catch (assetError) {
      console.error('[uploads.finalize] failed to initialize media asset record', assetError);
    }
  } else if (kind === 'sources') {
    try {
      const asset = await ensurePrimaryMediaAssetIfSupported(supabase, projectId, storagePath);
      assetId = asset?.id ?? null;
      if (asset?.id) {
        await ensureAssetIndexingJob(supabase, projectId, asset.id);
      }
    } catch (assetError) {
      console.error('[uploads.finalize] failed to initialize source media asset record', assetError);
    }

    const { data: latestProject, error: latestProjectError } = await supabase
      .from('projects')
      .select('video_path, video_filename, edit_state')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();
    if (latestProjectError || !latestProject) {
      return NextResponse.json({ error: latestProjectError?.message ?? 'Project not found' }, { status: 404 });
    }

    const nextSources = upsertProjectSource(
      buildProjectSources({
        persistedSources: Array.isArray(latestProject.edit_state?.sources) ? latestProject.edit_state.sources : [],
        projectStoragePath: latestProject.video_path,
        projectVideoFilename: latestProject.video_filename,
        referencedSourceIds: extractReferencedSourceIdsFromClips(latestProject.edit_state?.clips),
      }),
      requestedSourceId!,
      {
        fileName: fileName?.trim() || `Source ${requestedSourceId}`,
        storagePath,
        assetId,
        duration: effectiveDurationSeconds,
        status: assetId ? 'indexing' : 'pending',
      },
    );

    const { error: updateError } = await supabase
      .from('projects')
      .update({
        edit_state: {
          ...(latestProject.edit_state ?? {}),
          sources: nextSources,
        },
      })
      .eq('id', projectId)
      .eq('user_id', user.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    quota,
    uploadedSize,
    assetId,
  });
}
