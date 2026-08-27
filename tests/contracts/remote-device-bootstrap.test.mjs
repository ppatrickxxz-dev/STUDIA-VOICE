import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const authSource = fs.readFileSync('packages/app/remote-auth.mjs', 'utf8');
const uiSource = fs.readFileSync('packages/app/remote-auth-ui.mjs', 'utf8');
const prebootSource = fs.readFileSync('packages/app/preboot.mjs', 'utf8');
const contract = fs.readFileSync('supabase/functions/device-auth/README.md', 'utf8');

test('remote auth exposes one-time bootstrap pairing without client secrets', () => {
  assert.match(authSource, /loginWithBootstrapCode\(code\)/);
  assert.match(authSource, /action:\s*'bootstrap'/);
  assert.match(authSource, /setDeviceToken\(data\.device_token\)/);
  assert.doesNotMatch(authSource, /service[_-]?role/i);
  assert.doesNotMatch(authSource, /OPENAI_API_KEY|GROQ_API_KEY|AI_GATEWAY_API_KEY/);
});

test('activation UI is installed by preboot and remains one-time and secret-free', () => {
  assert.match(prebootSource, /installRemoteAuthUI/);
  assert.match(uiSource, /Ativar recursos online/);
  assert.match(uiSource, /one-time-code/);
  assert.match(uiSource, /automaticamente/i);
  assert.match(uiSource, /rotatingDeviceToken:\s*true/);
  assert.match(uiSource, /noProviderSecretInClient:\s*true/);
});

test('canonical device-auth contract requires hash-only single-use codes', () => {
  assert.match(contract, /SHA-256/);
  assert.match(contract, /unused and unexpired/i);
  assert.match(contract, /reuse fails closed/i);
  assert.match(contract, /Only the token hash is stored/i);
});
