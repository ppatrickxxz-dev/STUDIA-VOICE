import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProviderEvidence, DEMUCS_HTDEMUCS_EVIDENCE } from '../../packages/audio/src/provider-evidence.mjs';

test('Demucs engine evidence is real but standalone route is not yet promotable', () => {
  const result = classifyProviderEvidence({
    engineEvidence: DEMUCS_HTDEMUCS_EVIDENCE.engineEvidence,
    routeEvidence: DEMUCS_HTDEMUCS_EVIDENCE.standaloneRouteEvidence,
  });
  assert.equal(result.engineValidated, true);
  assert.equal(result.routeValidated, false);
  assert.equal(result.promotable, false);
  assert.equal(result.state, 'engine_validated_route_pending');
});

test('provider becomes promotable only when both engine and current route have evidence', () => {
  const result = classifyProviderEvidence({ engineEvidence: { verified: true }, routeEvidence: { verified: true } });
  assert.equal(result.promotable, true);
  assert.equal(result.state, 'validated');
});
