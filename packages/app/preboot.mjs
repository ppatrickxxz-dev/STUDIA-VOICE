const app = document.querySelector('#app');
const ACTIVE_PROJECT_SESSION_KEY = 'pablovoice.activeProjectId';

document.addEventListener('click', (event) => {
  const id = event.target.closest('[data-action="open-project"][data-id]')?.dataset.id;
  if (!id) return;
  try { sessionStorage.setItem(ACTIVE_PROJECT_SESSION_KEY, id); } catch {}
}, true);

function fallbackShell() {
  if (!app || document.querySelector('.pv-nav')) return;
  const offline = navigator.onLine === false;
  app.innerHTML = `<div class="pv-shell"><header class="pv-top"><div class="pv-brand"><span>PV</span> PABLOVOICE</div><div class="pv-top-actions"><span class="pv-health ${offline ? '' : 'connected'}"><span></span>${offline ? 'OFFLINE' : 'ONLINE'}</span></div></header><main><section class="pv-hero"><h1 class="pv-title">Você tá no <em>estúdio</em></h1><p class="pv-lead">${offline ? 'Restaurando seu projeto local.' : 'Restaurando seu estúdio.'}</p></section><div class="pv-quick"><button class="pv-btn" data-action="new-project">Novo projeto</button><button class="pv-btn" data-action="import">Importar áudio</button><button class="pv-btn record" data-action="record">Gravar voz</button></div></main></div><nav class="pv-nav" aria-label="Navegação principal"><button class="active" data-route="home"><span>Início</span></button><button data-route="studio"><span>Studio</span></button><button data-route="projects"><span>Projetos</span></button><button data-route="compose"><span>Compor</span></button><button data-route="pablo"><span>Pablo</span></button></nav>`;
}

try {
  const { installAudioPlaybackRecovery, installPhysicalGateRuntime } = await import('./physical-gate-runtime.mjs');
  installAudioPlaybackRecovery();
  await import('./app.js');
  const { installPabloConversationUI } = await import('./pablo-conversation-ui.mjs');
  const { installPabloMusicalPlanUI } = await import('./pablo-musical-plan-ui.mjs');
  const { installPabloSectionHereAdapter } = await import('./pablo-section-here-adapter.mjs');
  const { installPabloSectionAuditionAdapter } = await import('./pablo-section-audition-adapter.mjs');
  const { installPabloSectionVocalGainAdapter } = await import('./pablo-section-vocal-gain-adapter.mjs');
  const { installPabloSectionVocalBrightnessAdapter } = await import('./pablo-section-vocal-brightness-adapter.mjs');
  const { installPabloSectionVocalBodyAdapter } = await import('./pablo-section-vocal-body-adapter.mjs');
  const { installPabloSectionVocalPresenceAdapter } = await import('./pablo-section-vocal-presence-adapter.mjs');
  const { installPabloSectionVocalDynamicsAdapter } = await import('./pablo-section-vocal-dynamics-adapter.mjs');
  const { installPabloSectionVocalDeEsserAdapter } = await import('./pablo-section-vocal-deesser-adapter.mjs');
  const { installPabloSectionVocalPlosiveAdapter } = await import('./pablo-section-vocal-plosive-adapter.mjs');
  const { installPabloSectionVocalClickAdapter } = await import('./pablo-section-vocal-click-adapter.mjs');
  const { installPabloSectionVocalRestorationRecommendationAdapter } = await import('./pablo-section-vocal-restoration-recommendation-adapter.mjs');
  const { installPabloSectionVocalRestorationSelectiveAdapter } = await import('./pablo-section-vocal-restoration-selective-adapter.mjs');
  const { installPabloFullVocalScanAdapter } = await import('./pablo-full-vocal-scan-adapter.mjs');
  const { installPabloFullVocalTreatmentAdapter } = await import('./pablo-full-vocal-treatment-adapter.mjs');
  const { installPabloSectionVocalScanAdapter } = await import('./pablo-section-vocal-scan-adapter.mjs');
  const { installPabloSectionVocalCleanupAdapter } = await import('./pablo-section-vocal-cleanup-adapter.mjs');
  const { installPabloSectionVocalSoftnessAdapter } = await import('./pablo-section-vocal-softness-adapter.mjs');
  const { installPabloSectionVocalSpaceAdapter } = await import('./pablo-section-vocal-space-adapter.mjs');
  const { installPabloSectionMixUndoAdapter } = await import('./pablo-section-mix-undo-adapter.mjs');
  const { installPabloSectionMixABAdapter } = await import('./pablo-section-mix-ab-adapter.mjs');
  const { installBreathReviewUI } = await import('./breath-review-ui.mjs');
  const { installAdvancedAIStudio } = await import('./advanced-ai-studio.mjs');
  const { installSongCreationStudio } = await import('./song-creation-studio.mjs');
  const { installAcousticEvidenceStatusUI } = await import('./acoustic-evidence-status-ui.mjs');
  const { installVoiceIdentityReferenceUI } = await import('./voice-identity-reference-ui.mjs');
  const { installRuntimeCapabilityStatus } = await import('./runtime-capability-status.mjs');
  const { installRemoteAuthUI } = await import('./remote-auth-ui.mjs');
  const { installInstrumentLab } = await import('./instrument-integration.mjs');
  const { installPianoRoll } = await import('./piano-roll-ui.mjs');
  const { installAudioToPianoRoll } = await import('./audio-to-piano-roll-ui.mjs');
  const { installSampler } = await import('./sampler-ui.mjs');
  const { installBeatLab } = await import('./beat-lab-ui.mjs');
  const { installSectionMapUI } = await import('./section-map-ui.mjs');
  const { installMusicSectionRegenerationUI } = await import('./music-section-regeneration-ui.mjs');
  const { installPabloVoiceIntimateUI } = await import('./pablovoice-intimate-ui.mjs');
  const { installPabloLifeUI } = await import('./pablo-life-ui.mjs');
  installPabloConversationUI();
  installPabloMusicalPlanUI();
  installPabloSectionHereAdapter();
  installPabloSectionAuditionAdapter();
  installPabloSectionVocalGainAdapter();
  installPabloSectionVocalBrightnessAdapter();
  installPabloSectionVocalBodyAdapter();
  installPabloSectionVocalPresenceAdapter();
  installPabloSectionVocalDynamicsAdapter();
  installPabloSectionVocalDeEsserAdapter();
  installPabloSectionVocalPlosiveAdapter();
  installPabloSectionVocalClickAdapter();
  installPabloSectionVocalRestorationRecommendationAdapter();
  installPabloSectionVocalRestorationSelectiveAdapter();
  installPabloFullVocalScanAdapter();
  installPabloFullVocalTreatmentAdapter();
  installPabloSectionVocalScanAdapter();
  installPabloSectionVocalCleanupAdapter();
  installPabloSectionVocalSoftnessAdapter();
  installPabloSectionVocalSpaceAdapter();
  installPabloSectionMixUndoAdapter();
  installPabloSectionMixABAdapter();
  installBreathReviewUI();
  installAdvancedAIStudio();
  installSongCreationStudio();
  installAcousticEvidenceStatusUI();
  installVoiceIdentityReferenceUI();
  installRuntimeCapabilityStatus();
  installRemoteAuthUI();
  installInstrumentLab();
  installPianoRoll();
  installAudioToPianoRoll();
  installSampler();
  installBeatLab();
  installSectionMapUI();
  installMusicSectionRegenerationUI();
  installPabloVoiceIntimateUI();
  installPabloLifeUI();
  installPhysicalGateRuntime();
  fallbackShell();
} catch (error) {
  console.error('PABLOVOICE_BOOT_IMPORT_FAILED', error);
  fallbackShell();
  document.documentElement.dataset.pvBootError = 'true';
}
