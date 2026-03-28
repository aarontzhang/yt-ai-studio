/**
 * Analysis Worker — processes background jobs from the analysis_jobs queue.
 *
 * Supports job types:
 *   index_asset       — video indexing (visual/transcript analysis)
 *   generate_music    — AI background music generation via Gemini + Lyria 3
 *
 * Usage:
 *   node scripts/analysis-worker.mjs
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   GOOGLE_GEMINI_API_KEY
 *   GOOGLE_LYRIA_API_KEY
 *
 * Optional:
 *   GEMINI_CLASSIFICATION_MODEL  (default: gemini-2.0-flash)
 *   LYRIA_MODEL                  (default: lyria-realtime-exp)
 *   WORKER_POLL_INTERVAL_MS      (default: 5000)
 *   WORKER_CONCURRENCY           (default: 2)
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local so the worker can run standalone with `node scripts/analysis-worker.mjs`
try {
  const envPath = resolve(import.meta.dirname, '..', '.env.local');
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

// ─── Configuration ───────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const LYRIA_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 2);
const WORKER_ID = `worker-${randomUUID().slice(0, 8)}`;
const GEMINI_MODEL = process.env.GEMINI_CLASSIFICATION_MODEL?.trim() || 'gemini-2.0-flash';
const LYRIA_MODEL = process.env.LYRIA_MODEL?.trim() || 'lyria-realtime-exp';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ─── Music Merge Algorithm (duplicated from lib/indexer/musicSegments.ts) ────

const ENERGY_NUMERIC = { low: 0, medium: 1, high: 2 };
const VALID_MOODS = new Set(['upbeat', 'calm', 'dramatic', 'melancholic', 'playful', 'suspenseful', 'inspirational', 'neutral']);
const VALID_ENERGIES = new Set(['low', 'medium', 'high']);

const DEFAULT_MERGE_OPTIONS = {
  maxSegmentDurationSeconds: 45,
  minSegmentDurationSeconds: 8,
  pauseBreakThresholdMs: 1500,
  energyShiftBreakThreshold: 2,
  sceneChangeBreak: true,
};

function modeByConfidence(values, confidences) {
  const counts = new Map();
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const entry = counts.get(v) ?? { count: 0, totalConf: 0 };
    entry.count++;
    entry.totalConf += confidences[i];
    counts.set(v, entry);
  }
  let best = values[0];
  let bestScore = { count: 0, totalConf: 0 };
  for (const [v, entry] of counts) {
    if (entry.count > bestScore.count || (entry.count === bestScore.count && entry.totalConf > bestScore.totalConf)) {
      best = v;
      bestScore = entry;
    }
  }
  return best;
}

function dedupeStrings(arr) {
  return [...new Set(arr)];
}

function uniqueNonNull(ids) {
  return [...new Set(ids.filter((id) => id !== null))];
}

function flushGroup(group) {
  const moods = group.classifications.map((c) => c.mood);
  const energies = group.classifications.map((c) => c.energy);
  const confidences = group.classifications.map((c) => c.confidence);
  const allGenres = group.classifications.flatMap((c) => c.genreHints);
  return {
    id: `mseg_${randomUUID().slice(0, 8)}`,
    sourceSegmentIds: group.segments.map((s) => s.id),
    sourceStart: group.segments[0].sourceStart,
    sourceEnd: group.segments[group.segments.length - 1].sourceEnd,
    mood: modeByConfidence(moods, confidences),
    energy: modeByConfidence(energies, confidences),
    genreHints: dedupeStrings(allGenres),
    sceneIds: uniqueNonNull(group.segments.map((s) => s.sceneId)),
  };
}

function segmentDuration(seg) {
  return seg.sourceEnd - seg.sourceStart;
}

function mergeTwo(a, b) {
  const primary = segmentDuration(a) >= segmentDuration(b) ? a : b;
  return {
    id: a.id,
    sourceSegmentIds: [...a.sourceSegmentIds, ...b.sourceSegmentIds],
    sourceStart: Math.min(a.sourceStart, b.sourceStart),
    sourceEnd: Math.max(a.sourceEnd, b.sourceEnd),
    mood: primary.mood,
    energy: primary.energy,
    genreHints: dedupeStrings([...a.genreHints, ...b.genreHints]),
    sceneIds: uniqueNonNull([...a.sceneIds, ...b.sceneIds]),
  };
}

function mergeShortSegments(segments, minDuration) {
  if (segments.length <= 1) return segments;
  const result = [...segments];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      if (segmentDuration(result[i]) >= minDuration) continue;
      const prevIdx = i > 0 ? i - 1 : null;
      const nextIdx = i < result.length - 1 ? i + 1 : null;
      let mergeWith = null;
      if (prevIdx !== null && nextIdx !== null) {
        const prevMatch = result[prevIdx].mood === result[i].mood;
        const nextMatch = result[nextIdx].mood === result[i].mood;
        if (prevMatch && !nextMatch) mergeWith = prevIdx;
        else if (!prevMatch && nextMatch) mergeWith = nextIdx;
        else mergeWith = segmentDuration(result[prevIdx]) <= segmentDuration(result[nextIdx]) ? prevIdx : nextIdx;
      } else {
        mergeWith = prevIdx ?? nextIdx;
      }
      if (mergeWith === null) continue;
      const lo = Math.min(i, mergeWith);
      const hi = Math.max(i, mergeWith);
      result.splice(lo, 2, mergeTwo(result[lo], result[hi]));
      changed = true;
      break;
    }
  }
  return result;
}

function buildMusicSegments(segments, classifications, options = {}) {
  if (segments.length === 0) return [];
  const opts = { ...DEFAULT_MERGE_OPTIONS, ...options };
  const classById = new Map(classifications.map((c) => [c.segmentId, c]));
  const paired = segments
    .map((seg) => ({ seg, cls: classById.get(seg.id) }))
    .filter((p) => !!p.cls);
  if (paired.length === 0) return [];

  const musicSegments = [];
  let currentGroup = { segments: [paired[0].seg], classifications: [paired[0].cls] };

  for (let i = 1; i < paired.length; i++) {
    const prev = paired[i - 1];
    const curr = paired[i];
    const groupDuration = curr.seg.sourceEnd - currentGroup.segments[0].sourceStart;
    const moodChanged = prev.cls.mood !== curr.cls.mood && !(prev.cls.mood === 'neutral' && curr.cls.mood === 'neutral');
    const energyJumped = Math.abs(ENERGY_NUMERIC[prev.cls.energy] - ENERGY_NUMERIC[curr.cls.energy]) >= opts.energyShiftBreakThreshold;
    const longPause = prev.seg.pauseAfterMs > opts.pauseBreakThresholdMs;
    const sceneCrossed = opts.sceneChangeBreak && prev.seg.sceneId !== null && curr.seg.sceneId !== null && prev.seg.sceneId !== curr.seg.sceneId;
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
  return mergeShortSegments(musicSegments, opts.minSegmentDurationSeconds);
}

// ─── Gemini Classification ────────────────────────────────────────────────────

const GEMINI_SYSTEM_PROMPT = `You are a music supervisor analyzing video transcript segments to select background music. For each segment, classify the emotional mood, energy level, and suggest music genre hints based on the content and pacing.

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

async function classifySegmentsBatch(segments, apiKey) {
  const userContent = JSON.stringify(segments.map((s) => ({
    id: s.id,
    text: s.text,
    durationSeconds: Math.round((s.sourceEnd - s.sourceStart) * 10) / 10,
    pauseAfterMs: s.pauseAfterMs,
  })));

  const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: GEMINI_SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: userContent }] }],
      generationConfig: { response_mime_type: 'application/json', temperature: 0.3 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('Gemini response is not an array');

  return parsed.map((item) => ({
    segmentId: String(item.segmentId ?? ''),
    mood: VALID_MOODS.has(item.mood) ? item.mood : 'neutral',
    energy: VALID_ENERGIES.has(item.energy) ? item.energy : 'medium',
    genreHints: Array.isArray(item.genreHints) ? item.genreHints.map(String).slice(0, 3) : [],
    confidence: typeof item.confidence === 'number' ? Math.max(0, Math.min(1, item.confidence)) : 0.5,
  }));
}

async function classifySegments(segments, apiKey) {
  const BATCH_SIZE = 50;
  const results = [];
  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const batchResults = await classifySegmentsBatch(batch, apiKey);
    results.push(...batchResults);
  }
  return results;
}

// ─── Lyria Music Generation ───────────────────────────────────────────────────

const MOOD_DESCRIPTIONS = {
  upbeat: 'cheerful, forward-moving, and optimistic',
  calm: 'peaceful, steady, and relaxing',
  dramatic: 'intense, cinematic, and powerful',
  melancholic: 'wistful, reflective, and bittersweet',
  playful: 'fun, lighthearted, and whimsical',
  suspenseful: 'tense, mysterious, and building anticipation',
  inspirational: 'uplifting, motivational, and soaring',
  neutral: 'subtle, unobtrusive, and ambient',
};

function buildMusicPrompt(segment) {
  const genreStr = segment.genreHints.length > 0 ? segment.genreHints.join(', ') + ' ' : '';
  const duration = Math.round(segment.sourceEnd - segment.sourceStart);
  const description = MOOD_DESCRIPTIONS[segment.mood] ?? 'subtle and ambient';
  const mood = segment.mood.charAt(0).toUpperCase() + segment.mood.slice(1);
  return [
    `${mood}, ${segment.energy}-energy ${genreStr}background music.`,
    `Instrumental only, no vocals. Suitable for video background.`,
    `Duration: approximately ${duration} seconds.`,
    `Should feel ${description}.`,
  ].join(' ');
}

async function generateMusicCue(segment, apiKey) {
  const url = `${LYRIA_API_BASE}/models/${LYRIA_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildMusicPrompt(segment) }] }],
      generationConfig: {
        response_modalities: ['AUDIO'],
        speech_config: {
          voice_config: {
            prebuilt_voice_config: { voice_name: 'Leda' },
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Lyria API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) throw new Error('Lyria returned no audio content');

  const audioPart = parts.find((p) => p.inlineData?.mimeType?.startsWith('audio/'));
  if (!audioPart?.inlineData) throw new Error('Lyria response contains no audio data');

  return {
    audioBase64: audioPart.inlineData.data,
    mimeType: audioPart.inlineData.mimeType,
  };
}

// ─── Job Processing ───────────────────────────────────────────────────────────

async function updateJobProgress(jobId, stage, completed, total, label) {
  await supabase
    .from('analysis_jobs')
    .update({ progress: { stage, completed, total, label: label ?? null, etaSeconds: null }, updated_at: new Date().toISOString() })
    .eq('id', jobId);
}

async function processGenerateMusicJob(job) {
  const { id: jobId, project_id: projectId, asset_id: assetId } = job;
  const geminiKey = process.env.GOOGLE_GEMINI_API_KEY?.trim();
  const lyriaKey = process.env.GOOGLE_LYRIA_API_KEY?.trim();

  if (!geminiKey) throw new Error('GOOGLE_GEMINI_API_KEY is not set');
  if (!lyriaKey) throw new Error('GOOGLE_LYRIA_API_KEY is not set');

  // 1. Fetch SourceIndex for the asset
  const { data: indexRow, error: indexError } = await supabase
    .from('source_indexes')
    .select('data')
    .eq('asset_id', assetId)
    .maybeSingle();

  if (indexError) throw indexError;
  if (!indexRow?.data) throw new Error(`No source index found for asset ${assetId}`);

  const sourceIndex = indexRow.data;
  const segments = sourceIndex.segments ?? [];
  const scenes = sourceIndex.scenes ?? [];

  if (segments.length === 0) {
    console.log(`[${jobId}] No segments to classify, skipping music generation.`);
    return { cueCount: 0, segments: [] };
  }

  // 2. Classify segments
  await updateJobProgress(jobId, 'classifying_segments', 0, segments.length, 'Classifying transcript mood/energy…');
  console.log(`[${jobId}] Classifying ${segments.length} segments with Gemini…`);
  const classifications = await classifySegments(segments, geminiKey);
  await updateJobProgress(jobId, 'merging_music_segments', segments.length, segments.length, 'Merging into music regions…');

  // 3. Build music segments
  const musicSegments = buildMusicSegments(segments, classifications, scenes);
  console.log(`[${jobId}] Built ${musicSegments.length} music segments.`);

  // 4. Generate music cues
  const cues = [];
  for (let i = 0; i < musicSegments.length; i++) {
    const seg = musicSegments[i];
    await updateJobProgress(jobId, 'generating_music', i, musicSegments.length, `Generating music ${i + 1} of ${musicSegments.length}…`);
    console.log(`[${jobId}] Generating music cue ${i + 1}/${musicSegments.length}: ${seg.mood}/${seg.energy} (${Math.round(seg.sourceEnd - seg.sourceStart)}s)`);

    let storagePath = null;
    try {
      const { audioBase64, mimeType } = await generateMusicCue(seg, lyriaKey);

      // Decode and upload
      const buffer = Buffer.from(audioBase64, 'base64');
      const ext = mimeType.includes('mp3') ? 'mp3' : mimeType.includes('wav') ? 'wav' : 'mp3';
      const cueId = randomUUID();
      storagePath = `${projectId}/${cueId}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('music')
        .upload(storagePath, buffer, { contentType: mimeType, upsert: true });

      if (uploadError) throw uploadError;
    } catch (err) {
      console.error(`[${jobId}] Failed to generate/upload cue ${i + 1}:`, err.message);
      // Continue with remaining cues even if one fails
    }

    // Insert music_cue row
    const { error: insertError } = await supabase
      .from('music_cues')
      .insert({
        project_id: projectId,
        asset_id: assetId,
        job_id: jobId,
        music_segment_id: seg.id,
        source_start: seg.sourceStart,
        source_end: seg.sourceEnd,
        duration_seconds: seg.sourceEnd - seg.sourceStart,
        mood: seg.mood,
        energy: seg.energy,
        genre_hints: seg.genreHints,
        storage_path: storagePath,
        status: storagePath ? 'suggested' : 'failed',
        volume_db: -18,
        fade_in_seconds: 1.0,
        fade_out_seconds: 1.5,
      });

    if (insertError) console.error(`[${jobId}] Failed to insert music cue:`, insertError.message);
    else cues.push({ segmentId: seg.id, storagePath });
  }

  await updateJobProgress(jobId, 'generating_music', musicSegments.length, musicSegments.length, 'Music generation complete');
  return { cueCount: cues.length, segments: musicSegments.length };
}

// ─── Worker Job Queue ─────────────────────────────────────────────────────────

async function claimNextJob() {
  const { data, error } = await supabase.rpc('claim_next_analysis_job', {
    p_worker_id: WORKER_ID,
    p_job_types: ['index_asset', 'generate_music'],
  }).maybeSingle();

  if (error) {
    // If the RPC doesn't exist, fall back to manual claim
    if (error.code === '42883') {
      return await claimNextJobManual();
    }
    throw error;
  }
  return data;
}

async function claimNextJobManual() {
  const { data, error } = await supabase
    .from('analysis_jobs')
    .select('id, project_id, asset_id, job_type, payload, attempt_count')
    .in('job_type', ['index_asset', 'generate_music'])
    .eq('status', 'queued')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { error: updateError } = await supabase
    .from('analysis_jobs')
    .update({
      status: 'running',
      locked_at: new Date().toISOString(),
      locked_by: WORKER_ID,
      attempt_count: (data.attempt_count ?? 0) + 1,
    })
    .eq('id', data.id)
    .eq('status', 'queued'); // optimistic lock

  if (updateError) return null; // Another worker claimed it
  return data;
}

async function markJobCompleted(jobId, result) {
  await supabase
    .from('analysis_jobs')
    .update({
      status: 'completed',
      result,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

async function markJobFailed(jobId, errorMessage) {
  await supabase
    .from('analysis_jobs')
    .update({
      status: 'failed',
      error: errorMessage,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

async function runWorkerSlot() {
  const job = await claimNextJob();
  if (!job) return;

  const { id: jobId, job_type: jobType } = job;
  console.log(`[${WORKER_ID}] Claimed job ${jobId} (${jobType})`);

  try {
    let result;
    if (jobType === 'generate_music') {
      result = await processGenerateMusicJob(job);
    } else {
      console.log(`[${WORKER_ID}] Job type '${jobType}' not handled by this worker slot — skipping.`);
      await markJobFailed(jobId, `Job type '${jobType}' not supported by this worker.`);
      return;
    }
    await markJobCompleted(jobId, result);
    console.log(`[${WORKER_ID}] Job ${jobId} completed:`, result);
  } catch (err) {
    console.error(`[${WORKER_ID}] Job ${jobId} failed:`, err.message);
    await markJobFailed(jobId, err.message ?? String(err));
  }
}

// ─── Main Loop ────────────────────────────────────────────────────────────────

async function workerLoop() {
  console.log(`[${WORKER_ID}] Worker started (concurrency=${CONCURRENCY}, poll=${POLL_INTERVAL_MS}ms)`);
  while (true) {
    try {
      // Run up to CONCURRENCY slots in parallel
      await Promise.all(Array.from({ length: CONCURRENCY }, () => runWorkerSlot()));
    } catch (err) {
      console.error(`[${WORKER_ID}] Worker loop error:`, err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

workerLoop().catch((err) => {
  console.error('Fatal worker error:', err);
  process.exit(1);
});
