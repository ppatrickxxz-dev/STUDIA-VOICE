import { classifyHarmonyPairReadiness } from './kaggle-harmony-client.mjs';

export function acousticEvidenceStatusModel({ voiceEvidence = null, highEvidence = null, lowEvidence = null } = {}) {
  const pair = classifyHarmonyPairReadiness({ highEvidence, lowEvidence });
  const voiceValidated = voiceEvidence?.state === 'validated' && voiceEvidence?.promotable === true;
  return Object.freeze({
    voice: voiceValidated ? 'validated' : voiceEvidence ? 'not_validated' : 'pending',
    harmony: pair.state,
    pairValidated: pair.pairValidated,
    promotable: voiceValidated && pair.pairValidated,
  });
}
