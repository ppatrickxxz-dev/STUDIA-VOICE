import test from 'node:test';
import assert from 'node:assert/strict';
import {
  B04_FROZEN,
  assertFrozenB04Request,
  buildB04DispatchRequest,
  classifyB04Readiness,
  evaluateB04RetainedEvidence,
} from '../../packages/providers/src/b04-voice-identity-contract.mjs';

test('B04 dispatch request is exactly frozen to identity profile and 64-72s', () => {
  const request = buildB04DispatchRequest();
  assert.equal(request.profile, 'identity');
  assert.equal(request.region_start_seconds, 64);
  assert.equal(request.region_end_seconds, 72);
  assert.equal(request.identity_reference_sha256, B04_FROZEN.identityReferenceSha256);
  assert.equal(assertFrozenB04Request(request), true);
});

test('B04 refuses guide, model, region, profile, and identity cherry-picking', () => {
  assert.throws(() => buildB04DispatchRequest({ profile: 'natural' }), /profile changed/);
  assert.throws(() => buildB04DispatchRequest({ regionStartSeconds: 63 }), /region changed/);
  assert.throws(() => buildB04DispatchRequest({ guideSha256: '0'.repeat(64) }), /expected_guide_sha256 changed/);
  assert.throws(() => buildB04DispatchRequest({ identityReferenceSha256: '1'.repeat(64) }), /identity_reference_sha256 changed/);
  assert.throws(() => buildB04DispatchRequest({ modelPthSha256: '2'.repeat(64) }), /required_model_pth_sha256 changed/);
});

test('historical full-guide RVC output cannot satisfy localized B04 evidence', () => {
  const result = evaluateB04RetainedEvidence({
    retained: true,
    private: true,
    profile: 'identity',
    guideSha256: B04_FROZEN.guideSha256,
    identityReferenceSha256: B04_FROZEN.identityReferenceSha256,
    modelPthSha256: B04_FROZEN.modelPthSha256,
    modelIndexSha256: B04_FROZEN.modelIndexSha256,
    regionStartSeconds: 64,
    regionEndSeconds: 72,
    outputSha256: '3'.repeat(64),
    guidePcmSha256: '4'.repeat(64),
    outputPcmSha256: '5'.repeat(64),
    durationSeconds: 180.999975,
  });
  assert.equal(result.valid, false);
  assert.ok(result.failures.includes('localized_duration_invalid'));
});

test('B04 readiness is separate from scoreability', () => {
  const ready = classifyB04Readiness({
    authenticatedDispatcher: true,
    exactGuideGuard: true,
    localizedRegionGuard: true,
    identityReferenceGuard: true,
    modelHashGuard: true,
  });
  assert.equal(ready.state, 'implementation_ready_unexecuted');
  assert.equal(ready.scorable, false);
});
