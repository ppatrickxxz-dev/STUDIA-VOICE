const UX_VERSION = 'creator-first-v2';

const ROUTE_CONTEXT = Object.freeze({
  home: { companion: 'Star Spark', role: 'inspiração e começo rápido', title: 'O que vamos criar hoje?', copy: 'Me dá a intenção. A gente transforma isso em música sem começar pela parte técnica.' },
  compose: { companion: 'Nota Drop', role: 'melodia, letra e direção', title: 'Me conta a ideia.', copy: 'Eu organizo letra, estrutura e direção musical; você decide o que fica.' },
  projects: { companion: 'Chime Lantern', role: 'continuidade e memória', title: 'Continuamos de onde parou.', copy: 'Seus takes, versões e decisões continuam juntos no mesmo projeto.' },
  pablo: { companion: 'EQ Bloom', role: 'escuta e refinamento', title: 'Tô ouvindo o projeto inteiro.', copy: 'Posso ajudar a decidir o próximo ajuste sem esconder o que foi feito.' },
  studio: { companion: 'Wave Ribbon', role: 'arranjo e fluxo', title: 'Escolhe o trecho.', copy: 'Ajuste, compare e refaça só o que precisar. O resto da música fica preservado.' },
});

let observer = null;
let queued = false;
let pendingNewSong = false;
let pendingOnlineAction = null;
let onlineUnlocked = false;

export function installProductUX() {
  if (observer) return () => observer.disconnect();
  document.documentElement.dataset.pvProductUx = UX_VERSION;
  observer = new MutationObserver(queueDecorate);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('click', handleEarlyClick, true);
  window.addEventListener('submit', handleEarlySubmit, true);
  document.addEventListener('pablovoice:remote-authenticated', handleRemoteAuthenticated);
  queueDecorate();
  return () => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener('click', handleEarlyClick, true);
    window.removeEventListener('submit', handleEarlySubmit, true);
    document.removeEventListener('pablovoice:remote-authenticated', handleRemoteAuthenticated);
  };
}

function queueDecorate() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    decorate();
  });
}

function decorate() {
  const route = activeRoute();
  document.documentElement.dataset.pvActiveRoute = route;
  decorateHome(route);
  decorateCompose(route);
  decorateStudio(route);
  decoratePabloRoute(route);
  decoratePairing();
  decorateContextCompanion(route);
  continueNewSongFlow(route);
}

function activeRoute() {
  return document.querySelector('.pv-nav [data-route].active')?.dataset.route ||
    (document.querySelector('#lyrics') ? 'compose' : document.querySelector('.pv-transport-card') ? 'studio' : 'home');
}

function decorateHome(route) {
  if (route !== 'home') return;
  document.querySelector('.pv-cap-card')?.classList.add('pv-product-diagnostics-hidden');

  const primaryCard = document.querySelector('.pv-home-grid > .pv-card.chrome');
  primaryCard?.classList.add('pv-product-home-primary');
  const headTitle = primaryCard?.querySelector('.pv-card-head h2');
  if (headTitle) headTitle.textContent = document.querySelector('.pv-project-now') ? 'Continue sua música' : 'Comece uma música';
  const localTag = primaryCard?.querySelector('.pv-card-head .pv-tag');
  if (localTag) localTag.textContent = 'SALVO';

  const newProject = document.querySelector('.pv-home-grid [data-action="new-project"] span');
  if (newProject) newProject.innerHTML = 'Nova música<small>comece do zero</small>';
  const importAudio = document.querySelector('.pv-home-grid [data-action="import"] span');
  if (importAudio) importAudio.innerHTML = 'Importar áudio<small>traga uma base, demo ou vocal</small>';
  const record = document.querySelector('.pv-home-grid [data-action="record"] span');
  if (record) record.innerHTML = 'Gravar minha voz<small>capture uma ideia ou take</small>';
  const projects = document.querySelector('.pv-home-grid [data-route="projects"] span');
  if (projects) projects.innerHTML = 'Continuar projeto<small>volte aos seus takes e versões</small>';

  compactCompanionShelf();
}

function compactCompanionShelf() {
  const shelf = document.querySelector('[data-canon-companions]');
  if (!shelf) return;
  shelf.classList.add('pv-product-companions');
  const layout = shelf.querySelector('.pv-canon-companion-layout');
  const board = layout?.querySelector(':scope > img');
  if (!layout || !board || board.closest('details')) return;

  const details = document.createElement('details');
  details.className = 'pv-product-companion-board';
  const summary = document.createElement('summary');
  summary.innerHTML = '<strong>Ver universo dos Companions</strong><span>board canônico</span>';
  details.append(summary, board);
  layout.prepend(details);
}

function decorateCompose(route) {
  if (route !== 'compose') return;
  const hero = document.querySelector('.pv-hero.compact');
  if (hero && !hero.dataset.productCopy) {
    hero.dataset.productCopy = 'true';
    const kicker = hero.querySelector('.pv-kicker');
    const title = hero.querySelector('.pv-title');
    const lead = hero.querySelector('.pv-lead');
    if (kicker) kicker.textContent = 'Criar · letra e música';
    if (title) title.innerHTML = 'Transforme uma <em>ideia em música.</em>';
    if (lead) lead.textContent = 'Escreva, peça ajuda ao Pablo, crie uma ideia rápida ou produza uma versão completa — tudo no mesmo projeto.';
  }

  const creator = document.querySelector('#pv-song-creator');
  if (!creator) return;
  creator.classList.add('pv-product-creator');
  simplifyCreatorForm(creator);
  integrateComposer(creator);
}

function simplifyCreatorForm(creator) {
  const form = creator.querySelector('[data-song-create-form]');
  if (!form) return;

  const brief = form.querySelector('input[name="brief"]')?.closest('label');
  if (brief) {
    brief.classList.add('pv-product-main-prompt');
    const input = brief.querySelector('input');
    if (input) input.placeholder = 'Ex.: pop R&B sensual, noite, synths, grave redondo, refrão grande…';
  }

  let details = form.querySelector('.pv-creator-advanced');
  if (!details) {
    details = document.createElement('details');
    details.className = 'pv-creator-advanced';
    details.innerHTML = '<summary><span>Ajustar detalhes</span><small>estilo · BPM · duração · tom · clima · evitar</small></summary><div class="pv-creator-advanced-body"></div>';
    const modeGrid = form.querySelector('.pv-song-mode-grid');
    modeGrid?.insertAdjacentElement('beforebegin', details);
    const body = details.querySelector('.pv-creator-advanced-body');
    const candidates = [
      form.querySelector('.pv-song-fields'),
      form.querySelector('[name="mood"]')?.closest('label'),
      form.querySelector('[name="negative"]')?.closest('label'),
      form.querySelector('.pv-song-start-mode'),
    ].filter(Boolean);
    for (const node of candidates) body.appendChild(node);
  }

  const cards = [...form.querySelectorAll('.pv-song-mode-card')];
  if (cards[0]) {
    const strong = cards[0].querySelector('strong');
    const copy = cards[0].querySelector('span');
    const button = cards[0].querySelector('[data-song-create-button]');
    if (strong) strong.textContent = '⚡ Ideia rápida';
    if (copy) copy.textContent = 'Ouça estrutura, instrumental e guia imediatamente. Funciona no aparelho e vira take editável.';
    if (button && !button.classList.contains('busy')) button.textContent = '♫ Ouvir ideia';
  }
  if (cards[1]) {
    const strong = cards[1].querySelector('strong');
    const copy = cards[1].querySelector('span');
    const button = cards[1].querySelector('[data-song-create-hq]');
    if (strong) strong.textContent = '✦ Produzir música';
    if (copy) copy.textContent = 'Crie uma versão musical completa, salve como novo take e continue editando depois.';
    if (button && !button.classList.contains('busy')) button.textContent = '✦ Produzir música';
  }

  const status = form.querySelector('#pv-song-create-status');
  if (status && !status.dataset.productCopy) {
    status.dataset.productCopy = 'true';
    status.textContent = 'Pablo organiza conceito, letra e estrutura junto do take. Nada substitui suas versões automaticamente.';
  }
}

function integrateComposer(creator) {
  const composer = document.querySelector('#pv-ai-composer');
  if (!composer || composer.closest('.pv-creator-pablo-assistant')) return;

  let details = creator.querySelector('.pv-creator-pablo-assistant');
  if (!details) {
    details = document.createElement('details');
    details.className = 'pv-creator-pablo-assistant';
    details.innerHTML = '<summary><span class="pv-product-pablo-dot">✦</span><div><strong>Pablo, me ajuda com a letra</strong><small>continuar, reescrever ou adaptar sem sair da criação</small></div><b>›</b></summary><div class="pv-product-composer-slot"></div>';
    const result = creator.querySelector('#pv-song-create-result');
    result?.insertAdjacentElement('beforebegin', details);
  }
  const slot = details.querySelector('.pv-product-composer-slot');
  slot?.appendChild(composer);
  composer.classList.add('pv-product-composer-inline');

  const heading = composer.querySelector('h3');
  const paragraph = composer.querySelector('.pv-card-head p');
  const tag = composer.querySelector('.pv-card-head .pv-tag');
  if (heading) heading.textContent = 'Pablo · letra e direção';
  if (paragraph) paragraph.textContent = 'Peça uma mudança, revise o resultado e só aplique se gostar.';
  if (tag) tag.textContent = 'REVISAR';

  const options = composer.querySelectorAll('select[name="command"] option');
  const labels = ['Criar trecho', 'Continuar daqui', 'Reescrever sem perder minha voz', 'Levar para outro estilo'];
  options.forEach((option, index) => { if (labels[index]) option.textContent = labels[index]; });
}

function decoratePairing() {
  const pairing = document.querySelector('#pv-remote-pairing');
  if (!pairing) return;
  pairing.classList.add('pv-online-demand');
  const creator = document.querySelector('#pv-song-creator');
  if (creator && !pairing.closest('#pv-song-creator')) {
    const result = creator.querySelector('#pv-song-create-result');
    result?.insertAdjacentElement('beforebegin', pairing);
  }
  const title = pairing.querySelector('h3');
  const copy = pairing.querySelector('.pv-card-head p');
  if (title) title.textContent = 'Ativar criação completa';
  if (copy) copy.textContent = 'Só aparece quando você pede uma função online. Ative uma vez neste aparelho.';
  if (!pairing.dataset.userVisible) pairing.hidden = true;
}

function showOnlineActivation(pairing, reason = 'Produzir música') {
  pairing.hidden = false;
  pairing.dataset.userVisible = 'true';
  const status = pairing.querySelector('[data-remote-pair-status]');
  if (status) status.textContent = `${reason} usa recursos online. Cole seu código uma vez; depois o PabloVoice reconhece este aparelho.`;
  pairing.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => pairing.querySelector('input[name="code"]')?.focus(), 220);
}

function decorateStudio(route) {
  if (route !== 'studio') return;
  document.querySelector('main')?.classList.add('pv-product-studio');
  const transport = document.querySelector('.pv-transport-card');
  transport?.classList.add('pv-product-transport');

  if (!document.querySelector('.pv-studio-flow-strip')) {
    const actions = document.querySelector('.pv-studio-actions');
    if (actions) {
      const strip = document.createElement('div');
      strip.className = 'pv-studio-flow-strip';
      strip.innerHTML = '<span><i></i> SESSÃO</span><div><b>EDITAR</b><b>VOZ</b><b>ARRANJO</b><b>MIX</b><b>MASTER</b></div>';
      actions.insertAdjacentElement('beforebegin', strip);
    }
  }
}

function decoratePabloRoute(route) {
  if (route !== 'pablo') return;
  const capability = [...document.querySelectorAll('.pv-card')].find((card) => card.querySelector('h3')?.textContent?.trim() === 'Capacidades');
  capability?.classList.add('pv-product-diagnostics-hidden');
  const hero = document.querySelector('.pv-canon-pablo-route');
  const kicker = hero?.querySelector('.pv-kicker');
  const lead = hero?.querySelector('.pv-lead');
  if (kicker) kicker.textContent = 'Pablo IA · contexto do projeto';
  if (lead) lead.textContent = 'Pablo lê o que está no projeto, explica o que percebe e sugere próximos passos sem fingir que fez algo que não fez.';
}

function decorateContextCompanion(route) {
  const hero = route === 'home'
    ? document.querySelector('.pv-canon-home-hero')
    : document.querySelector('.pv-hero.compact');
  if (!hero) return;

  let context = ROUTE_CONTEXT[route] || ROUTE_CONTEXT.home;
  if (route === 'studio') {
    const tab = document.querySelector('.pv-tabs button.active')?.textContent?.trim();
    if (tab === 'Voice Lab') context = { companion: 'EQ Bloom', role: 'timbre e equilíbrio', title: 'Vamos cuidar da voz.', copy: 'Compare A/B e trate sem perder a identidade do take.' };
    else if (tab === 'Mixer') context = { companion: 'Vinyl Groove', role: 'groove e textura', title: 'Agora é encaixe.', copy: 'Equilibre pistas, panorama e energia sem desmontar o arranjo.' };
    else if (tab === 'Exportar') context = { companion: 'Chime Lantern', role: 'transição e fechamento', title: 'Vamos fechar essa versão.', copy: 'Revise o que vai sair e preserve o projeto para continuar depois.' };
  }

  let badge = hero.querySelector('[data-product-context-companion]');
  if (!badge) {
    badge = document.createElement('div');
    badge.dataset.productContextCompanion = 'true';
    badge.className = 'pv-context-companion';
    hero.appendChild(badge);
  }
  badge.innerHTML = `<span>${context.companion}</span><b>${context.title}</b><small>${context.copy}</small><em>${context.role}</em>`;

  document.querySelectorAll('.pv-canon-pablo-copy').forEach((copy) => {
    const title = copy.querySelector('strong');
    const text = copy.querySelector(':scope > span');
    if (title) title.textContent = context.title;
    if (text) text.textContent = context.copy;
  });
}

function handleEarlyClick(event) {
  const target = event.target.closest('button, [data-route], [data-action]');
  if (!target) return;

  if (target.matches('[data-action="close-modal"]') && pendingNewSong) pendingNewSong = false;

  if (target.matches('[data-song-create-hq]')) {
    const pairing = document.querySelector('#pv-remote-pairing');
    if (pairing && !onlineUnlocked) {
      event.preventDefault();
      event.stopImmediatePropagation();
      pendingOnlineAction = { kind: 'click', selector: '[data-song-create-hq]' };
      showOnlineActivation(pairing, 'Produzir música');
      return;
    }
  }

  const heroCreate = target.matches('[data-canon-home-actions] [data-route="compose"]');
  if (heroCreate && !document.querySelector('.pv-project-now')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    pendingNewSong = true;
    document.querySelector('.pv-home-grid [data-action="new-project"]')?.click();
    return;
  }

  if (target.matches('.pv-home-grid [data-action="new-project"]')) pendingNewSong = true;
}

function handleEarlySubmit(event) {
  if (event.target.matches('[data-ai-compose-form]')) {
    const pairing = document.querySelector('#pv-remote-pairing');
    if (pairing && !onlineUnlocked) {
      event.preventDefault();
      event.stopImmediatePropagation();
      pendingOnlineAction = { kind: 'submit', selector: '[data-ai-compose-form]' };
      showOnlineActivation(pairing, 'Pedir ajuda ao Pablo');
    }
  }
}

function handleRemoteAuthenticated() {
  onlineUnlocked = true;
  const action = pendingOnlineAction;
  pendingOnlineAction = null;
  if (!action) return;
  setTimeout(() => {
    const node = document.querySelector(action.selector);
    if (!node) return;
    if (action.kind === 'submit') node.requestSubmit?.();
    else node.click?.();
  }, 40);
}

function continueNewSongFlow(route) {
  if (!pendingNewSong) return;
  if (document.querySelector('.pv-modal-back')) return;
  if (route === 'compose') {
    pendingNewSong = false;
    return;
  }
  const projectReady = Boolean(document.querySelector('.pv-project-now') || document.querySelector('.pv-studio-actions'));
  if (!projectReady) return;
  const compose = document.querySelector('.pv-nav [data-route="compose"]');
  if (!compose) return;
  pendingNewSong = false;
  compose.click();
}

installProductUX();
