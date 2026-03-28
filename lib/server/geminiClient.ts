import type { MusicEnergy, MusicMood, SegmentVibeClassification } from '../types';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const BATCH_SIZE = 50;

interface SegmentInput {
  id: string;
  text: string;
  durationSeconds: number;
  pauseAfterMs: number;
}

const VALID_MOODS = new Set<MusicMood>([
  'upbeat', 'calm', 'dramatic', 'melancholic',
  'playful', 'suspenseful', 'inspirational', 'neutral',
]);
const VALID_ENERGIES = new Set<MusicEnergy>(['low', 'medium', 'high']);

function getApiKey(): string {
  const key = process.env.GOOGLE_GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GOOGLE_GEMINI_API_KEY is not set');
  return key;
}

function getModel(): string {
  return process.env.GEMINI_CLASSIFICATION_MODEL?.trim() || 'gemini-2.0-flash';
}

const SYSTEM_PROMPT = `You are a music supervisor analyzing video transcript segments to select background music. For each segment, classify the emotional mood, energy level, and suggest music genre hints based on the content and pacing.

Return a JSON array with one object per segment in the same order as the input:
{
  "segmentId": "<id>",
  "mood": "upbeat" | "calm" | "dramatic" | "melancholic" | "playful" | "suspenseful" | "inspirational" | "neutral",
  "energy": "low" | "medium" | "high",
  "genreHints": ["genre1", "genre2"],
  "confidence": <number between 0.0 and 1.0>
}

Guidelines:
- Consider both the words spoken AND the pacing (short segments with long pauses may indicate dramatic beats).
- genreHints should be 1-3 music genres or styles (e.g. "ambient", "electronic", "orchestral", "lo-fi", "acoustic").
- confidence reflects how certain you are about the classification (0.5 = uncertain, 1.0 = very clear emotional signal).
- When text is purely informational with no emotional signal, use mood "neutral" and energy "medium".`;

async function classifyBatch(
  segments: SegmentInput[],
  apiKey: string,
  model: string,
): Promise<SegmentVibeClassification[]> {
  const userContent = JSON.stringify(
    segments.map((s) => ({
      id: s.id,
      text: s.text,
      durationSeconds: Math.round(s.durationSeconds * 10) / 10,
      pauseAfterMs: s.pauseAfterMs,
    })),
  );

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ parts: [{ text: userContent }] }],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0.3,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');

  const parsed: unknown[] = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('Gemini response is not an array');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return parsed.map((item: any) => ({
    segmentId: String(item.segmentId ?? ''),
    mood: VALID_MOODS.has(item.mood) ? item.mood : 'neutral',
    energy: VALID_ENERGIES.has(item.energy) ? item.energy : 'medium',
    genreHints: Array.isArray(item.genreHints)
      ? item.genreHints.map(String).slice(0, 3)
      : [],
    confidence: typeof item.confidence === 'number'
      ? Math.max(0, Math.min(1, item.confidence))
      : 0.5,
  }));
}

/**
 * Classify transcript segments for mood/energy using Gemini.
 * Automatically batches large segment lists into chunks of 50.
 */
export async function classifySegmentVibes(
  segments: SegmentInput[],
): Promise<SegmentVibeClassification[]> {
  if (segments.length === 0) return [];

  const apiKey = getApiKey();
  const model = getModel();
  const results: SegmentVibeClassification[] = [];

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const batchResults = await classifyBatch(batch, apiKey, model);
    results.push(...batchResults);
  }

  return results;
}
