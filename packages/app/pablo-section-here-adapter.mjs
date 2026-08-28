import { executePabloAudioMessage } from './pablo-conversation-audio.mjs';
import { parseSectionEndHereCommand, parseSectionHereCommand } from './core/src/section-here-command.mjs';
import { resolveSectionEndTarget } from './core/src/section-end-target.mjs';
import { activeProjectSessionId, getProject } from './storage.mjs';
import { readStudioPlayhead } from './studio-playhead-context.mjs';

let mounted = false;

export function installPabloSectionHereAdapter() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', onPabloSubmitCapture, true);
}

async function onPabloSubmitCapture(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const input = form.querySelector('input[name="message"]');
  const original = String(input?.value || '').trim();
  const startCommand = parseSectionHereCommand(original);
  const endCommand = startCommand ? null : parseSectionEndHereCommand(original);
  const command = startCommand || endCommand;
  if (!command) return;
  const boundary = endCommand ? 'end' : 'start';

  event.preventDefault();
  event.stopImmediatePropagation();
  if (input) input.value = '';
  appendMessage(original, 'user');
  setBusy(form, true);

  try {
    const projectId = activeProjectSessionId();
    const playhead = readStudioPlayhead(projectId);
    if (!playhead.ok) {
      const verb = boundary === 'end' ? 'termina' : 'começa';
      appendMessage(
        `Não tenho um ponto recente e confirmado dessa música para usar como “aqui”. Dê play, pare onde ${command.label.toLowerCase()} ${verb} e tente de novo. Não alterei o projeto.`,
        'assistant',
        { domain: 'beat_lab', canApply: false },
      );
      return;
    }

    const explicit = boundary === 'end'
      ? await explicitSectionRange(command, projectId, playhead.seconds)
      : {
          ok: true,
          command: `marca o ${spokenSection(command.section)} em ${playhead.seconds.toFixed(3)} segundos`,
        };
    if (!explicit.ok) {
      appendMessage(explicit.reply, 'assistant', { domain: 'beat_lab', canApply: false });
      return;
    }

    const result = await executePabloAudioMessage(explicit.command, { projectId });
    if (!result?.supported) {
      appendMessage('Não consegui transformar esse ponto em uma marcação segura. Não alterei o projeto.', 'assistant', { domain: 'beat_lab', canApply: false });
      return;
    }
    appendMessage(result.reply || boundaryReply(command, boundary), 'assistant', result);
    if (result.canApply) {
      appendMessage(
        boundary === 'end'
          ? 'O fim foi salvo no mesmo timing manual confirmado da seção; o início foi preservado.'
          : 'A seção foi salva como timing manual confirmado e já pode ser usada por comandos de arranjo do Pablo.',
        'assistant',
      );
    }
  } catch (error) {
    appendMessage(error?.message || 'Não consegui marcar essa seção com segurança.', 'assistant', { error: true });
  } finally {
    setBusy(form, false);
  }
}

async function explicitSectionRange(command, projectId, endSeconds) {
  if (!projectId) return { ok: false, reply: 'Não encontrei o projeto ativo. Não alterei nenhuma seção.' };
  const project = await getProject(projectId);
  if (!project) return { ok: false, reply: 'Não encontrei o projeto ativo. Não alterei nenhuma seção.' };
  const resolved = resolveSectionEndTarget(project.arrangementMap, command.section, endSeconds);
  if (!resolved.ok) {
    if (resolved.reason === 'missing_confirmed_start') {
      return {
        ok: false,
        reply: `Ainda não existe um início confirmado de ${command.label.toLowerCase()} antes desse ponto. Marque onde ele começa primeiro; não alterei o projeto.`,
      };
    }
    if (resolved.reason === 'crosses_confirmed_section') {
      return {
        ok: false,
        reply: `Há outra seção confirmada (${resolved.blocker?.label || 'seção'}) entre o início de ${command.label.toLowerCase()} e esse ponto. Não criei uma sobreposição; ajuste o mapa ou pare antes.`,
      };
    }
    return { ok: false, reply: 'Esse ponto não forma um fim de seção válido. Não alterei o projeto.' };
  }
  return {
    ok: true,
    command: `marca o ${spokenSection(command.section)} de ${resolved.target.startSeconds.toFixed(3)} a ${resolved.endSeconds.toFixed(3)} segundos`,
  };
}

function boundaryReply(command, boundary) {
  return boundary === 'end'
    ? `${command.label} fechado no ponto ouvido.`
    : `${command.label} marcado no ponto ouvido.`;
}

function spokenSection(section) {
  return ({
    intro: 'intro',
    verse: 'verso',
    pre_chorus: 'pré-refrão',
    chorus: 'refrão',
    bridge: 'ponte',
    rap: 'rap',
    outro: 'outro',
  })[section] || section;
}

function appendMessage(text, role, result = null) {
  const log = document.querySelector('[data-pablo-log]');
  if (!log) return;
  const message = document.createElement('div');
  message.className = `pv-msg ${role}`;
  message.textContent = String(text || '');
  if (result?.domain === 'beat_lab') {
    const meta = document.createElement('small');
    meta.textContent = `Beat Lab · ${result.canApply ? 'salvo' : 'prévia segura'}`;
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
