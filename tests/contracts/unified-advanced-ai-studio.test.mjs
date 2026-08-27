import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const advanced = await readFile(new URL('../../packages/app/advanced-ai-studio.mjs', import.meta.url), 'utf8');
const pablo = await readFile(new URL('../../packages/app/pablo-conversation-ui.mjs', import.meta.url), 'utf8');
const status = await readFile(new URL('../../packages/app/runtime-capability-status.mjs', import.meta.url), 'utf8');
const preboot = await readFile(new URL('../../packages/app/preboot.mjs', import.meta.url), 'utf8');

test('advanced AI layer uses only canonical authenticated endpoints', () => {
  assert.match(advanced, /compute-kaggle-voice-v70/);
  assert.match(advanced, /progress-kaggle-harmony-v73/);
  assert.match(advanced, /RemoteAuthAdapter/);
  assert.match(advanced, /ensureRemoteProject/);
  assert.doesNotMatch(advanced, /service_role/i);
  assert.doesNotMatch(advanced, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('songwriting generator preserves review-before-apply behavior', () => {
  for (const command of ['generate', 'continue_section', 'rewrite', 'adapt_genre']) assert.match(advanced, new RegExp(command));
  assert.match(advanced, /preserve_authorial_voice/);
  assert.match(advanced, /no_artist_imitation/);
  assert.match(advanced, /data-ai-apply/);
  assert.match(advanced, /Revise antes de aplicar/);
});

test('voice and harmony results can become real local tracks without automatic promotion', () => {
  assert.match(advanced, /voiceProfiles: \['natural', 'identity', 'smooth'\]/);
  assert.match(advanced, /harmonyVoices: \['high', 'low'\]/);
  assert.match(advanced, /saveAudioAsset/);
  assert.match(advanced, /createTrack/);
  assert.match(advanced, /saveProject/);
  assert.match(advanced, /automaticPromotion: false/);
});

test('Pablo remains local-first and remote reasoning is advice-only fallback', () => {
  assert.match(pablo, /executePabloAudioMessage/);
  assert.match(pablo, /tryRemoteReasoning/);
  assert.match(pablo, /mode: 'advice_only'/);
  assert.match(pablo, /destructive_actions: false/);
  assert.match(pablo, /tools: \[\]/);
});

test('runtime capability labels keep evidence gates explicit', () => {
  assert.match(status, /buildDoesNotEqualFunctionalProof: true/);
  assert.match(status, /stemsRequiresLiveRouteCanaryForPromotion: true/);
  assert.match(status, /voiceConversionRequiresVerifiedGuideAndVoiceModel: true/);
  assert.match(status, /CANDIDATE/);
  assert.match(status, /GATED/);
});

test('advanced AI layers boot with the canonical app', () => {
  assert.match(preboot, /installPabloConversationUI/);
  assert.match(preboot, /installAdvancedAIStudio/);
  assert.match(preboot, /installRuntimeCapabilityStatus/);
});
