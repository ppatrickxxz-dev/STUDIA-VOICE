import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NativeMusicGenerationClient, NATIVE_MUSIC_ENDPOINTS } from '../../packages/app/native-music-generation-client.mjs';

function authFixture() {
  return {
    session: { accessToken: 'native-token' },
    async ensureRemoteProject(localProject) {
      assert.equal(localProject.id, 'local-native');
      return { ok: true, project: { id: '11111111-1111-4111-8111-111111111111' } };
    },
    async ensureSession() { return this.session; },
    clearSession() {},
    async loginWithDevice() { return null; },
  };
}

const plan = {
  schema: 'pablovoice_song_creation_v1',
  brief: 'R&B noturno com synths',
  genre: 'rnb',
  mood: 'íntimo',
  bpm: 96,
  key: 'C',
  mode: 'minor',
  durationSeconds: 60,
  seed: 42,
  sections: [{ id: 'intro' }, { id: 'refrão' }],
  guideLines: [{ text: 'Amanhã a gente vê', sectionId: 'refrão' }],
};

test('native music client dispatches privately, polls verified job and downloads exact asset', async () => {
  const bytes = new Uint8Array([10, 20, 30, 40, 50, 60]);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const calls = [];
  const progress = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === NATIVE_MUSIC_ENDPOINTS.dispatch) {
      return Response.json({ ok: true, job_id: '22222222-2222-4222-8222-222222222222', status: 'waiting_kaggle', progress: 15 });
    }
    if (String(url).includes('/rest/v1/render_jobs')) {
      return Response.json([{
        id: '22222222-2222-4222-8222-222222222222',
        project_id: '11111111-1111-4111-8111-111111111111',
        job_type: 'music_generation', status: 'completed', progress: 100,
        engine: 'ace_step_1_5_turbo', provider: 'kaggle', output_asset_ids: ['33333333-3333-4333-8333-333333333333'],
        proof: { verified: true, model: 'acestep-v15-turbo', model_revision: 'ca1e85fe9430179831e6bc6be790c332190a3866' },
      }]);
    }
    if (String(url).includes('/rest/v1/audio_assets')) {
      return Response.json([{
        id: '33333333-3333-4333-8333-333333333333', project_id: '11111111-1111-4111-8111-111111111111',
        kind: 'full_mix', storage_bucket: 'audio-private', storage_path: 'user/project/music/output.flac',
        original_name: 'output.flac', mime_type: 'audio/flac', size_bytes: bytes.length, duration_seconds: 60,
        sample_rate: 48000, channels: 2, sha256: sha,
        metadata: { model: 'acestep-v15-turbo', model_revision: 'ca1e85fe9430179831e6bc6be790c332190a3866' },
      }]);
    }
    if (String(url).includes('/storage/v1/object/authenticated/audio-private/')) {
      return new Response(bytes, { status: 200, headers: { 'content-type': 'audio/flac' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const client = new NativeMusicGenerationClient({ authAdapter: authFixture(), fetchImpl, pollIntervalMs: 0 });
  const result = await client.generate({
    localProject: { id: 'local-native', name: 'Native test' }, plan,
    negativeStyles: ['heavy dembow'], instrumental: false,
    onProgress: (state) => progress.push(state.progress),
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'pablovoice_native_music_v1');
  assert.equal(result.provider, 'kaggle');
  assert.equal(result.model, 'acestep-v15-turbo');
  assert.equal(result.modelRevision, 'ca1e85fe9430179831e6bc6be790c332190a3866');
  assert.equal(result.songId, null);
  assert.equal(result.blob.size, bytes.length);
  assert.equal(result.sha256, sha);
  assert.equal(progress.includes(15), true);
  assert.equal(progress.includes(100), true);

  const dispatch = calls[0];
  assert.equal(dispatch.options.headers.authorization, 'Bearer native-token');
  const body = JSON.parse(dispatch.options.body);
  assert.equal(body.project_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(body.plan.schema, 'pablovoice_song_creation_v1');
  assert.deepEqual(body.negative_styles, ['heavy dembow']);
  assert.equal(JSON.stringify(body).includes('native-token'), false);
  assert.equal(calls.every((call) => !String(call.url).includes('native-token')), true);
});

test('native music result fails closed when persisted bytes do not match SHA-256 proof', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const fetchImpl = async (url) => {
    if (String(url) === NATIVE_MUSIC_ENDPOINTS.dispatch) return Response.json({ ok: true, job_id: '22222222-2222-4222-8222-222222222222', status: 'waiting_kaggle', progress: 15 });
    if (String(url).includes('/rest/v1/render_jobs')) return Response.json([{ id: '22222222-2222-4222-8222-222222222222', project_id: '11111111-1111-4111-8111-111111111111', job_type: 'music_generation', status: 'completed', progress: 100, output_asset_ids: ['33333333-3333-4333-8333-333333333333'], proof: { verified: true } }]);
    if (String(url).includes('/rest/v1/audio_assets')) return Response.json([{ id: '33333333-3333-4333-8333-333333333333', project_id: '11111111-1111-4111-8111-111111111111', kind: 'full_mix', storage_bucket: 'audio-private', storage_path: 'user/project/music/output.flac', mime_type: 'audio/flac', size_bytes: bytes.length, sha256: '0'.repeat(64), metadata: {} }]);
    if (String(url).includes('/storage/v1/object/authenticated/audio-private/')) return new Response(bytes, { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  };
  const client = new NativeMusicGenerationClient({ authAdapter: authFixture(), fetchImpl, pollIntervalMs: 0 });
  const result = await client.generate({ localProject: { id: 'local-native' }, plan });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'music_sha256_mismatch');
  assert.equal(result.fallback_allowed, false);
});
