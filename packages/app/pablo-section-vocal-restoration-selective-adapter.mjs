import {
  applySelectiveVocalRestoration,
  parseSelectiveVocalRestorationCommand,
  resolveSelectiveVocalRestorationTarget,
  SELECTIVE_VOCAL_RESTORATION_MODES,
} from './core/src/section-vocal-restoration-selective.mjs';
import { snapshotProject } from './core/src/project.mjs';
import { analyzeAudioTrack } from './audio-analysis-runtime.mjs';
import { activeProjectSessionId, getProject, saveProject } from './storage.mjs';

let mounted = false;

export function installPabloSectionVocalRestorationSelectiveAdapter() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', onPabloSubmitCapture, true);
}

async function onPabloSubmitCapture(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const input = form.querySelector('input[name="message"]');
  const original = String(input?.value || '').trim();
  const command = parseSelectiveVocalRestorationCommand(original);
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
      appendMessage('Não encontrei o projeto ativo. Não alterei nenhuma faixa.', 'assistant', { applied: false });
      return;
    }
    const target = resolveSelectiveVocalRestorationTarget(project, command);
    if (!target.ok) {
      appendMessage(blockedReply(command, target), 'assistant', { applied: false });
      return;
    }
    const analysis = await analyzeAudioTrack(target.track);
    const result = applySelectiveVocalRestoration(project, command, { analysis, now: Date.now() });
    if (!result.ok) {
      appendMessage(blockedReply(command, result), 'assistant', { applied: false });
      return;
    }

    const label = command.mode === SELECTIVE_VOCAL_RESTORATION_MODES.DENOISE
      ? `Denoise seletivo no ${result.section.label}`
      : `De-reverb seletivo no ${result.section.label}`;
    const snapshotted = snapshotProject(result.project, label);
    await saveProject(snapshotted);
    const persisted = await getProject(project.id);
    const savedTrack = persisted?.tracks?.find((track) => track.id === result.track.id);
    const saved = (savedTrack?.regionAutomation || []).filter((item) => item?.source === result.source && belongsToSection(item, result.section.id));
    if (saved.length !== result.events.length || !saved.every((event) => verifiedEvent(event, result.events))) {
      throw new Error('A restauração seletiva não foi confirmada no projeto local. Não vou dizer que foi aplicada.');
    }
    globalThis.dispatchEvent(new CustomEvent('pablovoice:project-persisted', {
      detail: { projectId: project.id, source: result.source },
    }));
    appendMessage(successReply(command, result), 'assistant', { applied: true });
  } catch (error) {
    appendMessage(error?.message || 'Não consegui aplicar essa restauração seletiva com segurança.', 'assistant', { error: true, applied: false });
  } finally {
    setBusy(form, false);
  }
}

function successReply(command, result) {
  const where = occurrenceLabel(command, result.section);
  if (command.mode === SELECTIVE_VOCAL_RESTORATION_MODES.DENOISE) {
    const maxReduction = Math.max(...result.events.map((event) => Number(event.reductionDb) || 0), 0);
    const minMargin = Math.min(...result.events.map((event) => Number(event.voicedMarginDb)).filter(Number.isFinite));
    return `Apliquei só o denoise no ${where}: ${result.events.length} trecho(s), redução máxima ${maxReduction.toFixed(1)} dB e margem vocal mínima ${Number.isFinite(minMargin) ? minMargin.toFixed(1) : '—'} dB. Não apliquei de-reverb nem mexi nas outras correções da voz.`;
  }
  const maxAmount = Math.max(...result.events.map((event) => Number(event.amount) || 0), 0);
  return `Apliquei só o de-reverb no ${where}: ${result.events.length} trecho(s), intensidade máxima ${maxAmount.toFixed(2)}. Não apliquei denoise nem mexi nas outras correções da voz.`;
}

function blockedReply(command, result) {
  if (result.reason === 'missing_confirmed_section') return `Ainda não existe ${command.label.toLowerCase()} com timing confirmado. Marque início e fim antes de restaurar só essa seção.`;
  if (result.reason === 'missing_confirmed_end') return `${command.label} ainda não tem fim confirmado. Marque onde termina antes da restauração seletiva.`;
  if (result.reason === 'ambiguous_occurrence') return `Há ${result.sectionResult?.count || 'várias'} ocorrências de ${command.label.toLowerCase()}. Diga qual você quer restaurar.`;
  if (result.reason === 'vocal_track_missing') return 'Não encontrei uma faixa identificada com segurança como sua voz. Não escolhi uma faixa por aproximação.';
  if (result.reason === 'vocal_track_ambiguous') return 'Há mais de uma faixa vocal possível. Selecione a voz no Studio e repita o pedido.';
  if (result.reason === 'section_outside_vocal_track') return `A faixa vocal não cobre o trecho confirmado de ${command.label.toLowerCase()}. Não alterei outro áudio no lugar.`;
  if (result.reason === 'restoration_analysis_required') return 'Preciso analisar a própria faixa antes da restauração seletiva. Não apliquei um preset sem evidência.';
  if (result.reason === 'no_safe_noise_profile') return `O denoise não passou o gate v9 nessa seção. Não reduzi ruído sem SNR, margem vocal e proteção de timbre suficientes.`;
  if (result.reason === 'no_safe_reverb_profile') return `O de-reverb não passou o gate v9 nessa seção. Não removi ambiente sem reflexão consistente e proteção de timbre suficientes.`;
  return 'Não consegui aplicar essa restauração seletiva com segurança. Não alterei o projeto.';
}

function verifiedEvent(saved, plannedEvents) {
  const planned = plannedEvents.find((event) => event.id === saved.id);
  if (!planned || saved.kind !== planned.kind || saved.timbreProtected !== true || saved.guardSource !== planned.guardSource) return false;
  const fields = saved.kind === 'vocal_denoise'
    ? ['startSeconds', 'endSeconds', 'thresholdDb', 'reductionDb', 'noiseFloorDb', 'voicedLevelDb', 'snrDb', 'voicedMarginDb']
    : ['startSeconds', 'endSeconds', 'reflectionDelayMs', 'amount', 'dampingHz', 'correlation', 'prominence'];
  return fields.every((field) => Math.abs(Number(saved?.[field]) - Number(planned?.[field])) <= 0.001);
}
function belongsToSection(event, sectionId) { return Boolean(sectionId) && String(event?.id || '').endsWith(`:${sectionId}`); }
function occurrenceLabel(command, section) {
  if (!command.occurrence) return section.label;
  const ordinal = ({ 1: 'primeiro', 2: 'segundo', 3: 'terceiro' })[command.occurrence] || `${command.occurrence}º`;
  return `${ordinal} ${section.label.toLowerCase()}`;
}
function appendMessage(text, role, result = null) {
  const log = document.querySelector('[data-pablo-log]');
  if (!log) return;
  const message = document.createElement('div');
  message.className = `pv-msg ${role}`;
  message.textContent = String(text || '');
  if (role === 'assistant' && result && !result.error) {
    const meta = document.createElement('small');
    meta.textContent = result.applied ? 'Studio · restauração seletiva · salvo' : 'Studio · restauração seletiva · não aplicada';
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
