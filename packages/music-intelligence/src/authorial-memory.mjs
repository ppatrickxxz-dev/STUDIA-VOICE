import { normalizePortuguese } from '../../songwriting/src/analyzer.mjs';

export function createAuthorialProfile(seed = {}) {
  return Object.freeze({
    version: 1,
    preferredTerms: unique(seed.preferredTerms),
    avoidedTerms: unique(seed.avoidedTerms),
    preferredStructures: unique(seed.preferredStructures),
    preferredTraits: unique(seed.preferredTraits),
    avoidedTraits: unique(seed.avoidedTraits),
    decisions: Array.isArray(seed.decisions) ? seed.decisions.slice(-100).map(sanitizeDecision) : [],
  });
}

export function learnAuthorialDecision(profile, decision = {}) {
  const current = createAuthorialProfile(profile);
  const nextDecision = sanitizeDecision(decision);
  const next = {
    ...current,
    preferredTerms: [...current.preferredTerms],
    avoidedTerms: [...current.avoidedTerms],
    preferredStructures: [...current.preferredStructures],
    preferredTraits: [...current.preferredTraits],
    avoidedTraits: [...current.avoidedTraits],
    decisions: [...current.decisions, nextDecision].slice(-100),
  };
  const target = nextDecision.kind === 'term'
    ? (nextDecision.accepted ? next.preferredTerms : next.avoidedTerms)
    : nextDecision.kind === 'structure'
      ? next.preferredStructures
      : (nextDecision.accepted ? next.preferredTraits : next.avoidedTraits);
  if (nextDecision.value && !target.includes(nextDecision.value)) target.push(nextDecision.value);
  return createAuthorialProfile(next);
}

export function evaluateAuthorialFit(text = '', profile = {}) {
  const current = createAuthorialProfile(profile);
  const normalized = normalizePortuguese(text);
  const avoidedHits = current.avoidedTerms.filter((term) => normalized.includes(normalizePortuguese(term)));
  const preferredHits = current.preferredTerms.filter((term) => normalized.includes(normalizePortuguese(term)));
  const traitWarnings = current.avoidedTraits.filter((trait) => trait && normalized.includes(normalizePortuguese(trait)));
  return Object.freeze({
    preferredHits,
    avoidedHits,
    traitWarnings,
    passesHardAvoids: avoidedHits.length === 0,
    notes: [
      ...(avoidedHits.length ? [`Evitar termos já rejeitados: ${avoidedHits.join(', ')}.`] : []),
      ...(preferredHits.length ? [`Vocabulário autoral reconhecido: ${preferredHits.join(', ')}.`] : []),
    ],
  });
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function sanitizeDecision(decision) {
  const kind = ['term','structure','trait'].includes(decision?.kind) ? decision.kind : 'trait';
  return Object.freeze({
    kind,
    value: String(decision?.value || '').trim().slice(0, 160),
    accepted: decision?.accepted !== false,
    reason: String(decision?.reason || '').trim().slice(0, 300) || null,
  });
}
