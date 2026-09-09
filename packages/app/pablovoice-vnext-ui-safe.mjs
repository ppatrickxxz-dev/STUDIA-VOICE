import { activeProjectSessionId, getProject, listProjects } from './storage.mjs';
import { buildUnifiedProjectContext } from './project-context.mjs';

const EXPERIENCE = 'pablovoice-vnext-product-shell-v1';
const COMPANIONS = Object.freeze([
  { id: 'note', name: 'Nota Drop', role: 'Ritmo & ideias', base: 'captura musical · melodia · groove', action: 'beat' },
  { id: 'wave', name: 'Wave Ribbon', role: 'Arranjo & flow', base: 'movimento · seções · continuidade', action: 'arrangement' },
  { id: 'chime', name: 'Chime Lantern', role: 'Letras & harmonia', base: 'palavras · sentido · guia', action: 'lyrics' },
  { id: 'eq', name: 'EQ Bloom', role: 'Voz & limpeza', base: 'clareza · timbre · equilíbrio', action: 'vocal' },
  { id: 'vinyl', name: 'Vinyl Groove', role: 'Mix & finalização', base: 'textura · impacto · balanço', action: 'mixer' },
  { id: 'star', name: 'Star Spark', role: 'Inspiração & visão', base: 'faísca · ousadia · direção', action: 'create' },
]);

const runtime = {
  observer: null,
  queued: false,
  graph: null,
  project: null,
  activeCompanion: 'note',
  graphRefreshTimer: 0,
  playheadTimer: 0,
};

export function installPabloVoiceVNextUI() {
  if (runtime.observer) return teardown;
  document.documentElement.dataset.pvExperienceVnext = EXPERIENCE;
  runtime.observer = new MutationObserver(queueSync);
  runtime.observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', onSubmit, true);
  for (const eventName of ['pablovoice:musical-plan-applied', 'pablovoice:stems-imported', 'pablovoice:project-updated', 'pablovoice:song-created']) {
    document.addEventListener(eventName, onProjectMutation);
  }
  runtime.playheadTimer = setInterval(updatePlayhead, 350);
  refreshGraph();
  queueSync();
  return teardown;
}

function teardown() {
  runtime.observer?.disconnect();
  runtime.observer = null;
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('submit', onSubmit, true);
  for (const eventName of ['pablovoice:musical-plan-applied', 'pablovoice:stems-imported', 'pablovoice:project-updated', 'pablovoice:song-created']) {
    document.removeEventListener(eventName, onProjectMutation);
  }
  clearTimeout(runtime.graphRefreshTimer);
  clearInterval(runtime.playheadTimer);
  runtime.playheadTimer = 0;
}

function queueSync() {
  if (runtime.queued) return;
  runtime.queued = true;
  queueMicrotask(() => {
    runtime.queued = false;
    syncShell();
  });
}

function syncShell() {
  const shell = document.querySelector('#app > .pv-shell, #app .pv-shell');
  if (!shell) return;
  shell.classList.add('pv-vnext-shell');
  ensureSidebar(shell);
  ensureBrainRail(shell);
  ensureCompanionDock(shell);
  decorateTop(shell);
  decorateStudio(shell);
  renderIdleVisualizer();
  renderBrainState();
  document.dispatchEvent(new CustomEvent('pablovoice:vnext-ui-synced'));
}

function ensureSidebar(shell) {
  let rail = shell.querySelector(':scope > [data-vnext-sidebar]');
  if (rail) return rail;
  rail = document.createElement('aside');
  rail.className = 'pv-vnext-sidebar';
  rail.dataset.vnextSidebar = 'true';
  rail.innerHTML = `<div class="pv-vnext-brand"><span>PV</span><div><b>PabloVoice</b><small>STUDIO · vNEXT</small></div></div>
    <nav class="pv-vnext-nav" aria-label="PabloVoice vNext">
      ${navItem('home', '⌂', 'Início')}${navItem('create', '＋', 'Criar')}${navItem('pablo', '✦', 'Pablo Brain')}${navItem('lyrics', '✎', 'Letras')}
      <span class="pv-vnext-nav-sep">PRODUÇÃO</span>
      ${navItem('beat', '▦', 'Beat Lab')}${navItem('instrument', '♬', 'Instrumentos')}${navItem('vocal', '≋', 'Vocal Studio')}${navItem('record', '●', 'Gravador')}${navItem('mixer', '☷', 'Mixer')}${navItem('arrangement', '↹', 'Arranjo')}${navItem('master', '▥', 'Finalização')}${navItem('export', '↥', 'Exportar')}
    </nav>
    <section class="pv-vnext-visualizer" data-vnext-visualizer data-vnext-reactive="music-graph" data-vnext-reaction-state="ready" aria-label="Visualizador dos Companions">
      <header><div><small>POCKET VISUALIZER</small><b data-vnext-visualizer-state>PRONTO</b></div><span data-vnext-network data-pv-connectivity-hidden="true">STUDIO</span></header>
      <div class="pv-vnext-device-screen">
        <div class="pv-vnext-spectrum" aria-hidden="true">${'<i></i>'.repeat(18)}</div>
        <div class="pv-canon-companion-sprite note" data-vnext-active-sprite role="img" aria-label="Nota Drop"></div>
        <div class="pv-vnext-now"><small data-vnext-now-copy>PRONTO PARA TOCAR</small><b data-vnext-now-name>Nota Drop</b><span data-vnext-now-base>captura musical · melodia · groove</span></div>
      </div>
      <div class="pv-vnext-mini-carousel">${COMPANIONS.map((item) => `<button type="button" data-vnext-companion="${item.id}" title="${escapeHtml(item.name)} · ${escapeHtml(item.base)}"><span class="pv-canon-companion-sprite ${item.id}"></span></button>`).join('')}</div>
      <div class="pv-vnext-device-controls"><button type="button" data-vnext-visualizer-prev aria-label="Companion anterior">‹</button><button type="button" data-vnext-command="play" class="main" aria-label="Tocar ou pausar">▶</button><button type="button" data-vnext-visualizer-next aria-label="Próximo companion">›</button></div>
    </section>`;
  shell.insertBefore(rail, shell.firstChild);
  return rail;
}

function navItem(command, icon, label) {
  return `<button type="button" data-vnext-command="${command}"><span>${icon}</span><b>${label}</b></button>`;
}

function ensureBrainRail(shell) {
  let rail = shell.querySelector(':scope > [data-vnext-brain]');
  if (rail) return rail;
  rail = document.createElement('aside');
  rail.className = 'pv-vnext-brain';
  rail.dataset.vnextBrain = 'true';
  rail.innerHTML = `<header class="pv-vnext-brain-head"><div><small>PABLO BRAIN</small><b>Seu produtor no projeto inteiro</b></div><span data-vnext-online data-pv-connectivity-hidden="true">STUDIO</span></header>
    <section class="pv-vnext-pablo-card">
      <img src="/site/assets/pablo_fullbody.webp" alt="Pablo canônico do PabloVoice">
      <div><b>E aí, sou o Pablo.</b><p data-vnext-pablo-copy>Eu leio o projeto, a seção e as ferramentas antes de sugerir qualquer mudança.</p></div>
    </section>
    <section class="pv-vnext-brain-context" data-vnext-brain-context></section>
    <section class="pv-vnext-suggestions"><small>ATALHOS DO PROJETO</small>
      <button type="button" data-vnext-command="create"><span>✦</span><div><b>Criar ou continuar música</b><small>ideia → estrutura → take</small></div></button>
      <button type="button" data-vnext-command="beat"><span>▦</span><div><b>Trabalhar beat</b><small>pads reais, groove e render</small></div></button>
      <button type="button" data-vnext-command="vocal"><span>≋</span><div><b>Produzir voz</b><small>limpeza, identidade e A/B</small></div></button>
      <button type="button" data-vnext-command="arrangement"><span>↹</span><div><b>Revisar arranjo</b><small>seções sem desmontar o resto</small></div></button>
    </section>
    <form class="pv-vnext-prompt" data-vnext-pablo-form><input name="message" autocomplete="off" placeholder="Peça algo ao Pablo sobre esta música…"><button type="submit" aria-label="Enviar">➤</button></form>`;
  const main = shell.querySelector(':scope > main');
  if (main) main.insertAdjacentElement('afterend', rail);
  else shell.appendChild(rail);
  return rail;
}

function ensureCompanionDock(shell) {
  let dock = shell.querySelector(':scope > [data-vnext-companion-dock]');
  if (dock) return dock;
  dock = document.createElement('section');
  dock.className = 'pv-vnext-companion-dock';
  dock.dataset.vnextCompanionDock = 'true';
  dock.innerHTML = `<header><small>BASE DOS COMPANIONS</small><span>mesmos personagens · funções preservadas</span></header><div>${COMPANIONS.map((item) => `<button type="button" data-vnext-command="${item.action}" data-vnext-dock-companion="${item.id}"><span class="pv-canon-companion-sprite ${item.id}"></span><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.role)}</small><em>${escapeHtml(item.base)}</em></div></button>`).join('')}</div>`;
  shell.appendChild(dock);
  return dock;
}

function decorateTop(shell) {
  const top = shell.querySelector(':scope > .pv-top');
  if (!top) return;
  top.classList.add('pv-vnext-top');
  let meta = top.querySelector('[data-vnext-project-meta]');
  if (!meta) {
    meta = document.createElement('div');
    meta.className = 'pv-vnext-project-meta';
    meta.dataset.vnextProjectMeta = 'true';
    meta.innerHTML = `<div><small>PROJETO ATUAL</small><b data-vnext-project-name>Nenhum projeto aberto</b><span data-vnext-project-detail>Comece uma ideia ou abra um projeto.</span></div><div class="pv-vnext-top-tools"><button type="button" data-vnext-command="takes">Takes</button><button type="button" data-vnext-command="ab">A/B</button><button type="button" data-vnext-command="stems">Stems</button><button type="button" data-vnext-command="visualizer">Visualizador</button></div>`;
    top.querySelector('.pv-brand')?.insertAdjacentElement('afterend', meta);
  }
  updateProjectMeta(meta);
}

function decorateStudio(shell) {
  const route = activeRoute();
  shell.dataset.vnextRoute = route;
  shell.querySelectorAll('[data-vnext-command]').forEach((button) => {
    const command = button.dataset.vnextCommand;
    const active = (route === 'home' && command === 'home') || (route === 'compose' && ['create', 'lyrics'].includes(command)) || (route === 'pablo' && command === 'pablo') || (route === 'studio' && ['vocal', 'mixer', 'arrangement', 'master', 'export'].includes(command));
    button.classList.toggle('route-active', active);
  });

  const main = shell.querySelector(':scope > main');
  if (!main || route !== 'studio') {
    main?.querySelector('[data-vnext-arrangement-overview]')?.remove();
    return;
  }
  const anchor = main.querySelector('.pv-transport-card');
  if (!anchor || main.querySelector('[data-vnext-arrangement-overview]')) return;
  const overview = document.createElement('section');
  overview.className = 'pv-vnext-arrangement-overview';
  overview.dataset.vnextArrangementOverview = 'true';
  anchor.insertAdjacentElement('beforebegin', overview);
  renderArrangementOverview(overview);
}

function renderArrangementOverview(host) {
  const graph = runtime.graph;
  if (!host) return;
  if (!graph?.project?.id) {
    host.innerHTML = `<div class="pv-vnext-overview-empty"><b>Mapa do projeto</b><span>As seções e faixas aparecem aqui quando o Music Graph estiver disponível.</span></div>`;
    return;
  }
  const duration = Math.max(1, Number(graph.structure?.durationSeconds || 0));
  const sections = graph.structure?.sections || [];
  const tracks = graph.tracks || [];
  host.innerHTML = `<header><div><small>MUSIC GRAPH · MESMO PROJETO</small><b>${escapeHtml(graph.project.name)}</b></div><span>${tracks.length} faixa(s) · ${sections.length} seção(ões)</span></header>
    <div class="pv-vnext-section-strip">${sections.length ? sections.map((section) => `<button type="button" data-vnext-command="arrangement" title="${escapeHtml(section.label || section.kind)}"><b>${escapeHtml(section.label || section.kind || 'Seção')}</b><small>${formatSeconds(section.startSeconds)}${Number.isFinite(section.endSeconds) ? `–${formatSeconds(section.endSeconds)}` : ''}</small></button>`).join('') : '<span class="pv-vnext-no-sections">Abra o Mapa de Seções para confirmar a estrutura.</span>'}</div>
    <div class="pv-vnext-track-lanes">${tracks.slice(0, 12).map((track) => renderTrackLane(track, duration)).join('')}</div>
    <svg class="pv-vnext-playhead-svg" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><line data-vnext-playhead x1="0" x2="0" y1="0" y2="100"></line></svg>`;
  updatePlayhead();
}

function renderTrackLane(track, duration) {
  const start = Math.max(0, Number(track.offset || 0) + Number(track.trimStart || 0));
  const end = Math.min(duration, Math.max(start + 0.05, Number(track.offset || 0) + Number(track.trimEnd || track.duration || 0)));
  const x = Math.round(Math.min(1000, Math.max(0, (start / duration) * 1000)));
  const width = Math.round(Math.min(1000 - x, Math.max(12, ((end - start) / duration) * 1000)));
  return `<button type="button" class="pv-vnext-track-lane role-${escapeHtml(track.role || 'unknown')}" data-vnext-track="${escapeHtml(track.id || '')}" title="Abrir ${escapeHtml(track.name)} no Mixer"><span><b>${escapeHtml(track.name)}</b><small>${escapeHtml(roleLabel(track.role))}</small></span><i><svg class="pv-vnext-lane-svg" viewBox="0 0 1000 12" preserveAspectRatio="none" aria-hidden="true"><rect x="${x}" y="2" width="${width}" height="8" rx="3"></rect></svg></i></button>`;
}

function renderBrainState() {
  const context = document.querySelector('[data-vnext-brain-context]');
  if (!context) return;
  document.querySelectorAll('[data-vnext-online], [data-vnext-network]').forEach((node) => {
    node.textContent = 'STUDIO';
    node.dataset.pvConnectivityHidden = 'true';
  });
  const graph = runtime.graph;
  if (!graph?.project?.id) {
    context.innerHTML = `<small>CONTEXTO</small><b>Sem projeto aberto</b><p>Pablo continua disponível para começar uma ideia. Nenhuma ação é fingida sem um projeto real.</p>`;
    return;
  }
  const latest = graph.songCreation?.latestTake || null;
  const sections = graph.structure?.sections?.length || 0;
  const tracks = graph.tracks?.length || 0;
  context.innerHTML = `<small>CONTEXTO DO CÉREBRO</small><b>${escapeHtml(graph.project.name)}</b><p>${tracks} faixa(s) · ${sections} seção(ões) · ${graph.songCreation?.takeCount || 0} take(s)</p><div><span>${latest?.bpm ? `${latest.bpm} BPM` : 'BPM livre'}</span><span>${latest?.key ? escapeHtml(latest.key) : 'tom não fixado'}</span><span>${graph.project.revisionCount || 0} revisões</span></div>`;
}

function updateProjectMeta(meta = document.querySelector('[data-vnext-project-meta]')) {
  if (!meta) return;
  const graph = runtime.graph;
  const name = graph?.project?.name || runtime.project?.name || 'Nenhum projeto aberto';
  const take = graph?.songCreation?.latestTake || null;
  const bpm = take?.bpm || graph?.labs?.instrument?.bpm || null;
  const key = take?.key || null;
  const detail = graph?.project?.id
    ? [bpm ? `${bpm} BPM` : null, key, `${graph.tracks?.length || 0} faixa(s)`, `${graph.songCreation?.takeCount || 0} take(s)`].filter(Boolean).join(' · ')
    : 'Comece uma ideia ou abra um projeto.';
  setText(meta.querySelector('[data-vnext-project-name]'), name);
  setText(meta.querySelector('[data-vnext-project-detail]'), detail);
}

async function refreshGraph() {
  clearTimeout(runtime.graphRefreshTimer);
  try {
    const project = await currentProject();
    runtime.project = project;
    runtime.graph = project ? (await buildUnifiedProjectContext(project))?.graph || null : null;
  } catch (error) {
    console.warn('PABLOVOICE_VNEXT_GRAPH_UNAVAILABLE', error);
    runtime.graph = null;
  }
  queueSync();
}

function onProjectMutation() {
  clearTimeout(runtime.graphRefreshTimer);
  runtime.graphRefreshTimer = setTimeout(refreshGraph, 160);
}

function onClick(event) {
  const companion = event.target.closest('[data-vnext-companion]');
  if (companion) {
    event.preventDefault();
    setCompanion(companion.dataset.vnextCompanion);
    return;
  }
  if (event.target.closest('[data-vnext-visualizer-prev]')) { event.preventDefault(); shiftCompanion(-1); return; }
  if (event.target.closest('[data-vnext-visualizer-next]')) { event.preventDefault(); shiftCompanion(1); return; }
  const track = event.target.closest('[data-vnext-track]');
  if (track) { event.preventDefault(); openTrack(track.dataset.vnextTrack); return; }
  const commandButton = event.target.closest('[data-vnext-command]');
  if (commandButton) {
    event.preventDefault();
    runCommand(commandButton.dataset.vnextCommand);
    return;
  }
  const source = event.target.closest('button, [data-action]');
  if (!source) return;
  if (source.matches('[data-beat-lab-open], [data-beat-play]')) setCompanion('note');
  if (source.matches('[data-section-map-open], [data-section-regenerate]')) setCompanion('wave');
  if (source.matches('[data-instrument-open]')) setCompanion('star');
  if (source.matches('[data-action="studio-tab"][data-value="voice"], [data-pv-studio-step="voice"]')) setCompanion('eq');
  if (source.matches('[data-action="studio-tab"][data-value="mixer"], [data-action="export"], [data-pv-studio-step="export"]')) setCompanion('vinyl');
  if (source.matches('[data-song-create-button], [data-song-create-hq], [data-pv-create]')) setCompanion('star');
  if (source.matches('[data-route="compose"]')) setCompanion('chime');
}

function onSubmit(event) {
  const form = event.target.closest('[data-vnext-pablo-form]');
  if (!form) return;
  event.preventDefault();
  const message = String(new FormData(form).get('message') || '').trim();
  if (!message) return;
  const input = form.querySelector('input[name="message"]');
  if (input) input.value = '';
  forwardToPablo(message);
}

function runCommand(command) {
  if (command === 'home') return forwardRoute('home');
  if (command === 'create') { setCompanion('star'); return forwardRoute('compose'); }
  if (command === 'pablo') return forwardRoute('pablo');
  if (command === 'lyrics') { setCompanion('chime'); forwardRoute('compose'); return later(() => document.querySelector('#lyrics')?.focus()); }
  if (command === 'beat') { setCompanion('note'); return inStudio('[data-beat-lab-open]'); }
  if (command === 'instrument') { setCompanion('star'); return inStudio('[data-instrument-open]'); }
  if (command === 'vocal') { setCompanion('eq'); return inStudio('[data-action="studio-tab"][data-value="voice"]'); }
  if (command === 'record') return clickFirst('[data-action="record"], [data-pv-record]');
  if (command === 'mixer') { setCompanion('vinyl'); return inStudio('[data-action="studio-tab"][data-value="mixer"]'); }
  if (command === 'arrangement') { setCompanion('wave'); return inStudio('[data-section-map-open]'); }
  if (command === 'master' || command === 'export') { setCompanion('vinyl'); return inStudio('[data-action="studio-tab"][data-value="export"]'); }
  if (command === 'stems') return inStudio('[data-pv-studio-stems], #pv-stems-canary-run');
  if (command === 'ab') return toggleAB();
  if (command === 'takes') return showTakeSummary();
  if (command === 'visualizer') return document.querySelector('[data-vnext-visualizer]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (command === 'play') return clickFirst('[data-action="play"]');
}

function forwardRoute(route) {
  document.querySelector(`.pv-nav [data-route="${route}"]`)?.click();
}

function inStudio(selector) {
  const trigger = document.querySelector(selector);
  if (trigger && !trigger.disabled) return trigger.click();
  forwardRoute('studio');
  later(() => {
    const next = document.querySelector(selector);
    if (next && !next.disabled) next.click();
    else toast('Abra ou crie um projeto para usar esta ferramenta.', 'error');
  }, 90);
}

function openTrack(trackId) {
  if (!trackId) return;
  inStudio('[data-action="studio-tab"][data-value="mixer"]');
  later(() => document.querySelector(`[data-action="select-track"][data-id="${cssEscape(trackId)}"]`)?.click(), 140);
}

function toggleAB() {
  const buttons = [...document.querySelectorAll('.pv-ab-switch [data-action="ab"]')];
  if (!buttons.length) return inStudio('[data-action="studio-tab"][data-value="voice"]');
  const active = buttons.findIndex((button) => button.classList.contains('active'));
  buttons[(active + 1 + buttons.length) % buttons.length]?.click();
}

function showTakeSummary() {
  const count = runtime.graph?.songCreation?.takeCount || 0;
  const latest = runtime.graph?.songCreation?.latestTake;
  toast(count ? `${count} take(s) no projeto${latest?.provider ? ` · último: ${latest.provider}` : ''}.` : 'Ainda não há takes de geração neste projeto.', count ? 'ok' : '');
}

function forwardToPablo(message) {
  forwardRoute('pablo');
  later(() => {
    const form = document.querySelector('[data-pablo-form]');
    const input = form?.querySelector('input[name="message"]');
    if (!form || !input) return toast('O Pablo Brain ainda está carregando.', 'error');
    input.value = message;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit?.();
  }, 120);
}

function setCompanion(id) {
  if (!COMPANIONS.some((item) => item.id === id)) return;
  runtime.activeCompanion = id;
  renderIdleVisualizer();
}

function shiftCompanion(direction) {
  const index = COMPANIONS.findIndex((item) => item.id === runtime.activeCompanion);
  setCompanion(COMPANIONS[(index + direction + COMPANIONS.length) % COMPANIONS.length].id);
}

function renderIdleVisualizer() {
  const visualizer = document.querySelector('[data-vnext-visualizer]');
  if (!visualizer || visualizer.dataset.vnextReactionState === 'playing') return;
  const spec = COMPANIONS.find((item) => item.id === runtime.activeCompanion) || COMPANIONS[0];
  const sprite = visualizer.querySelector('[data-vnext-active-sprite]');
  if (sprite) {
    sprite.className = `pv-canon-companion-sprite ${spec.id}`;
    sprite.setAttribute('aria-label', spec.name);
  }
  setText(visualizer.querySelector('[data-vnext-now-name]'), spec.name);
  setText(visualizer.querySelector('[data-vnext-now-base]'), spec.base);
  setText(visualizer.querySelector('[data-vnext-now-copy]'), 'PRONTO PARA TOCAR');
  setText(visualizer.querySelector('[data-vnext-visualizer-state]'), 'PRONTO');
  visualizer.dataset.vnextReactive = 'music-graph';
  visualizer.dataset.vnextReactionState = 'ready';
  document.querySelectorAll('[data-vnext-companion]').forEach((button) => button.classList.toggle('active', button.dataset.vnextCompanion === spec.id));
}

function updatePlayhead() {
  const marker = document.querySelector('[data-vnext-playhead]');
  if (!marker || !runtime.graph?.structure?.durationSeconds) return;
  const readout = document.querySelector('#current-time')?.textContent || document.querySelector('.pv-transport span')?.textContent || '0:00';
  const seconds = parseTime(readout);
  const x = Math.round(Math.max(0, Math.min(1000, (seconds / runtime.graph.structure.durationSeconds) * 1000)));
  marker.setAttribute('x1', String(x));
  marker.setAttribute('x2', String(x));
}

async function currentProject() {
  const activeId = activeProjectSessionId();
  if (activeId) {
    const active = await getProject(activeId);
    if (active) return active;
  }
  return (await listProjects())[0] || null;
}

function activeRoute() {
  return document.querySelector('.pv-nav [data-route].active')?.dataset.route || (document.querySelector('.pv-transport-card') ? 'studio' : document.querySelector('#lyrics') ? 'compose' : 'home');
}

function roleLabel(role = '') {
  const labels = {
    'lead-vocal': 'voz principal', 'harmony-vocal': 'harmonia', 'voice-variant': 'variação vocal', 'stem-vocal': 'stem vocal',
    drums: 'bateria', bass: 'baixo', synth: 'synth', guitar: 'guitarra', instrument: 'instrumento', 'stem-instrumental': 'stem instrumental',
  };
  return labels[role] || String(role || 'áudio').replaceAll('-', ' ');
}

function formatSeconds(value) {
  const seconds = Math.max(0, Number(value || 0));
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function parseTime(value) {
  const match = String(value || '').match(/(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function clickFirst(selector) {
  const target = document.querySelector(selector);
  if (target && !target.disabled) target.click();
  else toast('Essa ação precisa de um projeto ou faixa ativa.', 'error');
}

function later(fn, delay = 60) { setTimeout(fn, delay); }

function toast(message, kind = '') {
  const wrap = document.querySelector('[data-toasts]');
  if (!wrap) return;
  const item = document.createElement('div');
  item.className = `pv-toast ${kind}`;
  item.textContent = message;
  wrap.appendChild(item);
  setTimeout(() => item.remove(), 3200);
}

function setText(node, value) { if (node && node.textContent !== String(value ?? '')) node.textContent = String(value ?? ''); }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;' })[char]); }
function cssEscape(value = '') { return globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }

export const PABLOVOICE_VNEXT_COMPANIONS = COMPANIONS;
export const PABLOVOICE_VNEXT_EXPERIENCE = EXPERIENCE;
export const PABLOVOICE_VNEXT_UI_POLICY = Object.freeze({
  strictCspNoInlineStyle: true,
  musicGraphArrangementGeometry: 'svg-attributes',
  unifiedStudioLanguage: true,
  delegatesToExistingProductHooks: true,
});
