const UNTRUSTED_REFERENCE_ACOUSTIC_KEYS = new Set([
  'durationSeconds',
  'formantsHz',
  'speakerEmbedding',
]);

const UNTRUSTED_CANDIDATE_ACOUSTIC_KEYS = new Set([
  'durationSeconds',
  'peak',
  'clippingRatio',
  'formantsHz',
  'medianFormantDriftCents',
  'speakerEmbedding',
  'speakerEmbeddingCosine',
  'identityPassed',
]);

/**
 * Cleanup callers may provide metadata, but must not be able to override facts
 * that are measurable from the exact PCM buffers or self-assert speaker identity.
 *
 * Speaker identity deliberately remains absent until a trusted server-side
 * attestation is integrated. This keeps automatic promotion fail-closed rather
 * than accepting a caller-provided boolean, cosine score, or raw embedding.
 */
export function sanitizeCleanupCallerEvidence({ reference = {}, candidate = {}, alignment = {} } = {}) {
  return Object.freeze({
    reference: Object.freeze(omitKeys(reference, UNTRUSTED_REFERENCE_ACOUSTIC_KEYS)),
    candidate: Object.freeze(omitKeys(candidate, UNTRUSTED_CANDIDATE_ACOUSTIC_KEYS)),
    alignment: Object.freeze({ ...alignment }),
  });
}

function omitKeys(value, blocked) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(Object.entries(source).filter(([key]) => !blocked.has(key)));
}
