import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateVocalCleanupIdentityGate,
  selectIdentitySafeVocalCleanup,
} from '../../packages/audio/src/voice/cleanup-identity-gate.mjs';

function validEvidence() {
  return {
    reference: {
      durationSeconds: 8,
      formantsHz: [520, 1480, 2520],
      speakerEmbedding: [0.72, 0.31, -0.18, 0.49],
    },
    candidate: {
      durationSeconds: 8.01,
      clippingRatio: 0,
      peak: 0.94,
      formantsHz: [526, 1468, 2544],
      speakerEmbedding: [0.71, 0.32, -0.17, 0.5],
    },
    alignment: { sameContent: true },
  };
}

test('identity-safe cleanup promotes processed audio only with complete passing acoustic evidence', () => {
  const evidence = validEvidence();
  const gate = evaluateVocalCleanupIdentityGate(evidence);
  assert.equal(gate.promotable, true);
  assert.equal(gate.state, 'validated_use_processed');
  assert.deepEqual(gate.blockers, []);
  assert.equal(gate.evidence.technical.pass, true);
  assert.equal(gate.evidence.timbre.status, 'pass');
  assert.equal(gate.evidence.identity.status, 'pass');

  const original = { id: 'original' };
  const processed = { id: 'cleaned' };
  const selected = selectIdentitySafeVocalCleanup({ original, processed, ...evidence });
  assert.equal(selected.output, processed);
  assert.equal(selected.usedProcessed, true);
});

test('missing speaker identity evidence fails closed and keeps the original vocal', () => {
  const evidence = validEvidence();
  delete evidence.reference.speakerEmbedding;
  delete evidence.candidate.speakerEmbedding;
  const original = { id: 'original' };
  const processed = { id: 'cleaned' };
  const selected = selectIdentitySafeVocalCleanup({ original, processed, ...evidence });

  assert.equal(selected.usedProcessed, false);
  assert.equal(selected.output, original);
  assert.equal(selected.gate.state, 'blocked_keep_original');
  assert.ok(selected.gate.blockers.includes('speaker_identity_unmeasured'));
  assert.ok(selected.gate.blockers.includes('cleanup_identity_evidence_missing'));
});

test('excessive formant drift blocks cleanup even when speaker embedding still matches', () => {
  const evidence = validEvidence();
  evidence.candidate.formantsHz = [650, 1850, 3150];
  const gate = evaluateVocalCleanupIdentityGate(evidence);

  assert.equal(gate.promotable, false);
  assert.equal(gate.evidence.timbre.status, 'fail');
  assert.ok(gate.blockers.includes('timbre_drift_failed'));
  assert.ok(gate.blockers.includes('cleanup_timbre_drift_failed'));
});

test('cleanup refuses promotion when same-content alignment is not confirmed', () => {
  const evidence = validEvidence();
  evidence.alignment = { sameContent: false };
  const gate = evaluateVocalCleanupIdentityGate(evidence);

  assert.equal(gate.promotable, false);
  assert.equal(gate.state, 'blocked_keep_original');
  assert.ok(gate.blockers.includes('cleanup_alignment_unconfirmed'));
});

test('cleanup selector requires both original and processed artifacts', () => {
  const evidence = validEvidence();
  assert.throws(
    () => selectIdentitySafeVocalCleanup({ processed: {}, ...evidence }),
    /Original vocal artifact is required/,
  );
  assert.throws(
    () => selectIdentitySafeVocalCleanup({ original: {}, ...evidence }),
    /Processed vocal artifact is required/,
  );
});
