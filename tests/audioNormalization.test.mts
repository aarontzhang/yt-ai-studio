import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGeneratedAudio } from '../lib/server/audioNormalization.ts';

test('normalizeGeneratedAudio wraps PCM-like inline audio in a WAV container', () => {
  const pcmBytes = Buffer.from([0x00, 0x00, 0xff, 0x7f]);
  const normalized = normalizeGeneratedAudio({
    audioBase64: pcmBytes.toString('base64'),
    mimeType: 'audio/L16;rate=24000;channels=1',
  });

  const wavBytes = Buffer.from(normalized.audioBase64, 'base64');
  assert.equal(normalized.mimeType, 'audio/wav');
  assert.equal(normalized.extension, 'wav');
  assert.equal(normalized.normalizedFromMimeType, 'audio/l16;rate=24000;channels=1');
  assert.equal(normalized.browserPlayable, true);
  assert.equal(wavBytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wavBytes.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(wavBytes.readUInt32LE(40), pcmBytes.byteLength);
  assert.deepEqual(wavBytes.subarray(44), pcmBytes);
});

test('normalizeGeneratedAudio keeps browser-playable audio as-is', () => {
  const mp3Bytes = Buffer.from([0x49, 0x44, 0x33, 0x04]);
  const normalized = normalizeGeneratedAudio({
    audioBase64: mp3Bytes.toString('base64'),
    mimeType: 'audio/mpeg',
  });

  assert.equal(normalized.mimeType, 'audio/mpeg');
  assert.equal(normalized.extension, 'mp3');
  assert.equal(normalized.normalizedFromMimeType, null);
  assert.equal(normalized.browserPlayable, true);
  assert.deepEqual(Buffer.from(normalized.audioBase64, 'base64'), mp3Bytes);
});
