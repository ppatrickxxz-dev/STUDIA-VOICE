import test from 'node:test';
import assert from 'node:assert/strict';
import { acousticEvidenceStatusModel } from '../../packages/providers/src/acoustic-evidence-status.mjs';

const validated = { state: 'validated', promotable: true };

test('evidence status stays pending when voice and harmony measurements are absent', () => {
  const status = acousticEvidenceStatusModel();
  assert.equal(status.voice, 'pending');
  assert.equal(status.harmony, 'pair_evidence_pending');
  assert.equal(status.pairValidated, false);
  assert.equal(status.promotable, false);
});

test('voice validation alone cannot promote the combined Voice Lab + harmony state', () => {
  const status = acousticEvidenceStatusModel({ voiceEvidence: validated });
  assert.equal(status.voice, 'validated');
  assert.equal(status.pairValidated, false);
  assert.equal(status.promotable, false);
});

test('combined state promotes only when voice plus both harmony layers are validated', () => {
  const status = acousticEvidenceStatusModel({ voiceEvidence: validated, highEvidence: validated, lowEvidence: validated });
  assert.equal(status.voice, 'validated');
  assert.equal(status.harmony, 'pair_validated');
  assert.equal(status.pairValidated, true);
  assert.equal(status.promotable, true);
});
