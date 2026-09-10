import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const authSource = fs.readFileSync('packages/app/remote-auth.mjs', 'utf8');
const uiSource = fs.readFileSync('packages/app/remote-auth-ui.mjs', 'utf8');
const prebootSource = fs.readFileSync('packages/app/preboot.mjs', 'utf8');
const contract = fs.readFileSync('supabase/functions/device-auth/README.md', 'utf8');

test('remote auth exposes passwordless owner email without client secrets', () => {
  assert.match(authSource, /loginWithEmail\(email\)/);
  assert.match(authSource, /auth\/v1\/otp/);
  assert.match(authSource, /emailRedirectTo/);
  assert.doesNotMatch(authSource, /service[_-]?role/i);
  assert.doesNotMatch(authSource, /OPENAI_API_KEY|GROQ_API_KEY|AI_GATEWAY_API_KEY/);
});

test('owner access is reachable from creation without blocking local editing', () => {
  assert.match(prebootSource, /installRemoteAuthUI/);
  assert.match(uiSource, /pablovoice:request-online-auth/);
  assert.match(uiSource, /Acesso do proprietário/);
  assert.match(uiSource, /Liberar meu estúdio/);
  assert.match(uiSource, /autocomplete="email"/);
  assert.match(uiSource, /Sem código de ativação/);
  assert.match(uiSource, /activationCodeRequired:\s*false/);
  assert.match(uiSource, /rotatingDeviceToken:\s*true/);
  assert.match(uiSource, /noProviderSecretInClient:\s*true/);
  assert.match(uiSource, /creatorSurfaceVisible:\s*true/);
  assert.match(uiSource, /noSilentOfflineFallback:\s*true/);
  assert.match(uiSource, /#pv-ai-composer/);
  assert.match(uiSource, /#pv-song-creator/);
  assert.match(uiSource, /scrollIntoView/);
  assert.match(uiSource, /blocksCreativeInterface:\s*false/);
});

test('canonical device-auth contract requires hash-only single-use codes', () => {
  assert.match(contract, /SHA-256/);
  assert.match(contract, /unused and unexpired/i);
  assert.match(contract, /reuse fails closed/i);
  assert.match(contract, /Only the token hash is stored/i);
});
