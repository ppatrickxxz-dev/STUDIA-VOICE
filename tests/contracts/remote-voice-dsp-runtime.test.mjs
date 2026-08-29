import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REMOTE_VOICE_DSP_CONTRACT,
  RemoteVoiceDspRuntime,
} from '../../packages/app/remote-voice-dsp-runtime.mjs';

const projectId = '11111111-1111-4111-8111-111111111111';
const sourceAssetId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';

function runtimeWith(requests, { session = true, linked = true } = {}) {
  const authAdapter = {
    async ensureSession() { return session ? { accessToken: 'user-jwt' } : null; },
    async ensureRemoteProject() { return linked ? { ok: true, project: { id: projectId } } : { ok: false }; },
  };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, init, body });
    return {
      ok: true,
      status: 200,
      async json() { return { ok: true, job_id: jobId, status: 'waiting_gpu', mode: body.mode, voice: body.voice }; },
    };
  };
  return new RemoteVoiceDspRuntime({ authAdapter, fetchImpl });
}

test('B07 runtime dispatches HIGH and LOW through the same frozen authenticated route', async () => {
  const requests = [];
  const runtime = runtimeWith(requests);
  const localProject = { id: 'local-1', name: 'Teste' };
  const high = await runtime.dispatchHarmony({ localProject, voice: 'high' });
  const low = await runtime.dispatchHarmony({ localProject, voice: 'low' });

  assert.deepEqual(requests.map((request) => request.body), [
    { action: 'dispatch', project_id: projectId, voice: 'high', mode: 'adaptive_partial' },
    { action: 'dispatch', project_id: projectId, voice: 'low', mode: 'adaptive_partial' },
  ]);
  assert.ok(requests.every((request) => request.url.endsWith('/functions/v1/progress-kaggle-harmony-v73')));
  assert.ok(requests.every((request) => request.init.headers.authorization === 'Bearer user-jwt'));
  assert.equal(high.benchmarkPass, false);
  assert.equal(low.benchmarkPass, false);
  assert.equal(high.benchmarkState, 'execution_evidence_pending_review');
});

test('B06 runtime fails closed without a verified remote source asset id', async () => {
  const requests = [];
  const runtime = runtimeWith(requests);
  await assert.rejects(
    () => runtime.dispatchPitchCorrection({ localProject: { id: 'local-1' }, sourceAssetId: 'local-only-asset' }),
    /Verified remote sourceAssetId/,
  );
  assert.equal(requests.length, 0);
});

test('B06 runtime preserves explicit target notes and does not award PASS on dispatch', async () => {
  const requests = [];
  const runtime = runtimeWith(requests);
  const result = await runtime.dispatchPitchCorrection({
    localProject: { id: 'local-1', name: 'Teste' },
    sourceAssetId,
    explicitTargets: [{ start: 1.2, end: 1.8, targetMidi: 61 }],
  });
  assert.deepEqual(requests[0].body, {
    action: 'dispatch',
    project_id: projectId,
    source_asset_id: sourceAssetId,
    explicit_targets: [{ start: 1.2, end: 1.8, target_midi: 61 }],
  });
  assert.ok(requests[0].url.endsWith('/functions/v1/diagnose-voice-v70-once'));
  assert.equal(result.benchmark, 'B06');
  assert.equal(result.benchmarkPass, false);
  assert.match(result.promotionRequires, /acoustic evidence/i);
});

test('remote DSP refuses execution without authenticated session or remote project ownership link', async () => {
  await assert.rejects(
    () => runtimeWith([], { session: false }).dispatchHarmony({ localProject: { id: 'local-1' }, voice: 'high' }),
    /Authenticated PabloVoice session/,
  );
  await assert.rejects(
    () => runtimeWith([], { linked: false }).dispatchHarmony({ localProject: { id: 'local-1' }, voice: 'high' }),
    /Remote project link/,
  );
});

test('runtime contract forbids pair promotion from implementation alone', () => {
  assert.deepEqual(REMOTE_VOICE_DSP_CONTRACT.harmony.voices, ['high', 'low']);
  assert.equal(REMOTE_VOICE_DSP_CONTRACT.harmony.mode, 'adaptive_partial');
  assert.equal(REMOTE_VOICE_DSP_CONTRACT.harmony.pairMustBeExecutedSequentially, true);
  assert.equal(REMOTE_VOICE_DSP_CONTRACT.pitch.sourceAssetRequired, true);
  assert.equal(REMOTE_VOICE_DSP_CONTRACT.benchmarkPromotion, 'external_acoustic_evidence_only');
});
