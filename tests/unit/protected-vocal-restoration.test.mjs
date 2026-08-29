import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneWithIdentitySafeVocalRestoration } from '../../packages/audio/src/voice/protected-restoration.mjs';

const SAMPLE_RATE = 16000;

function makeBuffer(fill = 0.01) {
  const channel = new Float32Array(SAMPLE_RATE);
  channel.fill(fill);
  return {
    numberOfChannels: 1,
    length: channel.length,
    sampleRate: SAMPLE_RATE,
    getChannelData(index) {
      if (index !== 0) throw new RangeError('channel');
      return channel;
    },
  };
}

const context = {
  createBuffer(numberOfChannels, length, sampleRate) {
    assert.equal(numberOfChannels, 1);
    const channel = new Float32Array(length);
    return {
      numberOfChannels,
      length,
      sampleRate,
      getChannelData(index) {
        if (index !== 0) throw new RangeError('channel');
        return channel;
      },
    };
  },
};

function denoiseEvent() {
  return {
    kind: 'vocal_denoise',
    startSeconds: 0,
    endSeconds: 1,
    thresholdDb: -30,
    reductionDb: 4,
    attackSeconds: 0.008,
    releaseSeconds: 0.12,
    noiseFloorDb: -40,
    voicedLevelDb: -16,
    snrDb: 24,
    voicedMarginDb: 14,
    confidence: 0.95,
    timbreProtected: true,
    guardSource: 'bounded-vocal-timbre-guard-v1',
  };
}

function callerClaimedPassingEvidence() {
  return {
    reference: {
      durationSeconds: 1,
      formantsHz: [510, 1510, 2490],
      speakerEmbedding: [0.7, 0.2, -0.1, 0.5],
    },
    candidate: {
      durationSeconds: 1,
      clippingRatio: 0,
      peak: 0.01,
      formantsHz: [514, 1500, 2502],
      speakerEmbedding: [0.69, 0.21, -0.09, 0.51],
      speakerEmbeddingCosine: 0.99,
      identityPassed: true,
    },
    alignment: { sameContent: true },
  };
}

test('protected restoration rejects caller-provided identity evidence and keeps processed audio audition-only', () => {
  const original = makeBuffer();
  const result = cloneWithIdentitySafeVocalRestoration(
    context,
    original,
    [denoiseEvent()],
    callerClaimedPassingEvidence(),
  );

  assert.equal(result.promoted, false);
  assert.equal(result.applied, false);
  assert.equal(result.buffer, original);
  assert.notEqual(result.auditionBuffer, original);
  assert.equal(result.identityGate.promotable, false);
  assert.equal(result.identityGate.evidence.identity.status, 'missing');
  assert.ok(result.identityGate.blockers.includes('cleanup_identity_evidence_missing'));
  assert.ok(result.auditionBuffer.getChannelData(0)[SAMPLE_RATE / 2] < original.getChannelData(0)[SAMPLE_RATE / 2]);
});

test('protected restoration keeps original final buffer when identity evidence is absent and preserves audition candidate', () => {
  const original = makeBuffer();
  const result = cloneWithIdentitySafeVocalRestoration(
    context,
    original,
    [denoiseEvent()],
    {},
  );

  assert.equal(result.promoted, false);
  assert.equal(result.applied, false);
  assert.equal(result.buffer, original);
  assert.notEqual(result.auditionBuffer, original);
  assert.equal(result.identityGate.promotable, false);
  assert.ok(result.identityGate.blockers.includes('cleanup_identity_evidence_missing'));
});

test('protected restoration returns original unchanged when there is no actionable restoration event', () => {
  const original = makeBuffer();
  const result = cloneWithIdentitySafeVocalRestoration(context, original, [], callerClaimedPassingEvidence());

  assert.equal(result.applied, false);
  assert.equal(result.promoted, false);
  assert.equal(result.buffer, original);
  assert.equal(result.auditionBuffer, original);
  assert.equal(result.identityGate, null);
});
