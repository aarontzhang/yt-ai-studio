import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import {
  STORAGE_FILE_LIMIT_BYTES,
  buildProjectStoragePath,
  getFileSizeErrorMessage,
  getQuotaErrorMessage,
  type ManagedUploadKind,
} from '@/lib/storageQuota';
import { getProjectedQuotaSnapshot } from '@/lib/server/storageQuota';
import { enforceRateLimit, enforceSameOrigin, getRateLimitIdentity } from '@/lib/server/requestSecurity';

function isUploadKind(value: unknown): value is ManagedUploadKind {
  return value === 'project-main' || value === 'main' || value === 'sources' || value === 'tracks';
}

export async function POST(request: NextRequest) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) return csrfError;

  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rateLimitError = enforceRateLimit({
    key: `uploads-initiate:${getRateLimitIdentity(request.headers, user.id)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimitError) return rateLimitError;

  const body = await request.json().catch(() => ({}));
  const kind = body.kind;
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const fileSize = typeof body.fileSize === 'number' && Number.isFinite(body.fileSize) ? Math.max(0, body.fileSize) : 0;

  if (!isUploadKind(kind) || !fileName || fileSize <= 0) {
    return NextResponse.json({ error: 'Invalid upload request' }, { status: 400 });
  }

  if (fileSize > STORAGE_FILE_LIMIT_BYTES) {
    return NextResponse.json({
      error: getFileSizeErrorMessage(),
    }, { status: 413 });
  }

  let projectId = typeof body.projectId === 'string' ? body.projectId : null;
  if (kind === 'project-main') {
    const { data: created, error: createError } = await supabase
      .from('projects')
      .insert({
        user_id: user.id,
        name: fileName.replace(/\.[^.]+$/, '') || 'Untitled Project',
        video_path: null,
        video_filename: fileName,
        video_size: fileSize,
        edit_state: {},
      })
      .select('id')
      .single();

    if (createError || !created) {
      return NextResponse.json({ error: createError?.message ?? 'Failed to create project' }, { status: 500 });
    }
    projectId = created.id;
  } else if (projectId) {
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 });
    }
  } else {
    return NextResponse.json({ error: 'Project ID is required' }, { status: 400 });
  }

  let quota: Awaited<ReturnType<typeof getProjectedQuotaSnapshot>> | null = null;
  try {
    quota = await getProjectedQuotaSnapshot(user.id, fileSize);
  } catch (quotaError) {
    console.error('[uploads.initiate] quota check failed, proceeding without limit enforcement', quotaError);
  }
  if (quota && quota.projected.usedBytes > quota.projected.limitBytes) {
    if (kind === 'project-main' && projectId) {
      await supabase.from('projects').delete().eq('id', projectId).eq('user_id', user.id);
    }

    return NextResponse.json({
      error: getQuotaErrorMessage(quota.current),
      quota,
    }, { status: 413 });
  }

  const storagePath = buildProjectStoragePath({
    userId: user.id,
    projectId: projectId!,
    fileName,
    kind,
  });

  const { data: signedData, error: signError } = await supabase.storage
    .from('videos')
    .createSignedUploadUrl(storagePath, {
      upsert: false,
    });

  if (signError || !signedData) {
    if (kind === 'project-main' && projectId) {
      await supabase.from('projects').delete().eq('id', projectId).eq('user_id', user.id);
    }

    return NextResponse.json({
      error: signError?.message ?? 'Failed to create upload URL',
    }, { status: 500 });
  }

  return NextResponse.json({
    projectId,
    storagePath,
    token: signedData.token,
    quota,
  });
}
