import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const wrangler = JSON.parse(await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
const worker = await readFile(new URL('../../cloudflare/worker.mjs', import.meta.url), 'utf8');
const headers = await readFile(new URL('../../packages/app/_headers', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const vercelQuarantine = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));

test('Cloudflare runtime serves canonical static build with API-first routing', () => {
  assert.equal(wrangler.name, 'pablovoice-web');
  assert.equal(wrangler.main, './cloudflare/worker.mjs');
  assert.equal(wrangler.workers_dev, true);
  assert.equal(wrangler.preview_urls, true);
  assert.equal(wrangler.build.command, 'npm run build:web');
  assert.equal(wrangler.assets.directory, './apps/web/dist');
  assert.equal(wrangler.assets.binding, 'ASSETS');
  assert.equal(wrangler.assets.not_found_handling, 'single-page-application');
  assert.deepEqual(wrangler.assets.run_worker_first, ['/api/*']);
});

test('Cloudflare worker owns the canonical API routes with no Vercel runtime dependency', () => {
  for (const route of ['/api/health', '/api/provider-readiness', '/api/pablo-agent']) {
    assert.match(worker, new RegExp(route.replaceAll('/', '\\/')));
  }
  assert.match(worker, /env\.ASSETS\.fetch\(request\)/);
  assert.match(worker, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(worker, /env\.OPENAI_API_KEY/);
  assert.doesNotMatch(worker, /@vercel\/oidc|getVercelOidcToken|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY/i);
  assert.doesNotMatch(worker, /ai-gateway\.vercel\.sh|vercel_ai_gateway/i);
});

test('Cloudflare AI provider failures remain typed and fail closed with no fabricated fallback', () => {
  for (const error of ['provider_auth_failed', 'provider_rate_limited', 'provider_unavailable', 'provider_invalid_response', 'provider_connection_failed', 'provider_timeout', 'remote_empty_response', 'agent_backend_error']) {
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
