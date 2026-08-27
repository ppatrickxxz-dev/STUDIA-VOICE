import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateVoiceAcousticEvidence, compareFormants, cosineSimilarity } from '../../packages/audio/src/voice/acoustic-evidence.mjs';

test('voice acoustic evidence fails closed when speaker identity is unmeasured', () => {
  const result = evaluateVoiceAcousticEvidence({
    reference: { formantsHz: [500, 1500, 2500] },
    candidate: { peak: 0.8, clippingRatio: 0, formantsHz: [510, 1490, 2520] },
    alignment: { sameContent: false },
  });
  assert.equal(result.technical.pass, true);
  assert.equal(result.timbre.status, 'pass');
  assert.equal(result.identity.status, 'missing');
  assert.equal(result.promotable, false);
  assert.ok(result.blockers.includes('speaker_identity_unmeasured'));
});

test('voice acoustic evidence passes only with technical, timbre and identity evidence', () => {
  const result = evaluateVoiceAcousticEvidence({
    reference: {
      durationSeconds: 10,
      formantsHz: [500, 1500, 2500],
      speakerEmbedding: [1, 0, 0.2],
    },
    candidate: {
      durationSeconds: 10.1,
      peak: 0.9,
      clippingRatio: 0,
      formantsHz: [515, 1490, 2520],
      speakerEmbedding: [0.98, 0.04, 0.21],
    },
    alignment: { sameContent: true },
  });
  assert.equal(result.technical.pass, true);
  assert.equal(result.temporal.status, 'pass');
  assert.equal(result.timbre.status, 'pass');
  assert.equal(result.identity.status, 'pass');
  assert.equal(result.promotable, true);
  assert.equal(result.state, 'validated');
});

test('technical clipping blocks promotion even when identity matches', () => {
  const result = evaluateVoiceAcousticEvidence({
    reference: { formantsHz: [500, 1500], speakerEmbedding: [1, 0] },
    candidate: { peak: 1, clippingRatio: 0.01, formantsHz: [500, 1500], speakerEmbedding: [1, 0] },
    alignment: { sameContent: false },
  });
  assert.equal(result.technical.pass, false);
  assert.equal(result.promotable, false);
  assert.ok(result.blockers.includes('technical_quality_failed'));
});

test('helpers calculate content-independent formant drift and embedding cosine', () => {
  assert.ok(compareFormants([500, 1500], [505, 1495]) < 30);
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});
