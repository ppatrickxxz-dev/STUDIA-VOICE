import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicGenerationClient, resolveMusicGenerationUrl } from '../../packages/app/music-generation-client.mjs';

test('music generation URL follows the same Cloudflare runtime as the Composer agent', () => {
  assert.equal(
    resolveMusicGenerationUrl('https://preview-studia-voice.ppatrickxxz.workers.dev/api/pablo-agent'),
    'https://preview-studia-voice.ppatrickxxz.workers.dev/api/music-generation',
  );
  assert.equal(resolveMusicGenerationUrl(''), '');
});

test('high-quality generation links project, authenticates and returns provider audio metadata', async () => {
  const calls = [];
  const auth = {
    session: { accessToken: 'token-1' },
    async ensureRemoteProject(localProject) {
      assert.equal(localProject.id, 'local_1');
      return { ok: true, project: { id: '11111111-1111-4111-8111-111111111111' } };
    },
    async ensureSession() { return this.session; },
    clearSession() {},
    async loginWithDevice() { return null; },
  };
  const client = new MusicGenerationClient({
    authAdapter: auth,
    endpoint: 'https://runtime.example/api/music-generation',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {
          'content-type': 'audio/mpeg',
          'x-pv-provider': 'elevenmusic',
          'x-pv-model': 'music_v2',
          'x-pv-song-id': 'song_123',
          'x-pv-request-id': 'request_123',
        },
      });
    },
  });
  const result = await client.generate({
    localProject: { id: 'local_1', name: 'Demo' },
    plan: { sections: [{ id: 'intro' }] },
    negativeStyles: ['heavy dembow'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'elevenmusic');
  assert.equal(result.model, 'music_v2');
  assert.equal(result.songId, 'song_123');
  assert.equal(result.requestId, 'request_123');
  assert.equal(result.remoteProjectId, '11111111-1111-4111-8111-111111111111');
  assert.equal(result.blob.size, 4);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.authorization, 'Bearer token-1');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.project_id, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(body.negative_styles, ['heavy dembow']);
  assert.equal(JSON.stringify(body).includes('token-1'), false);
});

test('high-quality generation fails honestly when project cannot link', async () => {
  const client = new MusicGenerationClient({
    authAdapter: {
      async ensureRemoteProject() { return { ok: false, error: 'auth_required' }; },
    },
    endpoint: 'https://runtime.example/api/music-generation',
    fetchImpl: async () => { throw new Error('must not call provider'); },
  });
  const result = await client.generate({ localProject: { id: 'local_1' }, plan: { sections: [{ id: 'intro' }] } });
  assert.deepEqual(result, { ok: false, error: 'auth_required', fallback_allowed: true });
});
