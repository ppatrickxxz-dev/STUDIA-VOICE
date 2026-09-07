import assert from 'node:assert/strict';
import test from 'node:test';
import cloudflareWorker from '../../cloudflare/worker.mjs';

const remoteProjectId = '11111111-1111-4111-8111-111111111111';

function workerEnv(secret = 'server-only-secret') {
  return {
    ...(secret ? { ELEVENLABS_API_KEY: secret } : {}),
    AI: { run: async () => ({ response: 'unused' }) },
    ASSETS: { fetch: async () => new Response('asset') },
  };
}

test('Music regeneration references untouched ranges and replaces only selected section', async () => {
  const originalFetch = globalThis.fetch;
  const outbound = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    outbound.push({ target, options });
    if (target.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target.includes('/rest/v1/projects?')) {
      return new Response(JSON.stringify([{ id: remoteProjectId, title: 'Selective gate' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target.startsWith('https://api.elevenlabs.io/v1/music?')) {
      const body = JSON.parse(options.body);
      assert.equal(options.headers['xi-api-key'], 'server-only-secret');
      assert.equal(JSON.stringify(body).includes('server-only-secret'), false);
      assert.equal(body.model_id, 'music_v2');
      assert.equal(body.store_for_inpainting, true);
      assert.equal(body.composition_plan.chunks.length, 3);
      assert.deepEqual(body.composition_plan.chunks[0], {
        song_id: 'song_source',
        range: { start_ms: 0, end_ms: 30000 },
      });
      assert.equal(body.composition_plan.chunks[1].duration_ms, 20000);
      assert.equal(body.composition_plan.chunks[1].text, '[Refrão]\nAmanhã a gente vê');
      assert.deepEqual(body.composition_plan.chunks[1].positive_styles, ['mais energia', 'R&B noturno']);
      assert.deepEqual(body.composition_plan.chunks[1].negative_styles, ['heavy dembow']);
      assert.equal(body.composition_plan.chunks[1].context_adherence, 'high');
      assert.deepEqual(body.composition_plan.chunks[2], {
        song_id: 'song_source',
        range: { start_ms: 50000, end_ms: 90000 },
      });
      return new Response(new Uint8Array([73, 68, 51, 8, 7, 6]), {
        status: 200,
        headers: { 'song-id': 'song_regenerated' },
      });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const response = await cloudflareWorker.fetch(new Request('https://studia-voice.ppatrickxxz.workers.dev/api/music-regeneration', {
      method: 'POST',
      headers: {
        Origin: 'https://appassets.androidplatform.net',
        Authorization: 'Bearer user-jwt',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        project_id: remoteProjectId,
        source_song_id: 'song_source',
        duration_ms: 90000,
        section: {
          id: 'chorus-1',
          label: 'Refrão',
          start_ms: 30000,
          end_ms: 50000,
          text: '[Refrão]\nAmanhã a gente vê',
          positive_styles: ['mais energia', 'R&B noturno'],
          negative_styles: ['heavy dembow'],
          context_adherence: 'high',
        },
      }),
    }), workerEnv());

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    assert.equal(response.headers.get('x-pv-provider'), 'elevenmusic');
    assert.equal(response.headers.get('x-pv-model'), 'music_v2');
    assert.equal(response.headers.get('x-pv-song-id'), 'song_regenerated');
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://appassets.androidplatform.net');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [73, 68, 51, 8, 7, 6]);
    assert.equal(outbound.some(({ target }) => target.startsWith('https://api.elevenlabs.io/v1/music?')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Music regeneration route reports selective semantics and rejects unauthenticated writes', async () => {
  const getResponse = await cloudflareWorker.fetch(new Request('https://studia-voice.ppatrickxxz.workers.dev/api/music-regeneration'), workerEnv());
  assert.equal(getResponse.status, 200);
  const health = await getResponse.json();
  assert.equal(health.service, 'pablovoice-music-regeneration');
  assert.equal(health.requires_song_id, true);
  assert.equal(health.preserves_unselected_ranges, true);
  assert.equal(health.credential_exposed, false);

  const postResponse = await cloudflareWorker.fetch(new Request('https://studia-voice.ppatrickxxz.workers.dev/api/music-regeneration', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source_song_id: 'song_source' }),
  }), workerEnv());
  assert.equal(postResponse.status, 401);
  const denied = await postResponse.json();
  assert.equal(denied.error, 'auth_required');
});

test('Music regeneration fails closed when provider secret is absent', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'user_1' }), { status: 200 });
    if (target.includes('/rest/v1/projects?')) return new Response(JSON.stringify([{ id: remoteProjectId, title: 'Selective gate' }]), { status: 200 });
    throw new Error(`Unexpected fetch: ${target}`);
  };
  try {
    const response = await cloudflareWorker.fetch(new Request('https://studia-voice.ppatrickxxz.workers.dev/api/music-regeneration', {
      method: 'POST',
      headers: { Authorization: 'Bearer user-jwt', 'content-type': 'application/json' },
      body: JSON.stringify({
        project_id: remoteProjectId,
        source_song_id: 'song_source',
        duration_ms: 90000,
        section: { start_ms: 30000, end_ms: 50000, text: '[Refrão instrumental]' },
      }),
    }), workerEnv(''));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, 'provider_unavailable');
    assert.equal(body.fallback_allowed, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
