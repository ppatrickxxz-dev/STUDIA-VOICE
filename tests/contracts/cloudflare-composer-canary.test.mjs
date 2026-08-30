import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../../.github/workflows/composer-provider-canary.yml', import.meta.url), 'utf8');
const runtimeGate = await readFile(new URL('../../.github/workflows/cloudflare-runtime-gate.yml', import.meta.url), 'utf8');

test('Composer production canary targets Cloudflare Workers AI instead of the retired OpenAI backend', () => {
  assert.match(workflow, /https:\/\/studia-voice\.ppatrickxxz\.workers\.dev/);
  assert.match(workflow, /cloudflare_workers_ai/);
  assert.match(workflow, /\/api\/pablo-agent/);
  assert.doesNotMatch(workflow, /validate-app-js-v71|openai_backend|billing_not_active|api\.openai\.com/);
});

test('Cloudflare physical preview proves authenticated provider output before merge', () => {
  assert.match(runtimeGate, /id-token:\s*write/);
  assert.match(runtimeGate, /Acquire OIDC-backed PabloVoice user session/);
  assert.match(runtimeGate, /Prove authenticated Workers AI generation on exact preview/);
  assert.match(runtimeGate, /cloudflare_workers_ai/);
  assert.match(runtimeGate, /fallback_allowed == false/);
});
