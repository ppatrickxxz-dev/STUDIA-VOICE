import { analyzeLyrics, normalizePortuguese, rhymeKey, assonanceKey } from '../../songwriting/src/analyzer.mjs';

export function analyzeRhymeArchitecture(text = '') {
  const base = analyzeLyrics(text);
  const lines = base.lines || [];
  const endGroups = groupBy(lines, (line) => line.rhyme || '—');
  const assonanceGroups = groupBy(lines, (line) => line.assonance || '—');
  const internal = lines.map((line) => ({ line: line.index, matches: internalRhymeMatches(line.content) })).filter((item) => item.matches.length);
  const repeatedEndings = Object.entries(endGroups).filter(([key, group]) => key !== '—' && group.length > 1)
    .map(([key, group]) => ({ key, lines: group.map((line) => line.index), words: group.map((line) => line.lastWord) }));
  const isolated = Object.entries(endGroups).filter(([key, group]) => key !== '—' && group.length === 1)
    .map(([, group]) => group[0].lastWord);
  return Object.freeze({
    rhymeCoverage: base.rhymeCoverage,
    meterConsistency: base.meterConsistency,
    singability: base.singability,
    targetSyllables: base.targetSyllables,
    repeatedEndings,
    isolatedEndings: isolated,
    internalRhymes: internal,
    assonanceFamilies: Object.entries(assonanceGroups).filter(([key, group]) => key !== '—' && group.length > 1)
      .map(([key, group]) => ({ key, words: group.map((line) => line.lastWord) })),
    recommendations: buildRecommendations(base, isolated, internal),
  });
}

export function compareRhymeOptions(words = []) {
  const clean = words.map((word) => normalizePortuguese(word)).filter(Boolean);
  const rows = [];
  for (let i = 0; i < clean.length; i += 1) {
    for (let j = i + 1; j < clean.length; j += 1) {
      rows.push(Object.freeze({
        a: clean[i],
        b: clean[j],
        perfect: rhymeKey(clean[i]) === rhymeKey(clean[j]),
        assonant: assonanceKey(clean[i]) === assonanceKey(clean[j]),
      }));
    }
  }
  return rows;
}

function internalRhymeMatches(line) {
  const words = normalizePortuguese(line).split(' ').filter((word) => word.length >= 3);
  const groups = groupBy(words, rhymeKey);
  return Object.entries(groups).filter(([key, group]) => key && group.length > 1)
    .map(([key, group]) => ({ key, words: [...new Set(group)] })).filter((item) => item.words.length > 1);
}

function buildRecommendations(base, isolated, internal) {
  const out = [];
  if (base.meterConsistency < 65) out.push('Ajustar comprimentos de linha antes de forçar novas rimas; cantabilidade vem primeiro.');
  if (isolated.length > Math.ceil((base.lines?.length || 0) / 2)) out.push('Há muitas terminações isoladas; aproximar algumas famílias sonoras pode dar unidade sem rimar tudo.');
  if (!internal.length && (base.lines?.length || 0) >= 4) out.push('Testar uma ou duas rimas internas em linhas-chave, principalmente pré-refrão ou rap.');
  if (!out.length) out.push('A arquitetura de rimas está funcional; priorizar naturalidade e intenção na próxima revisão.');
  return out;
}

function groupBy(values, keyFn) {
  return values.reduce((acc, value) => {
    const key = keyFn(value);
    (acc[key] ||= []).push(value);
    return acc;
  }, {});
}
