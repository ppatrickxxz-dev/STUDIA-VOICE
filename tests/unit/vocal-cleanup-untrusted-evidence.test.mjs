import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCleanupCallerEvidence } from '../../packages/audio/src/voice/cleanup-untrusted-evidence.mjs';

test('cleanup caller cannot inject measurable acoustic facts or speaker identity claims', () => {
  const sanitized = sanitizeCleanupCallerEvidence({
    reference: {
      durationSeconds: 999,
      formantsHz: [1, 2, 3],
      speakerEmbedding: [1, 0, 0],
      referenceProfileId: 'voice-profile-v7',
    },
    candidate: {
      durationSeconds: 999,
      peak: 0,
      clippingRatio: 0,
      formantsHz: [1, 2, 3],
      medianFormantDriftCents: 0,
      speakerEmbedding: [1, 0, 0],
      speakerEmbeddingCosine: 1,
      identityPassed: true,
      requestId: 'req-123',
    },
    alignment: { sameContent: true, source: 'caller' },
  });

  assert.deepEqual(sanitized.reference, {
    referenceProfileId: 'voice-profile-v7',
  });
  assert.deepEqual(sanitized.candidate, {
    identityPassed: true,
    requestId: 'req-123',
  });
  assert.deepEqual(sanitized.alignment, { sameContent: true, source: 'caller' });
});

test('cleanup sanitation does not convert a caller identity boolean into acoustic identity evidence', () => {
  const sanitized = sanitizeCleanupCallerEvidence({
    candidate: {
      identityPassed: true,
      speakerEmbeddingCosine: 0.99,
    },
  });

  assert.equal(sanitized.candidate.identityPassed, true);
  assert.equal('speakerEmbeddingCosine' in sanitized.candidate, false);
  assert.equal('speakerEmbedding' in sanitized.candidate, false);
});
