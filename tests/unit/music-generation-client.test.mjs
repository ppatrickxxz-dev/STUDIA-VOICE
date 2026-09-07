import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MusicGenerationClient,
  resolveMusicGenerationUrl,
  resolveMusicSectionRegenerationUrl,
} from '../../packages/app/music-generation-client.mjs';

test('music generation URLs follow preview runtime and use canonical runtime from local Creator', () => {
  assert.equal(
    resolveMusicGenerationUrl('https://preview-studia-voice.ppatrickxxz.workers.dev/api/pablo-agent'),
    'https://preview-studia-voice.ppatrickxxz.workers.dev/api/music-generation',
  );
  assert.equal(
    resolveMusicGenerationUrl(''),
    'https://studia-voice.ppatrickxxz.workers.dev/api/music-generation',
  );
  assert.equal(
    resolveMusicSectionRegenerationUrl('https://preview-studia-voice.ppatrickxxz.workers.dev/api/music-generation'),
    'https://preview-studia-voice.ppatrickxxz.workers.dev/api/music-regeneration',
  );
});

function authFixture() {
  return {
    session: { accessToken: 'token-1' },
    async ensureRemoteProject(localProject) {
      assert.equal(localProject.id, 'local_1');
      return { ok: true, project: { id: '11111111-1111-4111-8111-111111111111' } };
    },
    async ensureSession() { return this.session; },
    clearSession() {},
    async loginWithDevice() { return null; },
  };
}

test('high-quality generation links project, authenticates and returns provider audio metadata', async () => {
  const calls = [];
  const client = new MusicGenerationClient({
    authAdapter: authFixture(),
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

test('section regeneration posts only source id, exact range and replacement instructions', async () => {
  const calls = [];
  const client = new MusicGenerationClient({
    authAdapter: authFixture(),
    endpoint: 'https://runtime.example/api/music-generation',
    sectionEndpoint: 'https://runtime.example/api/music-regeneration',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(new Uint8Array([9, 8, 7]), {
        status: 200,
        headers: {
          'content-type': 'audio/mpeg',
          'x-pv-provider': 'elevenmusic',
          'x-pv-model': 'music_v2',
          'x-pv-song-id': 'song_after_chorus',
          'x-pv-request-id': 'request_regen',
        },
      });
    },
  });
  const result = await client.regenerateSection({
    localProject: { id: 'local_1', name: 'Demo' },
    sourceSongId: 'song_before',
    durationMs: 90000,
    section: {
      id: 'chorus-1',
      label: 'Refrão',
      startMs: 30000,
      endMs: 50000,
      text: '[Refrão]\nAmanhã a gente vê',
      positiveStyles: ['mais energia'],
      negativeStyles: ['heavy dembow'],
      contextAdherence: 'high',
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.sourceSongId, 'song_before');
  assert.equal(result.sectionId, 'chorus-1');
  assert.equal(result.songId, 'song_after_chorus');
  assert.equal(result.blob.size, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://runtime.example/api/music-regeneration');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.project_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(body.source_song_id, 'song_before');
  assert.equal(body.duration_ms, 90000);
  assert.equal(body.section.start_ms, 30000);
  assert.equal(body.section.end_ms, 50000);
  assert.equal(body.section.text, '[Refrão]\nAmanhã a gente vê');
  assert.deepEqual(body.section.positive_styles, ['mais energia']);
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
