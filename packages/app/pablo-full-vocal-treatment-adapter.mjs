import {
  applyFullVocalTreatment,
  parseFullVocalTreatmentCommand,
  resolveFullVocalTreatmentTarget,
} from './core/src/full-vocal-treatment.mjs';
import { PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST } from './core/src/section-vocal-cleanup.mjs';
import { snapshotProject } from './core/src/project.mjs';
import { analyzeAudioTrack } from './audio-analysis-runtime.mjs';
import { activeProjectSessionId, getProject, saveProject } from './storage.mjs';

let mounted = false;

export function installPabloFullVocalTreatmentAdapter() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', onPabloSubmitCapture, true);
}

async function onPabloSubmitCapture(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const input = form.querySelector('input[name="message"]');
  const original = String(input?.value || '').trim();
  const command = parseFullVocalTreatmentCommand(original);
  if (!command) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (input) input.value = '';
  appendMessage(original, 'user');
  setBusy(form, true);

  try {
    const projectId = activeProjectSessionId();
    const project = projectId ? await getProject(projectId) : null;
    if (!project) {
      appendMessage('Não encontrei o projeto ativo. Não alterei nenhuma faixa.', 'assistant', { canApply: false });
      return;
    }

    const target = resolveFullVocalTreatmentTarget(project);
    if (!target.ok) {
      appendMessage(blockedReply(target), 'assistant', { canApply: false });
      return;
    }

    const analysis = await analyzeAudioTrack(target.track);
    const result = applyFullVocalTreatment(project, command, { analysis, now: Date.now() });
    if (!result.ok) {
      appendMessage(blockedReply(result), 'assistant', { canApply: false });
      return;
    }

    const snapshotted = snapshotProject(result.project, `Tratamento vocal por prioridade em ${result.appliedSectionCount} seção(ões)`);
    await saveProject(snapshotted);
    const persisted = await getProject(project.id);
    if (!isTreatmentPersisted(persisted, result)) {
      throw new Error('O tratamento vocal por prioridade não foi confirmado no projeto local. Não vou dizer que foi aplicado.');
    }

    globalThis.dispatchEvent(new CustomEvent('pablovoice:project-persisted', {
      detail: { projectId: project.id, source: 'pablo_full_vocal_priority_treatment' },
    }));
    appendMessage(successReply(result), 'assistant', { canApply: true });
  } catch (error) {
    appendMessage(error?.message || 'Não consegui executar o tratamento vocal por prioridade com segurança.', 'assistant', { error: true, canApply: false });
  } finally {
    setBusy(form, false);
  }
}

function isTreatmentPersisted(project, result) {
  const track = project?.tracks?.find((candidate) => candidate.id === result.trackId);
  const automation = Array.isArray(track?.regionAutomation) ? track.regionAutomation : [];
  const expectedIds = result.appliedSections.flatMap((section) => section.eventIds || []);
  if (!expectedIds.length) return false;
  const saved = automation.filter((event) => expectedIds.includes(event?.id));
  if (saved.length !== expectedIds.length) return false;
  return saved.every((event) =>
    expectedIds.includes(event.id)
    && PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST.includes(String(event.source || ''))
    && event.enabled !== false);
}

function successReply(result) {
  const sections = result.appliedSections.map((section) => {
    const where = sectionOccurrenceLabel(section);
    const modules = appliedModules(section.modules).join(', ');
    return `${where} (${priorityLabel(section.priority)}): ${section.eventCount} ajuste(s)${modules ? ` · ${modules}` : ''}`;
  });
  const limited = result.candidateCount > result.appliedSectionCount
    ? ` Parei nas ${result.appliedSectionCount} seção(ões) mais críticas; ${result.candidateCount - result.appliedSectionCount} seção(ões) ainda podem ser tratadas depois.`
    : '';
  const skipped = result.applicationSkipped?.length
    ? ` ${result.applicationSkipped.length} seção(ões) foram puladas porque o gate fechou durante a aplicação.`
    : '';
  return `Tratei a voz por prioridade, usando uma única análise vocal e só os módulos que os gates acústicos autorizaram. Comecei pelos trechos mais críticos: ${sections.join('; ')}.${limited}${skipped} Nada fora das seções escolhidas foi alterado.`;
}

function blockedReply(result) {
  if (result.reason === 'missing_confirmed_sections') return 'Ainda não há seções com início e fim confirmados para tratar a voz seção por seção. Não alterei nada.';
  if (result.reason === 'vocal_track_missing') return 'Não encontrei uma faixa identificada com segurança como sua voz. Não escolhi outra faixa por aproximação.';
  if (result.reason === 'vocal_track_ambiguous') return 'Há mais de uma faixa vocal possível. Selecione a voz principal no Studio e repita o tratamento.';
  if (result.reason === 'treatment_analysis_required' || result.reason === 'scan_analysis_required') return 'Preciso analisar a própria faixa vocal antes de tratar por prioridade. Não apliquei preset sem evidência acústica.';
  if (result.reason === 'no_scannable_confirmed_sections') return 'As seções confirmadas não estão cobertas com segurança pela faixa vocal atual. Não tratei outro áudio no lugar.';
  if (result.reason === 'no_priority_cleanup_evidence') return 'Varri as seções confirmadas, mas não encontrei trecho com evidência suficiente para aplicar limpeza automática com proteção de timbre. Não alterei nada por aproximação.';
  if (result.reason === 'priority_treatment_apply_failed') return 'O ranking encontrou candidatos, mas a aplicação não passou na verificação final. Não confirmei tratamento salvo.';
  return 'Não consegui resolver a faixa vocal e as seções com segurança. Não alterei o projeto.';
}

function appliedModules(modules = {}) {
  const applied = [];
  if (modules.breath?.applied) applied.push('respiração');
  if (modules.deesser?.applied) applied.push('sibilância');
  if (modules.plosive?.applied) applied.push('P/B');
  if (modules.click?.applied) applied.push('estalos');
  if (modules.dynamics?.applied) applied.push('picos');
  if (modules.denoise?.applied) applied.push('denoise');
  if (modules.dereverb?.applied) applied.push('de-reverb');
  return applied;
}
function sectionOccurrenceLabel(section) {
  const ordinal = ({ 1: '1º', 2: '2º', 3: '3º' })[section.occurrence] || `${section.occurrence}º`;
  return `${ordinal} ${String(section.label || 'seção').toLowerCase()}`;
}
function priorityLabel(priority) {
  if (priority === 'high') return 'prioridade alta';
  if (priority === 'medium') return 'prioridade média';
  if (priority === 'low') return 'prioridade baixa';
  return 'prioridade definida';
}
function appendMessage(text, role, result = null) {
  const log = document.querySelector('[data-pablo-log]');
  if (!log) return;
  const message = document.createElement('div');
  message.className = `pv-msg ${role}`;
  message.textContent = String(text || '');
  if (role === 'assistant' && result && !result.error) {
    const meta = document.createElement('small');
    meta.textContent = result.canApply ? 'Studio · tratamento vocal por prioridade salvo' : 'Studio · tratamento por prioridade não aplicado';
    message.appendChild(meta);
  }
  log.appendChild(message);
  log.scrollTop = log.scrollHeight;
}
function setBusy(form, busy) {
  const button = form?.querySelector('button[type="submit"]');
  if (button) button.disabled = Boolean(busy);
  form?.setAttribute('aria-busy', busy ? 'true' : 'false');
}
