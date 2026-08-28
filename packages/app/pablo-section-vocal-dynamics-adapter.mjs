import {
  applySectionVocalDynamics,
  parseSectionVocalDynamicsCommand,
  PABLO_SECTION_VOCAL_DYNAMICS_SOURCE,
} from './core/src/section-vocal-dynamics.mjs';
import { snapshotProject } from './core/src/project.mjs';
import { activeProjectSessionId, getProject, saveProject } from './storage.mjs';

let mounted = false;

export function installPabloSectionVocalDynamicsAdapter() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', onPabloSubmitCapture, true);
}

async function onPabloSubmitCapture(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const input = form.querySelector('input[name="message"]');
  const original = String(input?.value || '').trim();
  const command = parseSectionVocalDynamicsCommand(original);
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

    const result = applySectionVocalDynamics(project, command);
    if (!result.ok) {
      appendMessage(blockedPlanReply(command, result), 'assistant', { canApply: false });
      return;
    }

    const label = `Dinâmica vocal ${result.ratio.toFixed(1)}:1 no ${result.section.label}`;
    const snapshotted = snapshotProject(result.project, label);
    await saveProject(snapshotted);
    const persisted = await getProject(project.id);
    const savedTrack = persisted?.tracks?.find((track) => track.id === result.track.id);
    const savedEvent = savedTrack?.regionAutomation?.find((item) => item.id === result.event.id && item.source === PABLO_SECTION_VOCAL_DYNAMICS_SOURCE);
    if (!savedEvent
      || savedEvent.kind !== 'compressor'
      || Math.abs(Number(savedEvent.thresholdDb) - result.thresholdDb) > 0.001
      || Math.abs(Number(savedEvent.ratio) - result.ratio) > 0.001
      || Math.abs(Number(savedEvent.attackSeconds) - result.attackSeconds) > 0.0001
      || Math.abs(Number(savedEvent.releaseSeconds) - result.releaseSeconds) > 0.0001) {
      throw new Error('A dinâmica regional não foi confirmada no projeto local. Não vou dizer que foi aplicada.');
    }

    globalThis.dispatchEvent(new CustomEvent('pablovoice:project-persisted', { detail: { projectId: project.id, source: PABLO_SECTION_VOCAL_DYNAMICS_SOURCE } }));
    appendMessage(
      `Segurei os picos ${trackLabel(result.track)} somente no ${occurrenceLabel(command, result.section)}: compressão ${result.ratio.toFixed(1)}:1 com entrada em ${result.thresholdDb.toFixed(0)} dB (${formatClock(result.range.timelineStartSeconds)} → ${formatClock(result.range.timelineEndSeconds)}). Fora desse trecho o compressor volta a 1:1. Volume, EQ, outras seções e outras faixas foram preservados.${result.range.clippedToTrack ? ' O efeito ficou limitado ao trecho em que essa voz realmente existe.' : ''}`,
      'assistant',
      { canApply: true },
    );
  } catch (error) {
    appendMessage(error?.message || 'Não consegui controlar essa dinâmica com segurança.', 'assistant', { error: true, canApply: false });
  } finally {
    setBusy(form, false);
  }
}

function blockedCommandReply(command) {
  if (command.reason === 'dynamics_out_of_safe_range') {
    return `Você pediu compressão ${command.requestedRatio}:1. Neste primeiro gate eu só aplico automaticamente entre 1,2:1 e 4:1 para preservar naturalidade. Não alterei o projeto.`;
  }
  return 'Não consegui transformar esse pedido em dinâmica regional segura. Não alterei o projeto.';
}

function blockedPlanReply(command, result) {
  if (result.reason === 'missing_confirmed_section') return `Ainda não existe ${command.label.toLowerCase()} com timing confirmado. Marque o início e o fim primeiro; não alterei a voz.`;
  if (result.reason === 'missing_confirmed_end') return `${command.label} ainda não tem fim confirmado. Marque onde termina antes de controlar a dinâmica só dessa seção.`;
  if (result.reason === 'ambiguous_occurrence') return `Há ${result.sectionResult?.count || 'várias'} ocorrências de ${command.label.toLowerCase()}. Diga qual, por exemplo “segura os picos da minha voz só no primeiro ${command.label.toLowerCase()}”.`;
  if (result.reason === 'missing_occurrence') return `Não encontrei essa ocorrência de ${command.label.toLowerCase()}. Não alterei a voz.`;
  if (result.reason === 'vocal_track_missing') return 'Não encontrei uma faixa identificada de forma segura como sua voz. Grave uma voz ou selecione uma variante vocal antes de aplicar esse comando.';
  if (result.reason === 'vocal_track_ambiguous') return 'Há mais de uma faixa vocal possível. Selecione no Studio a voz que você quer editar e repita o pedido; não escolhi por você.';
  if (result.reason === 'section_outside_vocal_track') return `A faixa vocal não cobre o trecho confirmado de ${command.label.toLowerCase()}. Não criei compressão fora do áudio existente.`;
  return 'Não consegui resolver essa seção e faixa vocal com segurança. Não alterei o projeto.';
}

function trackLabel(track) {
  return track?.kind === 'voice_variant' ? `na variante “${track.name || 'Pablo Voice'}”` : `na faixa “${track?.name || 'voz'}”`;
}

function occurrenceLabel(command, section) {
  if (!command.occurrence) return section.label;
  const ordinal = ({ 1: 'primeiro', 2: 'segundo', 3: 'terceiro' })[command.occurrence] || `${command.occurrence}º`;
  return `${ordinal} ${section.label.toLowerCase()}`;
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
    meta.textContent = result.canApply ? 'Studio · dinâmica regional salva' : 'Studio · edição não aplicada';
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
