import { cloneWithVocalRestoration } from '../automation/region-restoration.mjs';
import { selectIdentitySafeVocalCleanup } from './cleanup-identity-gate.mjs';

/**
 * Produces a denoise/de-reverb audition candidate, then promotes it only when
 * retained-identity acoustic evidence passes. A failed or incomplete identity
 * gate keeps the original AudioBuffer as the final output while still exposing
 * the processed candidate for explicit A/B audition.
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
  } = {},
) {
  const restoration = cloneWithVocalRestoration(context, buffer, events);
  if (!restoration.applied) {
    return Object.freeze({
      ...restoration,
      promoted: false,
      auditionBuffer: buffer,
      identityGate: null,
    });
  }

  const selection = selectIdentitySafeVocalCleanup({
    original: buffer,
    processed: restoration.buffer,
    reference,
    candidate,
    alignment,
    ...(policy ? { policy } : {}),
  });

  return Object.freeze({
    ...restoration,
    buffer: selection.output,
    applied: selection.usedProcessed,
    promoted: selection.usedProcessed,
    auditionBuffer: restoration.buffer,
    identityGate: selection.gate,
  });
}
