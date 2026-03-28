import { getSourceRangeId, normalizeSourceId } from './sourceUtils';
import {
  CaptionCue,
  CaptionCueWord,
  CaptionEntry,
  EditAction,
  IndexedVideoFrame,
  SilenceCandidate,
  SourceIndexedFrame,
  SourceRangeRef,
  TransitionEntry,
  VideoClip,
} from './types';
import { getAdaptiveCoarseFrameBudget } from './indexer/representativeFrames';
import {
  buildClipSchedule,
  getTimelineDuration as getRenderTimelineDuration,
  timelineTimeToSource,
} from './playbackEngine';

const DEFAULT_MAX_CAPTION_CHARS_PER_LINE = 42;
const DEFAULT_CAPTION_MAX_LINES = 2;
const DEFAULT_CAPTION_PAUSE_BREAK_SECONDS = 0.65;
const CAPTION_PUNCTUATION_BREAK = /[.!?]$|[,;:]$/;
const CAPTION_SIMULTANEOUS_WORD_EPSILON = 0.0005;

/**
 * Convert a current-timeline timestamp to the corresponding source video timestamp,
 * accounting for which clip it falls in and any speed changes.
 */
export function timelineToSourceTime(clips: VideoClip[], timelineTime: number): number {
  const schedule = buildClipSchedule(clips);
  for (let index = schedule.length - 1; index >= 0; index -= 1) {
    const entry = schedule[index];
    const isLastClip = index === schedule.length - 1;
    if (timelineTime >= entry.timelineStart && (timelineTime < entry.timelineEnd || (isLastClip && timelineTime <= entry.timelineEnd))) {
      const offset = Math.max(0, timelineTime - entry.timelineStart);
      return entry.sourceStart + offset * entry.speed;
    }
  }
  // Past end — clamp to end of last clip
  if (clips.length > 0) {
    const last = clips[clips.length - 1];
    return last.sourceStart + last.sourceDuration;
  }
  return timelineTime;
}

/**
 * For a timeline range [startTime, endTime], return the source video segments
 * that correspond to it, with their timeline offsets for timestamp correction.
 */
export function getSourceSegmentsForTimelineRange(
  clips: VideoClip[],
  startTime: number,
  endTime: number,
  transitions: TransitionEntry[] = [],
): Array<{ sourceId: string; sourceStart: number; sourceDuration: number; timelineOffset: number }> {
  const segments: Array<{ sourceId: string; sourceStart: number; sourceDuration: number; timelineOffset: number }> = [];
  const schedule = buildClipSchedule(clips, transitions);
  for (const entry of schedule) {
    const clipStart = entry.timelineStart;
    const clipEnd = entry.timelineEnd;
    const overlapStart = Math.max(startTime, clipStart);
    const overlapEnd = Math.min(endTime, clipEnd);
    if (overlapEnd > overlapStart) {
      const sourceOffset = (overlapStart - clipStart) * entry.speed;
      segments.push({
        sourceId: entry.sourceId,
        sourceStart: entry.sourceStart + sourceOffset,
        sourceDuration: (overlapEnd - overlapStart) * entry.speed,
        timelineOffset: overlapStart,
      });
    }
    if (clipEnd >= endTime) break;
  }
  return segments;
}

export function timeToPx(time: number, duration: number, width: number): number {
  if (duration <= 0) return 0;
  return (time / duration) * width;
}

export function pxToTime(px: number, duration: number, width: number): number {
  if (width <= 0) return 0;
  return Math.max(0, Math.min(duration, (px / width) * duration));
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatTimeDetailed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

export function formatTimePrecise(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const m = Math.floor(safeSeconds / 60);
  const s = Math.floor(safeSeconds % 60);
  const ms = Math.round((safeSeconds % 1) * 1000);
  if (ms === 1000) {
    return formatTimePrecise(safeSeconds + 0.001);
  }
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

export function formatTimeShort(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function getOverviewFrameTarget(duration: number, preferredInterval: number, maxOverviewFrames: number): number {
  return getAdaptiveCoarseFrameBudget(duration, preferredInterval, maxOverviewFrames);
}

export function getRulerTicks(duration: number, width: number): { time: number; major: boolean }[] {
  if (duration <= 0 || width <= 0) return [];
  const targetMajor = Math.max(4, Math.floor(width / 80));
  const rawInterval = duration / targetMajor;

  const candidates = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  let majorInterval = candidates[candidates.length - 1];
  for (const c of candidates) {
    if (c >= rawInterval) { majorInterval = c; break; }
  }
  const minorInterval = majorInterval / 5;

  const ticks: { time: number; major: boolean }[] = [];
  const step = minorInterval;
  for (let t = 0; t <= duration + 0.001; t += step) {
    const snapped = Math.round(t * 1000) / 1000;
    const isMajor = Math.abs(snapped % majorInterval) < step * 0.1;
    ticks.push({ time: snapped, major: isMajor });
  }
  return ticks;
}

export function invertSegments(
  cutSegments: Array<{ startTime: number; endTime: number }>,
  duration: number,
): Array<{ startTime: number; endTime: number }> {
  if (cutSegments.length === 0) return [{ startTime: 0, endTime: duration }];
  const sorted = [...cutSegments].sort((a, b) => a.startTime - b.startTime);
  const keep: Array<{ startTime: number; endTime: number }> = [];
  let cursor = 0;
  for (const seg of sorted) {
    if (seg.startTime > cursor + 0.01) keep.push({ startTime: cursor, endTime: seg.startTime });
    cursor = Math.max(cursor, seg.endTime);
  }
  if (cursor < duration - 0.01) keep.push({ startTime: cursor, endTime: duration });
  return keep;
}

/**
 * Convert a source video timestamp to the current-timeline timestamp,
 * accounting for deleted segments (returns null if the source time was cut out).
 */
export function sourceTimeToTimeline(
  clips: VideoClip[],
  sourceTime: number,
  sourceId?: string | null,
  transitions: TransitionEntry[] = [],
): number | null {
  const schedule = buildClipSchedule(clips, transitions);
  for (const entry of schedule) {
    if (sourceId && entry.sourceId !== sourceId) {
      continue;
    }
    if (sourceTime >= entry.sourceStart && sourceTime <= entry.sourceStart + entry.sourceDuration) {
      return entry.timelineStart + (sourceTime - entry.sourceStart) / entry.speed;
    }
  }
  return null;
}

/**
 * Return every current-timeline occurrence of a source timestamp.
 * A source moment can appear multiple times after duplication or reordering.
 */
export function sourceTimeToTimelineOccurrences(
  clips: VideoClip[],
  sourceTime: number,
  sourceId?: string | null,
  transitions: TransitionEntry[] = [],
): number[] {
  const matches: number[] = [];
  const schedule = buildClipSchedule(clips, transitions);
  for (const entry of schedule) {
    if (sourceId && entry.sourceId !== sourceId) {
      continue;
    }
    if (sourceTime >= entry.sourceStart && sourceTime <= entry.sourceStart + entry.sourceDuration) {
      matches.push(entry.timelineStart + (sourceTime - entry.sourceStart) / entry.speed);
    }
  }
  return matches;
}

/**
 * Map a timeline moment from one snapshot into another by following the
 * underlying source media. When the exact source moment was removed in the
 * target snapshot, snap to the nearest surviving boundary for that source span.
 */
export function mapTimelineTimeAcrossSnapshots(
  fromClips: VideoClip[],
  toClips: VideoClip[],
  timelineTime: number,
  fromTransitions: TransitionEntry[] = [],
  toTransitions: TransitionEntry[] = [],
): number | null {
  const fromSchedule = buildClipSchedule(fromClips, fromTransitions);
  const toSchedule = buildClipSchedule(toClips, toTransitions);
  if (fromSchedule.length === 0 || toSchedule.length === 0) return null;

  const sourceMoment = timelineTimeToSource(fromSchedule, timelineTime);
  if (!sourceMoment) return null;

  const { sourceTime, entry: fromEntry } = sourceMoment;
  const fromSourceStart = fromEntry.sourceStart;
  const fromSourceEnd = fromEntry.sourceStart + fromEntry.sourceDuration;
  const EPSILON = 1e-6;

  let bestMatch: {
    timelineTime: number;
    sourceDistance: number;
    timelineDistance: number;
    exact: boolean;
  } | null = null;

  for (const toEntry of toSchedule) {
    if (toEntry.sourceId !== fromEntry.sourceId) continue;

    const toSourceStart = toEntry.sourceStart;
    const toSourceEnd = toEntry.sourceStart + toEntry.sourceDuration;
    const overlapStart = Math.max(fromSourceStart, toSourceStart);
    const overlapEnd = Math.min(fromSourceEnd, toSourceEnd);
    if (overlapEnd < overlapStart + EPSILON) continue;

    const projectedSourceTime = Math.max(overlapStart, Math.min(sourceTime, overlapEnd));
    const candidateTimelineTime = toEntry.timelineStart + (projectedSourceTime - toSourceStart) / toEntry.speed;
    const sourceDistance = Math.abs(sourceTime - projectedSourceTime);
    const timelineDistance = Math.abs(candidateTimelineTime - timelineTime);
    const exact = sourceDistance <= EPSILON;

    if (
      !bestMatch
      || Number(exact) > Number(bestMatch.exact)
      || sourceDistance < bestMatch.sourceDistance - EPSILON
      || (
        Math.abs(sourceDistance - bestMatch.sourceDistance) <= EPSILON
        && timelineDistance < bestMatch.timelineDistance - EPSILON
      )
    ) {
      bestMatch = {
        timelineTime: candidateTimelineTime,
        sourceDistance,
        timelineDistance,
        exact,
      };
    }
  }

  return bestMatch?.timelineTime ?? null;
}

/**
 * Project a source-time range onto the current timeline.
 * Returns zero ranges if the source span is fully cut out.
 */
export function sourceRangeToTimelineRanges(
  clips: VideoClip[],
  sourceId: string | null | undefined,
  sourceStart: number,
  sourceEnd: number,
  transitions: TransitionEntry[] = [],
): Array<{ timelineStart: number; timelineEnd: number }> {
  if (sourceEnd <= sourceStart) return [];
  const ranges: Array<{ timelineStart: number; timelineEnd: number }> = [];
  const schedule = buildClipSchedule(clips, transitions);
  for (const entry of schedule) {
    if (sourceId && entry.sourceId !== sourceId) {
      continue;
    }
    const clipSourceStart = entry.sourceStart;
    const clipSourceEnd = entry.sourceStart + entry.sourceDuration;
    const overlapStart = Math.max(sourceStart, clipSourceStart);
    const overlapEnd = Math.min(sourceEnd, clipSourceEnd);

    if (overlapEnd > overlapStart) {
      ranges.push({
        timelineStart: entry.timelineStart + (overlapStart - clipSourceStart) / entry.speed,
        timelineEnd: entry.timelineStart + (overlapEnd - clipSourceStart) / entry.speed,
      });
    }
  }
  return ranges;
}

export function mergeSourceRanges(
  ranges: SourceRangeRef[],
): SourceRangeRef[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges]
    .filter((range) => range.sourceEnd > range.sourceStart)
    .sort((a, b) => {
      const aId = getSourceRangeId(a) ?? '';
      const bId = getSourceRangeId(b) ?? '';
      return aId.localeCompare(bId) || a.sourceStart - b.sourceStart || a.sourceEnd - b.sourceEnd;
    });
  if (sorted.length === 0) return [];

  const merged: SourceRangeRef[] = [{ ...sorted[0] }];
  for (const range of sorted.slice(1)) {
    const current = merged[merged.length - 1];
    if (
      getSourceRangeId(range) === getSourceRangeId(current)
      && range.sourceStart <= current.sourceEnd + 1e-6
    ) {
      current.sourceEnd = Math.max(current.sourceEnd, range.sourceEnd);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function subtractSourceRanges(
  target: SourceRangeRef,
  removed: SourceRangeRef[],
): SourceRangeRef[] {
  let remaining: SourceRangeRef[] = [{ ...target }];
  const targetSourceId = getSourceRangeId(target);
  for (const cut of mergeSourceRanges(removed)) {
    if (targetSourceId !== getSourceRangeId(cut)) continue;
    remaining = remaining.flatMap((range) => {
      if (cut.sourceEnd <= range.sourceStart || cut.sourceStart >= range.sourceEnd) {
        return [range];
      }
      const next: SourceRangeRef[] = [];
      if (cut.sourceStart > range.sourceStart) {
        next.push({
          ...range,
          sourceStart: range.sourceStart,
          sourceEnd: Math.min(cut.sourceStart, range.sourceEnd),
        });
      }
      if (cut.sourceEnd < range.sourceEnd) {
        next.push({
          ...range,
          sourceStart: Math.max(cut.sourceEnd, range.sourceStart),
          sourceEnd: range.sourceEnd,
        });
      }
      return next;
    });
    if (remaining.length === 0) break;
  }
  return remaining.filter((range) => range.sourceEnd - range.sourceStart > 1e-3);
}

export function sourceRangesForAction(
  clips: VideoClip[],
  action: EditAction,
): SourceRangeRef[] {
  if (action.type === 'delete_range') {
    if (action.deleteStartTime === undefined || action.deleteEndTime === undefined) return [];
    return getSourceSegmentsForTimelineRange(clips, action.deleteStartTime, action.deleteEndTime)
      .map((segment) => ({
        sourceId: segment.sourceId,
        sourceStart: segment.sourceStart,
        sourceEnd: segment.sourceStart + segment.sourceDuration,
      }));
  }

  if (action.type === 'delete_ranges') {
    return (action.ranges ?? []).flatMap((range) => (
      getSourceSegmentsForTimelineRange(clips, range.start, range.end).map((segment) => ({
        sourceId: segment.sourceId,
        sourceStart: segment.sourceStart,
        sourceEnd: segment.sourceStart + segment.sourceDuration,
      }))
    ));
  }

  if (action.type === 'add_captions' && action.transcriptRange) {
    return getSourceSegmentsForTimelineRange(
      clips,
      action.transcriptRange.startTime,
      action.transcriptRange.endTime,
    ).map((segment) => ({
      sourceId: segment.sourceId,
      sourceStart: segment.sourceStart,
      sourceEnd: segment.sourceStart + segment.sourceDuration,
    }));
  }

  return [];
}

/**
 * Build a transcript string from raw captions remapped to the current timeline.
 * Captions whose source time falls in deleted segments are omitted.
 */
function scoreCaptionLineBreak(left: string, right: string, maxCharsPerLine: number): number {
  const overflowPenalty = Math.max(0, left.length - maxCharsPerLine) + Math.max(0, right.length - maxCharsPerLine);
  const balancePenalty = Math.abs(left.length - right.length) * 0.35;
  const lastLeftWord = left.split(' ').at(-1)?.toLowerCase() ?? '';
  const awkwardBreakPenalty = ['a', 'an', 'and', 'but', 'for', 'in', 'of', 'or', 'the', 'to'].includes(lastLeftWord) ? 8 : 0;
  return overflowPenalty * 100 + balancePenalty + awkwardBreakPenalty;
}

function buildBalancedCaptionLines(
  words: CaptionCueWord[],
  maxCharsPerLine = DEFAULT_MAX_CAPTION_CHARS_PER_LINE,
): string[] {
  const textWords = words.map((word) => word.text.trim()).filter(Boolean);
  if (textWords.length === 0) return [];
  const fullText = textWords.join(' ');
  if (fullText.length <= maxCharsPerLine || textWords.length === 1) {
    return [fullText];
  }

  let bestSplitIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let index = 1; index < textWords.length; index += 1) {
    const left = textWords.slice(0, index).join(' ');
    const right = textWords.slice(index).join(' ');
    const score = scoreCaptionLineBreak(left, right, maxCharsPerLine);
    if (score < bestScore) {
      bestScore = score;
      bestSplitIndex = index;
    }
  }

  if (bestSplitIndex <= 0) {
    return [fullText];
  }

  return [
    textWords.slice(0, bestSplitIndex).join(' '),
    textWords.slice(bestSplitIndex).join(' '),
  ];
}

function trimCaptionWordsToWindow(
  words: CaptionCueWord[],
  maxCharsPerLine = DEFAULT_MAX_CAPTION_CHARS_PER_LINE,
  maxLines = DEFAULT_CAPTION_MAX_LINES,
): CaptionCueWord[] {
  const safeWords = words.map((word) => ({ ...word, text: word.text.trim() })).filter((word) => word.text);
  if (safeWords.length <= 1) return safeWords;

  let startIndex = 0;
  let visibleWords = safeWords;
  let lines = buildBalancedCaptionLines(visibleWords, maxCharsPerLine);
  let totalChars = lines.join(' ').length;

  while (
    startIndex < safeWords.length - 1
    && (
      lines.length > maxLines
      || lines.some((line) => line.length > maxCharsPerLine + 8)
      || totalChars > maxCharsPerLine * maxLines + 12
    )
  ) {
    startIndex += 1;
    visibleWords = safeWords.slice(startIndex);
    lines = buildBalancedCaptionLines(visibleWords, maxCharsPerLine);
    totalChars = lines.join(' ').length;
  }

  return visibleWords;
}

function captionLinesExceedWindow(
  words: CaptionCueWord[],
  maxCharsPerLine = DEFAULT_MAX_CAPTION_CHARS_PER_LINE,
  maxLines = DEFAULT_CAPTION_MAX_LINES,
): boolean {
  if (words.length <= 1) return false;
  const lines = buildBalancedCaptionLines(words, maxCharsPerLine);
  if (lines.length > maxLines) return true;
  if (lines.some((line) => line.length > maxCharsPerLine + 8)) return true;
  return lines.join(' ').length > maxCharsPerLine * maxLines + 12;
}

export function projectCaptionWordsToTimeline(
  clips: VideoClip[],
  rawCaptions: CaptionEntry[],
  transitions: TransitionEntry[] = [],
): CaptionCueWord[] {
  return rawCaptions
    .map((cap) => {
      const captionSourceId = normalizeSourceId(cap.sourceId);
      if (!captionSourceId) {
        if (cap.endTime <= cap.startTime || !cap.text.trim()) return [];
        return [{
          startTime: cap.startTime,
          endTime: cap.endTime,
          text: cap.text.trim(),
        }];
      }
      const occurrences = sourceRangeToTimelineRanges(clips, captionSourceId, cap.startTime, cap.endTime, transitions)
        .filter((range) => range.timelineEnd > range.timelineStart);
      return occurrences.map((range) => ({
        startTime: range.timelineStart,
        endTime: range.timelineEnd,
        text: cap.text.trim(),
      }));
    })
    .flat()
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime)
    .filter((entry): entry is CaptionCueWord => !!entry && !!entry.text);
}

export type CaptionRenderWindow = {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  lines: string[];
};

function buildStaticCaptionLines(
  text: string,
  maxCharsPerLine = DEFAULT_MAX_CAPTION_CHARS_PER_LINE,
  maxLines = DEFAULT_CAPTION_MAX_LINES,
): string[] {
  const normalized = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (normalized.length === 0) return [];
  if (normalized.length > 1) return normalized.slice(-maxLines);
  return buildBalancedCaptionLines(
    normalized[0]
      .split(/\s+/)
      .filter(Boolean)
      .map((word, index) => ({ text: word, startTime: index, endTime: index + 1 })),
    maxCharsPerLine,
  ).slice(-maxLines);
}

function buildRollingCaptionLines(
  words: CaptionCueWord[],
  maxCharsPerLine = DEFAULT_MAX_CAPTION_CHARS_PER_LINE,
  maxLines = DEFAULT_CAPTION_MAX_LINES,
): string[] {
  return buildBalancedCaptionLines(words, maxCharsPerLine).slice(0, maxLines);
}

export function buildCaptionEntriesFromWords(
  words: CaptionCueWord[],
  options?: {
    pauseBreakSeconds?: number;
    maxCharsPerLine?: number;
    maxLines?: number;
  },
): CaptionEntry[] {
  const pauseBreakSeconds = options?.pauseBreakSeconds ?? DEFAULT_CAPTION_PAUSE_BREAK_SECONDS;
  const maxCharsPerLine = options?.maxCharsPerLine ?? DEFAULT_MAX_CAPTION_CHARS_PER_LINE;
  const maxLines = options?.maxLines ?? DEFAULT_CAPTION_MAX_LINES;
  const sortedWords = [...words]
    .map((word) => ({ ...word, text: word.text.trim() }))
    .filter((word) => word.text && word.endTime > word.startTime)
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
  if (sortedWords.length === 0) return [];

  const entries: CaptionEntry[] = [];
  let activeWords: CaptionCueWord[] = [];

  const flushActiveWords = () => {
    if (activeWords.length === 0) return;
    entries.push({
      startTime: activeWords[0].startTime,
      endTime: activeWords[activeWords.length - 1].endTime,
      text: activeWords.map((word) => word.text).join(' '),
      words: activeWords.map((word) => ({ ...word })),
      renderStyle: 'rolling_word',
    });
    activeWords = [];
  };

  for (const word of sortedWords) {
    const pauseSinceLast = activeWords.length > 0
      ? word.startTime - activeWords[activeWords.length - 1].endTime
      : 0;
    const candidateWords = [...activeWords, word];
    const candidateDuration = candidateWords[candidateWords.length - 1].endTime - candidateWords[0].startTime;
    const candidateWouldOverflow = activeWords.length > 0
      && captionLinesExceedWindow(candidateWords, maxCharsPerLine, maxLines);
    const shouldFlush = activeWords.length > 0 && (
      pauseSinceLast > pauseBreakSeconds
      || candidateWords.length > 22
      || candidateDuration > 6.2
      || candidateWouldOverflow
      || (
        CAPTION_PUNCTUATION_BREAK.test(activeWords[activeWords.length - 1].text)
        && pauseSinceLast > 0.12
        && activeWords.length >= 3
      )
    );

    if (shouldFlush) {
      flushActiveWords();
    }

    activeWords.push(word);
  }

  flushActiveWords();
  return entries;
}

export function buildCaptionRenderWindows(
  rawCaptions: CaptionEntry[],
  options?: {
    maxCharsPerLine?: number;
    maxLines?: number;
  },
): CaptionRenderWindow[] {
  const maxCharsPerLine = options?.maxCharsPerLine ?? DEFAULT_MAX_CAPTION_CHARS_PER_LINE;
  const maxLines = options?.maxLines ?? DEFAULT_CAPTION_MAX_LINES;

  return [...rawCaptions]
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime)
    .flatMap((caption, captionIndex) => {
      const renderStyle = caption.renderStyle ?? 'static';
      const cueId = caption.id ?? `caption_${captionIndex}_${Math.round(caption.startTime * 1000)}`;
      if (renderStyle === 'rolling_word' && Array.isArray(caption.words) && caption.words.length > 0) {
        const words = caption.words
          .map((word) => ({ ...word, text: word.text.trim() }))
          .filter((word): word is CaptionCueWord => Boolean(word.text) && word.endTime > word.startTime)
          .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
        return words.flatMap((word, wordIndex) => {
          const isNewChangePoint = wordIndex === 0
            || Math.abs(word.startTime - words[wordIndex - 1].startTime) > CAPTION_SIMULTANEOUS_WORD_EPSILON;
          if (!isNewChangePoint) return [];

          let visibleWordEndIndex = wordIndex;
          while (
            visibleWordEndIndex + 1 < words.length
            && Math.abs(words[visibleWordEndIndex + 1].startTime - word.startTime) <= CAPTION_SIMULTANEOUS_WORD_EPSILON
          ) {
            visibleWordEndIndex += 1;
          }

          const lines = buildRollingCaptionLines(words.slice(0, visibleWordEndIndex + 1), maxCharsPerLine, maxLines);
          const nextWord = words[visibleWordEndIndex + 1];
          const endTime = nextWord?.startTime ?? caption.endTime;
          if (lines.length === 0 || endTime <= word.startTime) return [];
          return [{
            id: `${cueId}:word:${wordIndex}`,
            startTime: word.startTime,
            endTime,
            text: lines.join('\n'),
            lines,
          }];
        });
      }

      const lines = buildStaticCaptionLines(caption.text, maxCharsPerLine, maxLines);
      if (lines.length === 0 || caption.endTime <= caption.startTime) return [];
      return [{
        id: cueId,
        startTime: caption.startTime,
        endTime: caption.endTime,
        text: lines.join('\n'),
        lines,
      }];
    });
}

export function buildCaptionCues(
  clips: VideoClip[],
  rawCaptions: CaptionEntry[],
  transitions: TransitionEntry[] = [],
  options?: {
    maxCharsPerLine?: number;
    maxLines?: number;
    pauseBreakSeconds?: number;
  },
): CaptionCue[] {
  const maxCharsPerLine = options?.maxCharsPerLine ?? DEFAULT_MAX_CAPTION_CHARS_PER_LINE;
  const maxLines = options?.maxLines ?? DEFAULT_CAPTION_MAX_LINES;
  const pauseBreakSeconds = options?.pauseBreakSeconds ?? DEFAULT_CAPTION_PAUSE_BREAK_SECONDS;
  const mapped = projectCaptionWordsToTimeline(clips, rawCaptions, transitions);
  if (mapped.length === 0) return [];

  const cues: CaptionCue[] = [];
  let activeWords: CaptionCueWord[] = [];

  const flushActiveWords = () => {
    if (activeWords.length === 0) return;
    const lines = buildBalancedCaptionLines(activeWords, maxCharsPerLine).slice(0, maxLines);
    const text = lines.join('\n');
    if (!text.trim()) {
      activeWords = [];
      return;
    }
    cues.push({
      id: `cue_${Math.round(activeWords[0].startTime * 1000)}_${Math.round(activeWords[activeWords.length - 1].endTime * 1000)}_${cues.length}`,
      startTime: activeWords[0].startTime,
      endTime: activeWords[activeWords.length - 1].endTime,
      text,
      lines,
      words: activeWords,
    });
    activeWords = [];
  };

  for (const word of mapped) {
    const pauseSinceLast = activeWords.length > 0
      ? word.startTime - activeWords[activeWords.length - 1].endTime
      : 0;
    const candidateWords = [...activeWords, word];
    const candidateDuration = candidateWords[candidateWords.length - 1].endTime - candidateWords[0].startTime;
    const shouldFlush = activeWords.length > 0 && (
      pauseSinceLast > pauseBreakSeconds
      || candidateWords.length > 22
      || candidateDuration > 6.2
      || (
        CAPTION_PUNCTUATION_BREAK.test(activeWords[activeWords.length - 1].text)
        && pauseSinceLast > 0.12
        && activeWords.length >= 3
      )
    );

    if (shouldFlush) {
      flushActiveWords();
    }

    activeWords.push(word);
  }

  flushActiveWords();
  return cues;
}

export function getCaptionCueDisplay(cue: CaptionCue, currentTime: number): { text: string; lines: string[] } {
  const maxCharsPerLine = DEFAULT_MAX_CAPTION_CHARS_PER_LINE;
  const maxLines = DEFAULT_CAPTION_MAX_LINES;
  const visibleWords = cue.words.filter((word) => currentTime + 0.03 >= word.startTime);
  const displayWords = trimCaptionWordsToWindow(
    visibleWords.length > 0 ? visibleWords : cue.words.slice(0, 1),
    maxCharsPerLine,
    maxLines,
  );
  const lines = buildBalancedCaptionLines(displayWords, maxCharsPerLine).slice(0, maxLines);
  return {
    text: lines.join('\n'),
    lines,
  };
}

export function buildTranscriptContext(
  clips: VideoClip[],
  rawCaptions: CaptionEntry[],
  transitions: TransitionEntry[] = [],
): string {
  const mapped = projectCaptionWordsToTimeline(clips, rawCaptions, transitions);

  const lines: string[] = [];
  let active: { startTime: number; endTime: number; parts: string[] } | null = null;

  for (const entry of mapped) {
    const pauseSinceLast = active ? entry.startTime - active.endTime : Infinity;
    const nextWordCount = (active?.parts.length ?? 0) + 1;
    const nextTextLength = active
      ? active.parts.join(' ').length + 1 + entry.text.length
      : entry.text.length;
    const shouldFlush = !!active && (
      pauseSinceLast > 0.45 ||
      nextWordCount > 10 ||
      nextTextLength > 72
    );

    if (!active || shouldFlush) {
      if (active) {
        lines.push(`[${formatTimePrecise(active.startTime)}-${formatTimePrecise(active.endTime)}] ${active.parts.join(' ')}`);
      }
      active = {
        startTime: entry.startTime,
        endTime: entry.endTime,
        parts: [entry.text],
      };
      continue;
    }

    active.endTime = entry.endTime;
    active.parts.push(entry.text);
  }

  if (active) {
    lines.push(`[${formatTimePrecise(active.startTime)}-${formatTimePrecise(active.endTime)}] ${active.parts.join(' ')}`);
  }

  return lines.join('\n');
}

function evenlyDownsampleFrames(
  frames: IndexedVideoFrame[],
  targetCount: number,
): IndexedVideoFrame[] {
  if (targetCount <= 0 || frames.length <= targetCount) return frames;
  if (targetCount === 1) return [frames[0]];

  const selected: IndexedVideoFrame[] = [];
  for (let index = 0; index < targetCount; index += 1) {
    const frameIndex = Math.min(
      frames.length - 1,
      Math.round(index * (frames.length - 1) / (targetCount - 1)),
    );
    const frame = frames[frameIndex];
    if (!frame) continue;
    if (selected.length > 0 && selected[selected.length - 1] === frame) continue;
    selected.push(frame);
  }

  return selected;
}

export function projectSourceFramesToTimelineAll(
  clips: VideoClip[],
  sourceFrames: SourceIndexedFrame[],
  transitions: TransitionEntry[] = [],
): IndexedVideoFrame[] {
  if (clips.length === 0 || sourceFrames.length === 0) return [];

  return sourceFrames
    .flatMap((frame) => {
      const timelineOccurrences = sourceTimeToTimelineOccurrences(clips, frame.sourceTime, frame.sourceId, transitions)
        .filter((timelineTime) => Number.isFinite(timelineTime));
      return timelineOccurrences.map((timelineTime) => ({
        image: frame.image,
        timelineTime,
        projectedTimelineTime: timelineTime,
        sourceTime: frame.sourceTime,
        sourceId: frame.sourceId,
        kind: 'overview' as const,
        description: frame.description,
        sampleKind: frame.sampleKind,
        score: frame.score ?? null,
        sceneId: frame.sceneId ?? null,
        visibleOnTimeline: true,
      }));
    })
    .sort((a, b) => a.timelineTime - b.timelineTime || a.sourceTime - b.sourceTime);
}

export function projectSourceFramesToTimeline(
  clips: VideoClip[],
  sourceFrames: SourceIndexedFrame[],
  frameTargetConfig: { overviewIntervalSeconds: number; maxOverviewFrames: number },
  transitions: TransitionEntry[] = [],
): IndexedVideoFrame[] {
  const projected = projectSourceFramesToTimelineAll(clips, sourceFrames, transitions);

  if (projected.length === 0) return [];

  const duration = getTimelineDuration(clips, transitions);
  const preferredInterval = Math.max(0.1, frameTargetConfig.overviewIntervalSeconds);
  const targetCount = Math.max(
    1,
    Math.min(
      projected.length,
      getOverviewFrameTarget(duration, preferredInterval, frameTargetConfig.maxOverviewFrames),
    ),
  );

  return evenlyDownsampleFrames(projected, targetCount);
}

type TimelineSpeechSegment = {
  startTime: number;
  endTime: number;
};

export function getTimelineDuration(clips: VideoClip[], transitions: TransitionEntry[] = []): number {
  return getRenderTimelineDuration(clips, transitions);
}

function collectTimelineClipBoundaries(clips: VideoClip[], transitions: TransitionEntry[] = []): number[] {
  return buildClipSchedule(clips, transitions).map((entry) => entry.timelineEnd);
}

function mergeTimelineSpeechSegments(segments: TimelineSpeechSegment[]): TimelineSpeechSegment[] {
  if (segments.length === 0) return [];

  const sorted = [...segments]
    .filter((segment) => segment.endTime > segment.startTime)
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);

  if (sorted.length === 0) return [];

  const merged = [{ ...sorted[0] }];
  for (const segment of sorted.slice(1)) {
    const current = merged[merged.length - 1];
    if (segment.startTime <= current.endTime + 0.01) {
      current.endTime = Math.max(current.endTime, segment.endTime);
    } else {
      merged.push({ ...segment });
    }
  }

  return merged;
}

export function buildTimelineSpeechSegments(
  clips: VideoClip[],
  rawCaptions: CaptionEntry[],
  transitions: TransitionEntry[] = [],
): TimelineSpeechSegment[] {
  if (clips.length === 0 || rawCaptions.length === 0) return [];

  return mergeTimelineSpeechSegments(
    projectCaptionWordsToTimeline(clips, rawCaptions, transitions)
      .map((word) => ({ startTime: word.startTime, endTime: word.endTime })),
  );
}

export function buildTimelineSilenceCandidates(
  clips: VideoClip[],
  rawCaptions: CaptionEntry[],
  settings: {
    paddingSeconds: number;
    minDurationSeconds: number;
    preserveShortPauses?: boolean;
  },
  transitions: TransitionEntry[] = [],
): SilenceCandidate[] {
  const timelineDuration = getTimelineDuration(clips, transitions);
  if (timelineDuration <= 0) return [];
  const clipBoundaries = collectTimelineClipBoundaries(clips, transitions);

  const speechSegments = buildTimelineSpeechSegments(clips, rawCaptions, transitions);
  const paddingSeconds = Math.max(0, settings.paddingSeconds);
  const minDurationSeconds = Math.max(0, settings.minDurationSeconds);
  const preserveShortPauses = settings.preserveShortPauses ?? false;
  const gaps: Array<{ gapStart: number; gapEnd: number }> = [];

  if (speechSegments.length === 0) {
    gaps.push({ gapStart: 0, gapEnd: timelineDuration });
  } else {
    if (speechSegments[0].startTime > 0) {
      gaps.push({ gapStart: 0, gapEnd: speechSegments[0].startTime });
    }

    for (let index = 0; index < speechSegments.length - 1; index += 1) {
      const current = speechSegments[index];
      const next = speechSegments[index + 1];
      if (next.startTime > current.endTime) {
        gaps.push({ gapStart: current.endTime, gapEnd: next.startTime });
      }
    }

    const lastSpeechSegment = speechSegments[speechSegments.length - 1];
    if (lastSpeechSegment.endTime < timelineDuration) {
      gaps.push({ gapStart: lastSpeechSegment.endTime, gapEnd: timelineDuration });
    }
  }

  return gaps.flatMap((gap) => {
    const gapDuration = gap.gapEnd - gap.gapStart;
    if (gapDuration <= 0) return [];
    if (preserveShortPauses && gapDuration < Math.max(0.35, minDurationSeconds + paddingSeconds * 2)) {
      return [];
    }

    const touchesTimelineStart = gap.gapStart <= 1e-3;
    const touchesTimelineEnd = gap.gapEnd >= timelineDuration - 1e-3;
    const touchesClipBoundaryStart = clipBoundaries.some((boundary) => Math.abs(gap.gapStart - boundary) <= 1e-3);
    const touchesClipBoundaryEnd = clipBoundaries.some((boundary) => Math.abs(gap.gapEnd - boundary) <= 1e-3);
    // Only preserve padding next to speech. If silence reaches the timeline edge,
    // or a hard clip boundary, cut all the way to that edge instead of leaving
    // a tiny silent tail/head clip behind.
    const deleteStart = touchesTimelineStart || touchesClipBoundaryStart
      ? gap.gapStart
      : Math.min(gap.gapEnd, gap.gapStart + paddingSeconds);
    const deleteEnd = touchesTimelineEnd || touchesClipBoundaryEnd
      ? gap.gapEnd
      : Math.max(deleteStart, gap.gapEnd - paddingSeconds);
    const duration = deleteEnd - deleteStart;
    if (duration < minDurationSeconds) return [];

    return [{
      gapStart: gap.gapStart,
      gapEnd: gap.gapEnd,
      deleteStart,
      deleteEnd,
      duration,
    }];
  });
}

/** Generate a deterministic pseudo-waveform array (normalized 0-1) for visual display */
export function generateWaveform(duration: number, bars: number): number[] {
  const result: number[] = [];
  let seed = duration * 1337;
  for (let i = 0; i < bars; i++) {
    seed = (seed * 9301 + 49297) % 233280;
    const rand = seed / 233280;
    // Mix to make it feel more like audio
    const envelope = Math.sin((i / bars) * Math.PI) * 0.6 + 0.4;
    result.push(0.15 + rand * 0.8 * envelope);
  }
  return result;
}
