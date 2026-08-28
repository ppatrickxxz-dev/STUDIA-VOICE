import { executePabloAudioMessage } from './pablo-conversation-audio.mjs';
import { parseSectionHereCommand } from './core/src/section-here-command.mjs';
import { activeProjectSessionId } from './storage.mjs';
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
  const command = parseSectionHereCommand(original);
  if (!command) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (input) input.value = '';
  appendMessage(original, 'user');
  setBusy(form, true);

  try {
    const projectId = activeProjectSessionId();
    const playhead = readStudioPlayhead(projectId);
    if (!playhead.ok) {
      appendMessage(
        `Não tenho um ponto recente e confirmado dessa música para usar como “aqui”. Dê play, pare onde ${command.label.toLowerCase()} começa e tente de novo — ou diga o tempo, como “marca ${command.label.toLowerCase()} em 45 segundos”. Não alterei o projeto.`,
        'assistant',
        { domain: 'beat_lab', canApply: false },
      );
      return;
    }

    const explicit = `marca o ${spokenSection(command.section)} em ${playhead.seconds.toFixed(3)} segundos`;
    const result = await executePabloAudioMessage(explicit, { projectId });
    if (!result?.supported) {
      appendMessage('Não consegui transformar esse ponto em uma marcação segura. Não alterei o projeto.', 'assistant', { domain: 'beat_lab', canApply: false });
      return;
    }
    appendMessage(result.reply || `${command.label} marcado no ponto ouvido.`, 'assistant', result);
    if (result.canApply) appendMessage('A seção foi salva como timing manual confirmado e já pode ser usada por comandos de arranjo do Pablo.', 'assistant');
  } catch (error) {
    appendMessage(error?.message || 'Não consegui marcar essa seção com segurança.', 'assistant', { error: true });
  } finally {
    setBusy(form, false);
  }
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
