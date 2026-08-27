import { buildConcept } from './concept-engine.mjs';
import { analyzeLyrics } from '../../songwriting/src/analyzer.mjs';
import { critiqueLyrics } from './critic.mjs';
import { createAuthorialMemory } from './authorial-memory.mjs';

const DEFAULT_STRUCTURE = Object.freeze(['verso_1', 'pre_refrão', 'refrão', 'verso_2', 'pre_refrão', 'refrão', 'ponte', 'refrão_final']);
const CREATION_INTENT = /(quero|vamos|bora|me ajuda|ajuda).{0,24}(musica|música|compor|composicao|composição|letra|refr[aã]o)|(?:criar|fazer|compor).{0,18}(musica|música|letra|refr[aã]o)|tenho uma ideia/i;

export function startCompositionSession({ brief, lyrics = '', preferences = {}, genre = '', mood = '', authorialMemory = null } = {}) {
  const concept = buildConcept(brief, { genre: genre || preferences.genre, mood: mood || preferences.mood });
  const analysis = lyrics.trim() ? analyzeLyrics(lyrics) : null;
  const memory = createAuthorialMemory(authorialMemory || preferences.authorialMemory || {});
  const structure = preferences.structure || structureForGenre(genre || preferences.genre, concept);
  return Object.freeze({
    schema: 'pmi_music_session_v1',
    engine: 'pmi-music-1.0',
    phase: lyrics.trim() ? 'develop' : 'discover',
    concept,
    songPlan: {
      structure,
      hookGoal: 'uma frase curta, memorável e coerente com a premissa',
      hookSeeds: buildHookSeeds(concept),
      verseGoal: 'avançar a história em vez de repetir o refrão',
      bridgeGoal: 'introduzir mudança de perspectiva, consequência ou revelação',
    },
    lyricsOriginal: String(lyrics || ''),
    lyricAnalysis: analysis,
    authorialMemory: memory,
    authorialGuard: {
      preserveUserLines: true,
      avoidGenericReplacement: true,
      requireReasonBeforeRewrite: true,
      acceptedChoices: preferences.acceptedChoices || memory.acceptedPatterns || [],
      rejectedChoices: preferences.rejectedChoices || memory.rejectedPatterns || [],
    },
    nextActions: analysis
      ? ['identificar o maior problema', 'propor até 3 alternativas', 'comparar sem apagar o original']
      : ['escolher uma das três direções criativas', 'definir a imagem central', 'propor até 3 caminhos de refrão'],
  });
}

export function critiqueDraft(session) {
  if (!session?.lyricAnalysis) return { severity: 'info', findings: ['Ainda não há letra para criticar.'] };
  if (String(session.lyricsOriginal || '').trim()) {
    return critiqueLyrics(session.lyricsOriginal, { concept: session.concept, authorialMemory: session.authorialMemory });
  }
  const a = session.lyricAnalysis;
  const findings = [];
  if (a.meterConsistency < 70) findings.push('A métrica varia bastante; revisar encaixe antes de polir rimas.');
  if (a.rhymeCoverage < 35) findings.push('Poucas terminações criam famílias sonoras recorrentes.');
  if (a.singability < 70) findings.push('A cantabilidade estimada ainda pede revisão em voz alta ou sobre guia melódica.');
  if (!findings.length) findings.push('A base textual está consistente; priorizar interpretação, hook e especificidade autoral.');
  return { severity: findings.length > 1 ? 'review' : 'info', findings, metrics: {
    meterConsistency: a.meterConsistency,
    rhymeCoverage: a.rhymeCoverage,
    singability: a.singability,
  }};
}

export function isMusicCreationRequest(message = '') {
  return CREATION_INTENT.test(String(message || ''));
}

export function respondToMusicCreation(message = '', context = {}) {
  if (!isMusicCreationRequest(message)) return Object.freeze({ supported: false });
  const brief = extractIdea(message);
  const session = startCompositionSession({
    brief,
    lyrics: context.lyrics || '',
    genre: context.genre || context.preset || '',
    mood: context.mood || '',
    authorialMemory: context.authorialMemory || {},
  });
  const directionText = session.concept.directions.map((item, index) => `${index + 1}) ${item.label}: ${item.angle}`).join('  ');
  const hookText = session.songPlan.hookSeeds.map((item) => `“${item}”`).join(' · ');
  const review = session.lyricAnalysis ? critiqueDraft(session) : null;
  const draftNote = review?.findings?.[0] ? ` No rascunho atual, eu começaria por: ${review.findings[0]}` : '';
  return Object.freeze({
    supported: true,
    kind: 'pmi_music_session',
    reply: `Entendi a ideia como: ${session.concept.premise}. Eu abriria três caminhos — ${directionText}. Sementes de hook: ${hookText}.${draftNote}`,
    session,
  });
}

function structureForGenre(genre, concept) {
  const value = String(genre || '').toLowerCase();
  if (/rap|hip.?hop/.test(value)) return ['intro','verso_1','refrão','verso_2','refrão','ponte_rap','refrão_final','outro'];
  if (/funk/.test(value)) return ['intro','verso_1','pre_refrão','refrão','pos_refrão','verso_2','refrão','ponte','refrão_final'];
  if (/r&b|rnb/.test(value)) return ['intro','verso_1','pre_refrão','refrão','verso_2','pre_refrão','refrão','ponte','refrão_outro'];
  return concept?.directions?.[0]?.id === 'narrative' ? DEFAULT_STRUCTURE : ['verso_1','refrão','verso_2','refrão','ponte','refrão_final'];
}

function buildHookSeeds(concept) {
  const anchors = concept.anchors || [];
  const a = anchors[0] || 'o plano';
  const b = anchors[1] || 'o caminho';
  return Object.freeze([concise(concept.payoff), concise(`${a} não era o destino`), concise(`${b} mudou o final`)]);
}

function extractIdea(message) {
  return String(message || '').trim()
    .replace(/^(pablo[,\s]*)?/i, '')
    .replace(/^(quero|vamos|bora|me ajuda a|me ajude a|ajuda a)\s+/i, '')
    .replace(/^(criar|fazer|compor)\s+(uma\s+)?(música|musica|letra)\s*(sobre|com|a partir de)?\s*/i, '')
    .trim() || String(message || '').trim();
}

function concise(value) {
  const text = String(value || '').replace(/[.!?]+$/g, '').trim();
  return text.length <= 54 ? text : `${text.slice(0, 51).trim()}…`;
}
