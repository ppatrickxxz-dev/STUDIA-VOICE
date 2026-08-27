import assert from 'node:assert/strict';
import test from 'node:test';
import { createPabloVoiceAudioToolRuntime, PABLOVOICE_AUDIO_TOOLS } from '../packages/providers/src/pablovoice-audio-tools.mjs';
import { buildProjectMixState } from '../packages/audio/src/mix/mix-intelligence-graph.mjs';

function analysis(assetId, { pitchConfidence = 0.92, breathConfidence = 0.9 } = {}) {
  return {
    assetId,
    schemaVersion: 2,
    source: { durationSeconds: 4 },
    music: { bpm: 120, noteEvents: [{ start: 0, end: 0.5, midi: 69, confidence: pitchConfidence }] },
    signal: {
      loudnessLufs: { value: -14 },
      spectralEnvelope: [1, 0.9, 0.5],
      onsets: [0, 0.5, 1, 1.5].map((timeSeconds) => ({ timeSeconds, confidence: 0.9 })),
      phaseCorrelation: { value: 0.95 },
    },
    voice: {
      pitchHz: 440,
      pitchConfidence,
      formants: [{ f1: 700, f2: 1200 }],
      breathEvents: [{ startSeconds: 1.1, endSeconds: 1.25, confidence: breathConfidence }],
    },
    confidence: { pitch: pitchConfidence, voice: pitchConfidence },
    validity: { complete: true, invalidatedRanges: [] },
  };
}

test('audio tool registry exposes the expected safe tool surface', () => {
  assert.deepEqual(PABLOVOICE_AUDIO_TOOLS, [
    'inspect_audio','inspect_mix','bring_voice_forward','make_vocal_space','align_vocals','soften_breaths','audio_to_instrument',
  ]);
});

test('runtime inspects analysis and produces guarded audio plans', async () => {
  const analyses = new Map([
    ['vocal', analysis('vocal')],
    ['double', { ...analysis('double'), signal: { ...analysis('double').signal, onsets: [0.03,0.53,1.03,1.53].map(timeSeconds => ({ timeSeconds, confidence: 0.9 })) } }],
  ]);
  const mix = buildProjectMixState({ tracks: [
    { trackId: 'lead', role: 'lead-vocal', confidence: 0.92, analysis: analyses.get('vocal') },
    { trackId: 'beat', role: 'instrumental', confidence: 0.9, analysis: { ...analysis('beat'), signal: { ...analysis('beat').signal, loudnessLufs: { value: -12 } } } },
  ]});
  const execute = createPabloVoiceAudioToolRuntime({
    getAnalysis: async (id) => analyses.get(id) || null,
    getMixState: async () => mix,
  });

  const inspected = await execute('inspect_audio', { assetId: 'vocal' });
  assert.equal(inspected.ok, true);
  assert.equal(inspected.data.assetId, 'vocal');

  const breath = await execute('soften_breaths', { assetId: 'vocal' });
  assert.equal(breath.ok, true);
  assert.equal(breath.data.execution, 'allowed');

  const align = await execute('align_vocals', { referenceAssetId: 'vocal', targetAssetId: 'double' });
  assert.equal(align.ok, true);
  assert.ok(Math.abs(align.data.offsetMs - 30) < 1);

  const forward = await execute('bring_voice_forward', { projectId: 'p1', trackId: 'lead' });
  assert.equal(forward.ok, true);
  assert.ok(forward.data.actions.length > 0);

  const instrument = await execute('audio_to_instrument', { assetId: 'vocal' });
  assert.equal(instrument.ok, true);
  assert.equal(instrument.data.chromatic.ready, true);
});

test('low-confidence operations remain preview-only', async () => {
  const weak = analysis('weak', { pitchConfidence: 0.5, breathConfidence: 0.5 });
  const execute = createPabloVoiceAudioToolRuntime({
    getAnalysis: async () => weak,
    getMixState: async () => buildProjectMixState({ tracks: [] }),
  });
  const breath = await execute('soften_breaths', { assetId: 'weak' });
  assert.equal(breath.data.execution, 'preview_only');
});
