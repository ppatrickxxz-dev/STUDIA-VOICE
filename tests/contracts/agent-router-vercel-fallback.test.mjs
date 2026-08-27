import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('supabase/functions/validate-app-js-v71/index.ts', 'utf8');

test('agent router uses Vercel composer only for reviewed songwriting commands', () => {
  for (const command of ['generate', 'continue_section', 'rewrite', 'adapt_genre']) assert.match(source, new RegExp(command));
  assert.match(source, /COMPOSER_AGENT/);
  assert.match(source, /LEGACY_AGENT/);
  assert.match(source, /SONG_COMMANDS\.has\(command\)/);
});

test('agent router preserves authenticated headers and no provider credential', () => {
  assert.match(source, /authorization/);
  assert.match(source, /x-benchmark-token/);
  assert.doesNotMatch(source, /OPENAI_API_KEY|GROQ_API_KEY|AI_GATEWAY_API_KEY|sk-[A-Za-z0-9_-]{20,}/);
  assert.match(source, /credential_exposed:\s*false/);
});

test('router reports songwriting ready only when a real upstream health check is configured', () => {
  assert.match(source, /const composerReady = Boolean\(composer\?\.configured\)/);
  assert.match(source, /const legacyReady = Boolean\(legacy\?\.configured\)/);
  assert.match(source, /songwriting_ready:\s*composerReady \|\| legacyReady/);
});
