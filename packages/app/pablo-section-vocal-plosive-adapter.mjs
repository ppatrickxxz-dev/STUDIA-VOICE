import {
  applySectionVocalPlosive,
  parseSectionVocalPlosiveCommand,
  PABLO_SECTION_VOCAL_PLOSIVE_SOURCE,
  resolveSectionVocalPlosiveTarget,
} from './core/src/section-vocal-plosive.mjs';
import { snapshotProject } from './core/src/project.mjs';
import { analyzeAudioTrack } from './audio-analysis-runtime.mjs';
import { activeProjectSessionId, getProject, saveProject } from './storage.mjs';

let mounted = false;

export function installPabloSectionVocalPlosiveAdapter() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', onPabloSubmitCapture, true);
}

async function onPabloSubmitCapture(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const input = form.querySelector('input[name="message"]');
  const original = String(input?.value || '').trim();
  const command = parseSectionVocalPlosiveCommand(original);
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
    const target = resolveSectionVocalPlosiveTarget(project, command);
    if (!target.ok) {
      appendMessage(blockedPlanReply(command, target), 'assistant', { canApply: false });
      return;
    }
    const analysis = await analyzeAudioTrack(target.track);
    const plosiveEvents = analysis?.voice?.plosiveEvents;
    const analysisSource = analysis?.voice?.eventDetection?.source;
    if (!Array.isArray(plosiveEvents)) throw new Error('A análise de plosivas não retornou evidência utilizável. Não alterei a voz.');
    const result = applySectionVocalPlosive(project, command, { plosiveEvents, analysisSource, now: Date.now() });
    if (!result.ok) {
      appendMessage(blockedPlanReply(command, result), 'assistant', { canApply: false });
      return;
    }
    const label = `Plosivas vocais no ${result.section.label}`;
    const snapshotted = snapshotProject(result.project, label);
    await saveProject(snapshotted);
    const persisted = await getProject(project.id);
    const savedTrack = persisted?.tracks?.find((track) => track.id === result.track.id);
    const savedEvents = (savedTrack?.regionAutomation || []).filter((item) =>
      item?.source === PABLO_SECTION_VOCAL_PLOSIVE_SOURCE && String(item?.id || '').endsWith(`:${result.section.id}`));
    if (savedEvents.length !== result.events.length || !savedEvents.every((savedEvent) => {
      const planned = result.events.find((plannedEvent) => plannedEvent.id === savedEvent.id);
      return planned
        && savedEvent.kind === 'peaking_eq'
        && Number(savedEvent.gainDb) < 0
        && Number(savedEvent.frequencyHz) >= 80
        && Number(savedEvent.frequencyHz) <= 260
        && Math.abs(Number(savedEvent.gainDb) - planned.gainDb) < 0.001
        && Math.abs(Number(savedEvent.frequencyHz) - planned.frequencyHz) < 0.001
        && Math.abs(Number(savedEvent.startSeconds) - planned.startSeconds) < 0.001
        && Math.abs(Number(savedEvent.endSeconds) - planned.endSeconds) < 0.001;
    })) throw new Error('O tratamento de plosivas não foi confirmado no projeto local. Não vou dizer que foi aplicado.');
    globalThis.dispatchEvent(new CustomEvent('pablovoice:project-persisted', {
      detail: { projectId: project.id, source: PABLO_SECTION_VOCAL_PLOSIVE_SOURCE },
    }));
    const [low, high] = result.frequencyRangeHz;
    const rangeText = low === high ? `${low} Hz` : `${low}–${high} Hz`;
    appendMessage(
      `Encontrei ${result.detectedCount} plosiva(s) ${trackLabel(result.track)} no ${occurrenceLabel(command, result.section)} e reduzi só os estouros. O corpo e o grave contínuo da voz ficaram intactos. Faixa medida: ${rangeText}; corte máximo: ${result.maxReductionDb.toFixed(1)} dB.`,
      'assistant',
      { canApply: true },
    );
  } catch (error) {
    appendMessage(error?.message || 'Não consegui tratar as plosivas com segurança.', 'assistant', { error: true, canApply: false });
  } finally {
    setBusy(form, false);
  }
}

function blockedCommandReply(command) {
  if (command.reason === 'plosive_out_of_safe_range') return `Você pediu até ${command.requestedReductionDb} dB de redução. Neste gate eu só aplico automaticamente entre 0,5 e 6 dB para preservar o grave natural da voz. Não alterei o projeto.`;
  return 'Não consegui transformar esse pedido em tratamento regional de plosivas seguro. Não alterei o projeto.';
}
function blockedPlanReply(command, result) {
  if (result.reason === 'missing_confirmed_section') return `Ainda não existe ${command.label.toLowerCase()} com timing confirmado. Marque o início e o fim primeiro; não alterei a voz.`;
  if (result.reason === 'missing_confirmed_end') return `${command.label} ainda não tem fim confirmado. Marque onde termina antes de tratar só essa seção.`;
  if (result.reason === 'ambiguous_occurrence') return `Há ${result.sectionResult?.count || 'várias'} ocorrências de ${command.label.toLowerCase()}. Diga qual você quer tratar.`;
  if (result.reason === 'vocal_track_missing') return 'Não encontrei uma faixa identificada com segurança como sua voz. Não escolhi uma faixa por aproximação.';
  if (result.reason === 'vocal_track_ambiguous') return 'Há mais de uma faixa vocal possível. Selecione a voz no Studio e repita o pedido.';
  if (result.reason === 'section_outside_vocal_track') return `A faixa vocal não cobre o trecho confirmado de ${command.label.toLowerCase()}. Não criei tratamento fora do áudio existente.`;
  if (result.reason === 'no_plosive_evidence') return `Não encontrei estouros de P/B com evidência suficiente nesse ${command.label.toLowerCase()}. Não cortei os graves por aproximação e não alterei o projeto.`;
  if (result.reason === 'plosive_analysis_required') return 'Preciso analisar a própria faixa vocal antes de tratar P/B. Nenhum corte foi criado sem essa evidência.';
  return 'Não consegui resolver essa seção e faixa vocal com segurança. Não alterei o projeto.';
}
function trackLabel(track) { return track?.kind === 'voice_variant' ? `na variante “${track.name || 'Pablo Voice'}”` : `na faixa “${track?.name || 'voz'}”`; }
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
    meta.textContent = result.canApply ? 'Studio · plosivas tratadas' : 'Studio · edição não aplicada';
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
