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
  parseAuthorialFeedback,
  applyAuthorialFeedback,
  respondToAuthorialFeedback,
} from './authorial-feedback.mjs';
export {
  PmiGeneratorAdapter,
  REVIEWED_SONG_COMMANDS,
  planComposerGeneration,
  isExplicitGenerationRequest,
} from './generator-adapter.mjs';
export {
  planPendingDraftRevision,
  normalizePendingDraft,
} from './draft-revision.mjs';
export {
  startCompositionSession,
  critiqueDraft,
  isMusicCreationRequest,
} from './session-engine.mjs';
export { respondToMusicCreation } from './conversation-router.mjs';
export {
  MUSICAL_INTENT_SCHEMA,
  interpretMusicalIntent,
} from './musical-intent.mjs';
export {
  MUSIC_SPEC_V2_SCHEMA,
  upgradeSongPlanToMusicSpec,
  musicSpecProviderContext,
} from './music-spec-v2.mjs';
export {
  PABLOVOICE_SONG_DIRECTOR_SCHEMA,
  directSongCandidates,
  applyDirectedCandidate,
  fingerprintSongDirection,
} from './song-director.mjs';
export {
  PROJECT_MUSIC_GRAPH_SCHEMA,
  buildProjectMusicGraph,
  musicGraphContextPack,
  resolveMusicGraphScope,
  validateMusicGraphAssets,
} from './project-music-graph.mjs';
export {
  MUSICAL_OPERATION_ROUTE_SCHEMA,
  routeMusicalIntent,
} from './operation-router.mjs';

export const PMI_MUSIC_VERSION = '2.0.0';
export const PMI_MUSIC_CAPABILITIES = Object.freeze([
  'concept_engine',
  'composition_session',
  'rhyme_intelligence',
  'draft_critic',
  'authorial_memory',
  'authorial_feedback',
  'composer_generator_adapter',
  'pending_draft_revision',
  'conversational_entrypoint',
  'musical_intent_translator',
  'music_spec_v2',
  'song_director_v2',
  'project_music_graph',
  'musical_operation_router',
]);
