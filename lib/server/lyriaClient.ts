import type { MusicMood, MusicSegment } from '../types';
import { normalizeGeneratedAudio } from './audioNormalization';

const LYRIA_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function getApiKey(): string {
  const key = process.env.GOOGLE_LYRIA_API_KEY?.trim();
  if (!key) throw new Error('GOOGLE_LYRIA_API_KEY is not set');
  return key;
}

function getModel(): string {
  return process.env.LYRIA_MODEL?.trim() || 'lyria-3-clip-preview';
}

const MOOD_DESCRIPTIONS: Record<MusicMood, string> = {
  upbeat: 'cheerful, forward-moving, and optimistic',
  calm: 'peaceful, steady, and relaxing',
  dramatic: 'intense, cinematic, and powerful',
  melancholic: 'wistful, reflective, and bittersweet',
  playful: 'fun, lighthearted, and whimsical',
  suspenseful: 'tense, mysterious, and building anticipation',
  inspirational: 'uplifting, motivational, and soaring',
  neutral: 'subtle, unobtrusive, and ambient',
};

export interface LyriaGenerateResult {
  audioBase64: string;
  mimeType: string;
  extension: string;
}

function buildPrompt(segment: MusicSegment): string {
  const genreStr = segment.genreHints.length > 0
    ? segment.genreHints.join(', ') + ' '
    : '';
  const duration = Math.round(segment.sourceEnd - segment.sourceStart);
  const description = MOOD_DESCRIPTIONS[segment.mood];

  return [
    `${capitalize(segment.mood)}, ${segment.energy}-energy ${genreStr}background music.`,
    `Instrumental only, no vocals. Suitable for video background.`,
    `Duration: approximately ${duration} seconds.`,
    `Should feel ${description}.`,
  ].join(' ');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Generate a music cue for a MusicSegment using Google Lyria 3.
 * Returns the raw base64 audio and its MIME type.
 */
export async function generateMusicCue(
  segment: MusicSegment,
): Promise<LyriaGenerateResult> {
  const apiKey = getApiKey();
  const model = getModel();
  const prompt = buildPrompt(segment);

  const url = `${LYRIA_API_BASE}/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      response_modalities: ['AUDIO', 'TEXT'],
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Lyria API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!parts || parts.length === 0) {
    const finishMessage = typeof candidate?.finishMessage === 'string'
      ? candidate.finishMessage
      : null;
    throw new Error(finishMessage || 'Lyria returned no audio content');
  }

  const audioPart = parts.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (p: any) => p.inlineData?.mimeType?.startsWith('audio/'),
  );
  if (!audioPart?.inlineData) {
    const finishMessage = typeof candidate?.finishMessage === 'string'
      ? candidate.finishMessage
      : null;
    throw new Error(finishMessage || 'Lyria response contains no audio data');
  }

  const normalizedAudio = normalizeGeneratedAudio({
    audioBase64: audioPart.inlineData.data,
    mimeType: audioPart.inlineData.mimeType,
  });

  if (normalizedAudio.normalizedFromMimeType) {
    console.info(
      `[lyria] Normalized inline audio from ${normalizedAudio.normalizedFromMimeType} to ${normalizedAudio.mimeType}.`,
    );
  } else if (!normalizedAudio.browserPlayable) {
    console.warn(
      `[lyria] Returned inline audio with MIME type ${normalizedAudio.mimeType}, which may not be browser-playable.`,
    );
  }

  return {
    audioBase64: normalizedAudio.audioBase64,
    mimeType: normalizedAudio.mimeType,
    extension: normalizedAudio.extension,
  };
}

/** Build the text prompt for a given MusicSegment (exported for testing/worker use) */
export { buildPrompt as buildMusicPrompt };
