import { activeProjectSessionId, getProject, listProjects, saveProject } from './storage.mjs';
import { interpretPabloAudioMessage } from './pablo-conversation-audio.mjs';
import { InstrumentEngine } from './instrument-engine.mjs';
import {
  buildMusicalPlanReview,
  describeMusicalExecutionPlan,
  humanizeMusicalReviewError,
  materializeMusicalPlanReview,
} from './pablo-musical-plan-review.mjs';
import {
  executeReviewedSectionRegeneration,
  humanizeReviewedGenerationError,
  prepareReviewedSectionRegeneration,
} from './pablo-musical-generation-execution.mjs';

export const MUSICAL_PLAN_FALLBACK_TEXT = 'Não consegui usar essa análise: dados insuficientes.';

let installed = false;
let pendingReview = null;
let sequence = 0;
let previewEngine = null;
const generatedPreviewUrls = new Set();

export function installPabloMusicalPlanUI() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('submit', capturePabloMessage, true);
  const observer = new MutationObserver(onConversationMutation);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', revokeGeneratedPreviewUrls, { once: true });
}

export function isMusicalPlanFallbackText(value = '') {
  return String(value || '').trim().startsWith(MUSICAL_PLAN_FALLBACK_TEXT);
}

function capturePabloMessage(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const source = String(form.querySelector('input[name="message"]')?.value || '').trim();
  if (!source) return;

  // Direct audio/Beat-Lab commands have a higher priority in the canonical
  // conversation runtime. Do not duplicate those paths in this adapter.
  const direct = interpretPabloAudioMessage(source, {});
  if (direct?.supported) {
    pendingReview = null;
    return;
  }

  const token = ++sequence;
  pendingReview = {
    token,
    source,
    promise: prepareReview(source),
  };
}

function onConversationMutation(records) {
  if (!pendingReview) return;
  const candidates = [];
  for (const record of records) {
    for (const node of record.addedNodes || []) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.('.pv-msg.assistant')) candidates.push(node);
      candidates.push(...(node.querySelectorAll?.('.pv-msg.assistant') || []));
    }
  }
  if (!candidates.length) return;

  // The form is single-flight while Pablo is processing, so the first assistant
  // message after capture belongs to this request. Clear immediately to avoid
  // leaking a stale plan into a later answer.
  const current = pendingReview;
  pendingReview = null;
  const target = candidates[0];
  if (!isMusicalPlanFallbackText(target.textContent)) return;

  current.promise.then(async (review) => {
    if (!review?.supported) {
      target.textContent = humanizeMusicalReviewError(review?.reason || 'musical_intent_plan_unavailable');
      return;
    }
    await decoratePlanMessage(target, review);
  }).catch(() => {
    target.textContent = 'Entendi a direção musical, mas não consegui preparar um executor seguro. Não alterei o projeto.';
  });
}

async function prepareReview(source) {
  const project = await currentProject();
  if (!project) return { supported: false, reason: 'project_required' };
  return buildMusicalPlanReview(source, project, {
    projectId: project.id,
    trackId: project.activeTrackId || project.tracks?.[0]?.id || null,
    lyrics: String(project.lyrics || '').slice(0, 12000),
    notes: String(project.notes || '').slice(0, 4000),
    preset: project.preset || null,
  });
}

async function decoratePlanMessage(message, review) {
  message.textContent = review.reply;
  const plan = review.executionPlan || {};

  const detail = document.createElement('small');
  detail.dataset.musicalPlanDetail = 'true';
  detail.textContent = describeMusicalExecutionPlan(plan);
  message.appendChild(detail);

  const meta = document.createElement('small');
  meta.dataset.musicalPlanMeta = 'true';
  meta.textContent = plan.ok
    ? `PMI · ${executorLabel(plan.executor)} · revisar antes de ${plan.executor === 'music_generation' ? 'gerar' : 'aplicar'}`
    : `PMI · ${executorLabel(plan.executor)} · não aplicado`;
  message.appendChild(meta);

  if (canApplyLocally(plan)) {
    renderLocalActions(message, review, plan);
    return;
  }

  if (isSectionGenerationPlan(plan)) {
    const project = await currentProject();
    const prepared = project ? prepareReviewedSectionRegeneration(review, project) : { ok: false, reason: 'project_required' };
    if (!prepared.ok) {
      const blocker = document.createElement('small');
      blocker.dataset.musicalPlanBlocker = 'true';
      blocker.textContent = `${humanizeReviewedGenerationError(prepared.reason)} Não gerei nada.`;
      message.appendChild(blocker);
      return;
    }
    renderGenerationActions(message, review, prepared);
  }
}

function renderLocalActions(message, review, plan) {
  const actions = document.createElement('div');
  actions.className = 'pv-actions';
  actions.dataset.musicalPlanActions = 'true';
  let applied = false;

  if (plan.executor === 'instrument_lab') {
    const preview = document.createElement('button');
    preview.className = 'pv-btn';
    preview.type = 'button';
    preview.textContent = '▶ Ouvir prévia';
    preview.addEventListener('click', async () => {
      preview.disabled = true;
      try {
        const project = await currentProject();
        if (!project) throw new Error(humanizeMusicalReviewError('project_required'));
        if (applied) {
          playInstrumentState(project.instrumentLab);
        } else {
          const candidate = await materializeMusicalPlanReview(review, project);
          if (!candidate?.ok || !candidate?.project?.instrumentLab) {
            throw new Error(humanizeMusicalReviewError(candidate?.reason));
          }
          playInstrumentState(candidate.project.instrumentLab);
        }
      } catch (error) {
        appendStatus(error?.message || 'Não consegui tocar essa prévia.', true);
      } finally {
        preview.disabled = false;
      }
    });
    actions.appendChild(preview);
  }

  const apply = document.createElement('button');
  apply.className = 'pv-btn primary';
  apply.type = 'button';
  apply.textContent = plan.partial ? 'Aplicar parte segura' : 'Aplicar ajuste';
  apply.addEventListener('click', async () => {
    if (applied) return;
    const buttons = [...actions.querySelectorAll('button')];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const project = await currentProject();
      if (!project) throw new Error(humanizeMusicalReviewError('project_required'));
      const result = await materializeMusicalPlanReview(review, project);
      if (!result?.ok || !result?.mutated || !result?.project) {
        throw new Error(humanizeMusicalReviewError(result?.reason));
      }
      const saved = await saveProject(result.project);
      applied = true;
      apply.textContent = 'Aplicado ✓';
      apply.disabled = true;
      const previewButton = actions.querySelector('button:not(.primary)');
      if (previewButton) {
        previewButton.disabled = false;
        previewButton.textContent = '▶ Ouvir aplicado';
      }
      appendStatus(successMessage(plan, result));
      document.dispatchEvent(new CustomEvent('pablovoice:musical-plan-applied', {
        detail: { projectId: saved.id, executor: plan.executor, action: plan.action },
      }));
    } catch (error) {
      appendStatus(error?.message || 'Não consegui aplicar esse ajuste.', true);
      buttons.forEach((button) => { button.disabled = false; });
    }
  });
  actions.appendChild(apply);
  message.appendChild(actions);
}

function renderGenerationActions(message, review, prepared) {
  const actions = document.createElement('div');
  actions.className = 'pv-actions';
  actions.dataset.musicalPlanActions = 'true';
  actions.dataset.musicalGenerationActions = 'true';

  const target = document.createElement('small');
  target.dataset.musicalGenerationTarget = 'true';
  target.textContent = `${prepared.targetSection.label} · ${formatSeconds(prepared.targetSection.startSeconds)} · origem: ${prepared.targetSource === 'recent_studio_playhead' ? 'playhead recente' : 'seção confirmada'}`;
  message.appendChild(target);

  const generate = document.createElement('button');
  generate.className = 'pv-btn primary';
  generate.type = 'button';
  generate.textContent = '✦ Gerar nova versão';
  let completed = false;
  generate.addEventListener('click', async () => {
    if (completed) return;
    generate.disabled = true;
    generate.textContent = 'Gerando seção…';
    try {
      const project = await currentProject();
      if (!project) throw new Error(humanizeMusicalReviewError('project_required'));
      const result = await executeReviewedSectionRegeneration(review, project);
      if (!result?.ok || !result?.mutated || !result?.project) {
        throw new Error(humanizeReviewedGenerationError(result?.reason));
      }
      completed = true;
      generate.textContent = 'Gerado ✓';
      generate.disabled = true;
      appendGeneratedAudio(message, result);
      appendStatus(`${result.section?.label || 'Seção'} regenerado · Take ${result.takeNumber} salvo. A versão anterior e o restante da música foram preservados.`);
      document.dispatchEvent(new CustomEvent('pablovoice:musical-generation-applied', {
        detail: {
          projectId: result.project.id,
          sectionId: result.section?.id || null,
          takeNumber: result.takeNumber,
          provider: result.provider,
          model: result.model,
          requestId: result.requestId,
        },
      }));
    } catch (error) {
      generate.disabled = false;
      generate.textContent = '✦ Gerar nova versão';
      appendStatus(error?.message || 'Não consegui gerar essa seção. O take anterior foi preservado.', true);
    }
  });
  actions.appendChild(generate);
  message.appendChild(actions);
}

function appendGeneratedAudio(message, result) {
  if (!(result?.audioBlob instanceof Blob) || result.audioBlob.size <= 0) return;
  const previous = message.querySelector('[data-musical-generation-audio]');
  if (previous) {
    const oldUrl = previous.dataset.objectUrl;
    if (oldUrl) {
      URL.revokeObjectURL(oldUrl);
      generatedPreviewUrls.delete(oldUrl);
    }
    previous.remove();
  }
  const url = URL.createObjectURL(result.audioBlob);
  generatedPreviewUrls.add(url);
  const wrap = document.createElement('div');
  wrap.dataset.musicalGenerationAudio = 'true';
  wrap.dataset.objectUrl = url;
  const label = document.createElement('small');
  label.textContent = `Nova versão · ${result.section?.label || 'seção'} · Take ${result.takeNumber}`;
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = 'metadata';
  audio.src = url;
  wrap.append(label, audio);
  message.appendChild(wrap);
}

function canApplyLocally(plan = {}) {
  return plan?.ok === true && ['instrument_lab', 'beat_lab'].includes(plan.executor);
}

function isSectionGenerationPlan(plan = {}) {
  return plan?.ok === true && plan.executor === 'music_generation' && plan.action === 'regenerate_section';
}

function playInstrumentState(state) {
  if (!state?.notes?.length) throw new Error(humanizeMusicalReviewError('instrument_notes_required'));
  if (!previewEngine) previewEngine = new InstrumentEngine();
  previewEngine.setState(state);
  if (!previewEngine.playSequence()) throw new Error('Não consegui iniciar a prévia do instrumento.');
}

function successMessage(plan, result) {
  if (plan.executor === 'instrument_lab') {
    const revisions = Array.isArray(result?.revisionIds) ? result.revisionIds.length : 0;
    return `Ajuste MIDI aplicado e salvo${revisions ? ` com ${revisions} ponto(s) de revisão` : ' como revisão reversível'}. Pitch e quantidade de notas foram preservados.`;
  }
  if (plan.executor === 'beat_lab') {
    if (plan.partial) {
      const pending = (plan.unhandledDeltas || []).join(', ');
      return `Apliquei somente a parte local comprovada no Beat Lab. ${pending ? `Ficou pendente: ${pending}.` : ''} Não inventei o restante.`;
    }
    return 'Ajuste do Beat Lab aplicado e salvo como revisão reversível.';
  }
  return 'Ajuste musical aplicado e salvo como revisão reversível.';
}

function appendStatus(text, error = false) {
  const log = document.querySelector('[data-pablo-log]');
  if (!log) return;
  const message = document.createElement('div');
  message.className = 'pv-msg assistant';
  if (error) message.dataset.error = 'true';
  message.textContent = String(text || '');
  log.appendChild(message);
  message.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function currentProject() {
  const activeId = activeProjectSessionId();
  if (activeId) {
    const project = await getProject(activeId);
    if (project) return project;
  }
  return (await listProjects())[0] || null;
}

function executorLabel(executor) {
  return ({
    instrument_lab: 'Instrument Lab',
    beat_lab: 'Beat Lab',
    music_generation: 'regeneração musical',
    version_history: 'histórico',
    audio_dsp: 'DSP',
    review_only: 'revisão',
  })[String(executor || '')] || 'plano musical';
}

function formatSeconds(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function revokeGeneratedPreviewUrls() {
  for (const url of generatedPreviewUrls) URL.revokeObjectURL(url);
  generatedPreviewUrls.clear();
}
