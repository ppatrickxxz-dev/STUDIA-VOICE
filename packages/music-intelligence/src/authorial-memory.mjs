import { normalizePortuguese } from '../../songwriting/src/analyzer.mjs';

export function createAuthorialMemory(seed = {}) {
  return Object.freeze({
    schema: 'pmi_authorial_memory_v1',
    vocabulary: unique(seed.vocabulary),
    preferredStructures: unique(seed.preferredStructures),
    preferredImages: unique(seed.preferredImages),
    avoid: unique(seed.avoid),
    acceptedPatterns: unique(seed.acceptedPatterns),
    rejectedPatterns: unique(seed.rejectedPatterns),
    evidenceCount: Number(seed.evidenceCount || 0),
  });
}

export function learnChoice(memory, { decision, value, category = 'pattern', reason = null } = {}) {
  if (!memory || !['accepted', 'rejected'].includes(decision) || !String(value || '').trim()) {
    throw new Error('valid_authorial_choice_required');
  }
  const next = structuredClone(memory);
  const key = decision === 'accepted' ? 'acceptedPatterns' : 'rejectedPatterns';
  next[key] = unique([...(next[key] || []), `${category}:${String(value).trim()}`]);
  if (category === 'term' || category === 'language') {
    const termKey = decision === 'accepted' ? 'vocabulary' : 'avoid';
    next[termKey] = unique([...(next[termKey] || []), String(value).trim()]);
  }
  if (category === 'structure' && decision === 'accepted') next.preferredStructures = unique([...(next.preferredStructures || []), String(value).trim()]);
  if (reason) next.lastReason = String(reason).trim().slice(0, 300);
  next.evidenceCount = Number(next.evidenceCount || 0) + 1;
  return createAuthorialMemory(next);
}

export function evaluateAuthorialFit(text = '', memory = {}) {
  const current = createAuthorialMemory(memory);
  const normalized = normalizePortuguese(text);
  const avoidedHits = current.avoid.filter((term) => normalized.includes(normalizePortuguese(term)));
  const preferredHits = current.vocabulary.filter((term) => normalized.includes(normalizePortuguese(term)));
  const rejectedPatternHits = current.rejectedPatterns
    .map((entry) => entry.split(':').slice(1).join(':'))
    .filter((value) => value && normalized.includes(normalizePortuguese(value)));
  return Object.freeze({
    preferredHits,
    avoidedHits,
    rejectedPatternHits,
    passesHardAvoids: avoidedHits.length === 0 && rejectedPatternHits.length === 0,
    evidenceCount: current.evidenceCount,
    notes: [
      ...(avoidedHits.length ? [`Evitar termos já rejeitados: ${avoidedHits.join(', ')}.`] : []),
      ...(rejectedPatternHits.length ? [`Evitar padrões já rejeitados: ${rejectedPatternHits.join(', ')}.`] : []),
      ...(preferredHits.length ? [`Vocabulário autoral reconhecido: ${preferredHits.join(', ')}.`] : []),
    ],
  });
}

export function createAuthorialProfile(seed = {}) {
  return createAuthorialMemory({
    vocabulary: seed.preferredTerms || seed.vocabulary,
    avoid: seed.avoidedTerms || seed.avoid,
    preferredStructures: seed.preferredStructures,
    acceptedPatterns: seed.acceptedPatterns,
    rejectedPatterns: seed.rejectedPatterns,
    evidenceCount: seed.evidenceCount,
  });
}

export function learnAuthorialDecision(profile, decision = {}) {
  const kind = ['term', 'structure', 'trait'].includes(decision.kind) ? decision.kind : 'pattern';
  return learnChoice(profile, {
    decision: decision.accepted === false ? 'rejected' : 'accepted',
    value: String(decision.value || '').trim(),
    category: kind,
    reason: decision.reason || null,
  });
}

function unique(values = []) {
  return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))];
}
