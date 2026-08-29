import {
  applySectionVocalPresence,
  parseSectionVocalPresenceCommand,
  PABLO_SECTION_VOCAL_PRESENCE_SOURCE,
} from './core/src/section-vocal-presence.mjs';
import { snapshotProject } from './core/src/project.mjs';
import { activeProjectSessionId, getProject, saveProject } from './storage.mjs';

let mounted = false;

export function installPabloSectionVocalPresenceAdapter() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', onPabloSubmitCapture, true);
}

async function onPabloSubmitCapture(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const input = form.querySelector('input[name="message"]');
  const original = String(input?.value || '').trim();
  const command = parseSectionVocalPresenceCommand(original);
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

    const result = applySectionVocalPresence(project, command);
    if (!result.ok) {
      appendMessage(blockedPlanReply(command, result), 'assistant', { canApply: false });
      return;
    }

    const label = `Presença vocal ${signedDb(result.gainDb)} no ${result.section.label}`;
    const snapshotted = snapshotProject(result.project, label);
    await saveProject(snapshotted);
    const persisted = await getProject(project.id);
    const savedTrack = persisted?.tracks?.find((track) => track.id === result.track.id);
    const savedEvent = savedTrack?.regionAutomation?.find((item) => item.id === result.event.id && item.source === PABLO_SECTION_VOCAL_PRESENCE_SOURCE);
    if (!savedEvent
      || savedEvent.kind !== 'peaking_eq'
      || Math.abs(Number(savedEvent.gainDb) - result.gainDb) > 0.001
      || Math.abs(Number(savedEvent.frequencyHz) - result.frequencyHz) > 0.5
      || Math.abs(Number(savedEvent.q) - result.q) > 0.001) {
      throw new Error('A presença regional não foi confirmada no projeto local. Não vou dizer que foi aplicada.');
    }

    globalThis.dispatchEvent(new CustomEvent('pablovoice:project-persisted', { detail: { projectId: project.id, source: PABLO_SECTION_VOCAL_PRESENCE_SOURCE } }));
    appendMessage(
      `Trouxe ${trackLabel(result.track)} mais para frente somente no ${occurrenceLabel(command, result.section)}: presença de ${signedDb(result.gainDb)} em ${formatKhz(result.frequencyHz)}, Q ${result.q.toFixed(2)} (${formatClock(result.range.timelineStartSeconds)} → ${formatClock(result.range.timelineEndSeconds)}). Volume, brilho, corpo, suavização, outras seções e outras faixas foram preservados.${result.range.clippedToTrack ? ' O efeito ficou limitado ao trecho em que essa voz realmente existe.' : ''}`,
      'assistant',
      { canApply: true },
    );
  } catch (error) {
    appendMessage(error?.message || 'Não consegui aplicar essa presença com segurança.', 'assistant', { error: true, canApply: false });
  } finally {
    setBusy(form, false);
  }
}

function blockedCommandReply(command) {
  if (command.reason === 'presence_out_of_safe_range') {
    return `Você pediu ${command.requestedGainDb} dB de presença. Neste gate eu só aplico até +3,5 dB de EQ regional automaticamente para evitar deixar a voz agressiva. Não alterei o projeto.`;
  }
  return 'Não consegui transformar esse pedido em presença regional segura. Não alterei o projeto.';
}

function blockedPlanReply(command, result) {
  if (result.reason === 'missing_confirmed_section') return `Ainda não existe ${command.label.toLowerCase()} com timing confirmado. Marque o início e o fim primeiro; não alterei a voz.`;
  if (result.reason === 'missing_confirmed_end') return `${command.label} ainda não tem fim confirmado. Marque onde termina antes de mudar a presença só dessa seção.`;
  if (result.reason === 'ambiguous_occurrence') return `Há ${result.sectionResult?.count || 'várias'} ocorrências de ${command.label.toLowerCase()}. Diga qual, por exemplo “deixa minha voz mais presente só no primeiro ${command.label.toLowerCase()}”.`;
  if (result.reason === 'missing_occurrence') return `Não encontrei essa ocorrência de ${command.label.toLowerCase()}. Não alterei a voz.`;
  if (result.reason === 'vocal_track_missing') return 'Não encontrei uma faixa identificada de forma segura como sua voz. Grave uma voz ou selecione uma variante vocal antes de aplicar esse comando.';
  if (result.reason === 'vocal_track_ambiguous') return 'Há mais de uma faixa vocal possível. Selecione no Studio a voz que você quer editar e repita o pedido; não escolhi por você.';
  if (result.reason === 'section_outside_vocal_track') return `A faixa vocal não cobre o trecho confirmado de ${command.label.toLowerCase()}. Não criei EQ fora do áudio existente.`;
  return 'Não consegui resolver essa seção e faixa vocal com segurança. Não alterei o projeto.';
}

function trackLabel(track) {
  return track?.kind === 'voice_variant' ? `a variante “${track.name || 'Pablo Voice'}”` : `a faixa “${track?.name || 'voz'}”`;
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
    meta.textContent = result.canApply ? 'Studio · presença regional salva' : 'Studio · edição não aplicada';
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
