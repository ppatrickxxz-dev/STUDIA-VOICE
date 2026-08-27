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
  const { installBreathReviewUI } = await import('./breath-review-ui.mjs');
  const { installAdvancedAIStudio } = await import('./advanced-ai-studio.mjs');
  const { installAcousticEvidenceStatusUI } = await import('./acoustic-evidence-status-ui.mjs');
  const { installVoiceIdentityReferenceUI } = await import('./voice-identity-reference-ui.mjs');
  const { installRuntimeCapabilityStatus } = await import('./runtime-capability-status.mjs');
  const { installRemoteAuthUI } = await import('./remote-auth-ui.mjs');
  installPabloConversationUI();
  installBreathReviewUI();
  installAdvancedAIStudio();
  installAcousticEvidenceStatusUI();
  installVoiceIdentityReferenceUI();
  installRuntimeCapabilityStatus();
  installRemoteAuthUI();
  installPhysicalGateRuntime();
  fallbackShell();
} catch (error) {
  console.error('PABLOVOICE_BOOT_IMPORT_FAILED', error);
  fallbackShell();
  document.documentElement.dataset.pvBootError = 'true';
}
