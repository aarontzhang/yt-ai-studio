import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceIndexAnalysis } from '../lib/server/sourceIndexAnalysis.ts';

test('buildSourceIndexAnalysis preserves in-flight transcript progress from analysis jobs', () => {
  const { analysis, analysisBySourceId } = buildSourceIndexAnalysis({
    sources: [{
      id: 'source-1',
      status: 'indexing',
      assetId: 'asset-1',
      storagePath: 'project/source-1.mp4',
    }],
    latestJobsByAssetId: new Map([
      ['asset-1', {
        id: 'job-1',
        assetId: 'asset-1',
        status: 'running',
        error: null,
        progress: {
          stage: 'transcribing_audio',
          completed: 4,
          total: 10,
          label: 'Transcribing audio 4/10',
          etaSeconds: 60,
        },
        pauseRequested: false,
      }],
    ]),
    transcriptCountByAssetId: new Map(),
  });

  assert.equal(analysisBySourceId['source-1']?.audio?.status, 'running');
  assert.equal(analysisBySourceId['source-1']?.audio?.completed, 4);
  assert.equal(analysisBySourceId['source-1']?.audio?.total, 10);
  assert.equal(analysis?.status, 'running');
  assert.equal(analysis?.progress?.stage, 'transcribing_audio');
  assert.ok((analysis?.progress?.completed ?? 0) > 0);
});

test('buildSourceIndexAnalysis marks transcript-ready sources completed without an active job', () => {
  const { analysis, analysisBySourceId } = buildSourceIndexAnalysis({
    sources: [{
      id: 'source-1',
      status: 'ready',
      assetId: 'asset-1',
      storagePath: 'project/source-1.mp4',
    }],
    latestJobsByAssetId: new Map(),
    transcriptCountByAssetId: new Map([['asset-1', 24]]),
  });

  assert.equal(analysisBySourceId['source-1']?.audio?.status, 'completed');
  assert.equal(analysisBySourceId['source-1']?.progress?.label, 'Completed');
  assert.equal(analysis?.status, 'completed');
});

test('buildSourceIndexAnalysis surfaces failed transcript jobs with their reason', () => {
  const { analysis, analysisBySourceId } = buildSourceIndexAnalysis({
    sources: [{
      id: 'source-1',
      status: 'indexing',
      assetId: 'asset-1',
      storagePath: 'project/source-1.mp4',
    }],
    latestJobsByAssetId: new Map([
      ['asset-1', {
        id: 'job-1',
        assetId: 'asset-1',
        status: 'failed',
        error: 'Whisper quota exceeded',
        progress: {
          stage: 'transcribing_audio',
          completed: 6,
          total: 10,
          label: 'Transcribing audio 6/10',
          etaSeconds: null,
        },
        pauseRequested: false,
      }],
    ]),
    transcriptCountByAssetId: new Map(),
  });

  assert.equal(analysisBySourceId['source-1']?.audio?.status, 'failed');
  assert.equal(analysisBySourceId['source-1']?.audio?.reason, 'Whisper quota exceeded');
  assert.equal(analysis?.status, 'failed');
  assert.equal(analysis?.error, 'Whisper quota exceeded');
});
