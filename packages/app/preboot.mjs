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

async function installOptional(label, specifier, exportName) {
  try {
    const module = await import(specifier);
    const install = module?.[exportName];
    if (typeof install !== 'function') throw new TypeError(`${exportName} não está disponível em ${specifier}.`);
    install();
    return true;
  } catch (error) {
    recordBootFailure(label, error);
    return false;
  }
}

// A usable shell must exist before IndexedDB restoration, network providers or any specialist starts.
fallbackShell();
document.documentElement.dataset.pvBootStage = 'shell';

let physicalRuntime = null;
try {
  physicalRuntime = await import('./physical-gate-runtime.mjs');
  physicalRuntime.installAudioPlaybackRecovery?.();
} catch (error) {
  recordBootFailure('audio-playback-recovery', error);
}

try {
  await import('./app.js');
  document.documentElement.dataset.pvBootStage = 'app';
} catch (error) {
  recordBootFailure('canonical-app', error);
}

// Identity and navigation are core product surfaces. Install them before optional specialists so a
// failing DSP/AI module can never blank the Studio or hide Pablo/companions again.
try {
  const { installPabloVoiceIntimateUI } = await import('./pablovoice-intimate-ui.mjs');
  installPabloVoiceIntimateUI();
} catch (error) {
  recordBootFailure('intimate-ui', error);
}

try {
  const { installPabloLifeUI } = await import('./pablo-life-ui.mjs');
  installPabloLifeUI();
} catch (error) {
  recordBootFailure('pablo-life-ui', error);
}

try {
  const { installPabloVoiceVNextUI } = await import('./pablovoice-vnext-ui.mjs');
  installPabloVoiceVNextUI();
} catch (error) {
  recordBootFailure('vnext-ui', error);
}

try {
  const { installPabloVoiceVNextRouteCompat } = await import('./pablovoice-vnext-route-compat.mjs');
  installPabloVoiceVNextRouteCompat();
} catch (error) {
  recordBootFailure('vnext-route-compat', error);
}

document.documentElement.dataset.pvBootStage = 'specialists';

// Specialists stay ordered because several adapters intentionally decorate hooks installed earlier.
// Each one is isolated: failure is visible and testable, but it cannot take the whole music studio down.
const specialists = [
  ['conversation', './pablo-conversation-ui.mjs', 'installPabloConversationUI'],
  ['musical-plan', './pablo-musical-plan-ui.mjs', 'installPabloMusicalPlanUI'],
  ['section-here', './pablo-section-here-adapter.mjs', 'installPabloSectionHereAdapter'],
  ['section-audition', './pablo-section-audition-adapter.mjs', 'installPabloSectionAuditionAdapter'],
  ['vocal-gain', './pablo-section-vocal-gain-adapter.mjs', 'installPabloSectionVocalGainAdapter'],
  ['vocal-brightness', './pablo-section-vocal-brightness-adapter.mjs', 'installPabloSectionVocalBrightnessAdapter'],
  ['vocal-body', './pablo-section-vocal-body-adapter.mjs', 'installPabloSectionVocalBodyAdapter'],
  ['vocal-presence', './pablo-section-vocal-presence-adapter.mjs', 'installPabloSectionVocalPresenceAdapter'],
  ['vocal-dynamics', './pablo-section-vocal-dynamics-adapter.mjs', 'installPabloSectionVocalDynamicsAdapter'],
  ['vocal-deesser', './pablo-section-vocal-deesser-adapter.mjs', 'installPabloSectionVocalDeEsserAdapter'],
  ['vocal-plosive', './pablo-section-vocal-plosive-adapter.mjs', 'installPabloSectionVocalPlosiveAdapter'],
  ['vocal-click', './pablo-section-vocal-click-adapter.mjs', 'installPabloSectionVocalClickAdapter'],
  ['vocal-restoration-recommendation', './pablo-section-vocal-restoration-recommendation-adapter.mjs', 'installPabloSectionVocalRestorationRecommendationAdapter'],
  ['vocal-restoration-selective', './pablo-section-vocal-restoration-selective-adapter.mjs', 'installPabloSectionVocalRestorationSelectiveAdapter'],
  ['full-vocal-scan', './pablo-full-vocal-scan-adapter.mjs', 'installPabloFullVocalScanAdapter'],
  ['full-vocal-treatment', './pablo-full-vocal-treatment-adapter.mjs', 'installPabloFullVocalTreatmentAdapter'],
  ['section-vocal-scan', './pablo-section-vocal-scan-adapter.mjs', 'installPabloSectionVocalScanAdapter'],
  ['section-vocal-cleanup', './pablo-section-vocal-cleanup-adapter.mjs', 'installPabloSectionVocalCleanupAdapter'],
  ['vocal-softness', './pablo-section-vocal-softness-adapter.mjs', 'installPabloSectionVocalSoftnessAdapter'],
  ['vocal-space', './pablo-section-vocal-space-adapter.mjs', 'installPabloSectionVocalSpaceAdapter'],
  ['mix-undo', './pablo-section-mix-undo-adapter.mjs', 'installPabloSectionMixUndoAdapter'],
  ['mix-ab', './pablo-section-mix-ab-adapter.mjs', 'installPabloSectionMixABAdapter'],
  ['breath-review', './breath-review-ui.mjs', 'installBreathReviewUI'],
  ['advanced-ai-studio', './advanced-ai-studio.mjs', 'installAdvancedAIStudio'],
  ['song-creation', './song-creation-studio.mjs', 'installSongCreationStudio'],
  ['acoustic-evidence', './acoustic-evidence-status-ui.mjs', 'installAcousticEvidenceStatusUI'],
  ['voice-identity', './voice-identity-reference-ui.mjs', 'installVoiceIdentityReferenceUI'],
  ['runtime-capability', './runtime-capability-status.mjs', 'installRuntimeCapabilityStatus'],
  ['remote-auth', './remote-auth-ui.mjs', 'installRemoteAuthUI'],
  ['instrument-lab', './instrument-integration.mjs', 'installInstrumentLab'],
  ['piano-roll', './piano-roll-ui.mjs', 'installPianoRoll'],
  ['audio-to-piano-roll', './audio-to-piano-roll-ui.mjs', 'installAudioToPianoRoll'],
  ['sampler', './sampler-ui.mjs', 'installSampler'],
  ['beat-lab', './beat-lab-ui.mjs', 'installBeatLab'],
  ['section-map', './section-map-ui.mjs', 'installSectionMapUI'],
  ['music-section-regeneration', './music-section-regeneration-ui.mjs', 'installMusicSectionRegenerationUI'],
];

for (const [label, specifier, exportName] of specialists) {
  await installOptional(label, specifier, exportName);
}

try {
  physicalRuntime?.installPhysicalGateRuntime?.();
} catch (error) {
  recordBootFailure('physical-gate-runtime', error);
}

fallbackShell();
document.documentElement.dataset.pvBootStage = 'ready';
document.documentElement.dataset.pvBootReady = 'true';
if (!bootFailures.length) delete document.documentElement.dataset.pvBootDegraded;
