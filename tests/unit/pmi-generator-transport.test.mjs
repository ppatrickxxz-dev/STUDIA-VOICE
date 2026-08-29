import test from 'node:test';
import assert from 'node:assert/strict';
import { PmiGeneratorAdapter } from '../../packages/music-intelligence/src/index.mjs';

const request = {
  command: 'generate',
  project_id: '11111111-1111-4111-8111-111111111111',
  task: 'Escreve um refrão sobre uma viagem que parou antes do destino',
  context_pack: { current_lyrics: '[Verso]\nAté onde deu' },
  constraints: { review_before_apply: true },
  best_of_n: 9,
};

test('Generator Adapter owns the reviewed Composer transport and validates successful provider metadata', async () => {
  let received = null;
  const adapter = new PmiGeneratorAdapter({
    invoke: async (payload, options) => {
      received = { payload, options };
      return {
        ok: true,
        text: '[Refrão]\nAté onde deu, ainda era caminho',
        provider: 'openai_backend',
        model: 'gpt-5.4-mini',
        request_id: 'provider-request-1',
        latency_ms: 432,
      };
    },
  });

  const result = await adapter.execute(request);
  assert.equal(received.payload.command, 'generate');
  assert.equal(received.payload.best_of_n, 1);
  assert.equal(received.payload.project_id, request.project_id);
  assert.equal(received.options.attempt, 1);
  assert.equal(result.ok, true);
  assert.equal(result.text, '[Refrão]\nAté onde deu, ainda era caminho');
  assert.equal(result.provider, 'openai_backend');
  assert.equal(result.model, 'gpt-5.4-mini');
  assert.equal(result.request_id, 'provider-request-1');
  assert.equal(result.attempts, 1);
});

test('Generator Adapter retries a transient provider failure at most once', async () => {
  let calls = 0;
  const adapter = new PmiGeneratorAdapter({
    sleep: async () => {},
    invoke: async () => {
      calls += 1;
      if (calls === 1) return { ok: false, error: 'provider_rate_limited', retry_after_ms: 0 };
      return { ok: true, text: 'segunda tentativa real', provider: 'openai_backend', model: 'gpt-5.4-mini' };
    },
  });

  const result = await adapter.execute(request);
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
});

test('Generator Adapter never fabricates success when provider response violates schema', async () => {
  let calls = 0;
  const adapter = new PmiGeneratorAdapter({
    invoke: async () => {
      calls += 1;
      return { ok: true, text: 'sem metadata de provider' };
    },
  });

  const result = await adapter.execute(request);
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'provider_invalid_response');
  assert.equal(Object.hasOwn(result, 'text'), false);
  assert.equal(Object.hasOwn(result, 'reply'), false);
});

test('Generator Adapter does not retry authentication or malformed-request failures', async () => {
  for (const error of ['auth_required', 'project_not_found', 'provider_auth_failed', 'provider_invalid_response']) {
    let calls = 0;
    const adapter = new PmiGeneratorAdapter({
      invoke: async () => { calls += 1; return { ok: false, error }; },
    });
    const result = await adapter.execute(request);
    assert.equal(calls, 1, error);
    assert.equal(result.ok, false, error);
    assert.equal(result.error, error);
  }
});

test('Generator Adapter treats an explicit caller abort as cancellation and never retries it', async () => {
  const controller = new AbortController();
  let calls = 0;
  const adapter = new PmiGeneratorAdapter({
    invoke: async (_payload, options) => {
      calls += 1;
      controller.abort('user_cancelled');
      await Promise.resolve();
      assert.equal(options.signal.aborted, true);
      throw new Error('aborted');
    },
  });

  const result = await adapter.execute(request, { signal: controller.signal });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'request_cancelled');
  assert.equal(Object.hasOwn(result, 'text'), false);
});
