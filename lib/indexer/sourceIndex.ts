import { v4 as uuidv4 } from 'uuid';
import { SceneBoundary, SourceIndex, SourceSegment, SourceWord } from '../types';

export const SOURCE_INDEX_VERSION = 'source-index-v2';

/** Common English filler words and sounds */
const FILLER_WORD_SET = new Set([
  'uh', 'um', 'uh-huh', 'uhh', 'umm', 'err', 'hmm', 'hm',
  'like', 'basically', 'literally', 'actually', 'honestly', 'frankly',
  'you know', 'i mean', 'you know what i mean', 'kind of', 'sort of',
  'kinda', 'sorta', 'right', 'okay', 'ok', 'so', 'well',
]);

/** Returns true if the word is a filler */
export function isFiller(word: string): boolean {
  return FILLER_WORD_SET.has(word.toLowerCase().trim().replace(/[.,!?]$/, ''));
}

type RawWord = { word: string; start: number; end: number };

/** Annotate raw Whisper words with isFiller */
export function annotateFillers(words: RawWord[]): SourceWord[] {
  return words.map((w) => ({
    word: w.word,
    start: w.start,
    end: w.end,
    isFiller: isFiller(w.word),
  }));
}

/**
 * Group words into sentence-level segments.
 * Splits on: sentence-ending punctuation, long pauses (>0.8s), or every 20 words max.
 */
export function groupWordsIntoSegments(words: SourceWord[]): SourceSegment[] {
  if (words.length === 0) return [];

  const segments: SourceSegment[] = [];
  let current: SourceWord[] = [];

  const flushSegment = () => {
    if (current.length === 0) return;
    const first = current[0];
    const last = current[current.length - 1];
    const text = current.map((w) => w.word).join(' ').trim();
    const fillerWords = current.filter((w) => w.isFiller).map((w) => w.word);
    segments.push({
      id: `seg_${uuidv4().slice(0, 8)}`,
      text,
      sourceStart: first.start,
      sourceEnd: last.end,
      words: current,
      sceneId: null,
      fillerWords,
      pauseAfterMs: 0,
    });
    current = [];
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    current.push(word);

    const nextWord = words[i + 1];
    const pauseToNext = nextWord ? (nextWord.start - word.end) * 1000 : 0;
    const endsSentence = /[.!?]$/.test(word.word.trim());
    const longPause = pauseToNext > 800;
    const maxLength = current.length >= 20;

    if (endsSentence || (longPause && current.length >= 3) || maxLength) {
      flushSegment();
    }
  }
  flushSegment();

  // Set pauseAfterMs between consecutive segments
  for (let i = 0; i < segments.length - 1; i++) {
    const gapMs = (segments[i + 1].sourceStart - segments[i].sourceEnd) * 1000;
    segments[i].pauseAfterMs = Math.max(0, Math.round(gapMs));
  }

  return segments;
}

/** Assign scene IDs to segments based on which scene boundary they fall within */
export function assignSceneIds(segments: SourceSegment[], scenes: SceneBoundary[]): SourceSegment[] {
  if (scenes.length === 0) return segments;
  return segments.map((seg) => {
    const scene = scenes.find(
      (s) => seg.sourceStart >= s.sourceStart && seg.sourceStart < s.sourceEnd,
    );
    return { ...seg, sceneId: scene?.id ?? null };
  });
}

/** Build the full source index from word-level Whisper output and scene boundaries */
export function buildSourceIndex(
  rawWords: RawWord[],
  scenes: SceneBoundary[],
  sourceId: string,
  sourceDuration: number,
): SourceIndex {
  const annotated = annotateFillers(rawWords);
  const rawSegments = groupWordsIntoSegments(annotated);
  const segments = assignSceneIds(rawSegments, scenes);

  return {
    version: SOURCE_INDEX_VERSION,
    sourceId,
    sourceDuration,
    segments,
    scenes,
    indexedAt: new Date().toISOString(),
  };
}

// ─── Query helpers ────────────────────────────────────────────────────────────

/** Return all filler-word source ranges from the index */
export function findFillerRanges(
  index: SourceIndex,
): Array<{ sourceStart: number; sourceEnd: number; word: string }> {
  const results: Array<{ sourceStart: number; sourceEnd: number; word: string }> = [];
  for (const seg of index.segments) {
    for (const w of seg.words) {
      if (w.isFiller) {
        results.push({ sourceStart: w.start, sourceEnd: w.end, word: w.word });
      }
    }
  }
  return results;
}

/** Return all inter-segment pauses above a threshold */
export function findPauseRanges(
  index: SourceIndex,
  minDurationMs: number,
): Array<{ sourceStart: number; sourceEnd: number; durationMs: number }> {
  const results: Array<{ sourceStart: number; sourceEnd: number; durationMs: number }> = [];
  for (let i = 0; i < index.segments.length - 1; i++) {
    const seg = index.segments[i];
    const next = index.segments[i + 1];
    const durationMs = seg.pauseAfterMs;
    if (durationMs >= minDurationMs) {
      results.push({
        sourceStart: seg.sourceEnd,
        sourceEnd: next.sourceStart,
        durationMs,
      });
    }
  }
  return results;
}

/** Return segments that overlap a source time range */
export function getSegmentsInRange(
  index: SourceIndex,
  sourceStart: number,
  sourceEnd: number,
): SourceSegment[] {
  return index.segments.filter(
    (seg) => seg.sourceEnd > sourceStart && seg.sourceStart < sourceEnd,
  );
}

/** Return the transcript text for a source time range */
export function getTranscriptForRange(
  index: SourceIndex,
  sourceStart: number,
  sourceEnd: number,
): string {
  return getSegmentsInRange(index, sourceStart, sourceEnd)
    .map((seg) => seg.text)
    .join(' ');
}
