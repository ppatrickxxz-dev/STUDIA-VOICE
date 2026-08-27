import { snapshotProject } from './core/src/project.mjs';
import {
  normalizeArrangementMap,
  parseClockSeconds,
  removeArrangementSection,
  replaceConfirmedSection,
  sectionLabel,
  upsertConfirmedSection,
} from './core/src/section-map.mjs';
import { activeProjectSessionId, getProject, listProjects, saveProject } from './storage.mjs';

const SECTION_OPTIONS = Object.freeze([
  ['intro', 'Intro'],
  ['verse', 'Verso'],
  ['pre_chorus', 'Pré-refrão'],
  ['chorus', 'Refrão'],
  ['bridge', 'Ponte'],
  ['rap', 'Rap'],
  ['outro', 'Outro'],
]);

let mounted = false;
let activeProject = null;
let editingSectionId = null;
let lastCursorSeconds = 0;
let lastCursorProjectId = '';

export function installSectionMapUI() {
  if (mounted) return;
  mounted = true;
  ensureStylesheet();
  const observer = new MutationObserver(onDomMutation);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  onDomMutation();
}

function onDomMutation() {
  captureCursorPosition();
  mountEntryPoint();
}

function ensureStylesheet() {
  if (document.querySelector('link[data-section-map-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './section-map.css';
  link.dataset.sectionMapStyle = 'true';
  document.head.appendChild(link);
}

function mountEntryPoint() {
  const actions = document.querySelector('.pv-studio-actions');
  if (!actions || actions.querySelector('[data-section-map-open]')) return;
  const button = document.createElement('button');
  button.className = 'pv-btn';
  button.type = 'button';
  button.dataset.sectionMapOpen = 'true';
  button.textContent = '⌁ Seções';
  actions.insertBefore(button, actions.lastElementChild || null);
}

async function onClick(event) {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.sectionMapOpen) { await showSectionMap(); return; }
  if (button.dataset.sectionMapClose) { hideSectionMap(); return; }
  if (!document.querySelector('[data-section-map-modal]')) return;

  if (button.dataset.sectionUseCursor) {
    const value = currentCursorSeconds();
    const input = document.querySelector('[data-section-start]');
    if (!input) return;
    input.value = formatClock(value);
    input.focus();
    toast(`Cursor usado: ${formatClock(value)}.`, 'ok');
    return;
  }

  if (button.dataset.sectionEdit) {
    beginEdit(button.dataset.sectionEdit);
    return;
  }

  if (button.dataset.sectionCancelEdit) {
    editingSectionId = null;
    renderSectionMap();
    return;
  }

  if (button.dataset.sectionRemove) {
    await removeSection(button.dataset.sectionRemove);
  }
}

async function onSubmit(event) {
  const form = event.target.closest('[data-section-form]');
  if (!form) return;
  event.preventDefault();
  if (!activeProject) return;

  const kind = String(form.elements.kind?.value || '');
  const startSeconds = parseClockSeconds(form.elements.start?.value);
  const endText = String(form.elements.end?.value || '').trim();
  const endSeconds = endText ? parseClockSeconds(endText) : null;
  if (startSeconds == null) {
    toast('Informe um início válido, como 45 ou 1:12.', 'error');
    return;
  }
  if (endText && (endSeconds == null || endSeconds <= startSeconds)) {
    toast('O fim precisa estar depois do início.', 'error');
    return;
  }

  try {
    const input = { kind, startSeconds, endSeconds, source: 'user_manual', confidence: 1 };
    activeProject.arrangementMap = editingSectionId
      ? replaceConfirmedSection(activeProject.arrangementMap, editingSectionId, input)
      : upsertConfirmedSection(activeProject.arrangementMap, input);
    const label = sectionLabel(kind);
    const revisionLabel = editingSectionId ? `${label} atualizado na timeline` : `${label} marcado na timeline`;
    activeProject = await saveProject(snapshotProject(activeProject, revisionLabel));
    editingSectionId = null;
    renderSectionMap();
    toast(`${label} salvo em ${formatClock(startSeconds)}.`, 'ok');
  } catch (error) {
    console.error('SECTION_MAP_SAVE_FAILED', error);
    toast(error?.message || 'Não consegui salvar essa seção.', 'error');
  }
}

async function showSectionMap() {
  try {
    captureCursorPosition();
    activeProject = await currentProject();
    if (!activeProject) throw new Error('Crie ou abra um projeto antes de organizar as seções.');
    activeProject.arrangementMap = normalizeArrangementMap(activeProject.arrangementMap);
    editingSectionId = null;
    renderSectionMap();
  } catch (error) {
    console.error('SECTION_MAP_OPEN_FAILED', error);
    toast(error?.message || 'Não consegui abrir as seções.', 'error');
  }
}

function hideSectionMap() {
  editingSectionId = null;
  document.querySelector('[data-section-map-modal]')?.remove();
}

function renderSectionMap() {
  document.querySelector('[data-section-map-modal]')?.remove();
  if (!activeProject) return;
  const map = normalizeArrangementMap(activeProject.arrangementMap);
  activeProject.arrangementMap = map;
  const editing = map.sections.find((section) => section.id === editingSectionId) || null;
  if (editingSectionId && !editing) editingSectionId = null;

  const overlay = document.createElement('div');
  overlay.className = 'pv-section-overlay';
  overlay.dataset.sectionMapModal = 'true';
  overlay.innerHTML = `<section class="pv-section-modal" role="dialog" aria-modal="true" aria-label="Seções da música">
    <header class="pv-section-head">
      <div><small>STUDIO · MAPA DA MÚSICA</small><h2>Seções</h2><p>Marque onde verso, refrão e ponte começam. O Pablo usa exatamente estes tempos.</p></div>
      <button class="pv-btn" type="button" data-section-map-close>Fechar</button>
    </header>
    <div class="pv-section-list" data-section-list>${renderSections(map.sections)}</div>
    <section class="pv-section-editor">
      <h3>${editing ? 'Editar seção' : 'Marcar seção'}</h3>
      ${editing ? `<div class="pv-section-editing">Editando ${escapeHtml(editing.label)} · ${formatClock(editing.startSeconds)}</div>` : ''}
      <form class="pv-section-form" data-section-form>
        <label>Parte da música<select name="kind" data-section-kind>${renderSectionOptions(editing?.kind || 'chorus')}</select></label>
        <label>Começa em<input name="start" data-section-start inputmode="decimal" placeholder="45 ou 1:12" value="${editing ? formatClock(editing.startSeconds) : ''}" autocomplete="off"></label>
        <label>Termina em · opcional<input name="end" data-section-end inputmode="decimal" placeholder="61 ou 1:28" value="${editing?.endSeconds != null ? formatClock(editing.endSeconds) : ''}" autocomplete="off"></label>
        <div class="pv-section-form-actions">
          <button class="pv-btn" type="button" data-section-use-cursor>Usar cursor</button>
          ${editing ? '<button class="pv-btn" type="button" data-section-cancel-edit>Cancelar</button>' : ''}
          <button class="pv-btn primary" type="submit">${editing ? 'Atualizar' : 'Salvar seção'}</button>
        </div>
      </form>
      <p class="pv-section-hint">Aceita segundos ou relógio, como 45, 1:12 ou 1:12.5. “Usar cursor” pega a posição atual ou o último ponto ouvido antes de parar.</p>
    </section>
  </section>`;
  document.body.appendChild(overlay);
}

function renderSections(sections) {
  if (!sections.length) return '<div class="pv-section-empty">Nenhuma seção marcada ainda. Dê play, pare no ponto certo e use o cursor.</div>';
  return sections.map((section, index) => {
    const occurrence = sections.slice(0, index + 1).filter((item) => item.kind === section.kind).length;
    const suffix = sections.filter((item) => item.kind === section.kind).length > 1 ? ` ${occurrence}` : '';
    const range = section.endSeconds == null ? formatClock(section.startSeconds) : `${formatClock(section.startSeconds)} → ${formatClock(section.endSeconds)}`;
    return `<article class="pv-section-item" data-section-row="${escapeHtml(section.id)}">
      <div class="pv-section-item-main"><b>${escapeHtml(section.label)}${suffix}</b><span>${range} · timing confirmado</span></div>
      <div class="pv-section-actions"><button class="pv-btn" type="button" data-section-edit="${escapeHtml(section.id)}">Editar</button><button class="pv-btn" type="button" data-section-remove="${escapeHtml(section.id)}">Remover</button></div>
    </article>`;
  }).join('');
}

function renderSectionOptions(selected) {
  return SECTION_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function beginEdit(sectionId) {
  const map = normalizeArrangementMap(activeProject?.arrangementMap);
  if (!map.sections.some((section) => section.id === sectionId)) return;
  editingSectionId = sectionId;
  renderSectionMap();
  document.querySelector('[data-section-start]')?.focus();
}

async function removeSection(sectionId) {
  if (!activeProject) return;
  const map = normalizeArrangementMap(activeProject.arrangementMap);
  const section = map.sections.find((item) => item.id === sectionId);
  if (!section) return;
  try {
    activeProject.arrangementMap = removeArrangementSection(map, sectionId);
    activeProject = await saveProject(snapshotProject(activeProject, `${section.label} removido da timeline`));
    if (editingSectionId === sectionId) editingSectionId = null;
    renderSectionMap();
    toast(`${section.label} removido do mapa.`, 'ok');
  } catch (error) {
    console.error('SECTION_MAP_REMOVE_FAILED', error);
    toast(error?.message || 'Não consegui remover essa seção.', 'error');
  }
}

function captureCursorPosition() {
  const projectId = String(activeProjectSessionId() || '');
  if (projectId !== lastCursorProjectId) {
    lastCursorProjectId = projectId;
    lastCursorSeconds = 0;
  }
  const parsed = parseClockSeconds(document.querySelector('#current-time')?.textContent || '');
  if (parsed != null && parsed > 0) lastCursorSeconds = parsed;
}

function currentCursorSeconds() {
  captureCursorPosition();
  const live = parseClockSeconds(document.querySelector('#current-time')?.textContent || '');
  return live != null && live > 0 ? live : lastCursorSeconds;
}

async function currentProject() {
  const id = activeProjectSessionId();
  if (id) {
    const project = await getProject(id);
    if (project) return project;
  }
  return (await listProjects())[0] || null;
}

function formatClock(value) {
  const total = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  const whole = Math.abs(seconds - Math.round(seconds)) < 0.001;
  const rendered = (whole ? String(Math.round(seconds)) : seconds.toFixed(1)).padStart(2, '0');
  return `${minutes}:${rendered}`;
}

function toast(message, kind = '') {
  const wrap = document.querySelector('[data-toasts]');
  if (!wrap) return;
  const item = document.createElement('div');
  item.className = `pv-toast ${kind}`;
  item.textContent = message;
  wrap.appendChild(item);
  setTimeout(() => item.remove(), 3500);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[char]);
}
