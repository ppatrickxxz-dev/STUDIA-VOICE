import { cloneWithVocalRestoration } from '../automation/region-restoration.mjs';
import { deriveVocalCleanupLocalEvidence } from './cleanup-local-evidence.mjs';
import { selectIdentitySafeVocalCleanup } from './cleanup-identity-gate.mjs';

/**
 * Produces a denoise/de-reverb audition candidate, derives technical/timbre
 * evidence from the exact before/after buffers, then promotes the candidate only
 * when retained speaker-identity evidence also passes. A failed or incomplete
 * identity gate keeps the original AudioBuffer while preserving A/B audition.
 */
export function cloneWithIdentitySafeVocalRestoration(
  context,
  buffer,
  events = [],
  {
    reference = {},
    candidate = {},
    alignment = {},
    policy,
    formantOptions,
  } = {},
) {
  const restoration = cloneWithVocalRestoration(context, buffer, events);
  if (!restoration.applied) {
    return Object.freeze({
      ...restoration,
      promoted: false,
      auditionBuffer: buffer,
      identityGate: null,
      localEvidence: null,
    });
  }

  const localEvidence = deriveVocalCleanupLocalEvidence({
    originalBuffer: buffer,
    processedBuffer: restoration.buffer,
    events,
    reference,
    candidate,
    alignment,
    ...(formantOptions ? { formantOptions } : {}),
  });
  const selection = selectIdentitySafeVocalCleanup({
    original: buffer,
    processed: restoration.buffer,
    reference: localEvidence.reference,
    candidate: localEvidence.candidate,
    alignment: localEvidence.alignment,
    ...(policy ? { policy } : {}),
  });

  return Object.freeze({
    ...restoration,
    buffer: selection.output,
    applied: selection.usedProcessed,
    promoted: selection.usedProcessed,
    auditionBuffer: restoration.buffer,
    identityGate: selection.gate,
    localEvidence,
  });
}
