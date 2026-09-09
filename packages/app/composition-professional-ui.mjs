import { analyzeLyrics, classifyStructure } from './songwriting/src/analyzer.mjs';

const runtime = {
  observer: null,
  suppressAppRewrite: false,
  suppressTimer: 0,
  analysisTimer: 0,
  composing: false,
  appGuardInstalled: false,
};

export function installCompositionProfessionalUI() {
  installLyricRenderGuard();
  if (runtime.observer) return () => disconnect();
  runtime.observer = new MutationObserver(queueEnhance);
  runtime.observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('input', onInputCapture, true);
  document.addEventListener('compositionstart', onCompositionStart, true);
  document.addEventListener('compositionend', onCompositionEnd, true);
  document.addEventListener('click', onClick, true);
  globalThis.visualViewport?.addEventListener('resize', onViewportResize);
  globalThis.visualViewport?.addEventListener('scroll', onViewportResize);
  queueEnhance();
  onViewportResize();
  return disconnect;
}

function disconnect() {
  runtime.observer?.disconnect();
  runtime.observer = null;
  document.removeEventListener('input', onInputCapture, true);
  document.removeEventListener('compositionstart', onCompositionStart, true);
  document.removeEventListener('compositionend', onCompositionEnd, true);
  document.removeEventListener('click', onClick, true);
  globalThis.visualViewport?.removeEventListener('resize', onViewportResize);
  globalThis.visualViewport?.removeEventListener('scroll', onViewportResize);
}

function installLyricRenderGuard() {
  if (runtime.appGuardInstalled) return;
  const app = document.querySelector('#app');
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!app || !descriptor?.get || !descriptor?.set) return;
  Object.defineProperty(app, 'innerHTML', {
    configurable: true,
    get() { return descriptor.get.call(app); },
    set(value) {
      const lyrics = document.querySelector('#lyrics');
      if (runtime.suppressAppRewrite && lyrics && document.activeElement === lyrics) return value;
      descriptor.set.call(app, value);
      return value;
    },
  });
  runtime.appGuardInstalled = true;
}

let enhanceQueued = false;
function queueEnhance() {
  if (enhanceQueued) return;
  enhanceQueued = true;
  queueMicrotask(() => {
    enhanceQueued = false;
    enhanceComposition();
  });
}

function enhanceComposition() {
  installLyricRenderGuard();
  const lyrics = document.querySelector('#lyrics');
  if (!lyrics) return;
  const main = lyrics.closest('main');
  main?.classList.add('pv-compose-pro');
  enhanceLyrics(lyrics);
  enhanceAiComposer();
  enhanceSongCreator();
}

function enhanceLyrics(lyrics) {
  lyrics.setAttribute('autocapitalize', 'sentences');
  lyrics.setAttribute('autocomplete', 'off');
  lyrics.setAttribute('spellcheck', 'true');
  lyrics.setAttribute('enterkeyhint', 'enter');
  lyrics.setAttribute('aria-describedby', 'pv-lyrics-writing-status');
  const card = lyrics.closest('.pv-card');
  if (!card) return;
  card.classList.add('pv-lyrics-workspace');
  if (!card.querySelector('[data-pv-lyrics-toolbar]')) {
    const toolbar = document.createElement('div');
    toolbar.className = 'pv-lyrics-toolbar';
    toolbar.dataset.pvLyricsToolbar = 'true';
    toolbar.setAttribute('aria-label', 'Inserir seção na letra');
    toolbar.innerHTML = `
      <div class="pv-lyrics-toolbar-copy"><b>Escrita</b><span id="pv-lyrics-writing-status">salvamento automático · teclado estável</span></div>
      <div class="pv-lyrics-section-actions">
        ${sectionButton('Verso', '[Verso]')}${sectionButton('Pré', '[Pré-refrão]')}${sectionButton('Refrão', '[Refrão]')}${sectionButton('Ponte', '[Ponte]')}
      </div>`;
    lyrics.insertAdjacentElement('beforebegin', toolbar);
  }
}

function sectionButton(label, token) {
  return `<button type="button" class="pv-compose-chip" data-pv-insert-section="${escapeHtml(token)}">${escapeHtml(label)}</button>`;
}

function enhanceAiComposer() {
  const panel = document.querySelector('#pv-ai-composer');
  if (!panel) return;
  panel.classList.add('pv-ai-composer-pro');
  const head = panel.querySelector('.pv-card-head');
  if (!head) return;
  const title = head.querySelector('h3');
  if (title && title.textContent !== 'Pablo Composer') title.textContent = 'Pablo Composer';
  const copy = head.querySelector('p');
  if (copy) copy.textContent = 'Assistente opcional para gerar, continuar ou lapidar sua letra.';
  if (!head.querySelector('[data-pv-ai-toggle]')) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'pv-compose-disclosure';
    toggle.dataset.pvAiToggle = 'true';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'Abrir IA';
    head.appendChild(toggle);
    const hasResult = Boolean(document.querySelector('#pv-ai-compose-result')?.textContent?.trim() && !document.querySelector('#pv-ai-compose-result')?.textContent?.includes('aparece aqui'));
    panel.classList.toggle('is-collapsed', !hasResult);
    if (hasResult) {
      toggle.setAttribute('aria-expanded', 'true');
      toggle.textContent = 'Fechar';
    }
  }
}

function enhanceSongCreator() {
  const panel = document.querySelector('#pv-song-creator');
  const form = panel?.querySelector('[data-song-create-form]');
  if (!panel || !form) return;
  panel.classList.add('pv-song-creator-pro');
  const intro = panel.querySelector('.pv-card-head p');
  if (intro) intro.textContent = 'Defina a direção, escolha o tipo e produza um novo take sem apagar o anterior.';

  const instrumental = form.elements.instrumentalFirst;
  if (instrumental && !form.querySelector('[data-pv-pro-kind]')) {
    const switcher = document.createElement('div');
    switcher.className = 'pv-create-kind';
    switcher.dataset.pvProKind = 'true';
    switcher.innerHTML = `
      <span>Tipo de criação</span>
      <div role="group" aria-label="Tipo de criação">
        <button type="button" data-pv-pro-kind-value="complete">Música completa</button>
        <button type="button" data-pv-pro-kind-value="instrumental">Instrumental</button>
      </div>`;
    form.insertBefore(switcher, form.firstElementChild);
  }
  syncCreationKind(form);

  const vocal = form.querySelector('.pv-song-vocal-profile');
  const negative = form.elements.negative?.closest('label');
  const startMode = form.querySelector('.pv-song-start-mode');
  if ((vocal || negative || startMode) && !form.querySelector('[data-pv-advanced-creation]')) {
    const advanced = document.createElement('details');
    advanced.className = 'pv-creation-advanced';
    advanced.dataset.pvAdvancedCreation = 'true';
    advanced.innerHTML = '<summary>Opções avançadas <span>voz-guia, exclusões e modo instrumental</span></summary><div data-pv-advanced-body></div>';
    const body = advanced.querySelector('[data-pv-advanced-body]');
    [negative, vocal, startMode].filter(Boolean).forEach((node) => body.appendChild(node));
    const modeGrid = form.querySelector('.pv-song-mode-grid');
    if (modeGrid) form.insertBefore(advanced, modeGrid);
    else form.appendChild(advanced);
  }

  form.querySelectorAll('[data-pv-kind]').forEach((button) => button.classList.add('pv-create-kind-legacy'));
  const unified = form.querySelector('[data-pv-unified-create-card]');
  unified?.classList.add('pv-unified-create-card-pro');
}

function syncCreationKind(form = document.querySelector('[data-song-create-form]')) {
  if (!form) return;
  const checked = Boolean(form.elements.instrumentalFirst?.checked);
  form.querySelectorAll('[data-pv-pro-kind-value]').forEach((button) => {
    const active = (button.dataset.pvProKindValue === 'instrumental') === checked;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function onInputCapture(event) {
  if (event.target?.id !== 'lyrics') return;
  runtime.suppressAppRewrite = true;
  clearTimeout(runtime.suppressTimer);
  runtime.suppressTimer = setTimeout(() => { runtime.suppressAppRewrite = false; }, 0);
  if (!runtime.composing) scheduleAnalysis(event.target.value);
}

function onCompositionStart(event) {
  if (event.target?.id !== 'lyrics') return;
  runtime.composing = true;
  runtime.suppressAppRewrite = true;
}

function onCompositionEnd(event) {
  if (event.target?.id !== 'lyrics') return;
  runtime.composing = false;
  clearTimeout(runtime.suppressTimer);
  runtime.suppressTimer = setTimeout(() => { runtime.suppressAppRewrite = false; }, 0);
  scheduleAnalysis(event.target.value, 40);
}

function scheduleAnalysis(value, delay = 120) {
  clearTimeout(runtime.analysisTimer);
  runtime.analysisTimer = setTimeout(() => updateAnalysisDom(value), delay);
}

function updateAnalysisDom(value = '') {
  let analysis;
  try { analysis = analyzeLyrics(String(value || '')); }
  catch { return; }
  const stats = document.querySelectorAll('.pv-compose-pro .pv-stat-grid .pv-stat strong');
  const values = [analysis.targetSyllables, `${analysis.meterConsistency}%`, `${analysis.rhymeCoverage}%`, analysis.singability];
  stats.forEach((node, index) => { if (values[index] != null) node.textContent = values[index]; });

  const tips = document.querySelector('.pv-compose-pro .pv-tips');
  if (tips) tips.innerHTML = (analysis.suggestions || []).map((tip) => `<div class="pv-tip">${escapeHtml(tip)}</div>`).join('');

  const lineMap = document.querySelector('.pv-compose-pro .pv-line-map');
  if (lineMap) {
    lineMap.innerHTML = analysis.lines?.length
      ? analysis.lines.map((line) => `<div><span>${line.index + 1}</span><b>${escapeHtml(line.content)}</b><small>${line.syllables} sílabas · final “${escapeHtml(line.rhyme)}”</small></div>`).join('')
      : '<p class="muted">A análise aparece enquanto você escreve.</p>';
  }

  const note = [...document.querySelectorAll('.pv-compose-pro .pv-note')].find((node) => node.textContent?.includes('Estrutura detectada:'));
  if (note) note.textContent = `Estrutura detectada: ${classifyStructure(String(value || '')).join(' → ')}.`;
  const status = document.querySelector('#pv-lyrics-writing-status');
  if (status) status.textContent = 'salvo automaticamente · análise atualizada';
}

function onClick(event) {
  const insert = event.target.closest('[data-pv-insert-section]');
  if (insert) {
    event.preventDefault();
    insertSection(insert.dataset.pvInsertSection || '');
    return;
  }
  const aiToggle = event.target.closest('[data-pv-ai-toggle]');
  if (aiToggle) {
    event.preventDefault();
    const panel = aiToggle.closest('#pv-ai-composer');
    const collapsed = !panel?.classList.toggle('is-collapsed');
    aiToggle.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
    aiToggle.textContent = collapsed ? 'Fechar' : 'Abrir IA';
    return;
  }
  const kind = event.target.closest('[data-pv-pro-kind-value]');
  if (kind) {
    event.preventDefault();
    const form = kind.closest('[data-song-create-form]');
    const checkbox = form?.elements.instrumentalFirst;
    if (!checkbox) return;
    checkbox.checked = kind.dataset.pvProKindValue === 'instrumental';
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    syncCreationKind(form);
  }
}

function insertSection(token) {
  const lyrics = document.querySelector('#lyrics');
  if (!lyrics || !token) return;
  const start = Number.isFinite(lyrics.selectionStart) ? lyrics.selectionStart : lyrics.value.length;
  const end = Number.isFinite(lyrics.selectionEnd) ? lyrics.selectionEnd : start;
  const before = lyrics.value.slice(0, start);
  const prefix = before && !before.endsWith('\n') ? '\n\n' : before.endsWith('\n\n') || !before ? '' : '\n';
  const text = `${prefix}${token}\n`;
  lyrics.setRangeText(text, start, end, 'end');
  lyrics.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  lyrics.focus({ preventScroll: true });
}

function onViewportResize() {
  const viewport = globalThis.visualViewport;
  if (!viewport) return;
  const covered = Math.max(0, globalThis.innerHeight - viewport.height - viewport.offsetTop);
  document.documentElement.style.setProperty('--pv-keyboard-inset', `${Math.round(covered)}px`);
  document.documentElement.classList.toggle('pv-keyboard-open', covered > 120);
  if (covered > 120 && document.activeElement?.id === 'lyrics') {
    requestAnimationFrame(() => document.activeElement?.scrollIntoView({ block: 'center', behavior: 'auto' }));
  }
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[char]);
}

installCompositionProfessionalUI();
