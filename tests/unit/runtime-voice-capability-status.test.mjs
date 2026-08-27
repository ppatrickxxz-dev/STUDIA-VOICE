import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPABILITY_STATUS_POLICY,
  classifyVoiceConversionCapability,
} from '../../packages/app/runtime-capability-status.mjs';

const model = Object.freeze({ id: '5c0976b2-bd2c-44d7-8720-a2dc013fd4b5', status: 'ready', name: 'PabloVoice Principal' });
const reference = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  is_active: true,
  source_sha256: '85b6341bac253f85a48506400baed3dd2bbf212ac172af6d0fa8e47d35642b95',
});

test('voice conversion capability is disconnected without an authenticated account', () => {
  const state = classifyVoiceConversionCapability({ authenticated: false });
  assert.equal(state.state, 'disconnected');
  assert.equal(state.configured, false);
});

test('voice conversion capability distinguishes model and reference prerequisites', () => {
  assert.equal(classifyVoiceConversionCapability({ authenticated: true }).state, 'model_pending');
  assert.equal(classifyVoiceConversionCapability({ authenticated: true, voiceModel: { ...model, status: 'training' } }).state, 'model_pending');
  assert.equal(classifyVoiceConversionCapability({ authenticated: true, voiceModel: model }).state, 'reference_pending');
  assert.equal(classifyVoiceConversionCapability({ authenticated: true, voiceModel: model, reference: { ...reference, source_sha256: 'bad' } }).state, 'reference_pending');
});

test('configured means identity prerequisites only, not project guide readiness', () => {
  const state = classifyVoiceConversionCapability({ authenticated: true, voiceModel: model, reference });
  assert.equal(state.state, 'configured');
  assert.equal(state.configured, true);
  assert.equal(state.voiceModel.id, model.id);
  assert.equal(state.reference.id, reference.id);
  assert.equal(CAPABILITY_STATUS_POLICY.voiceConversionGuideReadinessIsProjectSpecific, true);
  assert.equal(CAPABILITY_STATUS_POLICY.configuredIdentityDoesNotClaimProjectReady, true);
});
