import type {
  ProjectSource,
  SourceIndexAnalysisState,
  SourceIndexAnalysisStateMap,
  SourceIndexState,
} from './types';

export function isServerBackedSource(source: Pick<ProjectSource, 'storagePath' | 'assetId'>) {
  return Boolean(source.storagePath || source.assetId);
}

function requiresInitialIndexing(source: Pick<ProjectSource, 'storagePath' | 'assetId'>) {
  return isServerBackedSource(source);
}

export function getInitialIndexingTrackedSourceIds(
  sources: Array<Pick<ProjectSource, 'id' | 'storagePath' | 'assetId'>>,
  analysisBySourceId?: SourceIndexAnalysisStateMap,
): string[] {
  return sources
    .filter((source) => requiresInitialIndexing(source) || Boolean(analysisBySourceId?.[source.id]))
    .map((source) => source.id);
}

export function isInitialIndexingReadyForSource(input: {
  analysis?: SourceIndexAnalysisState | null;
  freshness?: Partial<Pick<SourceIndexState, 'transcript' | 'overview'>> | null;
}): boolean {
  return input.freshness?.transcript === true
    || input.analysis?.audio?.status === 'completed'
    || input.analysis?.audio?.status === 'unavailable';
}

export function getInitialIndexingReady(
  sources: Array<Pick<ProjectSource, 'id' | 'storagePath' | 'assetId'>>,
  analysisBySourceId: SourceIndexAnalysisStateMap,
  freshnessBySourceId?: Record<string, Partial<Pick<SourceIndexState, 'transcript' | 'overview'>> | null | undefined>,
): boolean {
  const trackedSourceIds = getInitialIndexingTrackedSourceIds(sources, analysisBySourceId);
  if (trackedSourceIds.length === 0) return true;

  return trackedSourceIds.every((sourceId) => {
    return isInitialIndexingReadyForSource({
      analysis: analysisBySourceId[sourceId],
      freshness: freshnessBySourceId?.[sourceId],
    });
  });
}
