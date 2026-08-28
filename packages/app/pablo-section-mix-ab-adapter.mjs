import { parseSectionMixABCommand, planSectionMixAB } from './core/src/section-mix-ab.mjs';
import { activeProjectSessionId, getProject } from './storage.mjs';
import { auditionSectionMixAB, stopSectionMixAB } from './section-mix-ab-runtime.mjs';

let mounted = false;

export function installPabloSectionMixABAdapter() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', onPabloSubmitCapture, true);
}

async function onPabloSubmitCapture(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const input = form.querySelector('input[name="message"]');
  const original = String(input?.value || '').trim();
  const command = parseSectionMixABCommand(original);
  if (!command) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (input) input.value = '';
  appendPlainMessage(original, 'user');
  setBusy(form, true);

  try {
    const projectId = activeProjectSessionId();
    const project = projectId ? await getProject(projectId) : null;
    if (!project) {
      appendPlainMessage('Não encontrei o projeto ativo para comparar essa seção.', 'assistant');
      return;
    }
    const plan = planSectionMixAB(project, command);
    if (!plan.ok) {
      appendPlainMessage(blockedReply(command, plan), 'assistant');
      return;
    }
    appendABPanel({ projectId: project.id, command, section: plan.section, eventCount: plan.matches.length });
  } catch (error) {
    appendPlainMessage(error?.message || 'Não consegui preparar o A/B dessa seção.', 'assistant');
  } finally {
    setBusy(form, false);
  }
}

function appendABPanel({ projectId, command, section, eventCount }) {
  const log = document.querySelector('[data-pablo-log]');
  if (!log) return;
  const panel = document.createElement('div');
  panel.className = 'pv-msg assistant';
  panel.dataset.sectionMixAb = section.id;

  const text = document.createElement('div');
  text.textContent = `${occurrenceLabel(command, section)} · A/B pronto. A mantém toda a mix processada, mas tira temporariamente só meus ${eventCount} ajuste(s) regional(is) dessa seção. B toca o projeto atual com esses ajustes.`;
  panel.appendChild(text);

  const meta = document.createElement('small');
  meta.textContent = 'A = sem ajustes regionais do Pablo · B = com ajustes atuais';
  panel.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'pv-actions';
  const a = button('Ouvir A', () => playVariant(projectId, section.id, 'A', panel));
  const b = button('Ouvir B', () => playVariant(projectId, section.id, 'B', panel));
  const keep = button('Manter B', () => {
    stopSectionMixAB();
    panel.dataset.decisionLocked = 'true';
    disableDecisionButtons(panel);
    appendPlainMessage(`Mantive os ajustes atuais no ${occurrenceLabel(command, section)}. O projeto não precisou ser regravado porque B já era o estado salvo.`, 'assistant');
  });
  const undo = button('Prefiro A · desfazer', () => requestCanonicalUndo(command));
  actions.append(a, b, keep, undo);
  panel.appendChild(actions);
  log.appendChild(panel);
  log.scrollTop = log.scrollHeight;
}

async function playVariant(projectId, sectionId, variant, panel) {
  const project = await getProject(projectId);
  const section = project?.arrangementMap?.sections?.find((item) => item.id === sectionId);
  if (!project || !section) throw new Error('Essa seção não está mais disponível para A/B. Abra a comparação novamente.');
  const status = await auditionSectionMixAB(project, section, variant);
  const line = panel.querySelector('small');
  if (line) {
    line.textContent = variant === 'A'
      ? `Tocando A · ${status.removedEvents} ajuste(s) do Pablo removido(s) só para esta audição.`
      : `Tocando B · ${status.comparedEvents} ajuste(s) do Pablo ativos no projeto atual.`;
  }
}

function requestCanonicalUndo(command) {
  stopSectionMixAB();
  const form = document.querySelector('[data-pablo-form]');
  const input = form?.querySelector('input[name="message"]');
  if (!form || !input) throw new Error('O chat do Pablo não está disponível para desfazer agora.');
  input.value = `desfaz o que você fez no ${undoOccurrenceLabel(command)}`;
  form.requestSubmit();
}

function blockedReply(command, plan) {
  const label = command.label.toLowerCase();
  if (plan.reason === 'nothing_to_compare') return `Não há ajustes regionais meus nesse ${label} para fazer A/B. A mix atual foi preservada.`;
  if (plan.reason === 'missing_confirmed_section') return `Ainda não existe ${label} com timing confirmado. Não iniciei comparação.`;
  if (plan.reason === 'missing_confirmed_end') return `${command.label} ainda não tem fim confirmado. Não vou comparar um intervalo aproximado.`;
  if (plan.reason === 'ambiguous_occurrence') return `Há ${plan.sectionResult?.count || 'várias'} ocorrências de ${label}. Diga qual, por exemplo “compara o primeiro ${label}”.`;
  if (plan.reason === 'missing_occurrence') return `Não encontrei essa ocorrência de ${label}. Não iniciei comparação.`;
  return `Não consegui resolver ${label} como uma seção segura para A/B.`;
}

function button(text, action) {
  const value = document.createElement('button');
  value.type = 'button';
  value.className = 'pv-btn';
  value.textContent = text;
  value.addEventListener('click', async () => {
    value.disabled = true;
    try { await action(); }
    catch (error) { appendPlainMessage(error?.message || 'Não consegui executar essa ação de A/B.', 'assistant'); }
    finally {
      const locked = value.closest('[data-decision-locked="true"]');
      if (value.isConnected && !locked) value.disabled = false;
    }
  });
  return value;
}

function disableDecisionButtons(panel) {
  panel.querySelectorAll('button').forEach((node) => { node.disabled = true; });
}

function occurrenceLabel(command, section) {
  if (!command.occurrence) return section.label;
  const ordinal = ({ 1: 'Primeiro', 2: 'Segundo', 3: 'Terceiro' })[command.occurrence] || `${command.occurrence}º`;
  return `${ordinal} ${section.label.toLowerCase()}`;
}

function undoOccurrenceLabel(command) {
  const label = command.label.toLowerCase();
  if (!command.occurrence) return label;
  const ordinal = ({ 1: 'primeiro', 2: 'segundo', 3: 'terceiro' })[command.occurrence] || `${command.occurrence}º`;
  return `${ordinal} ${label}`;
}

function appendPlainMessage(text, role) {
  const log = document.querySelector('[data-pablo-log]');
  if (!log) return;
  const message = document.createElement('div');
  message.className = `pv-msg ${role}`;
  message.textContent = String(text || '');
  log.appendChild(message);
  log.scrollTop = log.scrollHeight;
}

function setBusy(form, busy) {
  const button = form?.querySelector('button[type="submit"]');
  if (button) button.disabled = Boolean(busy);
  form?.setAttribute('aria-busy', busy ? 'true' : 'false');
}
