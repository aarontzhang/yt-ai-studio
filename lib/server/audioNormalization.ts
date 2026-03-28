export interface GeneratedAudioPayload {
  audioBase64: string;
  mimeType: string;
}

export interface NormalizedGeneratedAudio extends GeneratedAudioPayload {
  extension: string;
  normalizedFromMimeType: string | null;
  browserPlayable: boolean;
}

const DEFAULT_PCM_SAMPLE_RATE = 24000;
const DEFAULT_PCM_CHANNELS = 1;
const DEFAULT_PCM_BIT_DEPTH = 16;

function normalizeMimeType(mimeType: string): string {
  return mimeType.trim().toLowerCase();
}

function getBaseMimeType(mimeType: string): string {
  return normalizeMimeType(mimeType).split(';')[0]?.trim() ?? '';
}

function getMimeParameters(mimeType: string): Map<string, string> {
  const segments = mimeType.split(';').slice(1);
  return segments.reduce((acc, segment) => {
    const [rawKey, ...rawValue] = segment.split('=');
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue.join('=').trim().toLowerCase();
    if (key && value) {
      acc.set(key, value);
    }
    return acc;
  }, new Map<string, string>());
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function getExtensionForMimeType(mimeType: string): string {
  const normalizedMimeType = normalizeMimeType(mimeType);
  const baseMimeType = getBaseMimeType(normalizedMimeType);
  if (baseMimeType === 'audio/wav' || baseMimeType === 'audio/x-wav' || baseMimeType === 'audio/wave') {
    return 'wav';
  }
  if (baseMimeType === 'audio/mpeg' || baseMimeType === 'audio/mp3') {
    return 'mp3';
  }
  if (baseMimeType === 'audio/ogg' || baseMimeType === 'audio/opus') {
    return 'ogg';
  }
  if (baseMimeType === 'audio/webm') {
    return 'webm';
  }
  if (baseMimeType === 'audio/mp4' || baseMimeType === 'audio/aac') {
    return 'm4a';
  }
  if (baseMimeType === 'audio/flac') {
    return 'flac';
  }

  const subtype = baseMimeType.split('/')[1]?.trim();
  return subtype && /^[a-z0-9.+-]+$/.test(subtype) ? subtype.replace(/^x-/, '') : 'bin';
}

function isBrowserPlayableMimeType(mimeType: string): boolean {
  const baseMimeType = getBaseMimeType(mimeType);
  return baseMimeType === 'audio/wav'
    || baseMimeType === 'audio/x-wav'
    || baseMimeType === 'audio/wave'
    || baseMimeType === 'audio/mpeg'
    || baseMimeType === 'audio/mp3'
    || baseMimeType === 'audio/ogg'
    || baseMimeType === 'audio/opus'
    || baseMimeType === 'audio/webm'
    || baseMimeType === 'audio/mp4'
    || baseMimeType === 'audio/aac'
    || baseMimeType === 'audio/flac';
}

function isPcmLikeMimeType(mimeType: string): boolean {
  const normalizedMimeType = normalizeMimeType(mimeType);
  return normalizedMimeType.startsWith('audio/l16')
    || normalizedMimeType.startsWith('audio/raw')
    || normalizedMimeType.startsWith('audio/pcm')
    || normalizedMimeType.includes('pcm');
}

function buildWavHeader(params: {
  dataSize: number;
  sampleRate: number;
  channelCount: number;
  bitDepth: number;
}): Buffer {
  const { dataSize, sampleRate, channelCount, bitDepth } = params;
  const header = Buffer.alloc(44);
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = sampleRate * blockAlign;

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channelCount, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  return header;
}

function wrapPcmAsWav(input: Buffer, mimeType: string): Buffer {
  const params = getMimeParameters(mimeType);
  const sampleRate = parsePositiveInt(
    params.get('rate') ?? params.get('sample-rate') ?? params.get('samplerate'),
    DEFAULT_PCM_SAMPLE_RATE,
  );
  const channelCount = parsePositiveInt(
    params.get('channels') ?? params.get('channel-count'),
    DEFAULT_PCM_CHANNELS,
  );
  const bitDepth = parsePositiveInt(params.get('bitdepth') ?? params.get('bits-per-sample'), DEFAULT_PCM_BIT_DEPTH);
  const header = buildWavHeader({
    dataSize: input.byteLength,
    sampleRate,
    channelCount,
    bitDepth,
  });
  return Buffer.concat([header, input]);
}

export function normalizeGeneratedAudio(payload: GeneratedAudioPayload): NormalizedGeneratedAudio {
  const normalizedMimeType = normalizeMimeType(payload.mimeType);
  const inputBuffer = Buffer.from(payload.audioBase64, 'base64');

  if (isPcmLikeMimeType(normalizedMimeType)) {
    const wavBuffer = wrapPcmAsWav(inputBuffer, normalizedMimeType);
    return {
      audioBase64: wavBuffer.toString('base64'),
      mimeType: 'audio/wav',
      extension: 'wav',
      normalizedFromMimeType: normalizedMimeType,
      browserPlayable: true,
    };
  }

  return {
    audioBase64: inputBuffer.toString('base64'),
    mimeType: normalizedMimeType,
    extension: getExtensionForMimeType(normalizedMimeType),
    normalizedFromMimeType: null,
    browserPlayable: isBrowserPlayableMimeType(normalizedMimeType),
  };
}
