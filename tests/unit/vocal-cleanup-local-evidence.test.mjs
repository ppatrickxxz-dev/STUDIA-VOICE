import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveVocalCleanupLocalEvidence } from '../../packages/audio/src/voice/cleanup-local-evidence.mjs';
import { cloneWithIdentitySafeVocalRestoration } from '../../packages/audio/src/voice/protected-restoration.mjs';

const SAMPLE_RATE = 16000;

function bufferFrom(channel, { channels = 1, sampleRate = SAMPLE_RATE } = {}) {
  const source = channel instanceof Float32Array ? channel : Float32Array.from(channel);
  const data = Array.from({ length: channels }, () => new Float32Array(source));
  return {
    numberOfChannels: channels,
    length: source.length,
    sampleRate,
    duration: source.length / sampleRate,
    getChannelData(index) {
      if (!data[index]) throw new RangeError('channel');
      return data[index];
    },
  };
}

function syntheticVowel(seconds = 1) {
  const samples = new Float32Array(Math.floor(SAMPLE_RATE * seconds));
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / SAMPLE_RATE;
    const envelope = Math.min(1, index / 320, (samples.length - index) / 320);
    samples[index] = envelope * (
      0.08 * Math.sin(2 * Math.PI * 140 * time)
      + 0.34 * Math.sin(2 * Math.PI * 500 * time)
      + 0.27 * Math.sin(2 * Math.PI * 1500 * time)
      + 0.2 * Math.sin(2 * Math.PI * 2500 * time)
    );
  }
  return samples;
}

function quietBuffer(fill = 0.01) {
  const samples = new Float32Array(SAMPLE_RATE);
  samples.fill(fill);
  return bufferFrom(samples);
}

const context = {
  createBuffer(numberOfChannels, length, sampleRate) {
    const data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    return {
      numberOfChannels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData(index) {
        if (!data[index]) throw new RangeError('channel');
        return data[index];
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

test('cleanup local evidence derives stable formants and exact structural facts from the buffers', () => {
  const original = bufferFrom(syntheticVowel());
  const processed = bufferFrom(syntheticVowel());
  const evidence = deriveVocalCleanupLocalEvidence({
    originalBuffer: original,
    processedBuffer: processed,
    events: [{ startSeconds: 0, endSeconds: 1 }],
    candidate: { speakerEmbeddingCosine: 0.99 },
    formantOptions: { maxFrames: 10 },
  });

  assert.equal(evidence.source, 'vocal-cleanup-local-evidence-v1');
  assert.equal(evidence.alignment.sameContent, true);
  assert.equal(evidence.local.structuralSameContent, true);
  assert.equal(evidence.reference.durationSeconds, 1);
  assert.equal(evidence.candidate.durationSeconds, 1);
  assert.equal(evidence.candidate.speakerEmbeddingCosine, 0.99);
  assert.equal(evidence.local.referenceFormants.stable, true);
  assert.equal(evidence.local.candidateFormants.stable, true);
  assert.equal(evidence.reference.formantsHz.length, 3);
  assert.equal(evidence.candidate.formantsHz.length, 3);
  assert.ok(evidence.candidate.peak > 0);
  assert.equal(evidence.candidate.clippingRatio, 0);
});

test('direct PCM measurement overrides forged safe peak and clipping claims', () => {
  const originalSamples = new Float32Array(SAMPLE_RATE);
  originalSamples.fill(0.05);
  const processedSamples = new Float32Array(originalSamples);
  for (let index = 0; index < 64; index += 1) processedSamples[index] = 1.2;

  const evidence = deriveVocalCleanupLocalEvidence({
    originalBuffer: bufferFrom(originalSamples),
    processedBuffer: bufferFrom(processedSamples),
    candidate: { peak: 0.1, clippingRatio: 0 },
    reference: { formantsHz: [500, 1500, 2500] },
    candidate: { peak: 0.1, clippingRatio: 0, formantsHz: [500, 1500, 2500] },
  });

  assert.ok(evidence.candidate.peak > 1);
  assert.ok(evidence.candidate.clippingRatio > 0.0001);
  assert.equal(evidence.local.candidateTechnical.peak, evidence.candidate.peak);
  assert.equal(evidence.local.candidateTechnical.clippingRatio, evidence.candidate.clippingRatio);
});

test('cleanup promotion needs only external identity when local technical/alignment facts and formants are available', () => {
  const original = quietBuffer();
  const result = cloneWithIdentitySafeVocalRestoration(
    context,
    original,
    [denoiseEvent()],
    {
      reference: { formantsHz: [510, 1510, 2490] },
      candidate: {
        formantsHz: [514, 1500, 2502],
        speakerEmbeddingCosine: 0.99,
      },
    },
  );

  assert.equal(result.promoted, true);
  assert.equal(result.applied, true);
  assert.equal(result.identityGate.promotable, true);
  assert.equal(result.localEvidence.alignment.sameContent, true);
  assert.equal(result.localEvidence.candidate.durationSeconds, 1);
  assert.equal(result.localEvidence.candidate.clippingRatio, 0);
  assert.ok(result.localEvidence.candidate.peak <= 0.01);
});

test('missing real identity still fails closed after all local evidence is derived', () => {
  const original = quietBuffer();
  const result = cloneWithIdentitySafeVocalRestoration(
    context,
    original,
    [denoiseEvent()],
    {
      reference: { formantsHz: [510, 1510, 2490] },
      candidate: { formantsHz: [514, 1500, 2502] },
    },
  );

  assert.equal(result.promoted, false);
  assert.equal(result.buffer, original);
  assert.notEqual(result.auditionBuffer, original);
  assert.equal(result.localEvidence.alignment.sameContent, true);
  assert.equal(result.identityGate.evidence.technical.pass, true);
  assert.equal(result.identityGate.evidence.timbre.status, 'pass');
  assert.equal(result.identityGate.evidence.identity.status, 'missing');
  assert.ok(result.identityGate.blockers.includes('cleanup_identity_evidence_missing'));
});

test('explicit alignment refusal and channel mismatch cannot be auto-promoted', () => {
  const mono = quietBuffer();
  const stereo = bufferFrom(new Float32Array(SAMPLE_RATE).fill(0.01), { channels: 2 });
  const mismatch = deriveVocalCleanupLocalEvidence({
    originalBuffer: mono,
    processedBuffer: stereo,
    reference: { formantsHz: [500, 1500, 2500] },
    candidate: { formantsHz: [500, 1500, 2500] },
  });
  assert.equal(mismatch.local.structuralSameContent, false);
  assert.equal(mismatch.alignment.sameContent, false);

  const explicit = deriveVocalCleanupLocalEvidence({
    originalBuffer: mono,
    processedBuffer: quietBuffer(),
    alignment: { sameContent: false },
    reference: { formantsHz: [500, 1500, 2500] },
    candidate: { formantsHz: [500, 1500, 2500] },
  });
  assert.equal(explicit.local.structuralSameContent, true);
  assert.equal(explicit.alignment.sameContent, false);
});
