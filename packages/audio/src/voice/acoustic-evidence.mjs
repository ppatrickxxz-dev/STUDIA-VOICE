const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export const PROVISIONAL_VOICE_EVIDENCE_POLICY = Object.freeze({
  maxClippingRatio: 0.0001,
  maxPeak: 1.0001,
  minSpeakerEmbeddingCosine: 0.8,
  maxMedianFormantDriftCents: 150,
  minAlignedDurationRatio: 0.97,
  maxAlignedDurationRatio: 1.03,
});

export function evaluateVoiceAcousticEvidence({ reference = {}, candidate = {}, alignment = {}, policy = PROVISIONAL_VOICE_EVIDENCE_POLICY } = {}) {
  const technical = evaluateTechnical(candidate, policy);
  const temporal = evaluateTemporal(reference, candidate, alignment, policy);
  const timbre = evaluateTimbre(reference, candidate, policy);
  const identity = evaluateIdentity(reference, candidate, policy);

  const blockers = [];
  if (!technical.pass) blockers.push('technical_quality_failed');
  if (temporal.status === 'fail') blockers.push('temporal_alignment_failed');
  if (timbre.status === 'fail') blockers.push('timbre_drift_failed');
  if (identity.status !== 'pass') blockers.push(identity.status === 'missing' ? 'speaker_identity_unmeasured' : 'speaker_identity_failed');

  return Object.freeze({
    schemaVersion: 1,
    technical,
    temporal,
    timbre,
    identity,
    promotable: blockers.length === 0,
    blockers,
    state: blockers.length === 0 ? 'validated' : identity.status === 'missing' ? 'identity_evidence_pending' : 'not_validated',
  });
}

function evaluateTechnical(candidate, policy) {
  const clippingRatio = finiteOrNull(candidate.clippingRatio);
  const peak = finiteOrNull(candidate.peak);
  const measured = clippingRatio !== null && peak !== null;
  const pass = measured && clippingRatio <= policy.maxClippingRatio && peak <= policy.maxPeak;
  return Object.freeze({ measured, pass, clippingRatio, peak });
}

function evaluateTemporal(reference, candidate, alignment, policy) {
  if (alignment.sameContent !== true) return Object.freeze({ status: 'not_applicable', reason: 'content_not_aligned' });
  const referenceDuration = finiteOrNull(reference.durationSeconds);
  const candidateDuration = finiteOrNull(candidate.durationSeconds);
  if (!(referenceDuration > 0) || !(candidateDuration > 0)) return Object.freeze({ status: 'missing', reason: 'duration_missing' });
  const ratio = candidateDuration / referenceDuration;
  const pass = ratio >= policy.minAlignedDurationRatio && ratio <= policy.maxAlignedDurationRatio;
  return Object.freeze({ status: pass ? 'pass' : 'fail', ratio });
}

function evaluateTimbre(reference, candidate, policy) {
  const drift = finiteOrNull(candidate.medianFormantDriftCents ?? compareFormants(reference.formantsHz, candidate.formantsHz));
  if (drift === null) return Object.freeze({ status: 'missing', reason: 'formant_evidence_missing' });
  return Object.freeze({ status: drift <= policy.maxMedianFormantDriftCents ? 'pass' : 'fail', medianFormantDriftCents: drift });
}

function evaluateIdentity(reference, candidate, policy) {
  const cosine = finiteOrNull(candidate.speakerEmbeddingCosine ?? cosineSimilarity(reference.speakerEmbedding, candidate.speakerEmbedding));
  if (cosine === null) return Object.freeze({ status: 'missing', reason: 'speaker_embedding_missing' });
  return Object.freeze({ status: cosine >= policy.minSpeakerEmbeddingCosine ? 'pass' : 'fail', cosine: clamp01(cosine) });
}

export function compareFormants(reference, candidate) {
  if (!Array.isArray(reference) || !Array.isArray(candidate) || !reference.length || reference.length !== candidate.length) return null;
  const cents = reference.map((value, index) => {
    const a = Number(value);
    const b = Number(candidate[index]);
    if (!(a > 0) || !(b > 0)) return null;
    return Math.abs(1200 * Math.log2(b / a));
  }).filter(Number.isFinite);
  if (!cents.length) return null;
  cents.sort((a, b) => a - b);
  return cents[Math.floor(cents.length / 2)];
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return null;
  let dot = 0, aa = 0, bb = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = Number(a[index]);
    const y = Number(b[index]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }
  if (!(aa > 0) || !(bb > 0)) return null;
  return dot / Math.sqrt(aa * bb);
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
