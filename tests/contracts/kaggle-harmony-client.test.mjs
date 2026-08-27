import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HARMONY_V752_ROUTE_EVIDENCE,
  KaggleHarmonyClient,
  buildHarmonyPairPlan,
  classifyHarmonyPairReadiness,
} from '../../services/providers/kaggle-harmony-client.mjs';

const projectId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';

function fakeClient(requests) {
  return new KaggleHarmonyClient({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'publishable',
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, init, body });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ ok: true, job_id: jobId, mode: body.mode, voice: body.voice, status: 'waiting_gpu' });
        },
      };
    },
  });
}

test('B07 pair plan always contains discreet high and low layers using one frozen mode', () => {
  assert.deepEqual(buildHarmonyPairPlan(), [
    { voice: 'high', mode: 'adaptive_partial' },
    { voice: 'low', mode: 'adaptive_partial' },
  ]);
});

test('harmony client preserves authenticated high/low requests without service-role credentials', async () => {
  const requests = [];
  const client = fakeClient(requests);
  await client.dispatch({ accessToken: 'user-jwt', projectId, voice: 'high' });
  await client.dispatch({ accessToken: 'user-jwt', projectId, voice: 'low' });

  assert.deepEqual(requests.map((request) => request.body), [
    { action: 'dispatch', project_id: projectId, voice: 'high', mode: 'adaptive_partial' },
    { action: 'dispatch', project_id: projectId, voice: 'low', mode: 'adaptive_partial' },
  ]);
  for (const request of requests) {
    assert.equal(request.init.headers.authorization, 'Bearer user-jwt');
    assert.equal(request.init.headers.apikey, 'publishable');
    assert.equal('service_role' in request.init.headers, false);
  }
});

test('B07 implementation readiness does not pretend the low acoustic output was validated', () => {
  const readiness = classifyHarmonyPairReadiness();
  assert.equal(HARMONY_V752_ROUTE_EVIDENCE.observedHighExecution.verified, true);
  assert.equal(HARMONY_V752_ROUTE_EVIDENCE.observedLowExecution, null);
  assert.equal(readiness.routeImplemented, true);
  assert.equal(readiness.highValidated, true);
  assert.equal(readiness.lowValidated, false);
  assert.equal(readiness.pairValidated, false);
  assert.equal(readiness.implementationReady, true);
  assert.equal(readiness.state, 'pair_implemented_execution_pending');
});

test('unsupported harmony voice fails before network dispatch', async () => {
  const requests = [];
  const client = fakeClient(requests);
  await assert.rejects(() => client.dispatch({ accessToken: 'user-jwt', projectId, voice: 'middle' }), /high or low/);
  assert.equal(requests.length, 0);
});
