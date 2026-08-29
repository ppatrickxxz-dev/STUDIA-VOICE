import test from 'node:test';
import assert from 'node:assert/strict';
import { PmiGeneratorAdapter } from '../../packages/music-intelligence/src/generator-adapter.mjs';

test('Generator Adapter preserves sanitized provider quota metadata and does not retry insufficient_quota', async () => {
  let calls = 0;
  const adapter = new PmiGeneratorAdapter({
    maxRetries: 1,
    sleep: async () => {},
    invoke: async () => {
      calls += 1;
      return {
        ok: false,
        error: 'provider_rate_limited',
        provider_error_type: 'insufficient_quota',
        provider_error_code: 'insufficient_quota',
        retry_after_ms: 250,
        fallback_allowed: false,
        request_id: 'quota_probe_1',
        latency_ms: 10,
      };
    },
  });

  const result = await adapter.execute({ command: 'generate', project_id: 'project-1', task: 'Crie um refrão curto.' });

  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'provider_rate_limited');
  assert.equal(result.provider_error_type, 'insufficient_quota');
  assert.equal(result.provider_error_code, 'insufficient_quota');
  assert.equal(result.attempts, 1);
  assert.equal(result.fallback_allowed, undefined);
});

test('Generator Adapter strips unsafe provider metadata', async () => {
  const adapter = new PmiGeneratorAdapter({
    maxRetries: 0,
    invoke: async () => ({
      ok: false,
      error: 'provider_rate_limited',
      provider_error_type: 'unsafe metadata with spaces and secrets',
      provider_error_code: '<script>',
      request_id: 'quota_probe_2',
    }),
  });

  const result = await adapter.execute({ command: 'generate', project_id: 'project-1', task: 'Crie um verso curto.' });
  assert.equal(result.provider_error_type, undefined);
  assert.equal(result.provider_error_code, undefined);
});
