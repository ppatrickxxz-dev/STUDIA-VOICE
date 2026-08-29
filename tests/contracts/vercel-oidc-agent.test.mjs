import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare/worker.mjs', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const vercelQuarantine = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

test('Vercel runtime dependencies stay removed from PabloVoice', () => {
  assert.equal(pkg.dependencies?.['@vercel/oidc'], undefined);
  assert.deepEqual(vercelQuarantine, { git: { deploymentEnabled: false } });
  assert.equal(Object.keys(vercelQuarantine).length, 1);
  assert.equal(Object.keys(vercelQuarantine.git).length, 1);
  assert.equal(fs.existsSync('api/pablo-agent.mjs'), false);
  assert.equal(fs.existsSync('api/health.js'), false);
  assert.equal(fs.existsSync('api/provider-readiness.js'), false);

  assert.doesNotMatch(worker, /@vercel\/oidc|getVercelOidcToken|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY/i);
  assert.doesNotMatch(worker, /ai-gateway\.vercel\.sh|vercel_ai_gateway/i);
});

test('Cloudflare Composer uses direct OpenAI Responses API with server-side secret only', () => {
  assert.match(worker, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(worker, /env\.OPENAI_API_KEY/);
  assert.match(worker, /const MODEL = 'gpt-5\.4-mini'/);
  assert.match(worker, /credential_exposed:\s*false/);
  assert.doesNotMatch(worker, /sk-[A-Za-z0-9_-]{20,}/);
});

test('Cloudflare Composer preserves authentication, project ownership and reviewed commands', () => {
  assert.match(worker, /\/auth\/v1\/user/);
  assert.match(worker, /\/rest\/v1\/projects\?id=eq\./);
  assert.match(worker, /project_not_found/);
  for (const command of ['generate', 'continue_section', 'rewrite', 'adapt_genre']) assert.match(worker, new RegExp(command));
  assert.match(worker, /unsupported_command/);
  assert.match(worker, /Não imite literalmente artistas/);
});

test('Cloudflare Composer fails closed and never fabricates provider output', () => {
  for (const error of ['provider_auth_failed', 'provider_rate_limited', 'provider_unavailable', 'provider_invalid_response', 'provider_connection_failed', 'provider_timeout', 'remote_empty_response', 'agent_backend_error']) {
    assert.match(worker, new RegExp(error));
  }
  assert.match(worker, /fallback_allowed:\s*false/);
  assert.doesNotMatch(worker, /fallback_allowed:\s*true/);
});
