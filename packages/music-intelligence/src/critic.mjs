import { analyzeLyrics, normalizePortuguese } from '../../songwriting/src/analyzer.mjs';
import { analyzeRhymeArchitecture } from './rhyme-intelligence.mjs';
import { evaluateAuthorialFit } from './authorial-memory.mjs';

const CLICHES = ['coracao partido','coração partido','sem voce nao sei viver','sem você não sei viver','pra sempre','ate o fim','até o fim','meu mundo parou'];

export function critiqueDraft(text = '', { concept = null, authorialProfile = null } = {}) {
  const lyrics = analyzeLyrics(text);
  const rhyme = analyzeRhymeArchitecture(text);
  const normalized = normalizePortuguese(text);
  const clichéHits = CLICHES.filter((item) => normalized.includes(normalizePortuguese(item)));
  const repeated = repetitionRatio(lyrics.lines || []);
  const authorial = evaluateAuthorialFit(text, authorialProfile || {});
  const issues = [];
  if ((lyrics.lines || []).length < 4) issues.push(issue('draft_short','high','Ainda há pouco material para avaliar uma canção inteira.'));
  if (lyrics.meterConsistency < 60) issues.push(issue('meter','high','A métrica varia bastante; revisar respiração e tamanho das frases antes de polir rimas.'));
  else if (lyrics.meterConsistency < 75) issues.push(issue('meter','medium','Há alguns saltos de métrica que podem pesar no canto.'));
  if (clichéHits.length) issues.push(issue('cliche','medium',`Há formulações muito previsvisíveis: ${clichéHits.join(', ')}.`));
  if (repeated > 0.32) issues.push(issue('repetition','medium','Muitas linhas reutilizam palavras centrais; confirmar se a repetição é hook ou apenas redundância.'));
  if (!authorial.passesHardAvoids) issues.push(issue('authorial_guard','high',authorial.notes[0] || 'O texto usa algo já rejeitado pelo perfil autoral.'));
  if (concept?.anchors?.length && !concept.anchors.some((anchor) => normalized.includes(normalizePortuguese(anchor)))) issues.push(issue('concept_drift','medium','O rascunho se afastou das imagens-âncora do conceito.'));

  return Object.freeze({
    dimensions: Object.freeze({
      meter: lyrics.meterConsistency,
      rhyme: lyrics.rhymeCoverage,
      singability: lyrics.singability,
      authorialFit: authorial.passesHardAvoids ? 100 : 40,
    }),
    issues,
    strengths: buildStrengths(lyrics, rhyme, authorial),
    nextActions: issues.slice(0, 3).map((item) => item.action),
    rhyme,
    authorial,
  });
}

function issue(code, severity, action) { return Object.freeze({ code, severity, action }); }
function repetitionRatio(lines) {
  const words = lines.flatMap((line) => normalizePortuguese(line.content).split(' ').filter((word) => word.length >= 4));
  if (!words.length) return 0;
  return 1 - new Set(words).size / words.length;
}
function buildStrengths(lyrics, rhyme, authorial) {
  const out = [];
  if (lyrics.meterConsistency >= 80) out.push('Métrica relativamente estável.');
  if (lyrics.rhymeCoverage >= 55) out.push('Famílias de rima reaparecem com unidade.');
  if (rhyme.internalRhymes.length) out.push('Há rimas internas úteis para flow.');
  if (authorial.preferredHits.length) out.push('O texto preserva vocabulário já aceito pelo perfil autoral.');
  if (!out.length) out.push('O rascunho ainda está aberto; há espaço para definir uma assinatura mais clara.');
  return out;
}
