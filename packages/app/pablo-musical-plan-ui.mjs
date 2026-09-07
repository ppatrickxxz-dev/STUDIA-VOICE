import { activeProjectSessionId, getProject, listProjects, saveProject } from './storage.mjs';
import { interpretPabloAudioMessage } from './pablo-conversation-audio.mjs';
import { InstrumentEngine } from './instrument-engine.mjs';
import {
  buildMusicalPlanReview,
  describeMusicalExecutionPlan,
  humanizeMusicalReviewError,
  materializeMusicalPlanReview,
} from './pablo-musical-plan-review.mjs';

export const MUSICAL_PLAN_FALLBACK_TEXT = 'Não consegui usar essa análise: dados insuficientes.';

let installed = false;
let pendingReview = null;
let sequence = 0;
let previewEngine = null;

export function installPabloMusicalPlanUI() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('submit', capturePabloMessage, true);
  const observer = new MutationObserver(onConversationMutation);
  observer.observe(document.documentElement, { childList: true, subtree: true });
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

  current.promise.then((review) => {
    if (!review?.supported) {
      target.textContent = humanizeMusicalReviewError(review?.reason || 'musical_intent_plan_unavailable');
      return;
    }
    decoratePlanMessage(target, review);
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

function decoratePlanMessage(message, review) {
  message.textContent = review.reply;
  const plan = review.executionPlan || {};

  const detail = document.createElement('small');
  detail.dataset.musicalPlanDetail = 'true';
  detail.textContent = describeMusicalExecutionPlan(plan);
  message.appendChild(detail);

  const meta = document.createElement('small');
  meta.dataset.musicalPlanMeta = 'true';
  meta.textContent = plan.ok
    ? `PMI · ${executorLabel(plan.executor)} · revisar antes de aplicar`
    : `PMI · ${executorLabel(plan.executor)} · não aplicado`;
  message.appendChild(meta);

  if (!canApplyLocally(plan)) return;

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

function canApplyLocally(plan = {}) {
  return plan?.ok === true && ['instrument_lab', 'beat_lab'].includes(plan.executor);
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
