import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HARMONY_ROUTE_CONTRACT,
  KaggleHarmonyClient,
  buildHarmonyPairPlan,
  classifyHarmonyPairReadiness,
} from '../../packages/providers/src/kaggle-harmony-client.mjs';

const projectId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';

function validatedEvidence() {
  return { state: 'validated', promotable: true };
}

function fakeClient(requests, response = {}) {
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
          return JSON.stringify({ ok: true, job_id: jobId, status: 'waiting_gpu', ...response });
        },
      };
    },
  });
}

test('B07 plan freezes discreet high and low layers under one mode', () => {
  assert.deepEqual(buildHarmonyPairPlan(), [
    { voice: 'high', mode: 'adaptive_partial' },
    { voice: 'low', mode: 'adaptive_partial' },
  ]);
  assert.equal(HARMONY_ROUTE_CONTRACT.formantPreservationRequired, true);
});

test('authenticated client dispatches both layers without service-role credentials', async () => {
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

test('response echo is validated when the remote route supplies it but is not invented when absent', async () => {
  await fakeClient([]).dispatch({ accessToken: 'user-jwt', projectId, voice: 'high' });
  await assert.rejects(
    () => fakeClient([], { voice: 'low' }).dispatch({ accessToken: 'user-jwt', projectId, voice: 'high' }),
    /changed the requested voice/,
  );
});

test('pair cannot promote until both layers have acoustic evidence', () => {
  const none = classifyHarmonyPairReadiness();
  assert.equal(none.pairValidated, false);
  assert.deepEqual(none.blockers, ['high_acoustic_evidence_missing', 'low_acoustic_evidence_missing']);

  const highOnly = classifyHarmonyPairReadiness({ highEvidence: validatedEvidence() });
  assert.equal(highOnly.highValidated, true);
  assert.equal(highOnly.lowValidated, false);
  assert.equal(highOnly.pairValidated, false);

  const pair = classifyHarmonyPairReadiness({ highEvidence: validatedEvidence(), lowEvidence: validatedEvidence() });
  assert.equal(pair.pairValidated, true);
  assert.equal(pair.promotable, true);
  assert.equal(pair.state, 'pair_validated');
});

test('unsupported voice fails before network dispatch', async () => {
  const requests = [];
  const client = fakeClient(requests);
  await assert.rejects(() => client.dispatch({ accessToken: 'user-jwt', projectId, voice: 'middle' }), /high or low/);
  assert.equal(requests.length, 0);
});
