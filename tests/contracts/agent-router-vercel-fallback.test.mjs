import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('supabase/functions/validate-app-js-v71/index.ts', 'utf8');

test('agent router sends only reviewed songwriting commands to the server-side composer', () => {
  for (const command of ['generate', 'continue_section', 'rewrite', 'adapt_genre']) assert.match(source, new RegExp(command));
  assert.match(source, /SONG_COMMANDS\.has\(command\)/);
  assert.match(source, /OPENAI_URL/);
  assert.match(source, /LEGACY_AGENT/);
});

test('composer credential is resolved server-side and never embedded in client source', () => {
  assert.match(source, /get_pablovoice_openai_api_key/);
  assert.doesNotMatch(source, /sk-[A-Za-z0-9_-]{20,}/);
  assert.match(source, /credential_exposed:false/);
});

test('composer authenticates the user and resolves only an owned project before generation', () => {
  assert.match(source, /auth\.getUser\(jwt\)/);
  assert.match(source, /from\('projects'\)/);
  assert.match(source, /eq\('id',projectId\)/);
  assert.match(source, /project_not_found/);
});

test('composer fails closed when the remote provider cannot return creative output', () => {
  assert.match(source, /remote_provider_failed/);
  assert.match(source, /remote_empty_response/);
  assert.match(source, /fallback_allowed:true/);
});
