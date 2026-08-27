import { buildConcept } from './concept-engine.mjs';
import { analyzeLyrics } from '../../songwriting/src/analyzer.mjs';

const DEFAULT_STRUCTURE = Object.freeze(['verso_1', 'pre_refrão', 'refrão', 'verso_2', 'pre_refrão', 'refrão', 'ponte', 'refrão_final']);

export function startCompositionSession({ brief, lyrics = '', preferences = {} } = {}) {
  const concept = buildConcept(brief);
  const analysis = lyrics.trim() ? analyzeLyrics(lyrics) : null;
  return {
    schema: 'pmi_music_session_v1',
    phase: lyrics.trim() ? 'develop' : 'discover',
    concept,
    songPlan: {
      structure: preferences.structure || DEFAULT_STRUCTURE,
      hookGoal: 'uma frase curta, memorável e coerente com a premissa',
      verseGoal: 'avançar a história em vez de repetir o refrão',
      bridgeGoal: 'introduzir mudança de perspectiva, consequência ou revelação'
    },
    lyricAnalysis: analysis,
    authorialGuard: {
      preserveUserLines: true,
      avoidGenericReplacement: true,
      requireReasonBeforeRewrite: true,
      acceptedChoices: preferences.acceptedChoices || [],
      rejectedChoices: preferences.rejectedChoices || []
    },
    nextActions: analysis
      ? ['identificar o maior problema', 'propor até 3 alternativas', 'comparar sem apagar o original']
      : ['escolher o foco emocional', 'definir a imagem central', 'propor até 3 caminhos de refrão']
  };
}

export function critiqueDraft(session) {
  if (!session?.lyricAnalysis) return { severity: 'info', findings: ['Ainda não há letra para criticar.'] };
  const a = session.lyricAnalysis;
  const findings = [];
  if (a.meterConsistency < 70) findings.push('A métrica varia bastante; revisar encaixe antes de polir rimas.');
  if (a.rhymeCoverage < 35) findings.push('Poucas terminações criam famílias sonoras recorrentes.');
  if (a.singability < 70) findings.push('A cantabilidade estimada ainda pede revisão em voz alta ou sobre guia melódica.');
  if (!findings.length) findings.push('A base textual está consistente; priorizar interpretação, hook e especificidade autoral.');
  return { severity: findings.length > 1 ? 'review' : 'info', findings, metrics: {
    meterConsistency: a.meterConsistency,
    rhymeCoverage: a.rhymeCoverage,
    singability: a.singability
  }};
}
