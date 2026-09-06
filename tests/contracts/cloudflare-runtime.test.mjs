import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import cloudflareWorker from '../../cloudflare/worker.mjs';

const wrangler = JSON.parse(await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
const worker = await readFile(new URL('../../cloudflare/worker.mjs', import.meta.url), 'utf8');
const headers = await readFile(new URL('../../packages/app/_headers', import.meta.url), 'utf8');
const html = await readFile(new URL('../../packages/app/index.html', import.meta.url), 'utf8');
const remoteAuth = await readFile(new URL('../../packages/app/remote-auth.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const vercelQuarantine = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));

test('Cloudflare runtime serves canonical static build with API-first routing', () => {
  assert.equal(wrangler.name, 'studia-voice');
  assert.equal(wrangler.main, './cloudflare/worker.mjs');
  assert.equal(wrangler.workers_dev, true);
  assert.equal(wrangler.preview_urls, true);
  assert.equal(wrangler.build.command, 'npm run build:web');
  assert.equal(wrangler.assets.directory, './apps/web/dist');
  assert.equal(wrangler.assets.binding, 'ASSETS');
  assert.equal(wrangler.assets.not_found_handling, 'single-page-application');
  assert.deepEqual(wrangler.assets.run_worker_first, ['/api/*']);
  assert.equal(wrangler.ai.binding, 'AI');
});

test('Cloudflare worker owns the canonical API routes with no Vercel runtime dependency', () => {
  for (const route of ['/api/health', '/api/provider-readiness', '/api/pablo-agent', '/api/music-generation']) {
    assert.match(worker, new RegExp(route.replaceAll('/', '\\/')));
  }
  assert.match(worker, /env\.ASSETS\.fetch\(request\)/);
  assert.match(worker, /@cf\/meta\/llama-3\.3-70b-instruct-fp8-fast/);
  assert.match(worker, /env\.AI/);
  assert.doesNotMatch(worker, /OPENAI_API_KEY|api\.openai\.com/);
  assert.doesNotMatch(worker, /@vercel\/oidc|getVercelOidcToken|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY/i);
});

test('Composer clients use Cloudflare and Android preflight is explicitly allowed', async () => {
  assert.match(remoteAuth, /const CLOUDFLARE_RUNTIME_URL = 'https:\/\/studia-voice\.ppatrickxxz\.workers\.dev';/);
  assert.match(remoteAuth, /const AGENT_URL = resolveAgentUrl\(\);/);
  assert.match(remoteAuth, /LOCAL_WEB_ORIGIN/);
  assert.match(remoteAuth, /CLOUDFLARE_WORKER_ORIGIN/);
  assert.doesNotMatch(remoteAuth, /const AGENT_URL = `\$\{PROJECT_URL\}\/functions\/v1\/validate-app-js-v71`;/);
  assert.match(html, /connect-src[^\n]*https:\/\/studia-voice\.ppatrickxxz\.workers\.dev/);
  assert.match(headers, /connect-src[^\n]*https:\/\/studia-voice\.ppatrickxxz\.workers\.dev/);

  const androidOrigin = 'https://appassets.androidplatform.net';
  const env = { AI: { run: async () => ({ response: 'unused' }) }, ASSETS: { fetch: async () => new Response('asset') } };
  const preflight = await cloudflareWorker.fetch(new Request('https://studia-voice.ppatrickxxz.workers.dev/api/pablo-agent', {
    method: 'OPTIONS',
    headers: {
      Origin: androidOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type, apikey',
    },
  }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), androidOrigin);
  assert.match(preflight.headers.get('access-control-allow-methods') || '', /POST/);
  assert.match(preflight.headers.get('access-control-allow-headers') || '', /Authorization/);

  const localOrigin = 'http://127.0.0.1:4173';
  const localPreflight = await cloudflareWorker.fetch(new Request('https://studia-voice.ppatrickxxz.workers.dev/api/pablo-agent', {
    method: 'OPTIONS',
    headers: { Origin: localOrigin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'apikey' },
  }), env);
  assert.equal(localPreflight.status, 204);
  assert.equal(localPreflight.headers.get('access-control-allow-origin'), localOrigin);

  const health = await cloudflareWorker.fetch(new Request('https://studia-voice.ppatrickxxz.workers.dev/api/health', {
    headers: { Origin: androidOrigin },
  }), env);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), androidOrigin);

  const denied = await cloudflareWorker.fetch(new Request('https://studia-voice.ppatrickxxz.workers.dev/api/pablo-agent', {
    headers: { Origin: 'https://evil.example' },
  }), env);
  assert.equal(denied.status, 200);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('Music generation route authenticates ownership, keeps provider key server-side and returns song-id with real audio bytes', async () => {
  const originalFetch = globalThis.fetch;
  const remoteProjectId = '11111111-1111-4111-8111-111111111111';
  const outbound = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    outbound.push({ target, options });
    if (target.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target.includes('/rest/v1/projects?')) {
      return new Response(JSON.stringify([{ id: remoteProjectId, title: 'Music gate', bpm: 112, musical_key: 'A' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target.startsWith('https://api.elevenlabs.io/v1/music?')) {
      const body = JSON.parse(options.body);
      assert.equal(options.headers['xi-api-key'], 'server-only-secret');
      assert.equal(JSON.stringify(body).includes('server-only-secret'), false);
      assert.equal(body.model_id, 'music_v2');
      assert.equal(body.store_for_inpainting, true);
      assert.equal(body.composition_plan.chunks.length, 2);
      assert.equal(body.composition_plan.chunks[0].duration_ms, 2000);
      assert.match(body.composition_plan.chunks[1].text, /Amanhã a gente vê/);
      return new Response(new Uint8Array([73, 68, 51, 4, 0, 0, 0, 1]), {
        status: 200,
        headers: { 'song-id': 'song_pv_gate' },
      });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const env = {
      ELEVENLABS_API_KEY: 'server-only-secret',
      AI: { run: async () => ({ response: 'unused' }) },
      ASSETS: { fetch: async () => new Response('asset') },
    };
    const response = await cloudflareWorker.fetch(new Request('https://studia-voice.ppatrickxxz.workers.dev/api/music-generation', {
      method: 'POST',
      headers: {
        Origin: 'https://appassets.androidplatform.net',
        Authorization: 'Bearer user-jwt',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        project_id: remoteProjectId,
        negative_styles: ['heavy dembow'],
        plan: {
          brief: 'Pop R&B noturno com synths',
          genre: 'rnb',
          mood: 'íntimo',
          bpm: 112,
          key: 'A',
          mode: 'minor',
          sections: [
            { id: 'intro', label: 'Intro', startBeat: 0, endBeat: 4, startSeconds: 0, endSeconds: 2, energy: 0.28 },
            { id: 'refrão', label: 'Refrão', startBeat: 4, endBeat: 12, startSeconds: 2, endSeconds: 6, energy: 0.9 },
          ],
          guideLines: [{ text: 'Amanhã a gente vê', startBeat: 5 }],
        },
      }),
    }), env);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    assert.equal(response.headers.get('x-pv-provider'), 'elevenmusic');
    assert.equal(response.headers.get('x-pv-model'), 'music_v2');
    assert.equal(response.headers.get('x-pv-song-id'), 'song_pv_gate');
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://appassets.androidplatform.net');
    assert.match(response.headers.get('access-control-expose-headers') || '', /X-PV-Song-Id/i);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [73, 68, 51, 4, 0, 0, 0, 1]);
    assert.equal(outbound.some(({ target }) => target.includes('/auth/v1/user')), true);
    assert.equal(outbound.some(({ target }) => target.includes('/rest/v1/projects?')), true);
    assert.equal(outbound.some(({ target }) => target.startsWith('https://api.elevenlabs.io/v1/music?')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Music generation stays fail-closed when provider secret is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const remoteProjectId = '11111111-1111-4111-8111-111111111111';
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'user_1' }), { status: 200 });
    if (target.includes('/rest/v1/projects?')) return new Response(JSON.stringify([{ id: remoteProjectId, title: 'Music gate' }]), { status: 200 });
    throw new Error(`Unexpected fetch: ${target}`);
  };
  try {
    const response = await cloudflareWorker.fetch(new Request('https://studia-voice.ppatrickxxz.workers.dev/api/music-generation', {
      method: 'POST',
      headers: { Authorization: 'Bearer user-jwt', 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: remoteProjectId, plan: { sections: [] } }),
    }), { AI: { run: async () => ({ response: 'unused' }) }, ASSETS: { fetch: async () => new Response('asset') } });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, 'provider_unavailable');
    assert.equal(body.fallback_allowed, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Cloudflare AI provider failures remain typed and fail closed with no fabricated fallback', () => {
  for (const error of ['provider_auth_failed', 'provider_rate_limited', 'provider_unavailable', 'provider_timeout', 'remote_empty_response', 'agent_backend_error']) {
    assert.match(worker, new RegExp(error));
  }
  assert.match(worker, /fallback_allowed:\s*false/);
  assert.doesNotMatch(worker, /fallback_allowed:\s*true/);
});

test('Cloudflare static assets preserve production security headers and service-worker policy', () => {
  assert.match(headers, /Content-Security-Policy:/);
  assert.match(headers, /https:\/\/yokmhqoncdwvxmzzybqa\.supabase\.co/);
  assert.match(headers, /Permissions-Policy: camera=\(\), geolocation=\(\), microphone=\(self\)/);
  assert.match(headers, /\/service-worker\.js/);
  assert.match(headers, /Cache-Control: no-cache/);
  assert.match(headers, /Service-Worker-Allowed: \//);
});

test('Cloudflare native Builds is deployment owner while legacy Vercel Git integration is quarantined', async () => {
  assert.equal(packageJson.dependencies?.['@vercel/oidc'], undefined);
  assert.equal(packageJson.devDependencies?.['@vercel/oidc'], undefined);
  assert.deepEqual(vercelQuarantine, { git: { deploymentEnabled: false } });
  await assert.rejects(access(new URL('../../.github/workflows/cloudflare-preview-upload.yml', import.meta.url)), { code: 'ENOENT' });
});
