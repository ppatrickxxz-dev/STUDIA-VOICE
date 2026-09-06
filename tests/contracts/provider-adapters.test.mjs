import test from 'node:test';
import assert from 'node:assert/strict';

import { BENCHMARK_TEST_IDS, PROVIDERS, assertProviderMatrix } from '../../packages/providers/src/registry.mjs';
import { ElevenMusicClient, buildInpaintingPlan, buildPabloMusicV2Plan } from '../../services/providers/elevenmusic.mjs';
import { createSunoManualRun, sunoSupportsOfficialAutomation } from '../../services/providers/suno-interactive.mjs';

test('provider registry covers B01-B12 exactly for every provider', () => {
  assert.equal(assertProviderMatrix(), true);
  for (const provider of Object.values(PROVIDERS)) {
    assert.deepEqual(Object.keys(provider.capabilities).sort(), [...BENCHMARK_TEST_IDS].sort());
  }
});

test('Suno remains interactive/manual until an official automation surface is explicitly verified', () => {
  assert.equal(PROVIDERS.suno.transport, 'interactive_manual');
  assert.equal(sunoSupportsOfficialAutomation(), false);
  const run = createSunoManualRun({ testId: 'B02', inputHashes: { reference_mix: 'abc' } });
  assert.equal(run.status, 'awaiting_human_execution');
  assert.match(run.protocol.join(' '), /Replace Section/);
  assert.ok(run.evidence_required.includes('output_file_hashes'));
});

test('ElevenMusic inpainting plan keeps all unedited ranges as audio references', () => {
  const plan = buildInpaintingPlan({
    songId: 'song_123',
    durationMs: 10000,
    replacements: [{
      startMs: 3000,
      endMs: 5000,
      text: '[Verse]\nlinha nova',
      positiveStyles: ['Brazilian R&B'],
    }],
  });
  assert.deepEqual(plan.chunks, [
    { song_id: 'song_123', range: { start_ms: 0, end_ms: 3000 } },
    {
      text: '[Verse]\nlinha nova',
      duration_ms: 2000,
      positive_styles: ['Brazilian R&B'],
      negative_styles: [],
      context_adherence: 'high',
    },
    { song_id: 'song_123', range: { start_ms: 5000, end_ms: 10000 } },
  ]);
});

test('PabloVoice song plan becomes duration-locked Music v2 chunks with section lyrics', () => {
  const plan = buildPabloMusicV2Plan({
    plan: {
      brief: 'Pop R&B noturno, synths suaves e grave redondo',
      genre: 'rnb',
      mood: 'íntimo, elegante',
      bpm: 112,
      key: 'A',
      mode: 'minor',
      sections: [
        { id: 'intro', label: 'Intro', startBeat: 0, endBeat: 4, startSeconds: 0, endSeconds: 2.143, energy: 0.28 },
        { id: 'verso_1', label: 'Verso 1', startBeat: 4, endBeat: 12, startSeconds: 2.143, endSeconds: 6.429, energy: 0.52 },
        { id: 'refrão', label: 'Refrão', startBeat: 12, endBeat: 20, startSeconds: 6.429, endSeconds: 10.714, energy: 0.9 },
      ],
      guideLines: [
        { text: 'Quando a cidade apaga eu vejo você', startBeat: 4 },
        { text: 'Chega mais perto, deixa acontecer', startBeat: 8 },
        { text: 'Amanhã a gente vê', startBeat: 13 },
      ],
    },
    negativeStyles: ['heavy dembow', 'female vocals'],
  });

  assert.equal(plan.chunks.length, 3);
  assert.equal(plan.chunks[0].text, '[Intro instrumental]');
  assert.match(plan.chunks[1].text, /Quando a cidade apaga/);
  assert.match(plan.chunks[2].text, /Amanhã a gente vê/);
  assert.equal(plan.chunks[2].context_adherence, 'high');
  assert.ok(plan.chunks[2].positive_styles.includes('contemporary R&B'));
  assert.ok(plan.chunks[2].positive_styles.includes('112 BPM'));
  assert.deepEqual(plan.chunks[2].negative_styles, ['heavy dembow', 'female vocals']);
  assert.equal(plan.chunks.reduce((sum, chunk) => sum + chunk.duration_ms, 0), 10715);
});

test('ElevenMusic compose sends music_v2 through the official endpoint without exposing key in payload', async () => {
  let request;
  const fakeFetch = async (url, options) => {
    request = { url, options };
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'song-id': 'song_test' },
    });
  };
  const client = new ElevenMusicClient({ apiKey: 'test-secret', fetchImpl: fakeFetch });
  const result = await client.compose({ prompt: 'Brazilian R&B', musicLengthMs: 30000 });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, 'https://api.elevenlabs.io/v1/music?output_format=mp3_48000_192');
  assert.equal(request.options.headers['xi-api-key'], 'test-secret');
  assert.equal(body.model_id, 'music_v2');
  assert.equal(body.prompt, 'Brazilian R&B');
  assert.equal(body.music_length_ms, 30000);
  assert.equal(JSON.stringify(body).includes('test-secret'), false);
  assert.equal(result.songId, 'song_test');
  assert.deepEqual([...result.audio], [1, 2, 3]);
});

test('ElevenMusic client rejects ambiguous prompt + composition plan', async () => {
  const client = new ElevenMusicClient({ apiKey: 'test-secret', fetchImpl: async () => { throw new Error('should not fetch'); } });
  await assert.rejects(
    client.compose({ prompt: 'x', compositionPlan: { chunks: [] } }),
    /Exactly one of prompt or compositionPlan/,
  );
});
