import { MusicGenerationClient } from './music-generation-client.mjs';
import { latestInpaintableSongTake, resolveSectionRegeneration } from './music-section-regeneration.mjs';
import { persistSectionRegeneration } from './music-section-regeneration-persistence.mjs';
import { activeProjectSessionId, getProject, listProjects } from './storage.mjs';

const OPEN_STUDIO_KEY = 'pablovoice.songCreation.openStudio';
const runtime = {
  observer: null,
  client: null,
  project: null,
  selectedSectionId: null,
  busy: false,
  syncQueued: false,
};

export function installMusicSectionRegenerationUI() {
  if (runtime.observer) return () => runtime.observer.disconnect();
  ensureStylesheet();
  runtime.observer = new MutationObserver(() => queueSync());
  runtime.observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', onSubmit, true);
  queueSync();
  return () => {
    runtime.observer?.disconnect();
    runtime.observer = null;
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('submit', onSubmit, true);
  };
}

function ensureStylesheet() {
  if (document.querySelector('link[data-music-section-regeneration-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './music-section-regeneration.css';
  link.dataset.musicSectionRegenerationStyle = 'true';
  document.head.appendChild(link);
}

function queueSync() {
  if (runtime.syncQueued) return;
  runtime.syncQueued = true;
  queueMicrotask(async () => {
    runtime.syncQueued = false;
    await syncSectionActions();
  });
}

async function syncSectionActions() {
  const modal = document.querySelector('[data-section-map-modal]');
  if (!modal) return;
  const project = await currentProject().catch(() => null);
  if (!project) return;
  runtime.project = project;
  const sourceTake = latestInpaintableSongTake(project);
  const list = modal.querySelector('[data-section-list]');
  if (!list) return;

  list.querySelector('[data-music-regen-readiness]')?.remove();
  const readiness = document.createElement('div');
  readiness.dataset.musicRegenReadiness = 'true';
  readiness.className = `pv-music-regen-readiness ${sourceTake ? 'ready' : ''}`;
  readiness.innerHTML = sourceTake
    ? `<strong>✦ Edição musical seletiva pronta</strong><span>Take HQ com continuidade encontrado. Você pode refazer uma seção sem pedir uma nova música inteira.</span>`
    : `<strong>Edição musical seletiva</strong><span>Crie uma demo HQ com ID de continuidade para habilitar “Refazer HQ”. O mapa de seções continua funcionando normalmente.</span>`;
  list.prepend(readiness);

  for (const row of list.querySelectorAll('[data-section-row]')) {
    const actions = row.querySelector('.pv-section-actions');
    if (!actions) continue;
    const existing = actions.querySelector('[data-music-section-regen]');
    if (!sourceTake) {
      existing?.remove();
      continue;
    }
    if (existing) continue;
    const button = document.createElement('button');
    button.className = 'pv-btn pv-music-regen-button';
    button.type = 'button';
    button.dataset.musicSectionRegen = row.dataset.sectionRow;
    button.textContent = '✦ Refazer HQ';
    actions.prepend(button);
  }
}

async function onClick(event) {
  const button = event.target.closest('[data-music-section-regen]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (runtime.busy) return;

  const project = await currentProject().catch(() => null);
  if (!project) return notify('Não consegui abrir o projeto ativo.', 'error');
  const initial = resolveSectionRegeneration(project, button.dataset.musicSectionRegen);
  if (!initial.ok) return notify(humanPlanError(initial.error), 'error');
  runtime.project = project;
  runtime.selectedSectionId = button.dataset.musicSectionRegen;
  renderRegenerationPanel(initial);
}

function renderRegenerationPanel(plan) {
  const modal = document.querySelector('.pv-section-modal');
  if (!modal) return;
  modal.querySelector('[data-music-regen-panel]')?.remove();
  const panel = document.createElement('section');
  panel.className = 'pv-music-regen-panel';
  panel.dataset.musicRegenPanel = 'true';
  const seconds = Math.max(0, (plan.section.endMs - plan.section.startMs) / 1000);
  panel.innerHTML = `
    <div class="pv-music-regen-head">
      <div><small>MUSIC V2 · INPAINTING</small><h3>Refazer só ${escapeHtml(plan.section.label)}</h3><p>${formatMs(plan.section.startMs)} → ${formatMs(plan.section.endMs)} · ${seconds.toFixed(1)}s. O restante da música é referenciado pelo take original.</p></div>
      <button class="pv-btn" type="button" data-music-regen-close>Cancelar</button>
    </div>
    <form data-music-regen-form class="pv-music-regen-form">
      <label>O que deve mudar nesta seção?
        <input class="pv-field" name="direction" maxlength="500" required placeholder="Ex.: mais energia, synths maiores e bateria abrindo no final">
      </label>
      <label>Letra só desta nova versão · opcional
        <textarea class="pv-field" name="lyrics" rows="3" maxlength="12000" placeholder="Deixe vazio para manter a letra já mapeada desta seção."></textarea>
      </label>
      <label>Evitar nesta seção · opcional
        <input class="pv-field" name="negative" maxlength="700" placeholder="Ex.: dembow pesado, drop EDM, excesso de guitarra">
      </label>
      <div class="pv-music-regen-safety"><b>Preservação seletiva</b><span>O PabloVoice envia o intervalo escolhido como substituição e referencia as faixas anteriores/posteriores pelo <code>song-id</code>. A versão anterior não é apagada.</span></div>
      <div class="pv-music-regen-actions"><span data-music-regen-status>Pronto para criar uma nova versão desta seção.</span><button class="pv-btn primary" type="submit" data-music-regen-submit>✦ Gerar nova versão</button></div>
    </form>`;
  const editor = modal.querySelector('.pv-section-editor');
  if (editor) editor.insertAdjacentElement('beforebegin', panel);
  else modal.appendChild(panel);
  panel.querySelector('input[name="direction"]')?.focus();
}

async function onSubmit(event) {
  const form = event.target.closest('[data-music-regen-form]');
  if (!form) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (runtime.busy || !runtime.selectedSectionId) return;

  const status = form.querySelector('[data-music-regen-status]');
  const submit = form.querySelector('[data-music-regen-submit]');
  const direction = String(form.elements.direction?.value || '').trim();
  const lyricOverride = String(form.elements.lyrics?.value || '').trim();
  if (!direction) return setText(status, 'Descreva o que você quer mudar nesta seção.');

  runtime.busy = true;
  if (submit) { submit.disabled = true; submit.textContent = 'Gerando seção…'; }
  setText(status, 'Confirmando take HQ, tempos e contexto da seção…');
  try {
    const project = await currentProject();
    const plan = resolveSectionRegeneration(project, runtime.selectedSectionId, {
      direction,
      lyrics: lyricOverride || null,
      negativeStyles: parseStyles(form.elements.negative?.value),
    });
    if (!plan.ok) throw new Error(humanPlanError(plan.error));

    setText(status, `Refazendo apenas ${plan.section.label}; restante referenciado pelo take anterior…`);
    const result = await client().regenerateSection({
      localProject: project,
      sourceSongId: plan.sourceSongId,
      durationMs: plan.durationMs,
      section: plan.section,
    });
    if (!result?.ok) throw new Error(humanRuntimeError(result));

    setText(status, 'Salvando como novo take, sem substituir a versão anterior…');
    const persisted = await persistSectionRegeneration(project, plan, result);
    setText(status, `${plan.section.label} regenerado · Take ${persisted.takeNumber} salvo.`);
    notify(`Nova versão de ${plan.section.label} salva. A anterior continua no projeto.`, 'ok');
    try { sessionStorage.setItem(OPEN_STUDIO_KEY, '1'); } catch {}
    location.reload();
  } catch (error) {
    console.error('PABLOVOICE_MUSIC_SECTION_REGEN_FAILED', error);
    setText(status, error?.message || 'A regeneração não concluiu. A versão anterior foi preservada.');
  } finally {
    runtime.busy = false;
    if (submit) { submit.disabled = false; submit.textContent = '✦ Gerar nova versão'; }
  }
}

document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-music-regen-close]');
  if (!close) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  runtime.selectedSectionId = null;
  document.querySelector('[data-music-regen-panel]')?.remove();
}, true);

function client() {
  if (!runtime.client) runtime.client = new MusicGenerationClient();
  return runtime.client;
}

async function currentProject() {
  const id = activeProjectSessionId();
  if (id) {
    const project = await getProject(id);
    if (project) return project;
  }
  return (await listProjects())[0] || null;
}

function humanPlanError(error) {
  if (error === 'inpainting_source_missing') return 'Esta música ainda não tem um take HQ com continuidade para regeneração seletiva.';
  if (error === 'section_not_found') return 'Esta seção não está mais no mapa canônico.';
  if (error === 'section_timing_incomplete') return 'Confirme os tempos desta seção antes de regenerá-la.';
  return 'Não consegui preparar esta seção para regeneração.';
}

function humanRuntimeError(result = {}) {
  if (result.error === 'auth_required') return 'Conecte sua sessão do PabloVoice para usar a regeneração HQ. O take atual foi preservado.';
  if (result.error === 'provider_unavailable') return 'O motor Music v2 não está disponível agora. O take atual foi preservado.';
  if (result.error === 'provider_rate_limited') return 'O motor Music v2 atingiu o limite temporário. Tente novamente depois; nada foi substituído.';
  if (result.error === 'provider_auth_failed') return 'A credencial do motor Music v2 precisa ser corrigida no backend. Nada foi substituído.';
  if (result.error === 'invalid_inpainting_plan') return 'O intervalo selecionado não pôde ser enviado com segurança ao motor musical.';
  return `A regeneração não concluiu (${result.error || 'erro remoto'}). O take anterior continua intacto.`;
}

function parseStyles(value) {
  return String(value || '').split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, 12);
}
function formatMs(value) {
  const seconds = Math.max(0, Number(value) || 0) / 1000;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
function notify(message, kind = '') {
  const wrap = document.querySelector('[data-toasts]');
  if (!wrap) return;
  const item = document.createElement('div');
  item.className = `pv-toast ${kind}`;
  item.textContent = message;
  wrap.appendChild(item);
  setTimeout(() => item.remove(), 3500);
}
function setText(node, value) { if (node) node.textContent = value; }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[char]); }
