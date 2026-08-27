export { buildConcept, extractConcept } from './concept-engine.mjs';
export { analyzeRhymeArchitecture, compareRhymeOptions } from './rhyme-intelligence.mjs';
export { critiqueLyrics } from './critic.mjs';
export {
  createAuthorialMemory,
  learnChoice,
  evaluateAuthorialFit,
  createAuthorialProfile,
  learnAuthorialDecision,
} from './authorial-memory.mjs';
export {
  startCompositionSession,
  critiqueDraft,
  isMusicCreationRequest,
  respondToMusicCreation,
} from './session-engine.mjs';

export const PMI_MUSIC_VERSION = '1.0.0';
export const PMI_MUSIC_CAPABILITIES = Object.freeze([
  'concept_engine',
  'composition_session',
  'rhyme_intelligence',
  'draft_critic',
  'authorial_memory',
  'conversational_entrypoint',
]);
