import {
  applySectionVocalCleanup,
  parseSectionVocalCleanupCommand,
  PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST,
  resolveSectionVocalCleanupTarget,
} from './core/src/section-vocal-cleanup.mjs';
import { snapshotProject } from './core/src/project.mjs';
import { analyzeAudioTrack } from './audio-analysis-runtime.mjs';
import { activeProjectSessionId, getProject, saveProject } from './storage.mjs';

let mounted = false;

export function installPabloSectionVocalCleanupAdapter() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', onPabloSubmitCapture, true);
}

async function onPabloSubmitCapture(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const input = form.querySelector('input[name="message"]');
  const original = String(input?.value || '').trim();
  const command = parseSectionVocalCleanupCommand(original);
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
      appendMessage('Não encontrei o projeto ativo. Não alterei nenhuma faixa.', 'assistant', { canApply: false });
      return;
    }

    const target = resolveSectionVocalCleanupTarget(project, command);
    if (!target.ok) {
      appendMessage(blockedReply(command, target), 'assistant', { canApply: false });
      return;
    }

    const analysis = await analyzeAudioTrack(target.track);
    const result = applySectionVocalCleanup(project, command, { analysis, now: Date.now() });
    if (!result.ok) {
      appendMessage(blockedReply(command, result), 'assistant', { canApply: false });
      return;
    }

    const snapshotted = snapshotProject(result.project, `Limpeza vocal no ${result.section.label}`);
    await saveProject(snapshotted);
    const persisted = await getProject(project.id);
    const savedTrack = persisted?.tracks?.find((track) => track.id === result.track.id);
    const savedEvents = (savedTrack?.regionAutomation || []).filter((item) =>
      PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST.includes(String(item?.source || ''))
      && String(item?.id || '').endsWith(`:${result.section.id}`));
    if (savedEvents.length !== result.events.length || !result.events.every((planned) => savedEvents.some((saved) => sameCleanupEvent(saved, planned)))) {
      throw new Error('A limpeza vocal não foi confirmada no projeto local. Não vou dizer que foi aplicada.');
    }

    globalThis.dispatchEvent(new CustomEvent('pablovoice:project-persisted', {
      detail: { projectId: project.id, source: 'pablo_section_vocal_cleanup' },
    }));
    appendMessage(successReply(command, result), 'assistant', { canApply: true });
  } catch (error) {
    appendMessage(error?.message || 'Não consegui limpar essa seção com segurança.', 'assistant', { error: true, canApply: false });
  } finally {
    setBusy(form, false);
  }
}

function sameCleanupEvent(saved, planned) {
  if (saved?.id !== planned?.id || saved?.source !== planned?.source || saved?.kind !== planned?.kind) return false;
  for (const field of ['startSeconds', 'endSeconds']) if (Math.abs(Number(saved?.[field]) - Number(planned?.[field])) > 0.001) return false;
  if (planned.kind === 'gain' || planned.kind === 'peaking_eq') {
    if (Math.abs(Number(saved.gainDb) - Number(planned.gainDb)) > 0.001) return false;
  }
  if (planned.kind === 'peaking_eq' && Math.abs(Number(saved.frequencyHz) - Number(planned.frequencyHz)) > 0.001) return false;
  if (planned.kind === 'compressor') {
    for (const field of ['thresholdDb', 'ratio', 'kneeDb', 'attackSeconds', 'releaseSeconds']) {
      if (Math.abs(Number(saved?.[field]) - Number(planned?.[field])) > 0.001) return false;
    }
  }
  if (planned.kind === 'vocal_denoise') {
    for (const field of ['thresholdDb', 'reductionDb', 'attackSeconds', 'releaseSeconds', 'noiseFloorDb', 'voicedLevelDb', 'snrDb', 'voicedMarginDb']) {
      if (Math.abs(Number(saved?.[field]) - Number(planned?.[field])) > 0.001) return false;
    }
    if (saved.timbreProtected !== true || saved.guardSource !== planned.guardSource) return false;
  }
  if (planned.kind === 'vocal_dereverb') {
    for (const field of ['reflectionDelayMs', 'amount', 'dampingHz', 'correlation', 'prominence']) {
      if (Math.abs(Number(saved?.[field]) - Number(planned?.[field])) > 0.001) return false;
    }
    if (saved.timbreProtected !== true || saved.guardSource !== planned.guardSource) return false;
  }
  return true;
}

function successReply(command, result) {
  const applied = [];
  if (result.modules.breath?.applied) applied.push(`${result.modules.breath.count} respiração(ões) suavizada(s)`);
  if (result.modules.deesser?.applied) applied.push(`${result.modules.deesser.count} sibilância(s) tratada(s)`);
  if (result.modules.plosive?.applied) applied.push(`${result.modules.plosive.count} plosiva(s) tratada(s)`);
  if (result.modules.click?.applied) applied.push(`${result.modules.click.count} estalo(s) curto(s) atenuado(s)`);
  if (result.modules.dynamics?.applied) applied.push(`picos controlados (${result.modules.dynamics.evidenceCount} evidência(s))`);
  if (result.modules.denoise?.applied) applied.push(`ruído de fundo reduzido em ${result.modules.denoise.count} trecho(s), só abaixo da margem segura da voz`);
  if (result.modules.dereverb?.applied) applied.push(`reflexo do ambiente reduzido em ${result.modules.dereverb.count} trecho(s), sem mudar pitch ou formantes`);
  const skipped = [];
  if (!result.modules.breath?.applied) skipped.push('respirações');
  if (!result.modules.deesser?.applied) skipped.push('sibilância');
  if (!result.modules.plosive?.applied) skipped.push('plosivas');
  if (!result.modules.click?.applied) skipped.push('estalos');
  if (!result.modules.dynamics?.applied) skipped.push('compressão');
  if (!result.modules.denoise?.applied) skipped.push('denoise');
  if (!result.modules.dereverb?.applied) skipped.push('de-reverb');
  return `Limpei ${occurrenceLabel(command, result.section)} usando só o que encontrei na própria voz: ${applied.join('; ')}.${skipped.length ? ` Não apliquei ${skipped.join(', ')} porque não havia evidência suficiente ou a proteção de timbre não abriu o gate.` : ''} Nada fora dessa seção foi alterado.`;
}

function blockedReply(command, result) {
  if (result.reason === 'missing_confirmed_section') return `Ainda não existe ${command.label.toLowerCase()} com timing confirmado. Marque início e fim primeiro; não alterei a voz.`;
  if (result.reason === 'missing_confirmed_end') return `${command.label} ainda não tem fim confirmado. Marque onde termina antes de limpar só essa seção.`;
  if (result.reason === 'ambiguous_occurrence') return `Há ${result.sectionResult?.count || 'várias'} ocorrências de ${command.label.toLowerCase()}. Diga qual você quer limpar.`;
  if (result.reason === 'missing_occurrence') return `Não encontrei essa ocorrência de ${command.label.toLowerCase()}. Não alterei nada.`;
  if (result.reason === 'vocal_track_missing') return 'Não encontrei uma faixa identificada de forma segura como sua voz. Não escolhi uma faixa por aproximação.';
  if (result.reason === 'vocal_track_ambiguous') return 'Há mais de uma faixa vocal possível. Selecione a voz no Studio e repita o pedido.';
  if (result.reason === 'section_outside_vocal_track') return `A faixa vocal não cobre o trecho confirmado de ${command.label.toLowerCase()}. Não criei tratamento fora do áudio.`;
  if (result.reason === 'cleanup_analysis_required') return 'Preciso analisar a própria faixa vocal antes da limpeza. Não apliquei um preset sem ouvir o áudio.';
  if (result.reason === 'no_cleanup_evidence') return `Analisei ${command.label.toLowerCase()} e não encontrei respirações fortes, sibilância, plosivas, estalos, picos, ruído ou reflexo de ambiente com confiança e margem de timbre suficientes. Não alterei a voz por aproximação.`;
  return 'Não consegui resolver essa limpeza regional com segurança. Não alterei o projeto.';
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
    meta.textContent = result.canApply ? 'Studio · limpeza vocal salva' : 'Studio · limpeza não aplicada';
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
