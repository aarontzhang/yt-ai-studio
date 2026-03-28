import { NextResponse } from 'next/server';
import { ensurePrimaryMediaAssetIfSupported } from '@/lib/analysisJobs';
import { buildProjectSources, extractReferencedSourceIdsFromClips } from '@/lib/projectSources';
import { getSupabaseServer } from '@/lib/supabase/server';
import type {
  CaptionEntry,
  ProjectSource,
  SourceIndexState,
} from '@/lib/types';

type ProjectRow = {
  id: string;
  user_id: string;
  video_path: string | null;
  video_filename: string | null;
  edit_state?: Record<string, unknown> | null;
};

type AssetLookupRow = {
  id: string;
  storage_path: string;
  status: ProjectSource['status'];
  indexed_at: string | null;
};

async function loadProjectAndSources(projectId: string, userId: string) {
  const supabase = await getSupabaseServer();
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, user_id, video_path, video_filename, edit_state')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle<ProjectRow>();

  if (projectError) throw projectError;
  return {
    project,
    sources: project ? buildProjectSources({
      persistedSources: Array.isArray(project.edit_state?.sources) ? project.edit_state?.sources : [],
      projectStoragePath: project.video_path,
      projectVideoFilename: project.video_filename,
      referencedSourceIds: extractReferencedSourceIdsFromClips(project.edit_state?.clips),
    }) : [],
  };
}

async function buildSourceIndexResponse(projectId: string, userId: string) {
  const supabase = await getSupabaseServer();
  const { project, sources } = await loadProjectAndSources(projectId, userId);

  if (!project || sources.length === 0) {
    return {
      sourceTranscriptCaptions: [],
      sourceIndexFreshBySourceId: {},
      sources: [],
    };
  }

  const storagePaths = sources
    .map((source) => source.storagePath)
    .filter((path): path is string => typeof path === 'string' && path.length > 0);

  const { data: assetRows, error: assetError } = await supabase
    .from('media_assets')
    .select('id, storage_path, status, indexed_at')
    .eq('project_id', projectId)
    .in('storage_path', storagePaths.length > 0 ? storagePaths : ['']);

  if (assetError) throw assetError;

  const assetByStoragePath = new Map(
    ((assetRows ?? []) as AssetLookupRow[]).map((asset) => [asset.storage_path, asset]),
  );

  const sourceIndexFreshBySourceId: Record<string, SourceIndexState> = {};
  const assetIdToSourceId = new Map<string, string>();
  const normalizedSources: Array<ProjectSource & { indexedAt: string | null }> = [];

  for (const source of sources) {
    let asset = source.storagePath ? assetByStoragePath.get(source.storagePath) ?? null : null;
    if (!asset && source.storagePath) {
      const ensuredAsset = await ensurePrimaryMediaAssetIfSupported(supabase, projectId, source.storagePath);
      if (ensuredAsset) {
        asset = {
          id: ensuredAsset.id,
          storage_path: ensuredAsset.storagePath,
          status: ensuredAsset.status,
          indexed_at: ensuredAsset.indexedAt,
        };
        assetByStoragePath.set(source.storagePath, asset);
      }
    }

    if (asset?.id) {
      assetIdToSourceId.set(asset.id, source.id);
    }

    sourceIndexFreshBySourceId[source.id] = {
      overview: false,
      transcript: false,
      version: 'source-index-v2',
      assetId: asset?.id ?? source.assetId ?? null,
      indexedAt: asset?.indexed_at ?? null,
    };

    normalizedSources.push({
      ...source,
      assetId: asset?.id ?? source.assetId ?? null,
      status: asset?.status ?? source.status ?? 'pending',
      indexedAt: asset?.indexed_at ?? null,
    });
  }

  const assetIds = Array.from(assetIdToSourceId.keys());
  if (assetIds.length === 0) {
    return {
      sourceTranscriptCaptions: [],
      sourceIndexFreshBySourceId,
      sources: normalizedSources,
    };
  }

  const { data: transcriptRows, error: transcriptError } = await supabase
    .from('asset_transcript_words')
    .select('asset_id, start_time, end_time, text')
    .in('asset_id', assetIds)
    .order('start_time', { ascending: true });

  if (transcriptError) throw transcriptError;

  const sourceTranscriptCaptions: CaptionEntry[] = ((transcriptRows ?? []) as Array<{
    asset_id: string;
    start_time: number;
    end_time: number;
    text: string;
  }>).flatMap((row) => {
    const sourceId = assetIdToSourceId.get(row.asset_id);
    if (!sourceId) return [];
    sourceIndexFreshBySourceId[sourceId] = {
      ...sourceIndexFreshBySourceId[sourceId],
      transcript: true,
    };
    return [{
      sourceId,
      startTime: Number(row.start_time ?? 0),
      endTime: Number(row.end_time ?? row.start_time ?? 0),
      text: String(row.text ?? ''),
    }];
  });

  return {
    sourceTranscriptCaptions,
    sourceIndexFreshBySourceId,
    sources: normalizedSources,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const payload = await buildSourceIndexResponse(id, user.id);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load source index';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
