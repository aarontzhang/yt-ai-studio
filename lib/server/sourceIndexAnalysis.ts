import type {
  AnalysisJobStatus,
  AnalysisProgress,
  ProjectSource,
  SourceIndexAnalysisState,
  SourceIndexAnalysisStateMap,
  SourceIndexTaskState,
  SourceIndexTaskStatus,
} from '../types';

export interface SourceIndexAnalysisJob {
  id: string;
  assetId: string;
  status: AnalysisJobStatus;
  error: string | null;
  progress: AnalysisProgress | null;
  pauseRequested: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseAnalysisProgress(value: unknown): AnalysisProgress | null {
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

function clampFraction(value: number) {
  return Math.max(0, Math.min(1, value));
}

function buildTaskState(input: {
  status: SourceIndexTaskStatus;
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

function isActiveTranscriptProgress(progress: AnalysisProgress | null): progress is AnalysisProgress {
  return progress?.stage === 'transcribing_audio' || progress?.stage === 'transcribing';
}

function buildAudioTaskState(input: {
  source: Pick<ProjectSource, 'status'>;
  job: SourceIndexAnalysisJob | null;
  transcriptRowCount: number;
}): SourceIndexTaskState {
  const hasTranscript = input.transcriptRowCount > 0;
  const activeProgress = isActiveTranscriptProgress(input.job?.progress ?? null)
    ? input.job!.progress
    : null;
  const total = Math.max(activeProgress?.total ?? 1, 1);
  const completed = activeProgress
    ? Math.min(Math.max(activeProgress.completed, 0), total)
    : hasTranscript
      ? total
      : 0;

  if (input.source.status === 'missing') {
    return buildTaskState({
      status: 'failed',
      completed: 0,
      total: 1,
      reason: 'Source media is missing.',
    });
  }

  if (input.source.status === 'error') {
    return buildTaskState({
      status: 'failed',
      completed: 0,
      total: 1,
      reason: 'Upload failed.',
    });
  }

  if (hasTranscript && (!input.job || !activeProgress || input.job.status === 'completed' || input.job.status === 'failed')) {
    return buildTaskState({
      status: 'completed',
      completed: total,
      total,
    });
  }

  if (!input.job) {
    return buildTaskState({
      status: hasTranscript ? 'completed' : 'queued',
      completed,
      total,
    });
  }

  if (input.job.status === 'failed' && !hasTranscript) {
    return buildTaskState({
      status: 'failed',
      completed,
      total,
      reason: input.job.error,
    });
  }

  if (input.job.status === 'completed' && !hasTranscript) {
    return buildTaskState({
      status: 'unavailable',
      completed,
      total,
      reason: input.job.error ?? 'Audio transcription did not produce a transcript.',
    });
  }

  if (input.job.status === 'paused') {
    return buildTaskState({
      status: 'paused',
      completed,
      total,
      etaSeconds: activeProgress?.etaSeconds ?? null,
      reason: input.job.pauseRequested ? 'Pausing after the current transcript chunk.' : null,
    });
  }

  if (input.job.status === 'queued') {
    return buildTaskState({
      status: 'queued',
      completed,
      total,
      reason: input.job.pauseRequested ? 'Waiting to pause.' : null,
    });
  }

  if (input.job.status === 'running') {
    return buildTaskState({
      status: 'running',
      completed,
      total,
      etaSeconds: activeProgress?.etaSeconds ?? null,
      reason: input.job.pauseRequested ? 'Pausing after the current transcript chunk.' : null,
    });
  }

  return buildTaskState({
    status: hasTranscript ? 'completed' : 'queued',
    completed,
    total,
  });
}

function resolveOverallStatus(audio: SourceIndexTaskState): AnalysisJobStatus {
  if (audio.status === 'running') return 'running';
  if (audio.status === 'queued') return 'queued';
  if (audio.status === 'paused') return 'paused';
  if (audio.status === 'failed') return 'failed';
  return 'completed';
}

function buildAudioProgress(task: SourceIndexTaskState, activeProgress: AnalysisProgress | null): AnalysisProgress {
  if (activeProgress && (task.status === 'running' || task.status === 'paused')) {
    return {
      ...activeProgress,
      completed: Math.max(activeProgress.completed, task.completed),
      total: Math.max(activeProgress.total, task.total),
      etaSeconds: task.status === 'paused' ? null : activeProgress.etaSeconds ?? null,
    };
  }

  return {
    stage: task.status === 'queued' ? 'queued' : 'transcribing',
    completed: task.status === 'completed' || task.status === 'unavailable'
      ? Math.max(task.total, 1)
      : task.completed,
    total: Math.max(task.total, 1),
    label: task.status === 'failed'
      ? 'Audio analysis issue'
      : task.status === 'paused'
        ? 'Audio analysis paused'
        : task.status === 'queued'
          ? 'Queued'
          : task.status === 'completed' || task.status === 'unavailable'
            ? 'Completed'
            : 'Transcribing audio',
    etaSeconds: task.status === 'running' ? task.etaSeconds ?? null : null,
  };
}

function buildSourceAnalysisState(input: {
  source: Pick<ProjectSource, 'id' | 'status'>;
  job: SourceIndexAnalysisJob | null;
  transcriptRowCount: number;
}): SourceIndexAnalysisState {
  const activeProgress = isActiveTranscriptProgress(input.job?.progress ?? null)
    ? input.job!.progress
    : null;
  const audio = buildAudioTaskState({
    source: input.source,
    job: input.job,
    transcriptRowCount: input.transcriptRowCount,
  });

  return {
    jobId: input.job?.id ?? null,
    status: resolveOverallStatus(audio),
    error: audio.status === 'failed' ? (audio.reason ?? input.job?.error ?? null) : null,
    pauseRequested: input.job?.pauseRequested ?? false,
    progress: buildAudioProgress(audio, activeProgress),
    audio,
    visual: null,
  };
}

function buildAggregateAnalysis(states: SourceIndexAnalysisState[]): SourceIndexAnalysisState | null {
  if (states.length === 0) return null;

  const audioTasks = states
    .map((state) => state.audio)
    .filter((task): task is SourceIndexTaskState => Boolean(task));
  if (audioTasks.length === 0) return null;

  const status = audioTasks.some((task) => task.status === 'running')
    ? 'running'
    : audioTasks.some((task) => task.status === 'queued')
      ? 'queued'
      : audioTasks.some((task) => task.status === 'paused')
        ? 'paused'
        : audioTasks.some((task) => task.status === 'failed')
          ? 'failed'
          : 'completed';

  const completedSources = audioTasks.filter((task) => (
    task.status === 'completed' || task.status === 'unavailable'
  )).length;
  const fraction = audioTasks.reduce((sum, task) => {
    if (task.status === 'completed' || task.status === 'unavailable') return sum + 1;
    return sum + clampFraction(task.completed / Math.max(task.total, 1));
  }, 0) / Math.max(audioTasks.length, 1);

  return {
    jobId: states.find((state) => state.jobId)?.jobId ?? null,
    status,
    error: states.find((state) => state.status === 'failed')?.error ?? null,
    pauseRequested: states.some((state) => state.pauseRequested === true),
    progress: {
      stage: status === 'running' ? 'transcribing_audio' : 'transcribing',
      completed: Math.round(clampFraction(fraction) * 1000),
      total: 1000,
      label: `${completedSources}/${audioTasks.length} audio tracks ready`,
      etaSeconds: Math.max(...audioTasks.map((task) => Math.max(task.etaSeconds ?? 0, 0)), 0) || null,
    },
    audio: null,
    visual: null,
  };
}

export function buildSourceIndexAnalysis(input: {
  sources: Array<Pick<ProjectSource, 'id' | 'status' | 'assetId' | 'storagePath'>>;
  latestJobsByAssetId: Map<string, SourceIndexAnalysisJob>;
  transcriptCountByAssetId: Map<string, number>;
}): {
  analysis: SourceIndexAnalysisState | null;
  analysisBySourceId: SourceIndexAnalysisStateMap;
} {
  const analysisBySourceId = input.sources.reduce<SourceIndexAnalysisStateMap>((acc, source) => {
    if (!source.assetId && !source.storagePath) {
      return acc;
    }
    const assetId = source.assetId ?? null;
    const transcriptRowCount = assetId ? input.transcriptCountByAssetId.get(assetId) ?? 0 : 0;
    const state = buildSourceAnalysisState({
      source,
      job: assetId ? input.latestJobsByAssetId.get(assetId) ?? null : null,
      transcriptRowCount,
    });
    acc[source.id] = state;
    return acc;
  }, {});

  return {
    analysis: buildAggregateAnalysis(Object.values(analysisBySourceId)),
    analysisBySourceId,
  };
}
