import { MAIN_SOURCE_ID, normalizeSourceId } from './sourceUtils';
import type { ProjectSource } from './types';

function getFallbackSourceStatus(fallbackStoragePath?: string | null): ProjectSource['status'] {
  return fallbackStoragePath ? 'pending' : 'ready';
}

export function isProjectSourceStatus(value: unknown): value is ProjectSource['status'] {
  return value === 'pending'
    || value === 'indexing'
    || value === 'ready'
    || value === 'error'
    || value === 'missing';
}

export function createMissingProjectSource(sourceId: string): ProjectSource {
  const isPrimary = sourceId === MAIN_SOURCE_ID;
  return {
    id: sourceId,
    fileName: isPrimary ? 'Missing main video' : `Missing source (${sourceId})`,
    storagePath: null,
    assetId: null,
    duration: 0,
    status: 'missing',
    isPrimary,
  };
}

export function buildProjectSourceAliasMap(sources: ProjectSource[]): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const source of sources) {
    aliases.set(source.id, source.id);
    const assetId = normalizeSourceId(source.assetId);
    if (assetId && !aliases.has(assetId)) {
      aliases.set(assetId, source.id);
    }
  }
  return aliases;
}

export function canonicalizeProjectSourceId(
  value: unknown,
  aliases: Map<string, string>,
  fallbackSourceId?: string | null,
): string | null {
  const normalized = normalizeSourceId(value);
  if (!normalized) {
    return fallbackSourceId ?? null;
  }
  return aliases.get(normalized) ?? normalized;
}

export function normalizeProjectSource(
  value: Partial<ProjectSource> | null | undefined,
  fallback: {
    id: string;
    fileName: string;
    duration: number;
    isPrimary: boolean;
    storagePath?: string | null;
  },
): ProjectSource {
  const fileName = typeof value?.fileName === 'string' && value.fileName.trim().length > 0
    ? value.fileName.trim()
    : fallback.fileName;
  const storagePath = typeof value?.storagePath === 'string' && value.storagePath.trim().length > 0
    ? value.storagePath.trim()
    : (fallback.storagePath ?? null);

  return {
    id: normalizeSourceId(value?.id) ?? fallback.id,
    fileName,
    storagePath,
    assetId: normalizeSourceId(value?.assetId) ?? null,
    duration: Number.isFinite(value?.duration) && value!.duration! > 0 ? Number(value!.duration) : Math.max(0, fallback.duration),
    status: isProjectSourceStatus(value?.status) ? value.status : getFallbackSourceStatus(storagePath),
    isPrimary: value?.isPrimary === true || fallback.isPrimary,
  };
}

export function buildProjectSources(input: {
  persistedSources?: unknown[];
  projectStoragePath?: string | null;
  projectVideoFilename?: string | null;
  projectDuration?: number;
  referencedSourceIds?: Iterable<string>;
  fallbackId?: (index: number) => string;
}): ProjectSource[] {
  const fallbackId = input.fallbackId ?? ((index: number) => `source-${index + 1}`);
  const persisted = Array.isArray(input.persistedSources)
    ? input.persistedSources
        .map((entry, index) => normalizeProjectSource(
          (entry && typeof entry === 'object' ? entry : null) as Partial<ProjectSource> | null,
          {
            id: index === 0 ? MAIN_SOURCE_ID : fallbackId(index),
            fileName: index === 0
              ? (input.projectVideoFilename?.trim() || 'Main video')
              : `Source ${index + 1}`,
            duration: input.projectDuration ?? 0,
            isPrimary: index === 0,
            storagePath: index === 0 ? input.projectStoragePath : null,
          },
        ))
        .filter((source, index, sources) => sources.findIndex((candidate) => candidate.id === source.id) === index)
    : [];

  const baseSources = persisted.length > 0
    ? (() => {
        const hasPrimary = persisted.some((source) => source.isPrimary);
        return persisted.map((source, index) => {
          const isPrimary = source.id === MAIN_SOURCE_ID || source.isPrimary || (!hasPrimary && index === 0);
          return {
            ...source,
            id: isPrimary ? MAIN_SOURCE_ID : source.id,
            isPrimary,
          };
        });
      })()
    : (
      !input.projectStoragePath
      && !(input.projectDuration && input.projectDuration > 0)
      && !input.projectVideoFilename
        ? []
        : [{
            id: MAIN_SOURCE_ID,
            fileName: input.projectVideoFilename?.trim() || 'Main video',
            storagePath: input.projectStoragePath ?? null,
            assetId: null,
            duration: Math.max(0, input.projectDuration ?? 0),
            status: getFallbackSourceStatus(input.projectStoragePath),
            isPrimary: true,
          }]
    );

  const knownSourceIds = new Set(baseSources.map((source) => source.id));
  const synthesizedSources: ProjectSource[] = [];

  for (const referencedSourceId of input.referencedSourceIds ?? []) {
    const sourceId = normalizeSourceId(referencedSourceId);
    if (!sourceId || knownSourceIds.has(sourceId)) continue;
    knownSourceIds.add(sourceId);
    synthesizedSources.push(createMissingProjectSource(sourceId));
  }

  return [...baseSources, ...synthesizedSources];
}

export function extractReferencedSourceIdsFromClips(clips: unknown): string[] {
  if (!Array.isArray(clips)) return [];

  return clips.reduce<string[]>((acc, clip) => {
    if (!clip || typeof clip !== 'object') return acc;
    const sourceId = normalizeSourceId((clip as { sourceId?: unknown }).sourceId);
    if (!sourceId || acc.includes(sourceId)) return acc;
    acc.push(sourceId);
    return acc;
  }, []);
}

function chooseMergedStatus(
  existing: ProjectSource['status'],
  incoming: ProjectSource['status'],
  hasResolvedStorage: boolean,
): ProjectSource['status'] {
  if (incoming === 'error' || incoming === 'missing') return incoming;
  if (existing === 'error' || existing === 'missing') return existing;
  if (incoming === 'ready' || existing === 'ready') {
    return hasResolvedStorage ? 'ready' : (incoming === 'ready' ? incoming : existing);
  }
  if (incoming === 'indexing' || existing === 'indexing') {
    return hasResolvedStorage ? 'indexing' : (incoming === 'indexing' ? incoming : existing);
  }
  return incoming;
}

export function mergeProjectSources(input: {
  existingSources?: unknown[];
  incomingSources?: unknown[];
  projectStoragePath?: string | null;
  projectVideoFilename?: string | null;
  projectDuration?: number;
  referencedSourceIds?: Iterable<string>;
}): ProjectSource[] {
  const existingSources = buildProjectSources({
    persistedSources: input.existingSources,
    projectStoragePath: input.projectStoragePath,
    projectVideoFilename: input.projectVideoFilename,
    projectDuration: input.projectDuration,
    referencedSourceIds: input.referencedSourceIds,
  });
  const incomingSources = buildProjectSources({
    persistedSources: input.incomingSources,
    projectStoragePath: input.projectStoragePath,
    projectVideoFilename: input.projectVideoFilename,
    projectDuration: input.projectDuration,
    referencedSourceIds: input.referencedSourceIds,
  });

  const mergedById = new Map<string, ProjectSource>();
  for (const source of existingSources) {
    mergedById.set(source.id, source);
  }

  for (const source of incomingSources) {
    const existing = mergedById.get(source.id);
    if (!existing) {
      mergedById.set(source.id, source);
      continue;
    }

    const storagePath = source.storagePath ?? existing.storagePath ?? null;
    const assetId = normalizeSourceId(source.assetId) ?? normalizeSourceId(existing.assetId) ?? null;
    const hasResolvedStorage = Boolean(storagePath || assetId);
    mergedById.set(source.id, {
      ...existing,
      ...source,
      id: source.id,
      fileName: source.fileName.trim() || existing.fileName,
      storagePath,
      assetId,
      duration: source.duration > 0 ? source.duration : existing.duration,
      status: chooseMergedStatus(existing.status, source.status, hasResolvedStorage),
      isPrimary: source.isPrimary || existing.isPrimary,
    });
  }

  const mergedSources = Array.from(mergedById.values());
  const primarySource = mergedSources.find((source) => source.id === MAIN_SOURCE_ID)
    ?? mergedSources.find((source) => source.isPrimary)
    ?? null;

  return mergedSources.map((source) => ({
    ...source,
    id: source === primarySource ? MAIN_SOURCE_ID : source.id,
    isPrimary: source === primarySource,
  }));
}

export function upsertProjectSource(
  sources: ProjectSource[],
  sourceId: string,
  patch: Partial<ProjectSource>,
): ProjectSource[] {
  const normalizedSourceId = normalizeSourceId(sourceId);
  if (!normalizedSourceId) return sources;

  const existing = sources.find((source) => source.id === normalizedSourceId) ?? createMissingProjectSource(normalizedSourceId);
  const nextSource: ProjectSource = {
    ...existing,
    ...patch,
    id: normalizedSourceId,
    isPrimary: patch.isPrimary ?? existing.isPrimary,
  };
  const existingIndex = sources.findIndex((source) => source.id === normalizedSourceId);

  if (existingIndex >= 0) {
    return sources.map((source, index) => {
      if (index === existingIndex) return nextSource;
      if (nextSource.isPrimary) return { ...source, isPrimary: false };
      return source;
    });
  }

  return nextSource.isPrimary
    ? [...sources.map((source) => ({ ...source, isPrimary: false })), nextSource]
    : [...sources, nextSource];
}
