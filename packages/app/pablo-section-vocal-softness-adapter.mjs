import {
  applySectionVocalSoftness,
  parseSectionVocalSoftnessCommand,
  PABLO_SECTION_VOCAL_SOFTNESS_SOURCE,
  SOFTNESS_MODES,
} from './core/src/section-vocal-softness.mjs';
import { snapshotProject } from './core/src/project.mjs';
import { activeProjectSessionId, getProject, saveProject } from './storage.mjs';

let mounted = false;

export function installPabloSectionVocalSoftnessAdapter() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', onPabloSubmitCapture, true);
}

async function onPabloSubmitCapture(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const input = form.querySelector('input[name="message"]');
  const original = String(input?.value || '').trim();
  const command = parseSectionVocalSoftnessCommand(original);
  if (!command) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (input) input.value = '';
  appendMessage(original, 'user');
  setBusy(form, true);

  try {
    if (command.blocked) {
      appendMessage(blockedCommandReply(command), 'assistant', { canApply: false });
      return;
    }
    const projectId = activeProjectSessionId();
    const project = projectId ? await getProject(projectId) : null;
    if (!project) {
      appendMessage('Não encontrei o projeto ativo. Não alterei nenhuma faixa.', 'assistant', { canApply: false });
      return;
    }

    const result = applySectionVocalSoftness(project, command);
    if (!result.ok) {
      appendMessage(blockedPlanReply(command, result), 'assistant', { canApply: false });
      return;
    }

    const label = result.mode === SOFTNESS_MODES.DARKEN
      ? `Menos brilho vocal ${signedDb(result.gainDb)} no ${result.section.label}`
      : `Menos aspereza vocal ${signedDb(result.gainDb)} no ${result.section.label}`;
    const snapshotted = snapshotProject(result.project, label);
    await saveProject(snapshotted);
    const persisted = await getProject(project.id);
    const savedTrack = persisted?.tracks?.find((track) => track.id === result.track.id);
    const savedEvent = savedTrack?.regionAutomation?.find((item) => item.id === result.event.id && item.source === PABLO_SECTION_VOCAL_SOFTNESS_SOURCE);
    if (!savedEvent
      || savedEvent.kind !== result.event.kind
      || Math.abs(Number(savedEvent.gainDb) - result.gainDb) > 0.001
      || Math.abs(Number(savedEvent.frequencyHz) - result.frequencyHz) > 0.5
      || Math.abs(Number(savedEvent.q) - result.q) > 0.001) {
      throw new Error('A suavização regional não foi confirmada no projeto local. Não vou dizer que foi aplicada.');
    }

    globalThis.dispatchEvent(new CustomEvent('pablovoice:project-persisted', { detail: { projectId: project.id, source: PABLO_SECTION_VOCAL_SOFTNESS_SOURCE } }));
    appendMessage(successReply(result, command), 'assistant', { canApply: true });
  } catch (error) {
    appendMessage(error?.message || 'Não consegui suavizar essa seção com segurança.', 'assistant', { error: true, canApply: false });
  } finally {
    setBusy(form, false);
  }
}

function successReply(result, command) {
  const where = occurrenceLabel(command, result.section);
  if (result.mode === SOFTNESS_MODES.DARKEN) {
    return `Tirei um pouco do brilho ${trackLabel(result.track)} somente no ${where}: high-shelf de ${signedDb(result.gainDb)} a partir de ${formatKhz(result.frequencyHz)} (${formatClock(result.range.timelineStartSeconds)} → ${formatClock(result.range.timelineEndSeconds)}). Corpo, volume e outras seções foram preservados.`;
  }
  return `Suavizei a estridência ${trackLabel(result.track)} somente no ${where}: EQ de ${signedDb(result.gainDb)} em ${formatKhz(result.frequencyHz)}, Q ${result.q.toFixed(2).replace(/0$/, '')} (${formatClock(result.range.timelineStartSeconds)} → ${formatClock(result.range.timelineEndSeconds)}). Corpo, brilho geral, volume e outras seções foram preservados.`;
}

function blockedCommandReply(command) {
  if (command.reason === 'softness_out_of_safe_range') {
    return `Você pediu ${command.requestedReductionDb} dB de redução. Neste gate eu só aplico até ${command.maxReductionDb} dB automaticamente nesse tipo de suavização. Não alterei o projeto.`;
  }
  return 'Não consegui transformar esse pedido em uma suavização regional segura. Não alterei o projeto.';
}

function blockedPlanReply(command, result) {
  if (result.reason === 'missing_confirmed_section') return `Ainda não existe ${command.label.toLowerCase()} com timing confirmado. Marque o início e o fim primeiro; não alterei a voz.`;
  if (result.reason === 'missing_confirmed_end') return `${command.label} ainda não tem fim confirmado. Marque onde termina antes de suavizar só essa seção.`;
  if (result.reason === 'ambiguous_occurrence') return `Há ${result.sectionResult?.count || 'várias'} ocorrências de ${command.label.toLowerCase()}. Diga qual você quer suavizar.`;
  if (result.reason === 'missing_occurrence') return `Não encontrei essa ocorrência de ${command.label.toLowerCase()}. Não alterei a voz.`;
  if (result.reason === 'vocal_track_missing') return 'Não encontrei uma faixa identificada de forma segura como sua voz. Não alterei o projeto.';
  if (result.reason === 'vocal_track_ambiguous') return 'Há mais de uma faixa vocal possível. Selecione no Studio a voz que você quer editar e repita o pedido.';
  if (result.reason === 'section_outside_vocal_track') return `A faixa vocal não cobre o trecho confirmado de ${command.label.toLowerCase()}. Não criei EQ fora do áudio existente.`;
  return 'Não consegui resolver essa seção e faixa vocal com segurança. Não alterei o projeto.';
}

function trackLabel(track) {
  return track?.kind === 'voice_variant' ? `da variante “${track.name || 'Pablo Voice'}”` : `da faixa “${track?.name || 'voz'}”`;
}

function occurrenceLabel(command, section) {
  if (!command.occurrence) return section.label;
  const ordinal = ({ 1: 'primeiro', 2: 'segundo', 3: 'terceiro' })[command.occurrence] || `${command.occurrence}º`;
  return `${ordinal} ${section.label.toLowerCase()}`;
}

function signedDb(value) {
  const number = Number(value) || 0;
  return `${number >= 0 ? '+' : ''}${number.toFixed(1).replace('.0', '')} dB`;
}

function formatKhz(value) {
  return `${(Number(value || 0) / 1000).toFixed(1).replace('.0', '')} kHz`;
}

function formatClock(value) {
  const total = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function appendMessage(text, role, result = null) {
  const log = document.querySelector('[data-pablo-log]');
  if (!log) return;
  const message = document.createElement('div');
  message.className = `pv-msg ${role}`;
  message.textContent = String(text || '');
  if (role === 'assistant' && result && !result.error) {
    const meta = document.createElement('small');
    meta.textContent = result.canApply ? 'Studio · suavização regional salva' : 'Studio · edição não aplicada';
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
