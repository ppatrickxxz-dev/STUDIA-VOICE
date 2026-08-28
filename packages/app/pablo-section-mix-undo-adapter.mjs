import {
  applySectionMixUndo,
  countSectionMixEvents,
  parseSectionMixUndoCommand,
  SECTION_MIX_UNDO_MODES,
} from './core/src/section-mix-undo.mjs';
import { snapshotProject } from './core/src/project.mjs';
import { activeProjectSessionId, getProject, saveProject } from './storage.mjs';

let mounted = false;

export function installPabloSectionMixUndoAdapter() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', onPabloSubmitCapture, true);
}

async function onPabloSubmitCapture(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const input = form.querySelector('input[name="message"]');
  const original = String(input?.value || '').trim();
  const command = parseSectionMixUndoCommand(original);
  if (!command) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (input) input.value = '';
  appendMessage(original, 'user');
  setBusy(form, true);
  try {
    const projectId = activeProjectSessionId();
    const project = projectId ? await getProject(projectId) : null;
    if (!project) { appendMessage('Não encontrei o projeto ativo. Não desfiz nada.', 'assistant', { canApply: false }); return; }
    const result = applySectionMixUndo(project, command);
    if (!result.ok) { appendMessage(blockedReply(command, result), 'assistant', { canApply: false }); return; }
    const beforeCount = result.matches.length;
    const snapshotted = snapshotProject(result.project, undoRevisionLabel(command, result.section));
    await saveProject(snapshotted);
    const persisted = await getProject(project.id);
    const remaining = countSectionMixEvents(persisted, result.section.id, command.mode);
    if (remaining !== 0) throw new Error('O desfazer não foi confirmado no projeto local. Não vou dizer que foi concluído.');
    globalThis.dispatchEvent(new CustomEvent('pablovoice:project-persisted', { detail: { projectId: project.id, source: 'pablo_section_mix_undo' } }));
    appendMessage(successReply(command, result.section, beforeCount), 'assistant', { canApply: true });
  } catch (error) {
    appendMessage(error?.message || 'Não consegui desfazer essa edição com segurança.', 'assistant', { error: true, canApply: false });
  } finally { setBusy(form, false); }
}

function blockedReply(command, result) {
  if (result.reason === 'missing_confirmed_section') return `Não encontrei ${command.label.toLowerCase()} com timing confirmado. Não desfiz nenhuma automação.`;
  if (result.reason === 'missing_confirmed_end') return `${command.label} ainda não tem um intervalo completo confirmado. Não removi automações por aproximação.`;
  if (result.reason === 'ambiguous_occurrence') return `Há ${result.sectionResult?.count || 'várias'} ocorrências de ${command.label.toLowerCase()}. Diga qual trecho você quer desfazer.`;
  if (result.reason === 'missing_occurrence') return `Não encontrei essa ocorrência de ${command.label.toLowerCase()}. Não desfiz nada.`;
  if (result.reason === 'nothing_to_undo') return `Não encontrei ${modeLabel(command.mode)} criado pelo Pablo nesse ${command.label.toLowerCase()}. Automação manual e outras edições foram preservadas.`;
  return 'Não consegui identificar com segurança qual edição regional desfazer. Não alterei o projeto.';
}

function successReply(command, section, count) {
  const where = occurrenceLabel(command, section);
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_PLOSIVE) return `Desfiz o tratamento de plosivas que eu tinha criado no ${where}. Removi ${count} microcorte(s) de P/B do Pablo e preservei corpo, grave contínuo, de-esser, dinâmica, respirações e ajustes manuais.`;
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_DEESSER) return `Desfiz o de-esser vocal que eu tinha criado no ${where}. Removi ${count} microcorte(s) de sibilância do Pablo e preservei brilho geral, presença, dinâmica, volume, outros EQs, respirações e ajustes manuais.`;
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_DYNAMICS) return `Desfiz a dinâmica vocal que eu tinha criado no ${where}. Removi ${count} compressor regional do Pablo e preservei de-esser, volume, EQ, respirações e ajustes manuais.`;
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_GAIN) return `Desfiz o ganho vocal que eu tinha criado no ${where}. Removi ${count} automação(ões) do Pablo e preservei de-esser, dinâmica, presença, corpo, brilho, suavização, espaço instrumental, respirações e ajustes manuais.`;
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_SPACE) return `Desfiz o espaço vocal que eu tinha criado no ${where}. Removi ${count} automação(ões) do Pablo e preservei de-esser, dinâmica, ganho, presença, corpo, brilho, suavização, respirações e ajustes manuais.`;
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_BRIGHTNESS) return `Desfiz o brilho vocal que eu tinha criado no ${where}. Removi ${count} high-shelf regional do Pablo e preservei de-esser, dinâmica, ganho, presença, corpo, suavização, espaço instrumental, respirações e ajustes manuais.`;
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_BODY) return `Desfiz o corpo vocal que eu tinha criado no ${where}. Removi ${count} EQ regional do Pablo e preservei de-esser, dinâmica, ganho, presença, brilho, suavização, espaço instrumental, respirações e ajustes manuais.`;
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_SOFTNESS) return `Desfiz a suavização vocal que eu tinha criado no ${where}. Removi ${count} EQ regional redutivo do Pablo e preservei de-esser, dinâmica, ganho, presença, corpo, brilho positivo, espaço instrumental, respirações e ajustes manuais.`;
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_PRESENCE) return `Desfiz a presença vocal que eu tinha criado no ${where}. Removi ${count} EQ regional do Pablo e preservei de-esser, dinâmica, ganho, corpo, brilho, suavização, espaço instrumental, respirações e ajustes manuais.`;
  return `Desfiz meus ajustes regionais de mix no ${where}. Removi ${count} automação(ões) do Pablo; respirações, automação manual e edições de outras seções ficaram intactas.`;
}
function undoRevisionLabel(command, section) {
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_PLOSIVE) return `Desfeito tratamento de plosivas no ${section.label}`;
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_DEESSER) return `Desfeito de-esser vocal no ${section.label}`;
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_DYNAMICS) return `Desfeita dinâmica vocal no ${section.label}`;
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_GAIN) return `Desfeito ganho vocal no ${section.label}`;
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_SPACE) return `Desfeito espaço vocal no ${section.label}`;
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_BRIGHTNESS) return `Desfeito brilho vocal no ${section.label}`;
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_BODY) return `Desfeito corpo vocal no ${section.label}`;
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_SOFTNESS) return `Desfeita suavização vocal no ${section.label}`;
  if (command.mode === SECTION_MIX_UNDO_MODES.VOCAL_PRESENCE) return `Desfeita presença vocal no ${section.label}`;
  return `Desfeitos ajustes do Pablo no ${section.label}`;
}
function modeLabel(mode) {
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_PLOSIVE) return 'tratamento de plosivas';
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_DEESSER) return 'de-esser vocal';
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_DYNAMICS) return 'dinâmica vocal';
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_GAIN) return 'ganho vocal';
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_SPACE) return 'espaço vocal';
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_BRIGHTNESS) return 'brilho vocal';
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_BODY) return 'corpo vocal';
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_SOFTNESS) return 'suavização vocal';
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_PRESENCE) return 'presença vocal';
  return 'ajustes regionais de mix';
}
function occurrenceLabel(command, section) { if (!command.occurrence) return section.label; const ordinal = ({ 1: 'primeiro', 2: 'segundo', 3: 'terceiro' })[command.occurrence] || `${command.occurrence}º`; return `${ordinal} ${section.label.toLowerCase()}`; }
function appendMessage(text, role, result = null) { const log = document.querySelector('[data-pablo-log]'); if (!log) return; const message = document.createElement('div'); message.className = `pv-msg ${role}`; message.textContent = String(text || ''); if (role === 'assistant' && result && !result.error) { const meta = document.createElement('small'); meta.textContent = result.canApply ? 'Studio · desfazer regional salvo' : 'Studio · nada removido'; message.appendChild(meta); } log.appendChild(message); log.scrollTop = log.scrollHeight; }
function setBusy(form, busy) { const button = form?.querySelector('button[type="submit"]'); if (button) button.disabled = Boolean(busy); form?.setAttribute('aria-busy', busy ? 'true' : 'false'); }
