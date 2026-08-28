import {
  parseSectionVocalScanCommand,
  planSectionVocalScan,
  resolveSectionVocalScanTarget,
} from './core/src/section-vocal-scan.mjs';
import { analyzeAudioTrack } from './audio-analysis-runtime.mjs';
import { activeProjectSessionId, getProject } from './storage.mjs';

let mounted = false;

export function installPabloSectionVocalScanAdapter() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', onPabloSubmitCapture, true);
}

async function onPabloSubmitCapture(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const input = form.querySelector('input[name="message"]');
  const original = String(input?.value || '').trim();
  const command = parseSectionVocalScanCommand(original);
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
      appendMessage('Não encontrei o projeto ativo. Não analisei nem alterei nenhuma faixa.', 'assistant', { scanned: false });
      return;
    }

    const target = resolveSectionVocalScanTarget(project, command);
    if (!target.ok) {
      appendMessage(blockedReply(command, target), 'assistant', { scanned: false });
      return;
    }

    const analysis = await analyzeAudioTrack(target.track);
    const result = planSectionVocalScan(project, command, { analysis });
    if (!result.ok) {
      appendMessage(blockedReply(command, result), 'assistant', { scanned: false });
      return;
    }

    appendMessage(scanReply(command, result), 'assistant', { scanned: true });
  } catch (error) {
    appendMessage(error?.message || 'Não consegui analisar essa seção com segurança. Não alterei o projeto.', 'assistant', { error: true, scanned: false });
  } finally {
    setBusy(form, false);
  }
}

function scanReply(command, result) {
  const where = occurrenceLabel(command, result.section);
  if (result.clean) {
    return `Ouvi ${where} e não encontrei respiração forte, sibilância, estouro de P/B, estalos curtos ou picos acima dos gates atuais. Foi só diagnóstico: não alterei nada.`;
  }

  const details = result.findings.slice(0, 8).map((finding) => {
    const at = formatClock(finding.timelineStartSeconds);
    const confidence = Math.round((Number(finding.confidence) || 0) * 100);
    const frequency = Number.isFinite(Number(finding.frequencyHz)) ? ` · ${Math.round(finding.frequencyHz)} Hz` : '';
    const action = finding.autoEdit ? 'tratável pelo cleanup atual' : 'revisar antes de editar';
    return `${finding.label} em ${at} · ${confidence}%${frequency} · ${action}`;
  });
  const omitted = Math.max(0, result.findings.length - details.length);
  const observed = result.observed || {};
  const counts = `respirações ${observed.breaths || 0}, sibilâncias ${observed.sibilance || 0}, P/B ${observed.plosives || 0}, estalos ${observed.clicks || 0}, picos ${observed.peaks || 0}`;
  return `Ouvi ${where} sem alterar nada. Encontrei ${result.findings.length} ponto(s) acima dos gates atuais (${result.actionableCount} acionável(is), ${result.reviewCount} para revisão). ${details.join('; ')}${omitted ? `; +${omitted} ponto(s) não listado(s)` : ''}. Evidência observada no trecho: ${counts}.`;
}

function blockedReply(command, result) {
  if (result.reason === 'missing_confirmed_section') return `Ainda não existe ${command.label.toLowerCase()} com timing confirmado. Marque início e fim antes do diagnóstico; não alterei nada.`;
  if (result.reason === 'missing_confirmed_end') return `${command.label} ainda não tem fim confirmado. Marque onde termina antes de eu analisar só essa seção.`;
  if (result.reason === 'ambiguous_occurrence') return `Há ${result.sectionResult?.count || 'várias'} ocorrências de ${command.label.toLowerCase()}. Diga qual você quer que eu analise. Não alterei nada.`;
  if (result.reason === 'missing_occurrence') return `Não encontrei essa ocorrência de ${command.label.toLowerCase()}. Não analisei outro trecho por aproximação.`;
  if (result.reason === 'vocal_track_missing') return 'Não encontrei uma faixa identificada com segurança como sua voz. Não escolhi uma faixa por aproximação.';
  if (result.reason === 'vocal_track_ambiguous') return 'Há mais de uma faixa vocal possível. Selecione a voz no Studio e repita o diagnóstico.';
  if (result.reason === 'section_outside_vocal_track') return `A faixa vocal não cobre o trecho confirmado de ${command.label.toLowerCase()}. Não analisei outro áudio no lugar.`;
  if (result.reason === 'scan_analysis_required') return 'Preciso analisar a própria faixa vocal para fazer esse diagnóstico. Não criei nenhum resultado sem evidência acústica.';
  return 'Não consegui resolver essa seção e faixa vocal com segurança. Não alterei o projeto.';
}

function occurrenceLabel(command, section) {
  if (!command.occurrence) return section.label;
  const ordinal = ({ 1: 'primeiro', 2: 'segundo', 3: 'terceiro' })[command.occurrence] || `${command.occurrence}º`;
  return `${ordinal} ${section.label.toLowerCase()}`;
}
function formatClock(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}
function appendMessage(text, role, result = null) {
  const log = document.querySelector('[data-pablo-log]');
  if (!log) return;
  const message = document.createElement('div');
  message.className = `pv-msg ${role}`;
  message.textContent = String(text || '');
  if (role === 'assistant' && result && !result.error) {
    const meta = document.createElement('small');
    meta.textContent = result.scanned ? 'Studio · diagnóstico vocal · somente leitura' : 'Studio · diagnóstico não executado';
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
