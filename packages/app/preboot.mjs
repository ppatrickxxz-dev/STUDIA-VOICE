const app = document.querySelector('#app');
const ACTIVE_PROJECT_SESSION_KEY = 'pablovoice.activeProjectId';

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action="open-project"][data-id]');
  const id = target?.dataset.id;
  if (!id) return;
  try { sessionStorage.setItem(ACTIVE_PROJECT_SESSION_KEY, id); }
  catch { /* session storage can be unavailable in privacy/file contexts */ }
}, true);

function fallbackShell() {
  if (!app || document.querySelector('.pv-nav')) return;
  app.innerHTML = `<div class="pv-shell">
    <header class="pv-top">
      <div class="pv-brand"><span>PV</span> PABLOVOICE <small>iniciando</small></div>
      <div class="pv-top-actions"><span class="pv-health connected"><span></span>restaurando local</span></div>
    </header>
    <main>
      <section class="pv-hero"><div class="pv-kicker">PabloVoice · estúdio local</div><h1 class="pv-title">Você tá no <em>estúdio</em></h1><p class="pv-lead">Sua ideia ganha som. Restaurando seus projetos no aparelho.</p></section>
      <article class="pv-card chrome"><div class="pv-card-head"><div><h2>Studio pronto para abrir</h2><p>Seu histórico local continua sendo carregado em segundo plano.</p></div><span class="pv-tag ok">LOCAL</span></div>
        <div class="pv-quick"><button class="pv-btn" data-action="new-project">＋ <span>Novo projeto<small>nome e histórico local</small></span></button><button class="pv-btn" data-action="import">↥ <span>Importar áudio<small>use um arquivo do aparelho</small></span></button><button class="pv-btn record" data-action="record">● <span>Gravar voz<small>microfone local</small></span></button><button class="pv-btn" data-route="projects">▤ <span>Meus projetos<small>abrir quando a restauração terminar</small></span></button></div>
      </article>
    </main>
  </div>
  <nav class="pv-nav" aria-label="Navegação principal">
    <button class="active" data-route="home" aria-label="Início"><b>⌂</b><span>Início</span></button>
    <button data-route="studio" aria-label="Studio"><b>◉</b><span>Studio</span></button>
    <button data-route="projects" aria-label="Projetos"><b>▤</b><span>Projetos</span></button>
    <button data-route="compose" aria-label="Compor"><b>✎</b><span>Compor</span></button>
    <button data-route="pablo" aria-label="Pablo"><b>✦</b><span>Pablo</span></button>
  </nav>`;
}

try {
  const { installAudioPlaybackRecovery, installPhysicalGateRuntime } = await import('./physical-gate-runtime.mjs');
  installAudioPlaybackRecovery();
  await import('./app.js');
  const { installPabloConversationUI } = await import('./pablo-conversation-ui.mjs');
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
  const { installPabloSectionVocalScanAdapter } = await import('./pablo-section-vocal-scan-adapter.mjs');
  const { installPabloSectionVocalCleanupAdapter } = await import('./pablo-section-vocal-cleanup-adapter.mjs');
  const { installPabloSectionVocalSoftnessAdapter } = await import('./pablo-section-vocal-softness-adapter.mjs');
  const { installPabloSectionVocalSpaceAdapter } = await import('./pablo-section-vocal-space-adapter.mjs');
  const { installPabloSectionMixUndoAdapter } = await import('./pablo-section-mix-undo-adapter.mjs');
  const { installPabloSectionMixABAdapter } = await import('./pablo-section-mix-ab-adapter.mjs');
  const { installBreathReviewUI } = await import('./breath-review-ui.mjs');
  const { installAdvancedAIStudio } = await import('./advanced-ai-studio.mjs');
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
  installPabloConversationUI();
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
  installPabloSectionVocalScanAdapter();
  installPabloSectionVocalCleanupAdapter();
  installPabloSectionVocalSoftnessAdapter();
  installPabloSectionVocalSpaceAdapter();
  installPabloSectionMixUndoAdapter();
  installPabloSectionMixABAdapter();
  installBreathReviewUI();
  installAdvancedAIStudio();
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
  installPhysicalGateRuntime();
  fallbackShell();
} catch (error) {
  console.error('PABLOVOICE_BOOT_IMPORT_FAILED', error);
  fallbackShell();
  document.documentElement.dataset.pvBootError = 'true';
}
