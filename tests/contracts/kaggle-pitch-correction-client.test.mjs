import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KagglePitchCorrectionClient,
  PITCH_CORRECTION_B06_ROUTE,
  classifyPitchCorrectionRouteReadiness,
} from '../../services/providers/kaggle-pitch-correction-client.mjs';

const projectId = '11111111-1111-4111-8111-111111111111';
const sourceAssetId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';

function fakeClient(requests) {
  return new KagglePitchCorrectionClient({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'publishable',
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, init, body });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ ok: true, job_id: jobId, status: 'waiting_gpu', policy: PITCH_CORRECTION_B06_ROUTE.policy });
        },
      };
    },
  });
}

test('B06 provider dispatch requires an owned source asset and normalized target notes', async () => {
  const requests = [];
  const client = fakeClient(requests);
  await client.dispatch({
    accessToken: 'user-jwt',
    projectId,
    sourceAssetId,
    explicitTargets: [{ start: 1.2, end: 1.8, targetMidi: 61 }],
  });
  assert.deepEqual(requests[0].body, {
    action: 'dispatch',
    project_id: projectId,
    source_asset_id: sourceAssetId,
    explicit_targets: [{ start: 1.2, end: 1.8, target_midi: 61 }],
  });
  assert.equal(requests[0].init.headers.authorization, 'Bearer user-jwt');
  assert.equal(requests[0].init.headers.apikey, 'publishable');
});

test('B06 route is conservative and formant/vibrato preserving by contract', () => {
  const policy = PITCH_CORRECTION_B06_ROUTE.policy;
  assert.equal(policy.preserve_formants, true);
  assert.equal(policy.preserve_relative_vibrato, true);
  assert.ok(policy.deadband_cents >= 10);
  assert.ok(policy.max_correction_cents <= 50);
  assert.ok(policy.min_confidence >= 0.7);
});

test('B06 implementation remains unscored until retained benchmark output exists', () => {
  const readiness = classifyPitchCorrectionRouteReadiness();
  assert.equal(readiness.implementationReady, true);
  assert.equal(readiness.retainedBenchmarkOutput, false);
  assert.equal(readiness.scorable, false);
  assert.equal(readiness.state, 'implementation_ready_unexecuted');
});

test('invalid target note fails before network dispatch', async () => {
  const requests = [];
  const client = fakeClient(requests);
  await assert.rejects(() => client.dispatch({
    accessToken: 'user-jwt',
    projectId,
    sourceAssetId,
    explicitTargets: [{ start: 1, end: 0.5, targetMidi: 61 }],
  }), /Invalid explicit target/);
  assert.equal(requests.length, 0);
});
