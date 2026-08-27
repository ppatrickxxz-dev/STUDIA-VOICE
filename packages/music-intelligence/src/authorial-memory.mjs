export function createAuthorialMemory(seed = {}) {
  return {
    schema: 'pmi_authorial_memory_v1',
    vocabulary: unique(seed.vocabulary),
    preferredStructures: unique(seed.preferredStructures),
    preferredImages: unique(seed.preferredImages),
    avoid: unique(seed.avoid),
    acceptedPatterns: unique(seed.acceptedPatterns),
    rejectedPatterns: unique(seed.rejectedPatterns),
    evidenceCount: Number(seed.evidenceCount || 0)
  };
}

export function learnChoice(memory, { decision, value, category = 'pattern' } = {}) {
  if (!memory || !['accepted', 'rejected'].includes(decision) || !String(value || '').trim()) {
    throw new Error('valid_authorial_choice_required');
  }
  const next = structuredClone(memory);
  const key = decision === 'accepted' ? 'acceptedPatterns' : 'rejectedPatterns';
  next[key] = unique([...(next[key] || []), `${category}:${String(value).trim()}`]);
  next.evidenceCount = Number(next.evidenceCount || 0) + 1;
  return next;
}

function unique(values = []) {
  return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))];
}
