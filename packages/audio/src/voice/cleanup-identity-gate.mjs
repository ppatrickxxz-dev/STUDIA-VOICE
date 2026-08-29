import {
  evaluateVoiceAcousticEvidence,
  PROVISIONAL_VOICE_EVIDENCE_POLICY,
} from './acoustic-evidence.mjs';

export const VOCAL_CLEANUP_IDENTITY_GATE = Object.freeze({
  source: 'vocal-cleanup-identity-gate-v1',
  requireSameContent: true,
  requireTechnicalPass: true,
  requireTimbrePass: true,
  requireIdentityPass: true,
});

/**
 * Fail-closed promotion gate for denoise/de-reverb output.
 *
 * Restoration DSP can be auditioned before this gate, but processed audio must
 * not replace the original take unless same-content acoustic evidence proves
 * technical quality, bounded timbre drift, and retained speaker identity.
 */
export function evaluateVocalCleanupIdentityGate({
  reference = {},
  candidate = {},
  alignment = {},
  policy = PROVISIONAL_VOICE_EVIDENCE_POLICY,
} = {}) {
  const sameContent = alignment?.sameContent === true;
  const acoustic = evaluateVoiceAcousticEvidence({
    reference,
    candidate,
    alignment: { ...alignment, sameContent },
    policy,
  });

  const blockers = [...acoustic.blockers];
  if (!sameContent) blockers.push('cleanup_alignment_unconfirmed');
  if (acoustic.technical.pass !== true) blockers.push('cleanup_technical_evidence_failed');
  if (acoustic.timbre.status !== 'pass') {
    blockers.push(acoustic.timbre.status === 'missing'
      ? 'cleanup_timbre_evidence_missing'
      : 'cleanup_timbre_drift_failed');
  }
  if (acoustic.identity.status !== 'pass') {
    blockers.push(acoustic.identity.status === 'missing'
      ? 'cleanup_identity_evidence_missing'
      : 'cleanup_identity_failed');
  }

  const uniqueBlockers = [...new Set(blockers)];
  const promotable = uniqueBlockers.length === 0;
  return Object.freeze({
    schemaVersion: 1,
    source: VOCAL_CLEANUP_IDENTITY_GATE.source,
    promotable,
    state: promotable ? 'validated_use_processed' : 'blocked_keep_original',
    blockers: Object.freeze(uniqueBlockers),
    evidence: acoustic,
  });
}

/**
 * Selects the processed artifact only after the identity gate passes.
 * Missing or failed evidence deterministically keeps the original artifact.
 */
export function selectIdentitySafeVocalCleanup({
  original,
  processed,
  reference = {},
  candidate = {},
  alignment = {},
  policy = PROVISIONAL_VOICE_EVIDENCE_POLICY,
} = {}) {
  if (original === undefined || original === null) {
    throw new TypeError('Original vocal artifact is required for identity-safe cleanup.');
  }
  if (processed === undefined || processed === null) {
    throw new TypeError('Processed vocal artifact is required for identity-safe cleanup.');
  }

  const gate = evaluateVocalCleanupIdentityGate({ reference, candidate, alignment, policy });
  return Object.freeze({
    output: gate.promotable ? processed : original,
    usedProcessed: gate.promotable,
    gate,
  });
}
