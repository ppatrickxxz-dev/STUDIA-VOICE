import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('reviewed songwriting commands route through the canonical Generator Adapter before authenticated transport', async () => {
  const source = await readFile(new URL('../../packages/app/remote-auth.mjs', import.meta.url), 'utf8');
  assert.match(source, /SONG_COMMANDS = new Set\(\['generate', 'continue_section', 'rewrite', 'adapt_genre'\]\)/);
  assert.match(source, /PmiGeneratorAdapter/);
  assert.match(source, /bypassGeneratorAdapter/);
  assert.match(source, /return adapter\.execute\(payload,\{signal:options\?\.signal\}\)/);
  assert.match(source, /signal:options\?\.signal/);
});

test('Composer Edge runtime has bounded timeout, typed provider failures and safe observability', async () => {
  const source = await readFile(new URL('../../supabase/functions/validate-app-js-v71/index.ts', import.meta.url), 'utf8');
  assert.match(source, /const PROVIDER_TIMEOUT_MS=20_000/);
  assert.match(source, /provider_auth_failed/);
  assert.match(source, /provider_rate_limited/);
  assert.match(source, /provider_unavailable/);
  assert.match(source, /provider_invalid_response/);
  assert.match(source, /provider_connection_failed/);
  assert.match(source, /remote_empty_response/);
  assert.match(source, /request_id:id/);
  assert.match(source, /latency_ms/);
  assert.match(source, /fallback_allowed:false/);
  assert.match(source, /readiness_basis:'credential_presence_only'/);
  assert.doesNotMatch(source, /console\.error/);
  assert.doesNotMatch(source, /safeLog\([^\n]*(task|input|context_pack|author_samples|key)[^\n]*\)/i);
});

test('Composer provider credential remains server-side and never enters the app transport', async () => {
  const edge = await readFile(new URL('../../supabase/functions/validate-app-js-v71/index.ts', import.meta.url), 'utf8');
  const remote = await readFile(new URL('../../packages/app/remote-auth.mjs', import.meta.url), 'utf8');
  assert.match(edge, /get_pablovoice_openai_api_key/);
  assert.doesNotMatch(remote, /OPENAI_API_KEY|service_role|sk-[A-Za-z0-9_-]{20,}/i);
  assert.doesNotMatch(edge, /json\([^\n]*(?:key|secret)[^\n]*\)/i);
});
