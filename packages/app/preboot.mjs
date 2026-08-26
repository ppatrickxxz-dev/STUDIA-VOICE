const app = document.querySelector('#app');

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
  // app.js registers its interaction handlers synchronously and then starts the
  // asynchronous IndexedDB/project restoration. Once import() resolves, the shell
  // is safe to expose even if local restoration is still pending.
  await import('./app.js');
  fallbackShell();
} catch (error) {
  console.error('PABLOVOICE_BOOT_IMPORT_FAILED', error);
  fallbackShell();
  document.documentElement.dataset.pvBootError = 'true';
}
