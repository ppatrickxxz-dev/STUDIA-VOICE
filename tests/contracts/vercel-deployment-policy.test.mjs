import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const wrangler = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
const runtimeGate = fs.readFileSync('.github/workflows/cloudflare-runtime-gate.yml', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const vercelQuarantine = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

test('Cloudflare is the only active repository hosting runtime for PabloVoice Web', () => {
  assert.deepEqual(vercelQuarantine, { git: { deploymentEnabled: false } });
  assert.equal(fs.existsSync('.github/workflows/cloudflare-preview-upload.yml'), false);
  assert.equal(wrangler.name, 'pablovoice-web');
  assert.equal(wrangler.main, './cloudflare/worker.mjs');
  assert.equal(wrangler.build.command, 'npm run build:web');
  assert.equal(wrangler.assets.directory, './apps/web/dist');
  assert.equal(wrangler.preview_urls, true);
});

test('Vercel runtime/auth dependencies stay absent while its legacy Git integration is disabled', () => {
  assert.equal(packageJson.dependencies?.['@vercel/oidc'], undefined);
  assert.equal(packageJson.devDependencies?.['@vercel/oidc'], undefined);
  assert.equal(Object.keys(vercelQuarantine).length, 1);
  assert.equal(Object.keys(vercelQuarantine.git).length, 1);
  assert.match(runtimeGate, /wrangler@4\.127\.1 deploy --dry-run/);
  assert.doesNotMatch(runtimeGate, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|vercel/i);
});
