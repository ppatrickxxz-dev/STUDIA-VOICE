import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../../.github/workflows/composer-provider-canary.yml', import.meta.url),
  'utf8',
);

test('Composer canary is bound to the canonical Workers AI production round-trip', () => {
  assert.match(workflow, /CLOUDFLARE_PRODUCTION_URL:\s*https:\/\/studia-voice\.ppatrickxxz\.workers\.dev/);
  assert.match(workflow, /provider == \"cloudflare_workers_ai\"/);
  assert.match(workflow, /fallback_allowed == false/);
  assert.match(workflow, /AI_RUNTIME_PROVIDER_BLOCKED/);
  assert.doesNotMatch(workflow, /billing_not_active|insufficient_quota|openai_backend|validate-app-js-v71/);
});

test('Composer canary never fabricates success or loops retries around provider failure', () => {
  assert.match(workflow, /if \[ \"\$HTTP_CODE\" != '200' \]; then/);
  assert.match(workflow, /exit 1/);
  assert.doesNotMatch(workflow, /RETRY_MS|RETRY_SECONDS|call_provider\(\)/);
});
