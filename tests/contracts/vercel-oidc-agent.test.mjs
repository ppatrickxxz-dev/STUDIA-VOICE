import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('api/pablo-agent.mjs', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

test('Vercel composer bridge resolves short-lived platform auth at runtime', () => {
  assert.equal(pkg.dependencies?.['@vercel/oidc'], '3.8.5');
  assert.match(source, /getVercelOidcToken/);
  assert.match(source, /resolveGatewayToken/);
  assert.match(source, /expirationBufferMs:\s*30_000/);
  assert.match(source, /process\.env\.AI_GATEWAY_API_KEY \|\| process\.env\.VERCEL_OIDC_TOKEN/);
  assert.doesNotMatch(source, /sk-[A-Za-z0-9_-]{20,}/);
  assert.match(source, /credential_exposed:\s*false/);
});

test('composer bridge authenticates the PabloVoice user and enforces project ownership before generation', () => {
  assert.match(source, /\/auth\/v1\/user/);
  assert.match(source, /authorization:\s*`Bearer \$\{jwt\}`/);
  assert.match(source, /\/rest\/v1\/projects\?id=eq\./);
  assert.match(source, /project_not_found/);
});

test('composer bridge exposes only reviewed songwriting commands', () => {
  for (const command of ['generate', 'continue_section', 'rewrite', 'adapt_genre']) assert.match(source, new RegExp(command));
  assert.match(source, /unsupported_command/);
  assert.match(source, /Não imite literalmente artistas/);
});

test('composer bridge fails closed and never pretends provider output exists', () => {
  assert.match(source, /gateway_unavailable/);
  assert.match(source, /remote_provider_failed/);
  assert.match(source, /remote_empty_response/);
  assert.match(source, /fallback_allowed:\s*true/);
});
