import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../../.github/workflows/composer-provider-canary.yml', import.meta.url),
  'utf8',
);

test('Composer canary does not retry terminal provider billing failures', () => {
  assert.match(workflow, /PROVIDER_ERROR_CODE=.*provider_error_code.*provider_error_type/);
  assert.match(workflow, /PROVIDER_ERROR_CODE.*billing_not_active/);
  assert.match(workflow, /PROVIDER_ERROR_CODE.*insufficient_quota/);
  assert.match(workflow, /if \[ "\$PROVIDER_ERROR_CODE" != 'billing_not_active' \].*insufficient_quota/);
});

