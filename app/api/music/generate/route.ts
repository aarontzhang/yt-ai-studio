import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { enforceSameOrigin } from '@/lib/server/requestSecurity';
import { buildMusicSegments } from '@/lib/indexer/musicSegments';
import { generateMusicCue } from '@/lib/server/lyriaClient';
import type { CaptionEntry, MusicCue, SourceSegment, SegmentVibeClassification, SceneBoundary } from '@/lib/types';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-2.5-flash-preview-04-17';
const MAX_SEGMENTS = 3;

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

const VALID_MOODS = new Set(['upbeat', 'calm', 'dramatic', 'melancholic', 'playful', 'suspenseful', 'inspirational', 'neutral']);
const VALID_ENERGIES = new Set(['low', 'medium', 'high']);

async function classifySegments(
  segments: SourceSegment[],
  apiKey: string,
): Promise<SegmentVibeClassification[]> {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed: any[] = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('Gemini response is not an array');

  return parsed.map((item) => ({
    segmentId: String(item.segmentId ?? ''),
    mood: VALID_MOODS.has(item.mood) ? item.mood : 'neutral',
    energy: VALID_ENERGIES.has(item.energy) ? item.energy : 'medium',
    genreHints: Array.isArray(item.genreHints) ? item.genreHints.map(String).slice(0, 3) : [],
    confidence: typeof item.confidence === 'number' ? Math.max(0, Math.min(1, item.confidence)) : 0.5,
  }));
}

/** Build coarse SourceSegments from word-level CaptionEntry array (fallback when sourceIndex is absent). */
function buildSegmentsFromCaptions(captions: CaptionEntry[]): SourceSegment[] {
  if (captions.length === 0) return [];

  const PAUSE_THRESHOLD_S = 0.5;
  const groups: CaptionEntry[][] = [];
  let current: CaptionEntry[] = [captions[0]];

  for (let i = 1; i < captions.length; i++) {
    const gap = captions[i].startTime - captions[i - 1].endTime;
    if (gap >= PAUSE_THRESHOLD_S) {
      groups.push(current);
      current = [captions[i]];
    } else {
      current.push(captions[i]);
    }
  }
  groups.push(current);

  return groups.map((group, idx) => {
    const nextGroup = groups[idx + 1];
    const pauseAfterMs = nextGroup
      ? Math.max(0, (nextGroup[0].startTime - group[group.length - 1].endTime) * 1000)
      : 0;
    return {
      id: `seg_${uuidv4().slice(0, 8)}`,
      text: group.map((w) => w.text).join(' '),
      sourceStart: group[0].startTime,
      sourceEnd: group[group.length - 1].endTime,
      words: group.map((w) => ({ word: w.text, start: w.startTime, end: w.endTime, isFiller: false })),
      sceneId: null,
      fillerWords: [],
      pauseAfterMs,
    };
  });
}

export async function POST(request: NextRequest) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) return csrfError;

  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.GOOGLE_LYRIA_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: 'Music generation not configured' }, { status: 503 });

  let projectId: string;
  let musicPrompt: string | undefined;
  try {
    const body = await request.json();
    projectId = String(body.projectId ?? '');
    musicPrompt = typeof body.musicPrompt === 'string' ? body.musicPrompt.slice(0, 200) : undefined;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  // Fetch project edit_state (only the sourceIndex bits we need)
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, edit_state')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single();

  if (projectError || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  // Extract sourceIndex from edit_state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editState = project.edit_state as Record<string, any> | null;
  const sourceIndex = editState?.sourceIndex ?? null;
  let segments: SourceSegment[] = Array.isArray(sourceIndex?.segments) ? sourceIndex.segments : [];
  const scenes: SceneBoundary[] = Array.isArray(sourceIndex?.scenes) ? sourceIndex.scenes : [];

  // Fallback: build segments from word-level transcript captions when sourceIndex is absent
  if (segments.length === 0) {
    const rawCaptions = Array.isArray(editState?.sourceTranscriptCaptions) ? editState.sourceTranscriptCaptions as CaptionEntry[] : [];
    segments = buildSegmentsFromCaptions(rawCaptions);
  }

  if (segments.length === 0) {
    return NextResponse.json({ error: 'No transcript available. Please transcribe the video first.' }, { status: 400 });
  }

  try {
    // 1. Classify segments via Gemini
    const classifications = await classifySegments(segments, apiKey);

    // 2. Build music segments
    const allMusicSegments = buildMusicSegments(segments, classifications, scenes);
    if (allMusicSegments.length === 0) {
      return NextResponse.json({ error: 'Could not build music segments from transcript' }, { status: 400 });
    }

    // 3. Cap at MAX_SEGMENTS
    const musicSegments = allMusicSegments.slice(0, MAX_SEGMENTS);

    const admin = getSupabaseAdmin();
    const cues: MusicCue[] = [];

    // 4. Generate, upload, and insert each cue
    for (const seg of musicSegments) {
      let storagePath: string | null = null;
      let signedUrl: string | null = null;
      const cueId = uuidv4();

      try {
        // Generate audio via Lyria — if musicPrompt provided, it influences the segment's genre hints
        const segWithHints = musicPrompt
          ? { ...seg, genreHints: [musicPrompt, ...seg.genreHints].slice(0, 3) }
          : seg;

        const { audioBase64, mimeType } = await generateMusicCue(segWithHints);

        // Upload to Supabase storage
        const ext = mimeType.includes('wav') ? 'wav' : 'mp3';
        storagePath = `${projectId}/${cueId}.${ext}`;
        const buffer = Buffer.from(audioBase64, 'base64');

        const { error: uploadError } = await admin.storage
          .from('music')
          .upload(storagePath, buffer, { contentType: mimeType, upsert: true });

        if (uploadError) throw uploadError;

        // Create signed URL (24h)
        const { data: urlData } = await admin.storage
          .from('music')
          .createSignedUrl(storagePath, 60 * 60 * 24);
        signedUrl = urlData?.signedUrl ?? null;
      } catch (err) {
        console.warn('[music/generate] Failed to generate/upload cue:', err instanceof Error ? err.message : err);
      }

      // Insert music_cue row
      const { error: insertError } = await admin
        .from('music_cues')
        .insert({
          id: cueId,
          project_id: projectId,
          asset_id: null,
          job_id: null,
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

      if (insertError) {
        console.warn('[music/generate] Failed to insert music_cue:', insertError.message);
      }

      if (storagePath) {
        const cue: MusicCue = {
          id: cueId,
          musicSegmentId: seg.id,
          sourceStart: seg.sourceStart,
          sourceEnd: seg.sourceEnd,
          durationSeconds: seg.sourceEnd - seg.sourceStart,
          mood: seg.mood,
          energy: seg.energy,
          genreHints: seg.genreHints,
          storagePath,
          signedUrl,
          status: 'suggested',
          volumeDb: -18,
          fadeInSeconds: 1.0,
          fadeOutSeconds: 1.5,
        };
        cues.push(cue);
      }
    }

    if (cues.length === 0) {
      return NextResponse.json({ error: 'Music generation failed for all segments' }, { status: 500 });
    }

    return NextResponse.json({ cues });
  } catch (err) {
    console.error('[music/generate] Error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Music generation failed' }, { status: 500 });
  }
}
