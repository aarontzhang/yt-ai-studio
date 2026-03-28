import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { CaptionEntry } from '@/lib/types';
import { getSupabaseServer } from '@/lib/supabase/server';
import { buildBetaLimitExceededResponse, consumeBetaUsage } from '@/lib/server/betaLimits';
import { enforceRateLimit, enforceSameOrigin, getRateLimitIdentity } from '@/lib/server/requestSecurity';
import { buildSourceIndex } from '@/lib/indexer/sourceIndex';
import { MAIN_SOURCE_ID } from '@/lib/sourceUtils';

const TRANSCRIBE_REQUESTS_PER_MINUTE = 25;
type WhisperWord = { start: number; end: number; word: string };

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Server transcription is not configured. Missing OPENAI_API_KEY.');
  }
  return new OpenAI({ apiKey });
}

export async function POST(req: NextRequest) {
  try {
    const csrfError = enforceSameOrigin(req);
    if (csrfError) return csrfError;

    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rateLimitError = enforceRateLimit({
      key: `transcribe:${getRateLimitIdentity(req.headers, user.id)}`,
      limit: TRANSCRIBE_REQUESTS_PER_MINUTE,
      windowMs: 60_000,
    });
    if (rateLimitError) return rateLimitError;

    const formData = await req.formData();
    const audio = formData.get('audio') as Blob | null;
    const startTime = parseFloat((formData.get('startTime') as string) ?? '0');
    const requestedDuration = Number((formData.get('requestedDuration') as string) ?? '0');
    const wordsPerCaption = Math.max(1, Math.min(12, parseInt((formData.get('wordsPerCaption') as string) ?? '4', 10) || 4));

    if (!audio) return NextResponse.json({ error: 'No audio provided' }, { status: 400 });

    const usage = await consumeBetaUsage(
      'transcribe_seconds',
      user.id,
      Number.isFinite(requestedDuration) ? Math.max(1, requestedDuration) : 1,
    );
    if (!usage.allowed) {
      return buildBetaLimitExceededResponse('transcribe_seconds', usage);
    }

    const file = new File([audio], 'audio.mp3', { type: 'audio/mpeg' });

    const transcription = await getOpenAIClient().audio.transcriptions.create({
      file,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word'],
    });

    const words = transcription.words ?? [];
    const wordEntries: CaptionEntry[] = words
      .map((word) => {
        const typedWord = word as WhisperWord;
        const text = typedWord.word.trim();
        if (!text) return null;
        return {
          startTime: startTime + typedWord.start,
          endTime: startTime + typedWord.end,
          text,
        };
      })
      .filter((entry): entry is CaptionEntry => entry !== null);
    const captions: CaptionEntry[] = [];

    for (let i = 0; i < wordEntries.length; i += wordsPerCaption) {
      const chunk = wordEntries.slice(i, i + wordsPerCaption);
      if (chunk.length === 0) continue;
      captions.push({
        startTime: chunk[0].startTime,
        endTime: chunk[chunk.length - 1].endTime,
        text: chunk.map((w) => w.text).join(' '),
      });
    }

    const rawWords = words.map((w) => {
      const typedWord = w as WhisperWord;
      return {
        word: typedWord.word.trim(),
        start: startTime + typedWord.start,
        end: startTime + typedWord.end,
      };
    }).filter((w) => w.word);
    const sourceIndex = buildSourceIndex(rawWords, [], MAIN_SOURCE_ID, startTime + (requestedDuration || 0));

    return NextResponse.json({ captions, words: wordEntries, segments: sourceIndex.segments });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
