const app = document.querySelector('#app');
const ACTIVE_PROJECT_SESSION_KEY = 'pablovoice.activeProjectId';
const bootFailures = [];

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action="open-project"][data-id]');
  const id = target?.dataset.id;
  if (!id) return;
  try { sessionStorage.setItem(ACTIVE_PROJECT_SESSION_KEY, id); }
  catch { /* session storage can be unavailable in privacy/file contexts */ }
}, true);

function fallbackShell() {
  if (!app || document.querySelector('.pv-nav')) return;
  const offline = navigator.onLine === false;
  app.innerHTML = `<div class="pv-shell">
    <header class="pv-top">
      <div class="pv-brand"><span>PV</span> PABLOVOICE <small>iniciando</small></div>
      <div class="pv-top-actions"><span class="pv-health ${offline ? '' : 'connected'}"><span></span>${offline ? 'OFFLINE · LOCAL' : 'ONLINE · FULL'}</span></div>
    </header>
    <main>
      <section class="pv-hero"><div class="pv-kicker">PabloVoice · pocket music studio</div><h1 class="pv-title">Você tá no <em>estúdio</em></h1><p class="pv-lead">${offline ? 'Sem rede agora. Restaurando seus projetos e o motor local no aparelho.' : 'Restaurando seu estúdio, projetos e recursos conectados.'}</p></section>
      <article class="pv-card chrome"><div class="pv-card-head"><div><h2>Studio pronto para abrir</h2><p>Seu histórico continua sendo carregado em segundo plano.</p></div><span class="pv-tag ok">MEMÓRIA</span></div>
        <div class="pv-quick"><button class="pv-btn" data-action="new-project">＋ <span>Novo projeto<small>nome e histórico</small></span></button><button class="pv-btn" data-action="import">↥ <span>Importar áudio<small>use um arquivo do aparelho</small></span></button><button class="pv-btn record" data-action="record">● <span>Gravar voz<small>microfone do aparelho</small></span></button><button class="pv-btn" data-route="projects">▤ <span>Meus projetos<small>abrir quando a restauração terminar</small></span></button></div>
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

function recordBootFailure(label, error) {
  bootFailures.push(label);
  document.documentElement.dataset.pvBootDegraded = 'true';
  document.documentElement.dataset.pvBootFailures = bootFailures.join(',');
  console.error(`PABLOVOICE_BOOT_MODULE_FAILED:${label}`, error);
}

async function installIsolated(label, installer) {
  try {
    await installer();
    return true;
  } catch (error) {
    recordBootFailure(label, error);
    return false;
  }
}

// The shell is a release boundary: it must exist even if a later provider/DSP specialist fails.
fallbackShell();
document.documentElement.dataset.pvBootStage = 'shell';

let installPhysicalGateRuntime = null;
try {
  const physicalRuntime = await import('./physical-gate-runtime.mjs');
  const { installAudioPlaybackRecovery } = physicalRuntime;
  installPhysicalGateRuntime = physicalRuntime.installPhysicalGateRuntime;
  installAudioPlaybackRecovery();
} catch (error) {
  recordBootFailure('audio-playback-recovery', error);
}

try {
  await import('./app.js');
  document.documentElement.dataset.pvBootStage = 'app';
} catch (error) {
  recordBootFailure('canonical-app', error);
}

// Identity and canonical navigation rise before optional specialists. The exact Pablo/Companion assets
// and vNext shell therefore remain usable and diagnosable even when one specialist cannot initialize.
await installIsolated('intimate-ui', async () => {
  const { installPabloVoiceIntimateUI } = await import('./pablovoice-intimate-ui.mjs');
  installPabloVoiceIntimateUI();
});
await installIsolated('pablo-life-ui', async () => {
  const { installPabloLifeUI } = await import('./pablo-life-ui.mjs');
  installPabloLifeUI();
});
await installIsolated('vnext-ui', async () => {
  const { installPabloVoiceVNextUI } = await import('./pablovoice-vnext-ui.mjs');
  installPabloVoiceVNextUI();
});
await installIsolated('vnext-route-compat', async () => {
  const { installPabloVoiceVNextRouteCompat } = await import('./pablovoice-vnext-route-compat.mjs');
  installPabloVoiceVNextRouteCompat();
});

document.documentElement.dataset.pvBootStage = 'specialists';

// Keep the reviewed canonical order explicit. Several adapters intentionally depend on earlier
// section/acoustic primitives, and contract tests freeze that ordering. Each block is still isolated.
await installIsolated('conversation', async () => {
  const { installPabloConversationUI } = await import('./pablo-conversation-ui.mjs');
  installPabloConversationUI();
});
await installIsolated('musical-plan', async () => {
  const { installPabloMusicalPlanUI } = await import('./pablo-musical-plan-ui.mjs');
  installPabloMusicalPlanUI();
});
await installIsolated('section-here', async () => {
  const { installPabloSectionHereAdapter } = await import('./pablo-section-here-adapter.mjs');
  installPabloSectionHereAdapter();
});
await installIsolated('section-audition', async () => {
  const { installPabloSectionAuditionAdapter } = await import('./pablo-section-audition-adapter.mjs');
  installPabloSectionAuditionAdapter();
});
await installIsolated('vocal-gain', async () => {
  const { installPabloSectionVocalGainAdapter } = await import('./pablo-section-vocal-gain-adapter.mjs');
  installPabloSectionVocalGainAdapter();
});
await installIsolated('vocal-brightness', async () => {
  const { installPabloSectionVocalBrightnessAdapter } = await import('./pablo-section-vocal-brightness-adapter.mjs');
  installPabloSectionVocalBrightnessAdapter();
});
await installIsolated('vocal-body', async () => {
  const { installPabloSectionVocalBodyAdapter } = await import('./pablo-section-vocal-body-adapter.mjs');
  installPabloSectionVocalBodyAdapter();
});
await installIsolated('vocal-presence', async () => {
  const { installPabloSectionVocalPresenceAdapter } = await import('./pablo-section-vocal-presence-adapter.mjs');
  installPabloSectionVocalPresenceAdapter();
});
await installIsolated('vocal-dynamics', async () => {
  const { installPabloSectionVocalDynamicsAdapter } = await import('./pablo-section-vocal-dynamics-adapter.mjs');
  installPabloSectionVocalDynamicsAdapter();
});
await installIsolated('vocal-deesser', async () => {
  const { installPabloSectionVocalDeEsserAdapter } = await import('./pablo-section-vocal-deesser-adapter.mjs');
  installPabloSectionVocalDeEsserAdapter();
});
await installIsolated('vocal-plosive', async () => {
  const { installPabloSectionVocalPlosiveAdapter } = await import('./pablo-section-vocal-plosive-adapter.mjs');
  installPabloSectionVocalPlosiveAdapter();
});
await installIsolated('vocal-click', async () => {
  const { installPabloSectionVocalClickAdapter } = await import('./pablo-section-vocal-click-adapter.mjs');
  installPabloSectionVocalClickAdapter();
});
await installIsolated('vocal-restoration-recommendation', async () => {
  const { installPabloSectionVocalRestorationRecommendationAdapter } = await import('./pablo-section-vocal-restoration-recommendation-adapter.mjs');
  installPabloSectionVocalRestorationRecommendationAdapter();
});
await installIsolated('vocal-restoration-selective', async () => {
  const { installPabloSectionVocalRestorationSelectiveAdapter } = await import('./pablo-section-vocal-restoration-selective-adapter.mjs');
  installPabloSectionVocalRestorationSelectiveAdapter();
});
await installIsolated('full-vocal-scan', async () => {
  const { installPabloFullVocalScanAdapter } = await import('./pablo-full-vocal-scan-adapter.mjs');
  installPabloFullVocalScanAdapter();
});
await installIsolated('full-vocal-treatment', async () => {
  const { installPabloFullVocalTreatmentAdapter } = await import('./pablo-full-vocal-treatment-adapter.mjs');
  installPabloFullVocalTreatmentAdapter();
});
await installIsolated('section-vocal-scan', async () => {
  const { installPabloSectionVocalScanAdapter } = await import('./pablo-section-vocal-scan-adapter.mjs');
  installPabloSectionVocalScanAdapter();
});
await installIsolated('section-vocal-cleanup', async () => {
  const { installPabloSectionVocalCleanupAdapter } = await import('./pablo-section-vocal-cleanup-adapter.mjs');
  installPabloSectionVocalCleanupAdapter();
});
await installIsolated('vocal-softness', async () => {
  const { installPabloSectionVocalSoftnessAdapter } = await import('./pablo-section-vocal-softness-adapter.mjs');
  installPabloSectionVocalSoftnessAdapter();
});
await installIsolated('vocal-space', async () => {
  const { installPabloSectionVocalSpaceAdapter } = await import('./pablo-section-vocal-space-adapter.mjs');
  installPabloSectionVocalSpaceAdapter();
});
await installIsolated('mix-undo', async () => {
  const { installPabloSectionMixUndoAdapter } = await import('./pablo-section-mix-undo-adapter.mjs');
  installPabloSectionMixUndoAdapter();
});
await installIsolated('mix-ab', async () => {
  const { installPabloSectionMixABAdapter } = await import('./pablo-section-mix-ab-adapter.mjs');
  installPabloSectionMixABAdapter();
});
await installIsolated('breath-review', async () => {
  const { installBreathReviewUI } = await import('./breath-review-ui.mjs');
  installBreathReviewUI();
});
await installIsolated('advanced-ai-studio', async () => {
  const { installAdvancedAIStudio } = await import('./advanced-ai-studio.mjs');
  installAdvancedAIStudio();
});
await installIsolated('song-creation', async () => {
  const { installSongCreationStudio } = await import('./song-creation-studio.mjs');
  installSongCreationStudio();
});
await installIsolated('acoustic-evidence', async () => {
  const { installAcousticEvidenceStatusUI } = await import('./acoustic-evidence-status-ui.mjs');
  installAcousticEvidenceStatusUI();
});
await installIsolated('voice-identity', async () => {
  const { installVoiceIdentityReferenceUI } = await import('./voice-identity-reference-ui.mjs');
  installVoiceIdentityReferenceUI();
});
await installIsolated('runtime-capability', async () => {
  const { installRuntimeCapabilityStatus } = await import('./runtime-capability-status.mjs');
  installRuntimeCapabilityStatus();
});
await installIsolated('remote-auth', async () => {
  const { installRemoteAuthUI } = await import('./remote-auth-ui.mjs');
  installRemoteAuthUI();
});
await installIsolated('instrument-lab', async () => {
  const { installInstrumentLab } = await import('./instrument-integration.mjs');
  installInstrumentLab();
});
await installIsolated('piano-roll', async () => {
  const { installPianoRoll } = await import('./piano-roll-ui.mjs');
  installPianoRoll();
});
await installIsolated('audio-to-piano-roll', async () => {
  const { installAudioToPianoRoll } = await import('./audio-to-piano-roll-ui.mjs');
  installAudioToPianoRoll();
});
await installIsolated('sampler', async () => {
  const { installSampler } = await import('./sampler-ui.mjs');
  installSampler();
});
await installIsolated('beat-lab', async () => {
  const { installBeatLab } = await import('./beat-lab-ui.mjs');
  installBeatLab();
});
await installIsolated('section-map', async () => {
  const { installSectionMapUI } = await import('./section-map-ui.mjs');
  installSectionMapUI();
});
await installIsolated('music-section-regeneration', async () => {
  const { installMusicSectionRegenerationUI } = await import('./music-section-regeneration-ui.mjs');
  installMusicSectionRegenerationUI();
});

if (typeof installPhysicalGateRuntime === 'function') {
  try {
    installPhysicalGateRuntime();
  } catch (error) {
    recordBootFailure('physical-gate-runtime', error);
  }
}

fallbackShell();
document.documentElement.dataset.pvBootStage = 'ready';
document.documentElement.dataset.pvBootReady = 'true';
if (!bootFailures.length) delete document.documentElement.dataset.pvBootDegraded;
