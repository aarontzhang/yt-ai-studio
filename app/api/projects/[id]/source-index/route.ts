import { NextRequest, NextResponse } from 'next/server';
import { ensureAssetIndexingJob, ensurePrimaryMediaAssetIfSupported } from '@/lib/analysisJobs';
import { buildProjectSources, extractReferencedSourceIdsFromClips } from '@/lib/projectSources';
import { getSupabaseServer } from '@/lib/supabase/server';
import type {
  AnalysisProgress,
  AnalysisJobStatus,
  CaptionEntry,
  ProjectSource,
  SourceIndexAnalysisState,
  SourceIndexAnalysisStateMap,
  SourceIndexState,
  SourceIndexTaskState,
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

type AnalysisJobRow = {
  id: string;
  status: AnalysisJobStatus;
  error: string | null;
  progress: AnalysisProgress | null;
  result: Record<string, unknown> | null;
  pause_requested: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseProgress(value: unknown): AnalysisProgress | null {
  const record = asRecord(value);
  if (!record || typeof record.stage !== 'string') return null;
  const completed = toFiniteNumber(record.completed, NaN);
  const total = toFiniteNumber(record.total, NaN);
  if (!Number.isFinite(completed) || !Number.isFinite(total)) return null;
  return {
    stage: record.stage as AnalysisProgress['stage'],
    completed,
    total: Math.max(1, total),
    label: typeof record.label === 'string' ? record.label : null,
    etaSeconds: Number.isFinite(record.etaSeconds) ? Number(record.etaSeconds) : null,
  };
}

async function getLatestAnalysisJobRow(
  projectId: string,
  assetId: string,
): Promise<AnalysisJobRow | null> {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase
    .from('analysis_jobs')
    .select('id, status, error, progress, result, pause_requested')
    .eq('project_id', projectId)
    .eq('asset_id', assetId)
    .eq('job_type', 'index_asset')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: String(data.id),
    status: data.status as AnalysisJobStatus,
    error: typeof data.error === 'string' ? data.error : null,
    progress: parseProgress(data.progress),
    result: asRecord(data.result),
    pause_requested: data.pause_requested === true,
  };
}

function clampFraction(value: number) {
  return Math.max(0, Math.min(1, value));
}

function getProgressFraction(progress: AnalysisProgress | null) {
  if (!progress || progress.total <= 0) return 0;
  return clampFraction(progress.completed / progress.total);
}

function getTranscriptCheckpoint(result: Record<string, unknown> | null) {
  const transcript = asRecord(result?.transcript);
  const completedChunkKeys = Array.isArray(transcript?.completedChunkKeys)
    ? transcript!.completedChunkKeys.filter((value): value is string => typeof value === 'string')
    : [];
  return {
    totalChunks: Math.max(1, toFiniteNumber(transcript?.totalChunks, completedChunkKeys.length || 1)),
    completedChunkKeys,
  };
}

function getVisualCheckpoint(result: Record<string, unknown> | null) {
  const visual = asRecord(result?.visual);
  return {
    plannedWindowCount: Math.max(0, toFiniteNumber(visual?.plannedWindowCount, 0)),
    plannedSceneCount: Math.max(0, toFiniteNumber(visual?.plannedSceneCount, 0)),
  };
}

function buildTaskState(input: {
  status: SourceIndexTaskState['status'];
  completed: number;
  total: number;
  etaSeconds?: number | null;
  reason?: string | null;
}): SourceIndexTaskState {
  return {
    status: input.status,
    completed: Math.max(0, Math.min(input.completed, Math.max(1, input.total))),
    total: Math.max(1, input.total),
    etaSeconds: Number.isFinite(input.etaSeconds) ? Number(input.etaSeconds) : null,
    reason: typeof input.reason === 'string' && input.reason.trim().length > 0 ? input.reason.trim() : null,
  };
}

function buildAudioTaskState(input: {
  job: AnalysisJobRow | null;
  transcriptRowCount: number;
}): SourceIndexTaskState {
  const checkpoint = getTranscriptCheckpoint(input.job?.result ?? null);
  const hasTranscript = input.transcriptRowCount > 0;
  const activeProgress = input.job?.progress?.stage === 'transcribing_audio' ? input.job.progress : null;
  const completed = activeProgress
    ? activeProgress.completed
    : Math.max(checkpoint.completedChunkKeys.length, hasTranscript ? checkpoint.totalChunks : 0);
  const total = activeProgress?.total ?? checkpoint.totalChunks;

  if (!input.job) {
    return buildTaskState({
      status: hasTranscript ? 'completed' : 'queued',
      completed: hasTranscript ? total : 0,
      total,
    });
  }

  if (input.job.status === 'completed' && !hasTranscript) {
    return buildTaskState({
      status: 'unavailable',
      completed: checkpoint.completedChunkKeys.length,
      total,
      reason: 'No transcript generated',
    });
  }

  if (input.job.status === 'failed' && !hasTranscript) {
    return buildTaskState({
      status: 'failed',
      completed: checkpoint.completedChunkKeys.length,
      total,
      reason: input.job.error,
    });
  }

  if (hasTranscript && (!activeProgress || input.job.progress?.stage !== 'transcribing_audio')) {
    return buildTaskState({
      status: 'completed',
      completed: total,
      total,
    });
  }

  if (input.job.status === 'paused') {
    return buildTaskState({
      status: 'paused',
      completed,
      total,
    });
  }

  if (input.job.status === 'queued') {
    return buildTaskState({
      status: 'queued',
      completed,
      total,
    });
  }

  if (input.job.status === 'running') {
    return buildTaskState({
      status: 'running',
      completed,
      total,
      etaSeconds: activeProgress?.etaSeconds ?? null,
      reason: input.job.pause_requested ? 'Pausing after the current transcript chunk.' : null,
    });
  }

  return buildTaskState({
    status: hasTranscript ? 'completed' : 'queued',
    completed,
    total,
  });
}

function buildVisualTaskState(input: {
  job: AnalysisJobRow | null;
  visualRowCount: number;
  describedVisualRowCount: number;
  sceneCount: number;
}): SourceIndexTaskState {
  const checkpoint = getVisualCheckpoint(input.job?.result ?? null);
  const totalSelections = Math.max(
    1,
    checkpoint.plannedWindowCount + Math.max(checkpoint.plannedSceneCount, input.sceneCount),
    input.visualRowCount,
  );
  const totalWorkUnits = Math.max(1, totalSelections * 2);
  const activeProgress = input.job?.progress?.stage === 'choosing_representative_frames'
    || input.job?.progress?.stage === 'describing_representative_frames'
    ? input.job.progress
    : null;
  const completedSelections = activeProgress?.stage === 'choosing_representative_frames'
    ? Math.min(totalSelections, Math.max(0, activeProgress.completed))
    : Math.min(totalSelections, Math.max(input.visualRowCount, input.describedVisualRowCount));
  const completedDescriptions = activeProgress?.stage === 'describing_representative_frames'
    ? Math.min(totalSelections, Math.max(0, activeProgress.completed))
    : Math.min(totalSelections, Math.max(0, input.describedVisualRowCount));
  const overallCompleted = Math.min(totalWorkUnits, completedSelections + completedDescriptions);

  if (!input.job) {
    return buildTaskState({
      status: input.describedVisualRowCount >= totalSelections ? 'completed' : 'queued',
      completed: input.describedVisualRowCount >= totalSelections ? totalWorkUnits : overallCompleted,
      total: totalWorkUnits,
    });
  }

  if (input.job.status === 'failed' && input.describedVisualRowCount < totalSelections) {
    return buildTaskState({
      status: 'failed',
      completed: overallCompleted,
      total: totalWorkUnits,
      reason: input.job.error,
    });
  }

  if (input.describedVisualRowCount >= totalSelections && totalSelections > 0) {
    return buildTaskState({
      status: 'completed',
      completed: totalWorkUnits,
      total: totalWorkUnits,
    });
  }

  if (input.job.status === 'paused') {
    return buildTaskState({
      status: 'paused',
      completed: overallCompleted,
      total: totalWorkUnits,
    });
  }

  if (input.job.status === 'queued') {
    return buildTaskState({
      status: 'queued',
      completed: overallCompleted,
      total: totalWorkUnits,
    });
  }

  if (input.job.status === 'running') {
    return buildTaskState({
      status: 'running',
      completed: overallCompleted,
      total: totalWorkUnits,
      etaSeconds: activeProgress?.etaSeconds ?? null,
      reason: input.job.pause_requested ? 'Pausing after the current visual batch.' : null,
    });
  }

  if (input.job.status === 'completed') {
    return buildTaskState({
      status: 'completed',
      completed: totalWorkUnits,
      total: totalWorkUnits,
    });
  }

  return buildTaskState({
    status: 'queued',
    completed: overallCompleted,
    total: totalWorkUnits,
  });
}

function resolveOverallStatus(audio: SourceIndexTaskState, visual: SourceIndexTaskState): AnalysisJobStatus {
  const statuses = [audio.status, visual.status];
  if (statuses.includes('running')) return 'running';
  if (statuses.includes('queued')) return 'queued';
  if (statuses.includes('paused')) return 'paused';
  if (statuses.includes('failed')) return 'failed';
  return 'completed';
}

function buildAggregateProgress(audio: SourceIndexTaskState, visual: SourceIndexTaskState): AnalysisProgress {
  const toFraction = (task: SourceIndexTaskState) => {
    if (task.status === 'completed' || task.status === 'unavailable') return 1;
    return getProgressFraction({
      stage: 'queued',
      completed: task.completed,
      total: task.total,
    });
  };
  const combinedFraction = (toFraction(audio) + toFraction(visual)) / 2;
  return {
    stage: audio.status === 'running' ? 'transcribing_audio' : 'describing_representative_frames',
    completed: Math.round(combinedFraction * 1000),
    total: 1000,
    label: `${audio.status === 'completed' || audio.status === 'unavailable' ? 1 : 0}/${visual.status === 'completed' ? 1 : 0}`,
    etaSeconds: Math.max(audio.etaSeconds ?? 0, visual.etaSeconds ?? 0) || null,
  };
}

function buildSourceAnalysisState(input: {
  job: AnalysisJobRow | null;
  transcriptRowCount: number;
  visualRowCount: number;
  describedVisualRowCount: number;
  sceneCount: number;
}): SourceIndexAnalysisState {
  const audio = buildAudioTaskState({
    job: input.job,
    transcriptRowCount: input.transcriptRowCount,
  });
  const visual = buildVisualTaskState({
    job: input.job,
    visualRowCount: input.visualRowCount,
    describedVisualRowCount: input.describedVisualRowCount,
    sceneCount: input.sceneCount,
  });

  return {
    jobId: input.job?.id ?? null,
    status: resolveOverallStatus(audio, visual),
    error: input.job?.error ?? null,
    pauseRequested: input.job?.pause_requested ?? false,
    progress: input.job?.progress ?? buildAggregateProgress(audio, visual),
    audio,
    visual,
  };
}

function buildAggregateAnalysis(states: SourceIndexAnalysisState[]): SourceIndexAnalysisState | null {
  if (states.length === 0) return null;
  const statuses = states.map((state) => state.status);
  const status = statuses.includes('running')
    ? 'running'
    : statuses.includes('queued')
      ? 'queued'
      : statuses.includes('paused')
        ? 'paused'
        : statuses.includes('failed')
          ? 'failed'
          : 'completed';
  const fraction = states.reduce((sum, state) => {
    const audio = state.audio ? (state.audio.status === 'completed' || state.audio.status === 'unavailable'
      ? 1
      : state.audio.completed / Math.max(state.audio.total, 1)) : 0;
    const visual = state.visual ? (state.visual.status === 'completed'
      ? 1
      : state.visual.completed / Math.max(state.visual.total, 1)) : 0;
    return sum + ((audio + visual) / 2);
  }, 0) / Math.max(states.length, 1);

  return {
    jobId: states.find((state) => state.jobId)?.jobId ?? null,
    status,
    error: states.find((state) => state.status === 'failed')?.error ?? null,
    pauseRequested: states.some((state) => state.pauseRequested),
    progress: {
      stage: status === 'running' ? 'transcribing_audio' : 'describing_representative_frames',
      completed: Math.round(clampFraction(fraction) * 1000),
      total: 1000,
      label: `${states.filter((state) => (
        state.visual?.status === 'completed'
        && (state.audio?.status === 'completed' || state.audio?.status === 'unavailable')
      )).length}/${states.length} clips ready`,
      etaSeconds: Math.max(...states.map((state) => Math.max(state.audio?.etaSeconds ?? 0, state.visual?.etaSeconds ?? 0)), 0) || null,
    },
    audio: null,
    visual: null,
  };
}

function shouldEnsureIndexingJob(input: {
  asset: AssetLookupRow;
  latestJob: AnalysisJobRow | null;
}) {
  if (input.latestJob) return false;
  if (input.asset.indexed_at) return false;
  return true;
}

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
      sourceOverviewFrames: [],
      sourceIndexFreshBySourceId: {},
      analysis: null,
      analysisBySourceId: {},
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
  const jobByAssetId = new Map<string, AnalysisJobRow | null>();
  const normalizedSources: Array<ProjectSource & { indexedAt: string | null }> = [];
  const analysisBySourceId: SourceIndexAnalysisStateMap = {};

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
      let latestJob = await getLatestAnalysisJobRow(projectId, asset.id);
      if (shouldEnsureIndexingJob({ asset, latestJob })) {
        await ensureAssetIndexingJob(supabase, projectId, asset.id);
        latestJob = await getLatestAnalysisJobRow(projectId, asset.id);
      }
      jobByAssetId.set(asset.id, latestJob);
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
      sourceOverviewFrames: [],
      sourceIndexFreshBySourceId,
      analysis: null,
      analysisBySourceId,
      sources: normalizedSources,
    };
  }

  const [{ data: transcriptRows, error: transcriptError }, { data: visualRows, error: visualError }, { data: sceneRows, error: sceneError }] = await Promise.all([
    supabase
      .from('asset_transcript_words')
      .select('asset_id, start_time, end_time, text')
      .in('asset_id', assetIds)
      .order('start_time', { ascending: true }),
    supabase
      .from('asset_visual_index')
      .select('asset_id, source_time, sample_kind, metadata')
      .in('asset_id', assetIds)
      .in('sample_kind', ['coarse_window_rep', 'scene_rep'])
      .order('source_time', { ascending: true }),
    supabase
      .from('asset_scenes')
      .select('asset_id, scene_index')
      .in('asset_id', assetIds),
  ]);

  if (transcriptError) throw transcriptError;
  if (visualError) throw visualError;
  if (sceneError) throw sceneError;

  const transcriptCountByAssetId = new Map<string, number>();
  const visualCountByAssetId = new Map<string, number>();
  const describedVisualCountByAssetId = new Map<string, number>();
  const sceneCountByAssetId = new Map<string, number>();

  const sourceTranscriptCaptions: CaptionEntry[] = ((transcriptRows ?? []) as Array<{
    asset_id: string;
    start_time: number;
    end_time: number;
    text: string;
  }>).flatMap((row) => {
    const sourceId = assetIdToSourceId.get(row.asset_id);
    if (!sourceId) return [];
    transcriptCountByAssetId.set(row.asset_id, (transcriptCountByAssetId.get(row.asset_id) ?? 0) + 1);
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

  const sourceOverviewFrames = ((visualRows ?? []) as Array<{
    asset_id: string;
    source_time: number;
    sample_kind: string;
    metadata?: Record<string, unknown> | null;
  }>).flatMap((row) => {
    const sourceId = assetIdToSourceId.get(row.asset_id);
    if (!sourceId) return [];
    visualCountByAssetId.set(row.asset_id, (visualCountByAssetId.get(row.asset_id) ?? 0) + 1);
    const metadata = asRecord(row.metadata) ?? {};
    if (typeof metadata.description === 'string' && metadata.description.trim().length > 0) {
      describedVisualCountByAssetId.set(row.asset_id, (describedVisualCountByAssetId.get(row.asset_id) ?? 0) + 1);
    }
    const freshness = sourceIndexFreshBySourceId[sourceId];
    sourceIndexFreshBySourceId[sourceId] = {
      ...freshness,
      overview: true,
    };
    return [{
      sourceId,
      sourceTime: Number(row.source_time ?? 0),
      description: typeof metadata.description === 'string' ? metadata.description : undefined,
      assetId: row.asset_id,
      indexedAt: freshness?.indexedAt ?? null,
      sampleKind: row.sample_kind === 'scene_rep' || row.sample_kind === 'coarse_window_rep'
        ? row.sample_kind
        : 'coarse_window_rep',
      score: Number.isFinite(metadata.score) ? Number(metadata.score) : null,
      sceneId: typeof metadata.sceneId === 'string' ? metadata.sceneId : null,
    }];
  });

  for (const row of (sceneRows ?? []) as Array<{ asset_id: string; scene_index: number }>) {
    sceneCountByAssetId.set(row.asset_id, (sceneCountByAssetId.get(row.asset_id) ?? 0) + 1);
  }

  for (const source of normalizedSources) {
    const assetId = source.assetId;
    if (!assetId) {
      if (!source.storagePath) {
        continue;
      }
      analysisBySourceId[source.id] = {
        jobId: null,
        status: 'queued',
        error: null,
        pauseRequested: false,
        progress: null,
        audio: buildTaskState({ status: 'queued', completed: 0, total: 1 }),
        visual: buildTaskState({ status: 'queued', completed: 0, total: 1 }),
      };
      continue;
    }

    analysisBySourceId[source.id] = buildSourceAnalysisState({
      job: jobByAssetId.get(assetId) ?? null,
      transcriptRowCount: transcriptCountByAssetId.get(assetId) ?? 0,
      visualRowCount: visualCountByAssetId.get(assetId) ?? 0,
      describedVisualRowCount: describedVisualCountByAssetId.get(assetId) ?? 0,
      sceneCount: sceneCountByAssetId.get(assetId) ?? 0,
    });
  }

  return {
    sourceTranscriptCaptions,
    sourceOverviewFrames,
    sourceIndexFreshBySourceId,
    analysis: buildAggregateAnalysis(Object.values(analysisBySourceId)),
    analysisBySourceId,
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

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId : '';
  const action = body.action === 'pause' || body.action === 'resume' || body.action === 'retry'
    ? body.action
    : null;

  if (!sourceId || !action) {
    return NextResponse.json({ error: 'Invalid source-index action' }, { status: 400 });
  }

  try {
    const { sources } = await loadProjectAndSources(id, user.id);
    const source = sources.find((entry) => entry.id === sourceId);
    if (!source?.storagePath) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    const asset = await ensurePrimaryMediaAssetIfSupported(supabase, id, source.storagePath);
    if (!asset?.id) {
      return NextResponse.json({ error: 'Source asset not found' }, { status: 404 });
    }

    let job = await getLatestAnalysisJobRow(id, asset.id);
    if (!job) {
      const ensured = await ensureAssetIndexingJob(supabase, id, asset.id);
      job = ensured ? await getLatestAnalysisJobRow(id, asset.id) : null;
    }

    if (!job) {
      return NextResponse.json({ error: 'Analysis job not found' }, { status: 404 });
    }

  if (action === 'pause') {
      const patch = job.status === 'queued'
        ? { status: 'paused', pause_requested: false, locked_at: null, locked_by: null }
        : { pause_requested: true };
      const { error } = await supabase.from('analysis_jobs').update(patch).eq('id', job.id);
      if (error) throw error;
    } else if (action === 'resume') {
      const patch = job.status === 'paused'
        ? { status: 'queued', pause_requested: false, locked_at: null, locked_by: null, error: null }
        : { pause_requested: false };
      const { error } = await supabase.from('analysis_jobs').update(patch).eq('id', job.id);
      if (error) throw error;
    } else {
      if (job.status !== 'failed') {
        return NextResponse.json({ error: 'Retry is only available for failed initial indexing.' }, { status: 409 });
      }
      const { error } = await supabase
        .from('analysis_jobs')
        .update({
          status: 'queued',
          pause_requested: false,
          locked_at: null,
          locked_by: null,
          error: null,
          progress: {
            stage: 'queued',
            completed: 0,
            total: 1,
            label: 'Queued',
            etaSeconds: null,
          },
        })
        .eq('id', job.id);
      if (error) throw error;
      await supabase
        .from('media_assets')
        .update({ status: 'indexing' })
        .eq('id', asset.id);
    }

    const payload = await buildSourceIndexResponse(id, user.id);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update source analysis';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
