import { applySectionVocalSpace, parseSectionVocalSpaceCommand, PABLO_SECTION_VOCAL_SPACE_SOURCE } from './core/src/section-vocal-space.mjs';
import { snapshotProject } from './core/src/project.mjs';
import { activeProjectSessionId, getProject, saveProject } from './storage.mjs';

let mounted = false;

export function installPabloSectionVocalSpaceAdapter() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', onPabloSubmitCapture, true);
}

async function onPabloSubmitCapture(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const input = form.querySelector('input[name="message"]');
  const original = String(input?.value || '').trim();
  const command = parseSectionVocalSpaceCommand(original);
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

    const result = applySectionVocalSpace(project, command);
    if (!result.ok) {
      appendMessage(blockedPlanReply(command, result), 'assistant', { canApply: false });
      return;
    }

    const label = `Espaço vocal ${signedDb(result.gainDb)} no ${result.section.label}`;
    const snapshotted = snapshotProject(result.project, label);
    await saveProject(snapshotted);
    const persisted = await getProject(project.id);
    const savedTrack = persisted?.tracks?.find((track) => track.id === result.track.id);
    const savedEvent = savedTrack?.regionAutomation?.find((item) => item.id === result.event.id && item.source === PABLO_SECTION_VOCAL_SPACE_SOURCE);
    if (!savedEvent || Math.abs(Number(savedEvent.gainDb) - result.gainDb) > 0.001) {
      throw new Error('A edição de espaço vocal não foi confirmada no projeto local. Não vou dizer que foi aplicada.');
    }

    globalThis.dispatchEvent(new CustomEvent('pablovoice:project-persisted', { detail: { projectId: project.id, source: PABLO_SECTION_VOCAL_SPACE_SOURCE } }));
    appendMessage(
      `Abri espaço para ${vocalLabel(result.vocalTrack)} reduzindo “${result.track.name || 'apoio'}” em ${Math.abs(result.gainDb).toFixed(1).replace('.0', '')} dB somente no ${occurrenceLabel(command, result.section)} (${formatClock(result.range.timelineStartSeconds)} → ${formatClock(result.range.timelineEndSeconds)}). A voz não foi alterada e o restante da música ficou intacto.${result.range.clippedToTrack ? ' A automação ficou limitada ao trecho em que a faixa de apoio realmente existe.' : ''}`,
      'assistant',
      { canApply: true },
    );
  } catch (error) {
    appendMessage(error?.message || 'Não consegui abrir esse espaço com segurança.', 'assistant', { error: true, canApply: false });
  } finally {
    setBusy(form, false);
  }
}

function blockedCommandReply(command) {
  if (command.reason === 'attenuation_out_of_safe_range') {
    return `Você pediu ${command.requestedAttenuationDb} dB de redução. Neste primeiro gate eu só atenúo automaticamente até 3 dB por seção. Não alterei o projeto.`;
  }
  return 'Não consegui transformar esse pedido em uma redução regional segura. Não alterei o projeto.';
}

function blockedPlanReply(command, result) {
  if (result.reason === 'missing_confirmed_section') return `Ainda não existe ${command.label.toLowerCase()} com timing confirmado. Marque o início e o fim primeiro; não alterei a mix.`;
  if (result.reason === 'missing_confirmed_end') return `${command.label} ainda não tem fim confirmado. Marque onde termina antes de abrir espaço só nessa seção.`;
  if (result.reason === 'ambiguous_occurrence') return `Há ${result.sectionResult?.count || 'várias'} ocorrências de ${command.label.toLowerCase()}. Diga qual, por exemplo “abre espaço pra minha voz só no primeiro ${command.label.toLowerCase()}”.`;
  if (result.reason === 'missing_occurrence') return `Não encontrei essa ocorrência de ${command.label.toLowerCase()}. Não alterei a mix.`;
  if (result.reason === 'vocal_track_missing') return 'Não encontrei uma faixa identificada com segurança como sua voz. Não vou reduzir outra faixa sem esse alvo vocal confirmado.';
  if (result.reason === 'vocal_track_ambiguous') return 'Há mais de uma faixa vocal possível. Selecione a voz desejada no Studio antes de pedir espaço em volta dela.';
  if (result.reason === 'support_track_missing') return 'Não encontrei uma faixa de apoio elegível para reduzir. Voz, harmonia e viradas geradas não serão tratadas como instrumental por suposição.';
  if (result.reason === 'support_track_ambiguous') return `Há ${result.candidates?.length || 'várias'} faixas de apoio possíveis. Não escolhi uma arbitrariamente; organize ou deixe uma única base/beat elegível antes de repetir.`;
  if (result.reason === 'section_outside_support_track') return `A faixa de apoio não cobre o trecho confirmado de ${command.label.toLowerCase()}. Não criei automação fora do áudio existente.`;
  return 'Não consegui resolver essa seção e a faixa de apoio com segurança. Não alterei o projeto.';
}

function vocalLabel(track) {
  return track?.kind === 'voice_variant' ? `a variante “${track.name || 'Pablo Voice'}”` : `a voz “${track?.name || 'principal'}”`;
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
    meta.textContent = result.canApply ? 'Studio · espaço regional salvo' : 'Studio · edição não aplicada';
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
