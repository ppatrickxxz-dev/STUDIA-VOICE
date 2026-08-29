import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const wrangler = JSON.parse(await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
const worker = await readFile(new URL('../../cloudflare/worker.mjs', import.meta.url), 'utf8');
const headers = await readFile(new URL('../../packages/app/_headers', import.meta.url), 'utf8');
const previewWorkflow = await readFile(new URL('../../.github/workflows/cloudflare-preview-upload.yml', import.meta.url), 'utf8');

test('Cloudflare runtime serves canonical static build with API-first routing', () => {
  assert.equal(wrangler.name, 'pablovoice-web');
  assert.equal(wrangler.main, './cloudflare/worker.mjs');
  assert.equal(wrangler.workers_dev, true);
  assert.equal(wrangler.preview_urls, true);
  assert.equal(wrangler.assets.directory, './apps/web/dist');
  assert.equal(wrangler.assets.binding, 'ASSETS');
  assert.equal(wrangler.assets.not_found_handling, 'single-page-application');
  assert.deepEqual(wrangler.assets.run_worker_first, ['/api/*']);
});

test('Cloudflare worker preserves all canonical Vercel API routes without Vercel OIDC dependency', () => {
  for (const route of ['/api/health', '/api/provider-readiness', '/api/pablo-agent']) {
    assert.match(worker, new RegExp(route.replaceAll('/', '\\/')));
  }
  assert.match(worker, /env\.ASSETS\.fetch\(request\)/);
  assert.match(worker, /env\.AI_GATEWAY_API_KEY/);
  assert.doesNotMatch(worker, /@vercel\/oidc|getVercelOidcToken/);
});

test('Cloudflare static assets preserve production security headers and service-worker policy', () => {
  assert.match(headers, /Content-Security-Policy:/);
  assert.match(headers, /https:\/\/yokmhqoncdwvxmzzybqa\.supabase\.co/);
  assert.match(headers, /Permissions-Policy: camera=\(\), geolocation=\(\), microphone=\(self\)/);
  assert.match(headers, /\/service-worker\.js/);
  assert.match(headers, /Cache-Control: no-cache/);
  assert.match(headers, /Service-Worker-Allowed: \//);
});

test('physical preview workflow can only upload a non-production Worker version and fails closed without auth', () => {
  assert.match(previewWorkflow, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(previewWorkflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(previewWorkflow, /Physical Cloudflare preview is BLOCKED/);
  assert.match(previewWorkflow, /exit 1/);
  assert.match(previewWorkflow, /PV_COMMIT: \$\{\{ github\.sha \}\}/);
  assert.match(previewWorkflow, /PREVIEW_ALIAS: pr-\$\{\{ github\.event\.pull_request\.number \}\}/);
  assert.match(previewWorkflow, /wrangler@4\.127\.1 versions upload/);
  assert.match(previewWorkflow, /--preview-alias/);
  assert.doesNotMatch(previewWorkflow, /wrangler@4\.127\.1 deploy(?! --dry-run)/);
  assert.doesNotMatch(previewWorkflow, /versions deploy/);
  assert.doesNotMatch(previewWorkflow, /AI_GATEWAY_API_KEY:\s*\$\{\{/);
});
