const SECTION_RE = /^\s*(?:\[|\()?\s*(verso|pré(?:-?refrão)?|refrão|ponte|rap|intro|outro)\s*(?:\]|\))?\s*$/i;
const VOWELS = /[aeiouáàâãéêíóôõúü]+/gi;
const COMMON_RHYMES = Object.freeze({
  amor: ['calor', 'valor', 'sabor', 'flor', 'tambor'],
  coração: ['canção', 'chão', 'mão', 'razão', 'direção'],
  vida: ['saída', 'ferida', 'avenida', 'partida', 'querida'],
  noite: ['açoite', 'biscoito', 'dezoito'],
  tempo: ['contratempo', 'destempo'],
  luz: ['conduz', 'seduz', 'cruz', 'reluz'],
  verdade: ['cidade', 'saudade', 'metade', 'vontade'],
});

export function normalizePortuguese(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function estimateSyllables(line = '') {
  return normalizePortuguese(line).split(' ').filter(Boolean)
    .reduce((total, word) => total + Math.max(1, word.match(VOWELS)?.length || 1), 0);
}

export function rhymeKey(word = '') {
  const clean = normalizePortuguese(word).replace(/[^a-z]/g, '');
  if (!clean) return '';
  const match = clean.match(/[aeiou][^aeiou]*[aeiou]?[^aeiou]*$/);
  return match?.[0] || clean.slice(-3);
}

export function assonanceKey(word = '') {
  return (normalizePortuguese(word).match(/[aeiou]/g) || []).slice(-2).join('');
}

export function analyzeLyrics(text = '') {
  const rawLines = String(text).split(/\r?\n/);
  let section = 'verso';
  const lines = [];
  for (const [index, raw] of rawLines.entries()) {
    const heading = raw.match(SECTION_RE);
    if (heading) { section = heading[1].toLowerCase(); continue; }
    const content = raw.trim();
    if (!content) continue;
    const words = normalizePortuguese(content).split(' ').filter(Boolean);
    const lastWord = words.at(-1) || '';
    lines.push({ index, section, content, words: words.length, syllables: estimateSyllables(content),
      lastWord, rhyme: rhymeKey(lastWord), assonance: assonanceKey(lastWord) });
  }
  const target = median(lines.map((line) => line.syllables)) || 8;
  const deviations = lines.map((line) => Math.abs(line.syllables - target));
  const rhymeGroups = lines.reduce((groups, line) => {
    const key = line.rhyme || '—';
    (groups[key] ||= []).push(line);
    return groups;
  }, {});
  const rhymed = Object.values(rhymeGroups).filter((group) => group.length > 1).flat().length;
  const meterConsistency = lines.length
    ? Math.max(0, 100 - (deviations.reduce((sum, value) => sum + value, 0) / lines.length) * 14) : 0;
  const rhymeCoverage = lines.length ? (rhymed / lines.length) * 100 : 0;
  return { lines, targetSyllables: target, meterConsistency: Math.round(meterConsistency),
    rhymeCoverage: Math.round(rhymeCoverage), singability: Math.round(meterConsistency * 0.68 + rhymeCoverage * 0.32),
    suggestions: buildSuggestions(lines, target, rhymeGroups) };
}

export function rhymeSuggestions(word = '') {
  const clean = normalizePortuguese(word).split(' ').at(-1) || '';
  if (COMMON_RHYMES[clean]) return COMMON_RHYMES[clean];
  const key = rhymeKey(clean);
  const vocabulary = [...new Set(Object.entries(COMMON_RHYMES).flatMap(([head, values]) => [head, ...values]))];
  return vocabulary.filter((candidate) => candidate !== clean && rhymeKey(candidate) === key).slice(0, 8);
}

export function classifyStructure(text = '') {
  const matches = String(text).split(/\r?\n/).map((line) => line.match(SECTION_RE)?.[1]).filter(Boolean);
  return matches.length ? matches.map((section) => section.toLowerCase()) : ['verso'];
}

function buildSuggestions(lines, target, groups) {
  const suggestions = [];
  const uneven = lines.filter((line) => Math.abs(line.syllables - target) >= 3);
  if (uneven.length) suggestions.push(`${uneven.length} linha(s) fogem três ou mais sílabas da métrica central de ${target}.`);
  const isolated = Object.values(groups).filter((group) => group.length === 1).flat();
  if (isolated.length > Math.ceil(lines.length / 2)) suggestions.push('A maioria das terminações não reaparece; experimente fechar pares com a mesma família sonora.');
  if (lines.some((line) => line.words > 14)) suggestions.push('Há linhas longas; teste pausas ou divida ideias para preservar respiração e cantabilidade.');
  if (!suggestions.length && lines.length) suggestions.push('A métrica e as terminações estão consistentes. Faça uma leitura em voz alta antes de reescrever.');
  if (!lines.length) suggestions.push('Cole ao menos uma linha para medir rima, métrica e cantabilidade.');
  return suggestions;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
