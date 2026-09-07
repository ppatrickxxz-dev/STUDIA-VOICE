const PABLO_ASSET = '/site/assets/pablo_fullbody.webp';
const COMPANIONS_ASSET = '/site/assets/companions_board.webp';

export const CANONICAL_COMPANIONS = Object.freeze([
  ['Nota Drop', 'Melodia e ideias'],
  ['Star Spark', 'Inspiração e brilho'],
  ['Wave Ribbon', 'Fluxo e arranjo'],
  ['EQ Bloom', 'Timbre e equilíbrio'],
  ['Chime Lantern', 'Atmosfera e transições'],
  ['Vinyl Groove', 'Groove e textura'],
]);

const PROVIDER_COPY = Object.freeze([
  [/ElevenLabs/gi, 'motor de alta qualidade'],
  [/Eleven Music/gi, 'motor de alta qualidade'],
  [/Music v2/gi, 'motor de alta qualidade'],
  [/\bSuno\b/gi, 'referência externa'],
]);

let observer = null;
let queued = false;

export function installCanonicalUI() {
  if (observer) return () => observer.disconnect();
  document.documentElement.dataset.pvUiCanon = 'retro-tape-onyx-galaxy-v1';
  observer = new MutationObserver(queueDecorate);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  queueDecorate();
  return () => {
    observer?.disconnect();
    observer = null;
  };
}

function queueDecorate() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    decorateCanonicalUI();
  });
}

function decorateCanonicalUI() {
  decorateBrand();
  document.querySelectorAll('.pv-companion').forEach(decoratePablo);
  decorateHome();
  decorateCreator();
  decoratePabloRoute();
  scrubProviderBranding(document.querySelector('#app'));
}

function decorateBrand() {
  const brand = document.querySelector('.pv-brand');
  if (!brand || brand.dataset.canon === 'true') return;
  brand.dataset.canon = 'true';
  brand.classList.add('pv-brand-canon');
  brand.setAttribute('title', 'PabloVoice · Retro Tape + Ônix Galáxia');
}

function decoratePablo(node) {
  if (node.dataset.canon === 'true') return;
  const state = node.dataset.state || 'idle';
  const status = state === 'listen' ? 'ouvindo sua voz' : state === 'speak' ? 'criando com você' : 'pronto para criar';
  node.dataset.canon = 'true';
  node.innerHTML = `
    <div class="pv-canon-pablo-card" aria-label="Pablo, companion canônico do PabloVoice">
      <div class="pv-canon-pablo-orbit" aria-hidden="true"></div>
      <img class="pv-canon-pablo" src="${PABLO_ASSET}" alt="Pablo canônico">
      <div class="pv-canon-pablo-copy">
        <div class="pv-canon-pablo-label"><span class="pv-live-dot"></span>Pablo IA</div>
        <strong>${state === 'listen' ? 'Tô te ouvindo.' : state === 'speak' ? 'Sente essa ideia.' : 'Tô contigo.'}</strong>
        <span>${state === 'listen' ? 'Grava tranquilo. A música continua sendo sua.' : state === 'speak' ? 'Vamos ouvir, comparar e mexer só no que precisar.' : 'Da ideia ao master, sem tirar o controle da sua mão.'}</span>
      </div>
    </div>
    <div class="pv-companion-status"><span class="pv-live-dot"></span>${status}</div>`;
}

function decorateHome() {
  const hero = [...document.querySelectorAll('.pv-hero:not(.compact)')].find((item) => /Você tá no/i.test(item.textContent || ''));
  if (!hero) return;
  hero.classList.add('pv-canon-home-hero');
  if (!hero.querySelector('[data-canon-home-actions]')) {
    const actions = document.createElement('div');
    actions.dataset.canonHomeActions = 'true';
    actions.className = 'pv-canon-home-actions';
    actions.innerHTML = `
      <button class="pv-btn primary" data-route="compose">♫ Criar música</button>
      <button class="pv-btn" data-route="studio">◉ Abrir Studio</button>
      <span>IDEIA → MÚSICA → VOZ → MIX → MASTER</span>`;
    hero.appendChild(actions);
  }

  const grid = document.querySelector('.pv-home-grid');
  if (!grid || document.querySelector('[data-canon-companions]')) return;
  const shelf = document.createElement('article');
  shelf.dataset.canonCompanions = 'true';
  shelf.className = 'pv-card pv-canon-companions';
  shelf.innerHTML = `
    <div class="pv-card-head">
      <div><h3>Seus Companions</h3><p>Seis perspectivas canônicas. Cada um aparece quando sua função musical fizer sentido.</p></div>
      <span class="pv-tag">CANON</span>
    </div>
    <div class="pv-canon-companion-layout">
      <img src="${COMPANIONS_ASSET}" alt="Board canônico dos seis Companions do PabloVoice">
      <div class="pv-canon-companion-grid">${CANONICAL_COMPANIONS.map(([name, role]) => `<div><b>${name}</b><span>${role}</span></div>`).join('')}</div>
    </div>`;
  grid.insertAdjacentElement('afterend', shelf);
}

function decorateCreator() {
  const creator = document.querySelector('#pv-song-creator');
  if (!creator) return;

  // Music creation is the primary action of Compor. Keep it immediately after
  // the lyric/analysis grid instead of allowing provider/activation panels to
  // push the Creator below secondary tools.
  const lyricsGrid = document.querySelector('#lyrics')?.closest('.pv-grid');
  if (lyricsGrid && creator.previousElementSibling !== lyricsGrid) {
    lyricsGrid.insertAdjacentElement('afterend', creator);
  }

  if (creator.dataset.canon === 'true') return;
  creator.dataset.canon = 'true';
  creator.classList.add('pv-canon-creator');
  const head = document.createElement('div');
  head.className = 'pv-canon-creator-banner';
  head.innerHTML = `
    <div><span>CRIAR MÚSICA</span><strong>Comece pela letra ou pelo instrumental.</strong><small>Pablo organiza a ideia; você escolhe o que fica.</small></div>
    <img src="${PABLO_ASSET}" alt="Pablo canônico acompanhando a criação">`;
  creator.prepend(head);
}

function decoratePabloRoute() {
  const hero = [...document.querySelectorAll('.pv-hero.compact')].find((item) => /Pablo/i.test(item.textContent || ''));
  if (hero) hero.classList.add('pv-canon-pablo-route');
}

function scrubProviderBranding(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent || parent.closest('code, pre, [data-provider-technical]')) continue;
    let value = node.nodeValue || '';
    for (const [pattern, replacement] of PROVIDER_COPY) value = value.replace(pattern, replacement);
    if (value !== node.nodeValue) node.nodeValue = value;
  }
}

installCanonicalUI();
