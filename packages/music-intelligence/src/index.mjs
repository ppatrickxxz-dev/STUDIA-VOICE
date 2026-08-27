export { extractConcept } from './concept.mjs';
export { analyzeRhymeArchitecture, compareRhymeOptions } from './rhyme-intelligence.mjs';
export { critiqueDraft } from './critic.mjs';
export { createAuthorialProfile, learnAuthorialDecision, evaluateAuthorialFit } from './authorial-memory.mjs';
export { isMusicCreationRequest, startCompositionSession, respondToMusicCreation } from './session.mjs';

export const PMI_MUSIC_VERSION = '1.0.0';
export const PMI_MUSIC_CAPABILITIES = Object.freeze([
  'concept_engine',
  'song_structure_planning',
  'rhyme_intelligence',
  'draft_critic',
  'authorial_memory',
  'conversational_composition_session',
]);
