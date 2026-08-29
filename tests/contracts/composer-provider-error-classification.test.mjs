import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtime = await readFile(new URL('../../supabase/functions/validate-app-js-v71/index.ts', import.meta.url), 'utf8');

test('Composer exposes only sanitized upstream provider error classification', () => {
  assert.match(runtime, /function safeProviderMeta/);
  assert.match(runtime, /\^\[A-Za-z0-9\._-\]\{1,80\}\$/);
  assert.match(runtime, /data\?\.error\?\.type/);
  assert.match(runtime, /data\?\.error\?\.code/);
  assert.match(runtime, /provider_error_type/);
  assert.match(runtime, /provider_error_code/);
  assert.match(runtime, /fallback_allowed:false/);
  assert.doesNotMatch(runtime, /data\?\.error\?\.message/);
  assert.doesNotMatch(runtime, /provider_error_message/);
});
