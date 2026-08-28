import {
  applySectionVocalDeEsser,
  parseSectionVocalDeEsserCommand,
  PABLO_SECTION_VOCAL_DEESSER_SOURCE,
  resolveSectionVocalDeEsserTarget,
} from './core/src/section-vocal-deesser.mjs';
import { snapshotProject } from './core/src/project.mjs';
import { analyzeAudioTrack } from './audio-analysis-runtime.mjs';
import { activeProjectSessionId, getProject, saveProject } from './storage.mjs';

let mounted = false;

export function installPabloSectionVocalDeEsserAdapter() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', onPabloSubmitCapture, true);
}

async function onPabloSubmitCapture(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const input = form.querySelector('input[name="message"]');
  const original = String(input?.value || '').trim();
  const command = parseSectionVocalDeEsserCommand(original);
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

    const target = resolveSectionVocalDeEsserTarget(project, command);
    if (!target.ok) {
      appendMessage(blockedPlanReply(command, target), 'assistant', { canApply: false });
      return;
    }

    const analysis = await analyzeAudioTrack(target.track);
    const sibilanceEvents = analysis?.voice?.sibilanceEvents;
    const analysisSource = analysis?.voice?.eventDetection?.source;
    if (!Array.isArray(sibilanceEvents)) {
      throw new Error('A análise de sibilância não retornou evidência utilizável. Não alterei a voz.');
    }

    const result = applySectionVocalDeEsser(project, command, {
      sibilanceEvents,
      analysisSource,
      now: Date.now(),
    });
    if (!result.ok) {
      appendMessage(blockedPlanReply(command, result), 'assistant', { canApply: false });
      return;
    }

    const label = `De-esser vocal no ${result.section.label}`;
    const snapshotted = snapshotProject(result.project, label);
    await saveProject(snapshotted);
    const persisted = await getProject(project.id);
    const savedTrack = persisted?.tracks?.find((track) => track.id === result.track.id);
    const savedEvents = (savedTrack?.regionAutomation || []).filter((item) =>
      item?.source === PABLO_SECTION_VOCAL_DEESSER_SOURCE
      && String(item?.id || '').endsWith(`:${result.section.id}`));

    if (savedEvents.length !== result.events.length || !savedEvents.every((savedEvent) => {
      const planned = result.events.find((event) => event.id === savedEvent.id);
      return planned
        && savedEvent.kind === 'peaking_eq'
        && Number(savedEvent.gainDb) < 0
        && Math.abs(Number(savedEvent.gainDb) - planned.gainDb) < 0.001
        && Math.abs(Number(savedEvent.frequencyHz) - planned.frequencyHz) < 0.001
        && Math.abs(Number(savedEvent.q) - planned.q) < 0.001
        && Math.abs(Number(savedEvent.startSeconds) - planned.startSeconds) < 0.001
        && Math.abs(Number(savedEvent.endSeconds) - planned.endSeconds) < 0.001;
    })) {
      throw new Error('O de-esser regional não foi confirmado no projeto local. Não vou dizer que foi aplicado.');
    }

    globalThis.dispatchEvent(new CustomEvent('pablovoice:project-persisted', {
      detail: { projectId: project.id, source: PABLO_SECTION_VOCAL_DEESSER_SOURCE },
    }));
    appendMessage(
      `Encontrei ${result.detectedCount} sibilância(s) ${trackLabel(result.track)} no ${occurrenceLabel(command, result.section)} e reduzi só esses momentos. O brilho geral da voz e o restante da música ficaram intactos. Corte máximo: ${result.maxReductionDb.toFixed(1)} dB em torno de ${(result.frequencyHz / 1000).toFixed(1)} kHz.`,
      'assistant',
      { canApply: true },
    );
  } catch (error) {
    appendMessage(error?.message || 'Não consegui tratar a sibilância com segurança.', 'assistant', { error: true, canApply: false });
  } finally {
    setBusy(form, false);
  }
}

function blockedCommandReply(command) {
  if (command.reason === 'deesser_out_of_safe_range') {
    return `Você pediu até ${command.requestedReductionDb} dB de redução. Neste gate eu só aplico automaticamente entre 0,5 e 5 dB para evitar deixar a voz opaca. Não alterei o projeto.`;
  }
  return 'Não consegui transformar esse pedido em de-esser regional seguro. Não alterei o projeto.';
}

function blockedPlanReply(command, result) {
  if (result.reason === 'missing_confirmed_section') return `Ainda não existe ${command.label.toLowerCase()} com timing confirmado. Marque o início e o fim primeiro; não alterei a voz.`;
  if (result.reason === 'missing_confirmed_end') return `${command.label} ainda não tem fim confirmado. Marque onde termina antes de tratar só essa seção.`;
  if (result.reason === 'ambiguous_occurrence') return `Há ${result.sectionResult?.count || 'várias'} ocorrências de ${command.label.toLowerCase()}. Diga qual, por exemplo “segura os esses no primeiro ${command.label.toLowerCase()}”.`;
  if (result.reason === 'missing_occurrence') return `Não encontrei essa ocorrência de ${command.label.toLowerCase()}. Não alterei a voz.`;
  if (result.reason === 'vocal_track_missing') return 'Não encontrei uma faixa identificada de forma segura como sua voz. Grave uma voz ou selecione uma variante vocal antes de aplicar esse comando.';
  if (result.reason === 'vocal_track_ambiguous') return 'Há mais de uma faixa vocal possível. Selecione no Studio a voz que você quer editar e repita o pedido; não escolhi por você.';
  if (result.reason === 'section_outside_vocal_track') return `A faixa vocal não cobre o trecho confirmado de ${command.label.toLowerCase()}. Não criei tratamento fora do áudio existente.`;
  if (result.reason === 'no_sibilance_evidence') return `Não encontrei sibilância com confiança suficiente nesse ${command.label.toLowerCase()}. Não escureci a voz por aproximação e não alterei o projeto.`;
  if (result.reason === 'sibilance_analysis_required') return 'Preciso analisar a própria faixa vocal antes de tratar os esses. Nenhum corte foi criado sem essa evidência.';
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

function appendMessage(text, role, result = null) {
  const log = document.querySelector('[data-pablo-log]');
  if (!log) return;
  const message = document.createElement('div');
  message.className = `pv-msg ${role}`;
  message.textContent = String(text || '');
  if (role === 'assistant' && result && !result.error) {
    const meta = document.createElement('small');
    meta.textContent = result.canApply ? 'Studio · de-esser regional salvo' : 'Studio · edição não aplicada';
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
