import { v4 as uuidv4 } from 'uuid';
import type {
  MusicEnergy,
  MusicSegment,
  SceneBoundary,
  SegmentVibeClassification,
  SourceSegment,
} from '../types';

export interface MusicMergeOptions {
  maxSegmentDurationSeconds: number;
  minSegmentDurationSeconds: number;
  pauseBreakThresholdMs: number;
  energyShiftBreakThreshold: number;
  sceneChangeBreak: boolean;
}

export const DEFAULT_MERGE_OPTIONS: MusicMergeOptions = {
  maxSegmentDurationSeconds: 45,
  minSegmentDurationSeconds: 8,
  pauseBreakThresholdMs: 1500,
  energyShiftBreakThreshold: 2,
  sceneChangeBreak: true,
};

const ENERGY_NUMERIC: Record<MusicEnergy, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function energyToNumeric(e: MusicEnergy): number {
  return ENERGY_NUMERIC[e];
}

/** Pick the most frequent value from a list; tie-break by total confidence. */
function modeByConfidence<T extends string>(
  values: T[],
  confidences: number[],
): T {
  const counts = new Map<T, { count: number; totalConf: number }>();
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const entry = counts.get(v) ?? { count: 0, totalConf: 0 };
    entry.count++;
    entry.totalConf += confidences[i];
    counts.set(v, entry);
  }
  let best: T = values[0];
  let bestScore = { count: 0, totalConf: 0 };
  for (const [v, entry] of counts) {
    if (
      entry.count > bestScore.count ||
      (entry.count === bestScore.count && entry.totalConf > bestScore.totalConf)
    ) {
      best = v;
      bestScore = entry;
    }
  }
  return best;
}

function dedupeStrings(arr: string[]): string[] {
  return [...new Set(arr)];
}

function uniqueNonNull(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

interface AccumulatedGroup {
  segments: SourceSegment[];
  classifications: SegmentVibeClassification[];
}

function flushGroup(group: AccumulatedGroup): MusicSegment {
  const moods = group.classifications.map((c) => c.mood);
  const energies = group.classifications.map((c) => c.energy);
  const confidences = group.classifications.map((c) => c.confidence);
  const allGenres = group.classifications.flatMap((c) => c.genreHints);

  return {
    id: `mseg_${uuidv4().slice(0, 8)}`,
    sourceSegmentIds: group.segments.map((s) => s.id),
    sourceStart: group.segments[0].sourceStart,
    sourceEnd: group.segments[group.segments.length - 1].sourceEnd,
    mood: modeByConfidence(moods, confidences),
    energy: modeByConfidence(energies, confidences),
    genreHints: dedupeStrings(allGenres),
    sceneIds: uniqueNonNull(group.segments.map((s) => s.sceneId)),
  };
}

/**
 * Build music segments by merging consecutive SourceSegments with similar vibes.
 *
 * Splits on mood changes, large energy jumps, long pauses, scene changes,
 * or when the merged region exceeds `maxSegmentDurationSeconds`.
 * Post-processes to merge short segments (< `minSegmentDurationSeconds`)
 * with the neighbor that has the closest mood match.
 */
export function buildMusicSegments(
  segments: SourceSegment[],
  classifications: SegmentVibeClassification[],
  _scenes: SceneBoundary[],
  options: Partial<MusicMergeOptions> = {},
): MusicSegment[] {
  if (segments.length === 0) return [];

  const opts = { ...DEFAULT_MERGE_OPTIONS, ...options };
  const classById = new Map(classifications.map((c) => [c.segmentId, c]));

  // Ensure every segment has a classification; skip unclassified segments.
  const paired = segments
    .map((seg) => ({ seg, cls: classById.get(seg.id) }))
    .filter((p): p is { seg: SourceSegment; cls: SegmentVibeClassification } => !!p.cls);

  if (paired.length === 0) return [];

  const musicSegments: MusicSegment[] = [];
  let currentGroup: AccumulatedGroup = {
    segments: [paired[0].seg],
    classifications: [paired[0].cls],
  };

  for (let i = 1; i < paired.length; i++) {
    const prev = paired[i - 1];
    const curr = paired[i];

    const groupDuration = curr.seg.sourceEnd - currentGroup.segments[0].sourceStart;
    const moodChanged =
      prev.cls.mood !== curr.cls.mood &&
      !(prev.cls.mood === 'neutral' && curr.cls.mood === 'neutral');
    const energyJumped =
      Math.abs(energyToNumeric(prev.cls.energy) - energyToNumeric(curr.cls.energy)) >=
      opts.energyShiftBreakThreshold;
    const longPause = prev.seg.pauseAfterMs > opts.pauseBreakThresholdMs;
    const sceneCrossed =
      opts.sceneChangeBreak &&
      prev.seg.sceneId !== null &&
      curr.seg.sceneId !== null &&
      prev.seg.sceneId !== curr.seg.sceneId;
    const tooLong = groupDuration > opts.maxSegmentDurationSeconds;

    if (moodChanged || energyJumped || longPause || sceneCrossed || tooLong) {
      musicSegments.push(flushGroup(currentGroup));
      currentGroup = { segments: [curr.seg], classifications: [curr.cls] };
    } else {
      currentGroup.segments.push(curr.seg);
      currentGroup.classifications.push(curr.cls);
    }
  }
  musicSegments.push(flushGroup(currentGroup));

  // Post-process: merge short segments with their closest-mood neighbor
  return mergeShortSegments(musicSegments, opts.minSegmentDurationSeconds);
}

function segmentDuration(seg: MusicSegment): number {
  return seg.sourceEnd - seg.sourceStart;
}

function mergeTwo(a: MusicSegment, b: MusicSegment): MusicSegment {
  const allIds = [...a.sourceSegmentIds, ...b.sourceSegmentIds];
  const allScenes = uniqueNonNull([...a.sceneIds, ...b.sceneIds]);
  // The longer segment's mood/energy wins
  const primary = segmentDuration(a) >= segmentDuration(b) ? a : b;
  return {
    id: a.id,
    sourceSegmentIds: allIds,
    sourceStart: Math.min(a.sourceStart, b.sourceStart),
    sourceEnd: Math.max(a.sourceEnd, b.sourceEnd),
    mood: primary.mood,
    energy: primary.energy,
    genreHints: dedupeStrings([...a.genreHints, ...b.genreHints]),
    sceneIds: allScenes,
  };
}

function mergeShortSegments(
  segments: MusicSegment[],
  minDuration: number,
): MusicSegment[] {
  if (segments.length <= 1) return segments;

  const result = [...segments];
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      if (segmentDuration(result[i]) >= minDuration) continue;

      // Find the neighbor with the closest mood; prefer shorter neighbor on tie.
      const prevIdx = i > 0 ? i - 1 : null;
      const nextIdx = i < result.length - 1 ? i + 1 : null;

      let mergeWith: number | null = null;
      if (prevIdx !== null && nextIdx !== null) {
        const prevMatch = result[prevIdx].mood === result[i].mood;
        const nextMatch = result[nextIdx].mood === result[i].mood;
        if (prevMatch && !nextMatch) mergeWith = prevIdx;
        else if (!prevMatch && nextMatch) mergeWith = nextIdx;
        else {
          // Both match or neither match — merge with shorter neighbor
          mergeWith =
            segmentDuration(result[prevIdx]) <= segmentDuration(result[nextIdx])
              ? prevIdx
              : nextIdx;
        }
      } else {
        mergeWith = prevIdx ?? nextIdx;
      }

      if (mergeWith === null) continue;

      const lo = Math.min(i, mergeWith);
      const hi = Math.max(i, mergeWith);
      const merged = mergeTwo(result[lo], result[hi]);
      result.splice(lo, 2, merged);
      changed = true;
      break; // restart scan after mutation
    }
  }

  return result;
}
