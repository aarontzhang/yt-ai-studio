'use client';

import { extractAudioSegment } from './ffmpegClient';
import { CaptionEntry } from './types';
import { getCaptionSourceId } from './sourceUtils';

type TimeRange = { startTime: number; endTime: number };
type TranscriptionResponse = {
  captions?: CaptionEntry[];
  words?: CaptionEntry[];
  error?: string;
  retryAfterSeconds?: number;
};
type TranscriptionProgressOptions = {
  onProgress?: (progress: { completed: number; total: number }) => void;
  sourceId?: string;
};

const MAX_TRANSCRIPTION_REQUEST_RETRIES = 3;
const TRANSCRIPTION_REQUEST_TIMEOUT_MS = 120_000;
const TRANSCRIPTION_RETRY_BASE_DELAY_MS = 1_500;

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function parseTranscriptionResponse(res: Response): Promise<TranscriptionResponse | null> {
  return res.json().catch(() => null);
}

async function requestTranscriptionChunk(params: {
  audioBlob: Blob;
  range: TimeRange;
  wordsPerCaption: number;
}): Promise<TranscriptionResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_TRANSCRIPTION_REQUEST_RETRIES; attempt += 1) {
    const ctrl = new AbortController();
    const timeoutId = window.setTimeout(() => {
      try {
        ctrl.abort(new DOMException('The transcription request timed out.', 'AbortError'));
      } catch {
        ctrl.abort();
      }
    }, TRANSCRIPTION_REQUEST_TIMEOUT_MS);

    try {
      const form = new FormData();
      form.append('audio', params.audioBlob, 'audio.mp3');
      form.append('startTime', String(params.range.startTime));
      form.append('requestedDuration', String(Math.max(0, params.range.endTime - params.range.startTime)));
      form.append('wordsPerCaption', String(params.wordsPerCaption));

      const res = await fetch('/api/transcribe', {
        method: 'POST',
        body: form,
        signal: ctrl.signal,
      });
      const data = await parseTranscriptionResponse(res);
      if (!res.ok) {
        const retryAfterSeconds = Number(res.headers.get('Retry-After') ?? data?.retryAfterSeconds);
        const nextError = new Error(data?.error ?? 'Transcription failed');
        lastError = nextError;
        if (
          attempt < MAX_TRANSCRIPTION_REQUEST_RETRIES
          && (res.status === 429 || res.status >= 500)
        ) {
          const retryDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : TRANSCRIPTION_RETRY_BASE_DELAY_MS * (attempt + 1);
          await sleep(retryDelay);
          continue;
        }
        throw nextError;
      }
      return data ?? {};
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error('Transcription failed');
      lastError = nextError;
      if (attempt >= MAX_TRANSCRIPTION_REQUEST_RETRIES) break;
      const isAbort = nextError.name === 'AbortError';
      await sleep((isAbort ? TRANSCRIPTION_RETRY_BASE_DELAY_MS * 2 : TRANSCRIPTION_RETRY_BASE_DELAY_MS) * (attempt + 1));
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error('Transcription failed');
}

export function buildOverlappingRanges(
  startTime: number,
  endTime: number,
  chunkDuration = 45,
  overlapSeconds = 0.75,
): TimeRange[] {
  const ranges: TimeRange[] = [];
  const safeStart = Math.max(0, startTime);
  const safeEnd = Math.max(safeStart, endTime);
  if (safeEnd <= safeStart) return ranges;

  const step = Math.max(1, chunkDuration - overlapSeconds);
  for (let cursor = safeStart; cursor < safeEnd; cursor += step) {
    const rangeEnd = Math.min(safeEnd, cursor + chunkDuration);
    ranges.push({ startTime: cursor, endTime: rangeEnd });
    if (rangeEnd >= safeEnd) break;
  }
  return ranges;
}

export function dedupeCaptionEntries(entries: CaptionEntry[], toleranceSeconds = 0.08): CaptionEntry[] {
  const sorted = [...entries].sort((a, b) => (
    getCaptionSourceId(a).localeCompare(getCaptionSourceId(b)) ||
    a.startTime - b.startTime ||
    a.endTime - b.endTime ||
    a.text.localeCompare(b.text)
  ));

  const deduped: CaptionEntry[] = [];
  for (const entry of sorted) {
    const text = entry.text.trim();
    if (!text) continue;
    const normalized: CaptionEntry = {
      ...entry,
      text,
      startTime: Math.max(0, entry.startTime),
      endTime: Math.max(entry.startTime, entry.endTime),
    };
    const last = deduped[deduped.length - 1];
    if (
      last &&
      getCaptionSourceId(last) === getCaptionSourceId(normalized) &&
      last.text === normalized.text &&
      Math.abs(last.startTime - normalized.startTime) <= toleranceSeconds &&
      Math.abs(last.endTime - normalized.endTime) <= toleranceSeconds
    ) {
      last.startTime = Math.min(last.startTime, normalized.startTime);
      last.endTime = Math.max(last.endTime, normalized.endTime);
      continue;
    }
    deduped.push(normalized);
  }

  return deduped;
}

export async function transcribeSourceRanges(
  source: Uint8Array | File | string,
  ranges: TimeRange[],
  wordsPerCaption: number,
  options: TranscriptionProgressOptions = {},
): Promise<CaptionEntry[]> {
  const rawEntries: CaptionEntry[] = [];
  const total = ranges.length;

  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    const audioBlob = await extractAudioSegment(source, range.startTime, range.endTime);
    const data = await requestTranscriptionChunk({ audioBlob, range, wordsPerCaption });
    const entries = ((data.words as CaptionEntry[]) ?? (data.captions as CaptionEntry[]) ?? [])
      .map((entry) => ({
        ...entry,
        ...(options.sourceId ? { sourceId: options.sourceId } : {}),
      }));
    rawEntries.push(...entries);
    options.onProgress?.({ completed: index + 1, total });
  }

  return dedupeCaptionEntries(rawEntries);
}
