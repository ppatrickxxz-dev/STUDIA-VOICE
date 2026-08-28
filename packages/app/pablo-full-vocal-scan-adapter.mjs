import {
  parseFullVocalScanCommand,
  planFullVocalScan,
  resolveFullVocalScanTarget,
} from './core/src/full-vocal-scan.mjs';
import { analyzeAudioTrack } from './audio-analysis-runtime.mjs';
import { activeProjectSessionId, getProject } from './storage.mjs';

let mounted = false;

export function installPabloFullVocalScanAdapter() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', onPabloSubmitCapture, true);
}

async function onPabloSubmitCapture(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const input = form.querySelector('input[name="message"]');
  const original = String(input?.value || '').trim();
  const command = parseFullVocalScanCommand(original);
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

    const target = resolveFullVocalScanTarget(project);
    if (!target.ok) {
      appendMessage(blockedReply(target), 'assistant', { scanned: false });
      return;
    }

    const analysis = await analyzeAudioTrack(target.track);
    const result = planFullVocalScan(project, { analysis });
    if (!result.ok) {
      appendMessage(blockedReply(result), 'assistant', { scanned: false });
      return;
    }

    appendMessage(scanReply(result), 'assistant', { scanned: true });
  } catch (error) {
    appendMessage(error?.message || 'Não consegui concluir a varredura vocal completa com segurança. Não alterei o projeto.', 'assistant', { error: true, scanned: false });
  } finally {
    setBusy(form, false);
  }
}

function scanReply(result) {
  if (result.clean) {
    const skipped = result.skippedSectionCount ? ` ${result.skippedSectionCount} seção(ões) ficou(aram) fora da cobertura segura da faixa vocal.` : '';
    return `Varri ${result.scannedSectionCount} seção(ões) confirmada(s) com uma única análise da faixa vocal. Não encontrei pontos acima dos gates atuais e não alterei nada.${skipped}`;
  }

  const top = result.rankedSections.slice(0, 5).map((section) => {
    const where = sectionOccurrenceLabel(section);
    const priority = priorityLabel(section.priority);
    const types = section.topTypes.map((item) => `${findingTypeLabel(item.type)} ${item.count}`).join(', ');
    return `${where}: prioridade ${priority}, ${section.findings.length} achado(s), ${section.actionableCount} acionável(is)${types ? ` · ${types}` : ''}`;
  });
  const omitted = Math.max(0, result.rankedSections.length - top.length);
  const skipped = result.skippedSectionCount ? ` ${result.skippedSectionCount} seção(ões) não entrou(aram) no ranking porque não havia cobertura vocal segura.` : '';
  return `Varri ${result.scannedSectionCount} seção(ões) confirmada(s) com uma única análise da sua faixa vocal e não alterei nada. Encontrei ${result.totalFindings} ponto(s): ${result.actionableCount} tratável(is) pelos gates atuais e ${result.reviewCount} para revisão. Ordem de atenção: ${top.join('; ')}${omitted ? `; +${omitted} seção(ões) com achados` : ''}.${skipped}`;
}

function blockedReply(result) {
  if (result.reason === 'missing_confirmed_sections') return 'Ainda não há seções com início e fim confirmados para eu varrer seção por seção. Não alterei nada.';
  if (result.reason === 'vocal_track_missing') return 'Não encontrei uma faixa identificada com segurança como sua voz. Não escolhi outra faixa por aproximação.';
  if (result.reason === 'vocal_track_ambiguous') return 'Há mais de uma faixa vocal possível. Selecione a voz principal no Studio e repita a varredura.';
  if (result.reason === 'scan_analysis_required') return 'Preciso analisar a própria faixa vocal para fazer a varredura completa. Não inventei resultado sem evidência acústica.';
  if (result.reason === 'no_scannable_confirmed_sections') return 'As seções confirmadas não estão cobertas com segurança pela faixa vocal atual. Não analisei outro áudio no lugar.';
  return 'Não consegui resolver a faixa vocal e as seções com segurança. Não alterei o projeto.';
}

function sectionOccurrenceLabel(section) {
  const ordinal = ({ 1: '1º', 2: '2º', 3: '3º' })[section.occurrence] || `${section.occurrence}º`;
  return `${ordinal} ${String(section.label || 'seção').toLowerCase()}`;
}
function priorityLabel(priority) {
  if (priority === 'high') return 'alta';
  if (priority === 'medium') return 'média';
  if (priority === 'low') return 'baixa';
  return 'limpa';
}
function findingTypeLabel(type) {
  if (type === 'breath') return 'respiração';
  if (type === 'sibilance') return 'sibilância';
  if (type === 'plosive') return 'P/B';
  if (type === 'click') return 'estalo';
  if (type === 'peak') return 'pico';
  if (type === 'noise') return 'ruído';
  if (type === 'reverb') return 'reflexo';
  if (type === 'hum') return 'hum';
  if (type === 'broadband_noise') return 'ruído broadband';
  return 'evidência';
}
function appendMessage(text, role, result = null) {
  const log = document.querySelector('[data-pablo-log]');
  if (!log) return;
  const message = document.createElement('div');
  message.className = `pv-msg ${role}`;
  message.textContent = String(text || '');
  if (role === 'assistant' && result && !result.error) {
    const meta = document.createElement('small');
    meta.textContent = result.scanned ? 'Studio · varredura vocal completa · somente leitura' : 'Studio · varredura vocal não executada';
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
