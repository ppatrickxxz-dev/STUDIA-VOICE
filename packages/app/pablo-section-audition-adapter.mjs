import { parseSectionAuditionCommand, resolveConfirmedSectionAudition } from './core/src/section-audition.mjs';
import { activeProjectSessionId, getProject } from './storage.mjs';
import { auditionConfirmedSection } from './section-audition-runtime.mjs';

let mounted = false;

export function installPabloSectionAuditionAdapter() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', onPabloSubmitCapture, true);
}

async function onPabloSubmitCapture(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const input = form.querySelector('input[name="message"]');
  const original = String(input?.value || '').trim();
  const command = parseSectionAuditionCommand(original);
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
      appendMessage('Não encontrei o projeto ativo para tocar essa seção. Não iniciei nenhum áudio.', 'assistant');
      return;
    }
    const resolved = resolveConfirmedSectionAudition(project.arrangementMap, command.section, { occurrence: command.occurrence });
    if (!resolved.ok) {
      appendMessage(blockedReply(command, resolved), 'assistant');
      return;
    }
    await auditionConfirmedSection(project, resolved.section, { mode: 'processed' });
    appendMessage(
      `Tocando ${occurrenceLabel(command, resolved.section)} do início ao fim confirmado (${formatClock(resolved.startSeconds)} → ${formatClock(resolved.endSeconds)}).`,
      'assistant',
      { playing: true },
    );
  } catch (error) {
    appendMessage(error?.message || 'Não consegui tocar essa seção com segurança.', 'assistant', { error: true });
  } finally {
    setBusy(form, false);
  }
}

function blockedReply(command, resolved) {
  const label = command.label.toLowerCase();
  if (resolved.reason === 'missing_confirmed_section') return `Ainda não existe ${label} com timing confirmado neste projeto. Não iniciei nenhum áudio.`;
  if (resolved.reason === 'missing_confirmed_end') return `${command.label} tem início confirmado, mas o fim ainda não foi marcado. Diga onde ele termina antes de pedir para tocar a seção.`;
  if (resolved.reason === 'ambiguous_occurrence') return `Há ${resolved.count} ocorrências de ${label}. Diga qual você quer ouvir, como “toca o primeiro ${label}” ou “toca o segundo ${label}”.`;
  if (resolved.reason === 'missing_occurrence') return `Não encontrei a ${ordinalWord(resolved.occurrence)} ocorrência de ${label}. Não iniciei nenhum áudio.`;
  return `Não consegui resolver ${label} como uma seção completa e confirmada. Não iniciei nenhum áudio.`;
}

function occurrenceLabel(command) {
  return command.occurrence ? `${ordinalWord(command.occurrence)} ${command.label.toLowerCase()}` : command.label;
}

function ordinalWord(value) {
  return ({ 1: 'primeira', 2: 'segunda', 3: 'terceira' })[Number(value)] || `${value}ª`;
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
  if (result?.playing) {
    const meta = document.createElement('small');
    meta.textContent = 'Studio · audição da seção confirmada';
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
