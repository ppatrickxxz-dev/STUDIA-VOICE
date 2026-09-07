import { RemoteAuthAdapter } from './remote-auth.mjs';

const EXPERIENCE = 'intimate-recorder-v1';
const PABLO_STATES = Object.freeze(['idle', 'listening', 'thinking', 'recording', 'happy', 'dancing']);
const COMPANIONS = Object.freeze([
  { id: 'star', name: 'Star Spark', mark: '✦', role: 'ideia e faísca', action: 'create' },
  { id: 'note', name: 'Nota Drop', mark: '♪', role: 'letra e melodia', action: 'compose' },
  { id: 'wave', name: 'Wave Ribbon', mark: '〰', role: 'seções e arranjo', action: 'sections' },
  { id: 'vinyl', name: 'Vinyl Groove', mark: '◉', role: 'beat e groove', action: 'beat' },
  { id: 'eq', name: 'EQ Bloom', mark: '≋', role: 'voz e timbre', action: 'voice' },
  { id: 'chime', name: 'Chime Lantern', mark: '◇', role: 'fechamento e master', action: 'export' },
]);

const CONTEXT = Object.freeze({
  home: { companion: 'Star Spark', state: 'idle', line: 'Me conta a intenção. Eu seguro o resto do estúdio com você.' },
  compose: { companion: 'Nota Drop', state: 'listening', line: 'Pode começar por uma frase, por uma letra ou só pelo som que você quer sentir.' },
  studio: { companion: 'Wave Ribbon', state: 'idle', line: 'Escolhe um trecho. A gente mexe nele sem desmontar o resto.' },
  projects: { companion: 'Chime Lantern', state: 'idle', line: 'Seus takes continuam aqui. Nada precisa recomeçar.' },
  pablo: { companion: 'EQ Bloom', state: 'listening', line: 'Tô ouvindo o projeto inteiro, não só um botão.' },
});

const runtime = {
  observer: null,
  queued: false,
  stateTimer: 0,
  pendingCreation: null,
  pendingOnlineButton: null,
  network: navigator.onLine === false ? 'offline' : 'online',
  auth: null,
};

export function installPabloVoiceIntimateUI() {
  if (runtime.observer) return () => runtime.observer.disconnect();
  document.documentElement.dataset.pvExperience = EXPERIENCE;
  runtime.auth = new RemoteAuthAdapter();
  runtime.observer = new MutationObserver(queueDecorate);
  runtime.observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('online', onNetworkChange);
  window.addEventListener('offline', onNetworkChange);
  window.addEventListener('click', onEarlyClick, true);
  window.addEventListener('submit', onEarlySubmit, true);
  document.addEventListener('input', onCreativeInput, true);
  document.addEventListener('pablovoice:remote-authenticated', onRemoteAuthenticated);
  queueDecorate();
  return () => {
    runtime.observer?.disconnect();
    runtime.observer = null;
    window.removeEventListener('online', onNetworkChange);
    window.removeEventListener('offline', onNetworkChange);
    window.removeEventListener('click', onEarlyClick, true);
    window.removeEventListener('submit', onEarlySubmit, true);
    document.removeEventListener('input', onCreativeInput, true);
    document.removeEventListener('pablovoice:remote-authenticated', onRemoteAuthenticated);
    clearTimeout(runtime.stateTimer);
  };
}

function queueDecorate() {
  if (runtime.queued) return;
  runtime.queued = true;
  queueMicrotask(() => {
    runtime.queued = false;
    decorate();
  });
}

function decorate() {
  setNetworkMode();
  const route = activeRoute();
  document.documentElement.dataset.pvIntimateRoute = route;
  decorateTopbar();
  decorateHome(route);
  decorateCreator(route);
  decorateStudio(route);
  decoratePabloRoute(route);
  continuePendingCreation(route);
  if (!document.documentElement.dataset.pvPabloState) setPabloState(CONTEXT[route]?.state || 'idle', CONTEXT[route]?.line);
}

function activeRoute() {
  return document.querySelector('.pv-nav [data-route].active')?.dataset.route ||
    (document.querySelector('#lyrics') ? 'compose' : document.querySelector('.pv-transport-card') ? 'studio' : 'home');
}

function setNetworkMode() {
  const next = navigator.onLine === false ? 'offline' : 'online';
  runtime.network = next;
  document.documentElement.dataset.pvNetworkMode = next;
  const health = document.querySelector('.pv-health');
  if (health) {
    health.classList.toggle('connected', next === 'online');
    setHtml(health, next === 'online' ? '<span></span>ONLINE · FULL' : '<span></span>OFFLINE · LOCAL');
  }
  document.querySelectorAll('[data-pv-network-copy]').forEach((node) => {
    setText(node, next === 'online' ? 'produção completa conectada' : 'sem rede · criação local preservada');
  });
  applyCreatorNetworkMode();
}

function onNetworkChange() {
  setNetworkMode();
  setPabloState(runtime.network === 'online' ? 'happy' : 'idle', runtime.network === 'online'
    ? 'Voltei pra rede. Produção completa disponível.'
    : 'Sem internet agora. Continuo criando localmente sem perder o projeto.');
  queueDecorate();
}

function decorateTopbar() {
  const brand = document.querySelector('.pv-brand');
  brand?.classList.add('pv-intimate-brand');
  const settings = document.querySelector('[data-action="settings"]');
  if (settings && !settings.dataset.pvCrystal) {
    settings.dataset.pvCrystal = 'true';
    settings.setAttribute('title', 'Sistema, histórico e diagnóstico');
  }
}

function decorateHome(route) {
  if (route !== 'home') return;
  const main = document.querySelector('main');
  const hero = main?.querySelector('.pv-hero');
  const homeGrid = main?.querySelector('.pv-home-grid');
  if (!main || !hero || !homeGrid) return;

  hero.classList.add('pv-intimate-home-hero');
  const kicker = hero.querySelector('.pv-kicker');
  const lead = hero.querySelector('.pv-lead');
  if (kicker) setText(kicker, 'PabloVoice · pocket music studio');
  if (lead) setText(lead, 'Sua ideia ganha som, versões e memória. Online por padrão; local só quando a rede some.');

  document.querySelector('.pv-cap-card')?.classList.add('pv-intimate-diagnostics');
  homeGrid.classList.add('pv-intimate-utility-grid');

  let stage = document.querySelector('#pv-intimate-home');
  if (!stage) {
    stage = document.createElement('section');
    stage.id = 'pv-intimate-home';
    stage.className = 'pv-intimate-stage';
    stage.innerHTML = homeStageMarkup();
    hero.insertAdjacentElement('afterend', stage);
  }
  refreshHomeStage(stage);
}

function homeStageMarkup() {
  return `<div class="pv-pocket-recorder" data-pv-pablo-device>
    <i class="pv-recorder-screw s1"></i><i class="pv-recorder-screw s2"></i><i class="pv-recorder-screw s3"></i><i class="pv-recorder-screw s4"></i>
    <div class="pv-recorder-head"><span>PABLOVOICE</span><b data-pv-network-copy>produção completa conectada</b></div>
    <div class="pv-recorder-display">
      <div class="pv-crystal-cluster" aria-hidden="true"><i></i><i></i><i></i></div>
      <img src="/site/assets/pablo_fullbody.webp" class="pv-intimate-pablo" alt="Pablo, companion canônico do PabloVoice">
      <div class="pv-pablo-state-readout"><span data-pv-state-label>IDLE</span><b data-pv-pablo-line>Pronto pra criar com você.</b></div>
      <div class="pv-mini-wave" aria-hidden="true">${'<i></i>'.repeat(22)}</div>
    </div>
    <div class="pv-recorder-meter"><span>MIC</span><div>${'<i></i>'.repeat(12)}</div><b>REC</b></div>
    <div class="pv-tape-counter"><span>MEM</span><strong data-pv-project-counter>00 · 00</strong><span>TAKES</span></div>
    <div class="pv-recorder-controls" aria-hidden="true"><i></i><i></i><b></b><i></i><i></i></div>
  </div>
  <div class="pv-intimate-actions">
    <div class="pv-intimate-prompt"><small>O QUE VAMOS CRIAR HOJE?</small><strong data-pv-home-prompt>Comece de onde estiver.</strong></div>
    <div class="pv-intimate-action-grid">
      <button class="pv-intimate-action primary" type="button" data-pv-create="song"><span>♪</span><b>Criar música</b><small>letra, instrumental, guia e takes</small></button>
      <button class="pv-intimate-action" type="button" data-pv-create="instrumental"><span>▥</span><b>Criar instrumental</b><small>comece pelo groove e arranjo</small></button>
      <button class="pv-intimate-action" type="button" data-pv-continue><span>▶</span><b>Continuar projeto</b><small>volte ao último take</small></button>
      <button class="pv-intimate-action" type="button" data-pv-record><span>●</span><b>Gravar voz</b><small>ideia, guia ou take final</small></button>
    </div>
    ${companionDockMarkup()}
  </div>`;
}

function companionDockMarkup() {
  return `<div class="pv-companion-dock" data-pv-companions><div class="pv-companion-dock-head"><div><small>COMPANIONS</small><b>Seu estúdio tem companhia.</b></div><button type="button" data-pv-show-board>ver canon</button></div>
    <div class="pv-companion-crystals">${COMPANIONS.map((item) => `<button type="button" data-pv-companion="${item.id}" title="${item.name} · ${item.role}"><span class="pv-crystal-token">${item.mark}</span><b>${item.name}</b><small>${item.role}</small></button>`).join('')}</div>
    <details class="pv-companion-board"><summary>Board canônico dos Companions</summary><img src="/site/assets/companions_board.webp" alt="Board canônico dos seis Companions do PabloVoice"></details>
  </div>`;
}

function refreshHomeStage(stage) {
  const project = document.querySelector('.pv-project-now');
  const projectName = project?.querySelector('b')?.textContent?.trim();
  const trackCopy = project?.querySelector('small')?.textContent?.trim();
  const prompt = stage.querySelector('[data-pv-home-prompt]');
  setText(prompt, projectName ? `${projectName}${trackCopy ? ` · ${trackCopy}` : ''}` : 'Comece por uma sensação, uma letra ou uma batida.');
  const counter = stage.querySelector('[data-pv-project-counter]');
  const trackMatch = String(document.querySelector('.pv-home-grid h2 + p')?.textContent || '').match(/(\d+)\s+faixa/i);
  setText(counter, `${projectName ? '01' : '00'} · ${String(Number(trackMatch?.[1] || 0)).padStart(2, '0')}`);
  syncPabloReadout(stage);
}

function decorateCreator(route) {
  if (route !== 'compose') return;
  const hero = document.querySelector('.pv-hero.compact');
  if (hero) {
    hero.classList.add('pv-intimate-compose-hero');
    const kicker = hero.querySelector('.pv-kicker');
    const lead = hero.querySelector('.pv-lead');
    if (kicker) setText(kicker, 'Criar · Pablo + PMI + Wave');
    if (lead) setText(lead, 'Descreva a música como você falaria com um produtor. Pablo organiza intenção, letra, estrutura e mudanças reversíveis.');
  }

  const creator = document.querySelector('#pv-song-creator');
  if (!creator) return;
  creator.classList.add('pv-intimate-creator');
  const form = creator.querySelector('[data-song-create-form]');
  if (!form) return;

  if (!form.querySelector('[data-pv-kind-switch]')) {
    const brief = form.querySelector('input[name="brief"]')?.closest('label');
    const switcher = document.createElement('div');
    switcher.className = 'pv-kind-switch';
    switcher.dataset.pvKindSwitch = 'true';
    switcher.innerHTML = `<button type="button" class="active" data-pv-kind="song"><span>♪</span><b>Música completa</b><small>arranjo + guia + letra opcional</small></button><button type="button" data-pv-kind="instrumental"><span>▥</span><b>Instrumental</b><small>groove, harmonia e seções primeiro</small></button>`;
    brief?.insertAdjacentElement('beforebegin', switcher);
  }

  const briefLabel = form.querySelector('input[name="brief"]')?.closest('label');
  if (briefLabel) {
    briefLabel.classList.add('pv-intimate-main-prompt');
    const first = briefLabel.childNodes[0];
    if (first?.nodeType === Node.TEXT_NODE && first.textContent.trim() !== 'O que você quer ouvir?') first.textContent = 'O que você quer ouvir?\n        ';
    const input = briefLabel.querySelector('input');
    if (input) input.placeholder = 'Ex.: R&B 2000s sensual, baixo redondo, bateria solta, synths escuros, refrão abrindo…';
  }

  wrapAdvancedControls(form);
  ensurePmiWavePreview(form);
  applyCreatorNetworkMode();
  syncCreationKind(form);

  const status = creator.querySelector('#pv-song-create-status');
  if (status) status.classList.add('pv-intimate-pmi-status');
}

function wrapAdvancedControls(form) {
  if (form.querySelector('.pv-intimate-advanced')) return;
  const fields = form.querySelector('.pv-song-fields');
  const mood = form.querySelector('[name="mood"]')?.closest('label');
  const negative = form.querySelector('[name="negative"]')?.closest('label');
  const instrumental = form.querySelector('.pv-song-start-mode');
  if (!fields) return;
  const details = document.createElement('details');
  details.className = 'pv-intimate-advanced';
  details.innerHTML = '<summary><span>Ajustes de produção</span><small>BPM · tom · duração · clima · evitar</small><b>＋</b></summary><div class="pv-intimate-advanced-body"></div>';
  fields.insertAdjacentElement('beforebegin', details);
  const body = details.querySelector('.pv-intimate-advanced-body');
  [fields, mood, negative, instrumental].filter(Boolean).forEach((node) => body.appendChild(node));
}

function ensurePmiWavePreview(form) {
  if (form.querySelector('[data-pv-intent-preview]')) return;
  const brief = form.querySelector('input[name="brief"]')?.closest('label');
  const preview = document.createElement('div');
  preview.className = 'pv-pmi-wave-preview';
  preview.dataset.pvIntentPreview = 'true';
  preview.innerHTML = '<div><span class="pv-crystal-mini">◇</span><b>Pablo entende sua direção</b><small>PMI transforma linguagem musical em decisões de estrutura e execução reversíveis.</small></div><div class="pv-pmi-wave-line" aria-hidden="true">' + '<i></i>'.repeat(28) + '</div><p data-pv-intent-copy>Diga estilo, energia, groove, instrumento ou seção. Ex.: “abre o refrão, menos batestaca e baixo mais solto”.</p>';
  brief?.insertAdjacentElement('afterend', preview);
}

function applyCreatorNetworkMode() {
  const form = document.querySelector('[data-song-create-form]');
  if (!form) return;
  const localCard = form.querySelector('[data-song-create-button]')?.closest('.pv-song-mode-card');
  const onlineCard = form.querySelector('[data-song-create-hq]')?.closest('.pv-song-mode-card');
  const localButton = form.querySelector('[data-song-create-button]');
  const onlineButton = form.querySelector('[data-song-create-hq]');
  if (!localCard || !onlineCard) return;

  localCard.classList.add('pv-local-fallback-card');
  onlineCard.classList.add('pv-online-primary-card');
  const online = runtime.network === 'online';
  localCard.hidden = online;
  onlineCard.hidden = !online;
  if (online) {
    const title = onlineCard.querySelector('strong');
    const copy = onlineCard.querySelector(':scope > span');
    if (title) setText(title, 'Produzir agora');
    if (copy) setText(copy, 'Produção completa conectada. Salva um novo take e mantém guia, estrutura e histórico para continuar editando.');
    if (onlineButton && !onlineButton.classList.contains('busy')) setText(onlineButton, '● Produzir música');
  } else {
    const title = localCard.querySelector('strong');
    const copy = localCard.querySelector(':scope > span');
    if (title) setText(title, 'Criar offline');
    if (copy) setText(copy, 'Sem rede: o motor local cria instrumental WAV + guia e mantém tudo editável no aparelho.');
    if (localButton && !localButton.classList.contains('busy')) setText(localButton, '♫ Criar offline');
  }
  form.dataset.pvNetworkPolicy = online ? 'online_full' : 'offline_local';
}

function syncCreationKind(form) {
  const instrumental = Boolean(form.elements.instrumentalFirst?.checked);
  form.dataset.pvCreationKind = instrumental ? 'instrumental' : 'song';
  form.querySelectorAll('[data-pv-kind]').forEach((button) => button.classList.toggle('active', button.dataset.pvKind === (instrumental ? 'instrumental' : 'song')));
  const onlineButton = form.querySelector('[data-song-create-hq]');
  if (onlineButton && runtime.network === 'online' && !onlineButton.classList.contains('busy')) setText(onlineButton, instrumental ? '● Produzir instrumental' : '● Produzir música');
}

function decorateStudio(route) {
  if (route !== 'studio') return;
  const main = document.querySelector('main');
  const hero = main?.querySelector('.pv-hero.compact');
  const transport = main?.querySelector('.pv-transport-card');
  if (!main || !hero) return;
  main.classList.add('pv-intimate-studio');
  transport?.classList.add('pv-intimate-transport');
  const kicker = hero.querySelector('.pv-kicker');
  if (kicker) setText(kicker, 'Studio · gravador não destrutivo');
  ensureStudioRail(hero);
}

function ensureStudioRail(hero) {
  if (document.querySelector('[data-pv-studio-rail]')) return;
  const rail = document.createElement('div');
  rail.className = 'pv-studio-life-rail';
  rail.dataset.pvStudioRail = 'true';
  rail.innerHTML = `<div class="pv-studio-life-head"><span class="pv-crystal-mini">〰</span><div><b>Wave Ribbon acompanha a sessão</b><small>Editar → Voz → Arranjo → Mix → Master</small></div><em data-pv-studio-state>PRONTO</em></div>
    <div class="pv-studio-life-steps"><button type="button" data-pv-studio-step="edit">EDITAR</button><button type="button" data-pv-studio-step="voice">VOZ</button><button type="button" data-pv-studio-step="sections">ARRANJO</button><button type="button" data-pv-studio-step="mixer">MIX</button><button type="button" data-pv-studio-step="export">MASTER</button></div>`;
  hero.insertAdjacentElement('afterend', rail);
}

function decoratePabloRoute(route) {
  if (route !== 'pablo') return;
  const hero = document.querySelector('.pv-hero.compact');
  if (!hero || hero.querySelector('[data-pv-pablo-intimacy]')) return;
  const panel = document.createElement('div');
  panel.className = 'pv-pablo-intimacy-panel';
  panel.dataset.pvPabloIntimacy = 'true';
  panel.innerHTML = `<div class="pv-pablo-mini-device"><img src="/site/assets/pablo_fullbody.webp" alt="Pablo canônico"><span data-pv-state-label>IDLE</span></div><div><small>PABLO · MEMÓRIA CRIATIVA</small><h2>Ele acompanha decisões, não só comandos.</h2><p data-pv-pablo-line>Posso ouvir, pensar, reagir, explicar uma mudança e manter o que você pediu para preservar.</p><div class="pv-expression-strip">${PABLO_STATES.map((state) => `<button type="button" data-pv-expression="${state}">${stateLabel(state)}</button>`).join('')}</div></div>`;
  hero.appendChild(panel);
  syncPabloReadout(panel);
}

function onEarlySubmit(event) {
  const form = event.target.closest('[data-song-create-form]');
  if (!form || runtime.network !== 'online') return;
  if (event.submitter?.matches('[data-song-create-hq]')) return;
  const onlineButton = form.querySelector('[data-song-create-hq]');
  if (!onlineButton || onlineButton.hidden) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  onlineButton.click();
}

function onEarlyClick(event) {
  const target = event.target.closest('button, [data-route], [data-action]');
  if (!target) return;

  if (target.matches('[data-pv-create]')) {
    event.preventDefault();
    beginCreation(target.dataset.pvCreate === 'instrumental' ? 'instrumental' : 'song');
    return;
  }
  if (target.matches('[data-pv-continue]')) {
    event.preventDefault();
    const current = document.querySelector('.pv-project-now');
    if (current) current.click(); else document.querySelector('[data-route="projects"]')?.click();
    return;
  }
  if (target.matches('[data-pv-record]')) {
    event.preventDefault();
    document.querySelector('[data-action="record"]')?.click();
    setPabloState('recording', 'Tô ouvindo. Pode cantar ou só deixar a ideia sair.');
    return;
  }
  if (target.matches('[data-pv-show-board]')) {
    event.preventDefault();
    const details = target.closest('[data-pv-companions]')?.querySelector('.pv-companion-board');
    if (details) details.open = !details.open;
    return;
  }
  if (target.matches('[data-pv-kind]')) {
    event.preventDefault();
    const form = target.closest('[data-song-create-form]');
    const checkbox = form?.elements?.instrumentalFirst;
    if (checkbox) checkbox.checked = target.dataset.pvKind === 'instrumental';
    if (form) syncCreationKind(form);
    setPabloState('happy', target.dataset.pvKind === 'instrumental' ? 'Beleza. Vamos construir o som antes da voz.' : 'Fechado. Música completa, mas sem perder o controle por seção.');
    return;
  }
  if (target.matches('[data-pv-companion]')) {
    event.preventDefault();
    runCompanion(target.dataset.pvCompanion);
    return;
  }
  if (target.matches('[data-pv-studio-step]')) {
    event.preventDefault();
    runStudioStep(target.dataset.pvStudioStep);
    return;
  }
  if (target.matches('[data-pv-expression]')) {
    event.preventDefault();
    setPabloState(target.dataset.pvExpression, expressionLine(target.dataset.pvExpression), 2600);
    return;
  }

  const hq = target.closest('[data-song-create-hq]');
  if (hq) {
    if (hq.dataset.pvAuthBypass === '1') { delete hq.dataset.pvAuthBypass; return; }
    if (runtime.network === 'offline') {
      event.preventDefault();
      event.stopImmediatePropagation();
      hq.closest('form')?.querySelector('[data-song-create-button]')?.click();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    void authorizeAndContinue(hq);
    return;
  }

  if (target.matches('[data-action="record"]')) setPabloState('recording', 'Tô ouvindo.');
  else if (target.matches('[data-action="play"]')) setPabloState('dancing', 'Essa parte tá tocando. Quero sentir o groove com você.', 3200);
  else if (target.matches('[data-action="stop"]')) setPabloState('idle', 'Parou. O take continua aqui.');
}

async function authorizeAndContinue(button) {
  setPabloState('thinking', 'Preparando a produção completa…');
  const session = await runtime.auth?.ensureSession?.().catch(() => null);
  if (session?.accessToken) {
    button.dataset.pvAuthBypass = '1';
    button.click();
    return;
  }
  runtime.pendingOnlineButton = button;
  document.dispatchEvent(new CustomEvent('pablovoice:request-online-auth', { detail: { reason: button.closest('form')?.dataset.pvCreationKind === 'instrumental' ? 'Produzir instrumental' : 'Produzir música' } }));
  setPabloState('listening', 'Só falta reconhecer este aparelho. Depois a criação online fica no fluxo normal.');
}

function onRemoteAuthenticated() {
  const button = runtime.pendingOnlineButton;
  runtime.pendingOnlineButton = null;
  setPabloState('happy', 'Pronto. Agora seguimos sem sair da música.');
  if (button?.isConnected) {
    button.dataset.pvAuthBypass = '1';
    setTimeout(() => button.click(), 80);
  }
}

function onCreativeInput(event) {
  const target = event.target;
  if (!target.matches('#lyrics, [data-song-create-form] input[name="brief"]')) return;
  setPabloState('listening', target.matches('#lyrics') ? 'Tô lendo enquanto você escreve.' : 'Tô ouvindo a direção musical.', 1100);
  if (target.matches('[data-song-create-form] input[name="brief"]')) updateIntentPreview(target.value);
}

function updateIntentPreview(value) {
  const node = document.querySelector('[data-pv-intent-copy]');
  if (!node) return;
  const text = String(value || '').trim();
  if (!text) return setText(node, 'Diga estilo, energia, groove, instrumento ou seção. Ex.: “abre o refrão, menos batestaca e baixo mais solto”.');
  const hints = [];
  if (/refr[aã]o|chorus|hook/i.test(text)) hints.push('refrão localizado');
  if (/verso|estrofe|verse/i.test(text)) hints.push('verso localizado');
  if (/baixo|bass/i.test(text)) hints.push('baixo');
  if (/bateria|beat|percuss|kick|caixa|snare/i.test(text)) hints.push('groove/bateria');
  if (/synth|pad|pluck|sintet/i.test(text)) hints.push('synth');
  if (/2000|y2k/i.test(text)) hints.push('caráter 2000s');
  if (/menos|sem|evit/i.test(text)) hints.push('restrições explícitas');
  if (/abre|maior|cresce/i.test(text)) hints.push('crescimento de energia');
  setText(node, hints.length ? `Entendi: ${[...new Set(hints)].join(' · ')}. A PMI preserva o que não foi selecionado e mantém revisão/undo.` : 'Direção recebida. Pablo vai combinar conceito, estrutura e linguagem musical antes de gerar.');
}

function beginCreation(kind) {
  runtime.pendingCreation = kind;
  const hasProject = Boolean(document.querySelector('.pv-project-now'));
  if (hasProject) {
    document.querySelector('[data-route="compose"]')?.click();
    setPabloState('happy', kind === 'instrumental' ? 'Vamos começar pelo instrumental.' : 'Vamos criar a música.');
    return;
  }
  document.querySelector('.pv-home-grid [data-action="new-project"]')?.click();
  setPabloState('thinking', 'Abrindo um espaço novo pra essa música.');
}

function continuePendingCreation(route) {
  if (!runtime.pendingCreation) return;
  const modal = document.querySelector('.pv-modal-back');
  if (modal) return;
  if (route !== 'compose') {
    const projectReady = Boolean(document.querySelector('.pv-studio-actions') || document.querySelector('.pv-project-now'));
    if (!projectReady) return;
    document.querySelector('.pv-nav [data-route="compose"]')?.click();
    return;
  }
  const form = document.querySelector('[data-song-create-form]');
  if (!form) return;
  const kind = runtime.pendingCreation;
  runtime.pendingCreation = null;
  const checkbox = form.elements.instrumentalFirst;
  if (checkbox) checkbox.checked = kind === 'instrumental';
  syncCreationKind(form);
  form.querySelector('input[name="brief"]')?.focus();
  setPabloState('happy', kind === 'instrumental' ? 'Som primeiro. Descreve o groove, a textura e como as seções devem crescer.' : 'Pode me dar a letra ou só a direção. A gente constrói daqui.');
}

function runCompanion(id) {
  const item = COMPANIONS.find((candidate) => candidate.id === id);
  if (!item) return;
  setPabloState('happy', `${item.name} entrou: ${item.role}.`, 1700);
  if (item.action === 'create') return beginCreation('song');
  if (item.action === 'compose') return document.querySelector('[data-route="compose"]')?.click();
  if (item.action === 'sections') {
    document.querySelector('[data-route="studio"]')?.click();
    return setTimeout(() => document.querySelector('[data-section-map-open]')?.click(), 120);
  }
  if (item.action === 'beat') {
    document.querySelector('[data-route="studio"]')?.click();
    return setTimeout(() => document.querySelector('[data-beat-lab-open]')?.click(), 120);
  }
  if (item.action === 'voice') {
    document.querySelector('[data-route="studio"]')?.click();
    return setTimeout(() => document.querySelector('[data-action="studio-tab"][data-value="voice"]')?.click(), 120);
  }
  if (item.action === 'export') {
    document.querySelector('[data-route="studio"]')?.click();
    return setTimeout(() => document.querySelector('[data-action="studio-tab"][data-value="export"]')?.click(), 120);
  }
}

function runStudioStep(step) {
  if (step === 'sections') return document.querySelector('[data-section-map-open]')?.click();
  const value = step === 'mixer' ? 'mixer' : step === 'export' ? 'export' : step === 'voice' ? 'voice' : 'edit';
  document.querySelector(`[data-action="studio-tab"][data-value="${value}"]`)?.click();
}

function setPabloState(state, line = '', duration = 0) {
  const safe = PABLO_STATES.includes(state) ? state : 'idle';
  document.documentElement.dataset.pvPabloState = safe;
  document.querySelectorAll('[data-pv-pablo-device], .pv-pablo-mini-device').forEach((node) => node.dataset.pvState = safe);
  document.querySelectorAll('[data-pv-state-label]').forEach((node) => setText(node, stateLabel(safe).toUpperCase()));
  if (line) document.querySelectorAll('[data-pv-pablo-line]').forEach((node) => setText(node, line));
  clearTimeout(runtime.stateTimer);
  if (duration > 0) runtime.stateTimer = setTimeout(() => {
    delete document.documentElement.dataset.pvPabloState;
    queueDecorate();
  }, duration);
}

function syncPabloReadout(scope = document) {
  const state = document.documentElement.dataset.pvPabloState || CONTEXT[activeRoute()]?.state || 'idle';
  scope.querySelectorAll('[data-pv-state-label]').forEach((node) => setText(node, stateLabel(state).toUpperCase()));
  const defaultLine = CONTEXT[activeRoute()]?.line || CONTEXT.home.line;
  scope.querySelectorAll('[data-pv-pablo-line]').forEach((node) => { if (!node.textContent.trim()) setText(node, defaultLine); });
}

function stateLabel(state) {
  return ({ idle: 'calmo', listening: 'ouvindo', thinking: 'pensando', recording: 'gravando', happy: 'feliz', dancing: 'dançando' })[state] || state;
}

function expressionLine(state) {
  return ({
    idle: 'Tô aqui. Sem pressa, mas sem perder a ideia.',
    listening: 'Manda. Eu tô prestando atenção no detalhe.',
    thinking: 'Tô juntando intenção, estrutura e o que você já decidiu antes.',
    recording: 'Vai. Eu seguro a sessão enquanto você canta.',
    happy: 'Essa decisão ficou boa. Salva o take e continua.',
    dancing: 'Agora sim tem movimento. Escuta como o groove respira.',
  })[state] || '';
}

function setText(node, value) {
  const text = String(value ?? '');
  if (node && node.textContent !== text) node.textContent = text;
}

function setHtml(node, value) {
  const html = String(value ?? '');
  if (node && node.innerHTML !== html) node.innerHTML = html;
}

installPabloVoiceIntimateUI();

export const PABLOVOICE_NETWORK_POLICY = Object.freeze({
  onlineIsDefault: true,
  localOnlyWhenOffline: true,
  noSilentLocalFallbackOnProviderFailure: true,
  providerBrandingIsNotProductUI: true,
});

export const PABLOVOICE_INTIMATE_STATES = PABLO_STATES;
export const PABLOVOICE_COMPANIONS = COMPANIONS;
