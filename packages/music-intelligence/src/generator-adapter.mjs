import { startCompositionSession } from './session-engine.mjs';
import { createAuthorialMemory } from './authorial-memory.mjs';

const SECTION_HINTS = Object.freeze([
  ['refrão', /\b(refr[aã]o|hook)\b/i],
  ['pre_refrão', /\b(pr[eé][ -]?refr[aã]o|pre[ -]?chorus)\b/i],
  ['verso', /\b(verso|estrofe)\b/i],
  ['ponte', /\b(ponte|bridge)\b/i],
  ['pos_refrão', /\b(p[oó]s[ -]?refr[aã]o|post[ -]?chorus)\b/i],
  ['rap', /\b(rap|barra|barras)\b/i],
]);

const REWRITE = /\b(reescrev\w*|refaz\w*|reescreva|reescrever|reformula\w*|melhora esse|melhore esse)\b/i;
const CONTINUE = /\b(continua\w*|continue|completa\w*|complete|termina\w*|termine|pr[oó]ximo verso|pr[oó]xima parte)\b/i;
const ADAPT = /\b(adapta\w*|adapte|leva\w* (?:isso|essa|esse)|transforma\w* (?:isso|essa|esse)).{0,32}\b(funk|r&b|rnb|rap|hip.?hop|pop|mpb|pagode|edm|k-?pop|trap)\b/i;
const GENERATE = /\b(escreve\w*|escreva|gera\w*|gere|cria\w*|crie|faz\w*|faça)\b.{0,40}\b(refr[aã]o|hook|verso|estrofe|ponte|letra|rap|parte|m[uú]sica)\b/i;

export function planComposerGeneration(message = '', context = {}) {
  const source = String(message || '').trim();
  if (!source) return Object.freeze({ supported: false });
  const command = inferCommand(source);
  if (!command) return Object.freeze({ supported: false });

  const lyrics = String(context.lyrics || '').slice(0, 12000);
  if ((command === 'rewrite' || command === 'continue_section' || command === 'adapt_genre') && !lyrics.trim()) {
    return Object.freeze({ supported: true, blocked: true, reason: 'lyrics_required', command });
  }

  const memory = createAuthorialMemory(context.authorialMemory || {});
  const session = startCompositionSession({
    brief: source,
    lyrics,
    notes: String(context.notes || '').slice(0, 4000),
    genre: context.genre || context.preset || '',
    mood: context.mood || '',
    authorialMemory: memory,
  });
  const targetSection = inferSection(source);
  const targetGenre = command === 'adapt_genre' ? inferGenre(source) : null;

  return Object.freeze({
    supported: true,
    blocked: false,
    kind: 'pmi_generation_request',
    command,
    targetSection,
    targetGenre,
    task: source.slice(0, 4000),
    request: Object.freeze({
      command,
      task: source.slice(0, 4000),
      targetSection,
      targetGenre,
      contextPack: Object.freeze({
        source: 'pablovoice-pmi-composer',
        pmi_version: '1.0.0',
        target_section: targetSection,
        target_genre: targetGenre,
        concept: session.concept,
        song_plan: session.songPlan,
        project_notes: session.projectNotes,
        current_lyrics: lyrics,
        authorial_memory: memory,
      }),
      authorSamples: lyrics.trim() ? [lyrics.slice(0, 10000)] : [],
      constraints: Object.freeze({
        language: 'pt-BR',
        preserve_authorial_voice: true,
        respect_authorial_memory: true,
        preserve_user_lines: command === 'rewrite',
        minimal_change: command === 'rewrite',
        no_artist_imitation: true,
        review_before_apply: true,
      }),
    }),
    session,
  });
}

export function isExplicitGenerationRequest(message = '') {
  return Boolean(inferCommand(String(message || '')));
}

function inferCommand(text) {
  if (REWRITE.test(text)) return 'rewrite';
  if (CONTINUE.test(text)) return 'continue_section';
  if (ADAPT.test(text)) return 'adapt_genre';
  if (GENERATE.test(text)) return 'generate';
  return null;
}

function inferSection(text) {
  for (const [name, pattern] of SECTION_HINTS) if (pattern.test(text)) return name;
  return null;
}

function inferGenre(text) {
  const match = String(text).match(/\b(funk|r&b|rnb|rap|hip.?hop|pop|mpb|pagode|edm|k-?pop|trap)\b/i);
  return match ? match[1].toLowerCase() : null;
}
