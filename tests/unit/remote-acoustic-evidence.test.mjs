import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRemoteAcousticEvidence, summarizePersistedAcousticEvidence } from '../../packages/providers/src/remote-acoustic-evidence.mjs';

const validated = (extra = {}) => ({
  state: 'validated',
  promotable: true,
  technical: { pass: true },
  identity: { status: 'pass' },
  timbre: { status: 'pass' },
  ...extra,
});

function track({ id, kind, voice = null, pairId = null, evidence = null, profile = null }) {
  return {
    id,
    kind,
    remoteEvidence: {
      metadata: {
        voice,
        profile,
        harmony_pair_id: pairId,
        acoustic_evidence: evidence,
      },
    },
  };
}

test('remote metadata cannot claim validation while technical, timbre or identity proof is missing', () => {
  const value = normalizeRemoteAcousticEvidence({ metadata: { acoustic_evidence: { state: 'validated', promotable: true } } });
  assert.equal(value.promotable, false);
  assert.equal(value.state, 'pending');
});

test('validated persisted voice evidence becomes available without exposing embeddings', () => {
  const summary = summarizePersistedAcousticEvidence([
    track({ id: 'v1', kind: 'voice_variant', profile: 'identity', evidence: validated() }),
  ]);
  assert.equal(summary.voice.validated, 1);
  assert.equal(summary.voice.state, 'validated_available');
});

test('high and low cannot form a validated pair when pair correlation is absent', () => {
  const summary = summarizePersistedAcousticEvidence([
    track({ id: 'h1', kind: 'harmony', voice: 'high', evidence: validated() }),
    track({ id: 'l1', kind: 'harmony', voice: 'low', evidence: validated() }),
  ]);
  assert.equal(summary.harmony.pairValidated, false);
  assert.equal(summary.harmony.unpaired, 2);
  assert.equal(summary.harmony.state, 'pair_evidence_pending');
});

test('high and low validate only when both share one explicit pair id and both pass evidence', () => {
  const summary = summarizePersistedAcousticEvidence([
    track({ id: 'h1', kind: 'harmony', voice: 'high', pairId: 'pair-1', evidence: validated() }),
    track({ id: 'l1', kind: 'harmony', voice: 'low', pairId: 'pair-1', evidence: validated() }),
  ]);
  assert.equal(summary.harmony.pairValidated, true);
  assert.equal(summary.harmony.validatedPairId, 'pair-1');
  assert.equal(summary.harmony.state, 'pair_validated');
});

test('a failed layer blocks its correlated high-low pair', () => {
  const failed = { state: 'not_validated', promotable: false, technical: { pass: true }, identity: { status: 'fail' }, timbre: { status: 'pass' } };
  const summary = summarizePersistedAcousticEvidence([
    track({ id: 'h1', kind: 'harmony', voice: 'high', pairId: 'pair-2', evidence: validated() }),
    track({ id: 'l1', kind: 'harmony', voice: 'low', pairId: 'pair-2', evidence: failed }),
  ]);
  assert.equal(summary.harmony.pairValidated, false);
  assert.equal(summary.harmony.state, 'pair_not_validated');
});
