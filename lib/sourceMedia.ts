import type { ProjectSource } from './types';
import { MAIN_SOURCE_ID } from './sourceUtils';

export type SourceMedia = Uint8Array | File | string;

export interface SourceRuntimeMedia {
  file: File | null;
  objectUrl: string;
  playerUrl: string;
  processingUrl: string;
}

export type SourceRuntimeMediaMap = Record<string, SourceRuntimeMedia | undefined>;

export interface ResolvedProjectSourceMedia {
  sourceId: string;
  source: SourceMedia | null;
  duration: number;
  fileName: string;
  storagePath: string | null;
  assetId: string | null;
  status: ProjectSource['status'];
  isPrimary: boolean;
  playerUrl: string;
  processingUrl: string;
  isResolved: boolean;
  missingReason: string | null;
}

type LegacyPrimarySourceInput = {
  videoData: Uint8Array | null;
  videoFile: File | null;
  videoUrl: string;
  processingVideoUrl?: string;
  videoDuration: number;
  videoName?: string;
  storagePath?: string | null;
};

type ResolveProjectSourcesInput = {
  sources: ProjectSource[];
  runtimeBySourceId?: SourceRuntimeMediaMap;
  primaryFallback?: LegacyPrimarySourceInput;
};

function pickRuntimeSource(runtime?: SourceRuntimeMedia, fallback?: LegacyPrimarySourceInput): SourceMedia | null {
  return runtime?.file
    ?? runtime?.processingUrl
    ?? runtime?.objectUrl
    ?? runtime?.playerUrl
    ?? fallback?.videoData
    ?? fallback?.videoFile
    ?? fallback?.processingVideoUrl
    ?? fallback?.videoUrl
    ?? null;
}

function buildResolvedEntry(
  source: ProjectSource,
  runtime: SourceRuntimeMedia | undefined,
  fallback?: LegacyPrimarySourceInput,
): ResolvedProjectSourceMedia {
  // Prefer the dedicated playback URL so seeking/preview uses the stable proxy
  // endpoint instead of a short-lived processing URL.
  const playerUrl = runtime?.objectUrl || runtime?.playerUrl || runtime?.processingUrl || fallback?.videoUrl || fallback?.processingVideoUrl || '';
  const processingUrl = runtime?.processingUrl
    || runtime?.objectUrl
    || runtime?.playerUrl
    || fallback?.processingVideoUrl
    || fallback?.videoUrl
    || '';
  const duration = source.duration > 0 ? source.duration : Math.max(0, fallback?.videoDuration ?? 0);
  const resolvedSource = pickRuntimeSource(runtime, fallback);
  const isResolved = Boolean(resolvedSource);

  return {
    sourceId: source.id,
    source: resolvedSource,
    duration,
    fileName: source.fileName || fallback?.videoName || 'Source video',
    storagePath: source.storagePath,
    assetId: source.assetId,
    status: source.status,
    isPrimary: source.isPrimary,
    playerUrl,
    processingUrl,
    isResolved,
    missingReason: isResolved ? null : describeSourceResolutionFailure({
      sourceId: source.id,
      fileName: source.fileName || fallback?.videoName || 'Source video',
      status: source.status,
      storagePath: source.storagePath,
    }),
  };
}

function buildFallbackPrimarySource(
  fallback: LegacyPrimarySourceInput,
  runtime?: SourceRuntimeMedia,
): ResolvedProjectSourceMedia | null {
  const source = pickRuntimeSource(runtime, fallback);
  const duration = Math.max(0, fallback.videoDuration);
  if (!source || duration <= 0) return null;

  return {
    sourceId: MAIN_SOURCE_ID,
    source,
    duration,
    fileName: fallback.videoName || fallback.videoFile?.name || 'Main video',
    storagePath: fallback.storagePath ?? null,
    assetId: null,
    status: fallback.storagePath ? 'pending' : 'ready',
    isPrimary: true,
    playerUrl: runtime?.objectUrl || runtime?.playerUrl || runtime?.processingUrl || fallback.videoUrl || fallback.processingVideoUrl || '',
    processingUrl: runtime?.processingUrl
      || runtime?.objectUrl
      || runtime?.playerUrl
      || fallback.processingVideoUrl
      || fallback.videoUrl
      || '',
    isResolved: true,
    missingReason: null,
  };
}

export function describeSourceResolutionFailure(source: {
  sourceId: string;
  fileName?: string | null;
  status?: ProjectSource['status'];
  storagePath?: string | null;
}) {
  const label = source.fileName?.trim() || source.sourceId;
  if (source.status === 'missing' || !source.storagePath) {
    return `Missing media for "${label}".`;
  }
  if (source.status === 'error') {
    return `Could not load "${label}".`;
  }
  return `Source media for "${label}" is unavailable.`;
}

export function resolveProjectSources(input: ResolveProjectSourcesInput): ResolvedProjectSourceMedia[] {
  const sources = input.sources.map((source) => {
    const fallback = source.id === MAIN_SOURCE_ID ? input.primaryFallback : undefined;
    return buildResolvedEntry(source, input.runtimeBySourceId?.[source.id], fallback);
  });

  if (sources.length > 0) {
    return sources;
  }

  if (!input.primaryFallback) return [];
  const fallbackPrimary = buildFallbackPrimarySource(
    input.primaryFallback,
    input.runtimeBySourceId?.[MAIN_SOURCE_ID],
  );
  return fallbackPrimary ? [fallbackPrimary] : [];
}

export function resolveProjectSourceById(
  input: ResolveProjectSourcesInput,
  sourceId: string,
): ResolvedProjectSourceMedia | null {
  return resolveProjectSources(input).find((entry) => entry.sourceId === sourceId) ?? null;
}

export function resolvePrimaryProjectSource(
  input: ResolveProjectSourcesInput,
): ResolvedProjectSourceMedia | null {
  return resolveProjectSourceById(input, MAIN_SOURCE_ID)
    ?? resolveProjectSources(input).find((entry) => entry.isPrimary)
    ?? null;
}
