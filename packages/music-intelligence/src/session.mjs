import { extractConcept } from './concept.mjs';
import { critiqueDraft } from './critic.mjs';
import { createAuthorialProfile } from './authorial-memory.mjs';

const CREATION_INTENT = /(quero|vamos|bora|me ajuda|ajuda).{0,24}(musica|música|compor|composicao|composição|letra|refr[aã]o)|(?:criar|fazer|compor).{0,18}(musica|música|letra|refr[aã]o)|tenho uma ideia/i;

export function isMusicCreationRequest(message = '') {
  return CREATION_INTENT.test(String(message || ''));
}

export function startCompositionSession({ idea = '', lyrics = '', genre = '', mood = '', authorialProfile = {} } = {}) {
  const concept = extractConcept(idea, { genre, mood });
  const profile = createAuthorialProfile(authorialProfile);
  const structure = buildStructure(genre, concept);
  const hookSeeds = buildHookSeeds(concept);
  const critique = String(lyrics || '').trim() ? critiqueDraft(lyrics, { concept, authorialProfile: profile }) : null;
  return Object.freeze({
    schemaVersion: 1,
    engine: 'pmi-music-1.0',
    stage: lyrics?.trim() ? 'developing_draft' : 'concept',
    concept,
    structure,
    hookSeeds,
    authorialProfile: profile,
    critique,
    nextStep: lyrics?.trim() ? 'Escolher a correção mais importante do rascunho.' : 'Escolher uma das três direções criativas antes de escrever a letra inteira.',
  });
}

export function respondToMusicCreation(message = '', context = {}) {
  if (!isMusicCreationRequest(message)) return Object.freeze({ supported: false });
  const idea = extractIdea(message);
  const session = startCompositionSession({
    idea,
    lyrics: context.lyrics || '',
    genre: context.genre || context.preset || '',
    mood: context.mood || '',
    authorialProfile: context.authorialProfile || {},
  });
  const directionText = session.concept.directions.map((item, index) => `${index + 1}) ${item.label}: ${item.angle}`).join('  ');
  const hookText = session.hookSeeds.map((item) => `“${item}”`).join(' · ');
  const draftNote = session.critique?.issues?.[0]?.action ? ` No rascunho atual, eu começaria por: ${session.critique.issues[0].action}` : '';
  return Object.freeze({
    supported: true,
    kind: 'pmi_music_session',
    reply: `Entendi a ideia como: ${session.concept.premise}. Eu abriria três caminhos — ${directionText}. Possíveis sementes de hook: ${hookText}.${draftNote}`,
    session,
  });
}

function extractIdea(message) {
  return String(message || '').trim()
    .replace(/^(pablo[,\s]*)?/i, '')
    .replace(/^(quero|vamos|bora|me ajuda a|me ajude a|ajuda a)\s+/i, '')
    .replace(/^(criar|fazer|compor)\s+(uma\s+)?(música|musica|letra)\s*(sobre|com|a partir de)?\s*/i, '')
    .trim() || String(message || '').trim();
}

function buildStructure(genre, concept) {
  const normalized = String(genre || '').toLowerCase();
  if (/rap|hip.?hop/.test(normalized)) return ['intro','verso','refrão','verso','refrão','ponte/rap','refrão','outro'];
  if (/funk/.test(normalized)) return ['intro','verso','pré-refrão','refrão','pós-refrão','verso','refrão','ponte','refrão'];
  if (/r&b|rnb/.test(normalized)) return ['intro','verso','pré-refrão','refrão','verso','pré-refrão','refrão','ponte','refrão/outro'];
  return concept?.directions?.[0]?.id === 'narrative'
    ? ['verso','pré-refrão','refrão','verso','refrão','ponte','refrão']
    : ['verso','refrão','verso','refrão','ponte','refrão'];
}

function buildHookSeeds(concept) {
  const anchors = concept.anchors || [];
  const a = anchors[0] || 'o plano';
  const b = anchors[1] || 'o caminho';
  return Object.freeze([
    concise(concept.payoff),
    concise(`${a} não era o destino`),
    concise(`${b} mudou o final`),
  ]);
}

function concise(value) {
  const text = String(value || '').replace(/[.!?]+$/g, '').trim();
  return text.length <= 54 ? text : `${text.slice(0, 51).trim()}…`;
}
