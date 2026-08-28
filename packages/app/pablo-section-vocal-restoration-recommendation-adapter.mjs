import {
  parseSectionVocalRestorationRecommendationCommand,
  planSectionVocalRestorationRecommendation,
  resolveSectionVocalRestorationRecommendationTarget,
} from './core/src/section-vocal-restoration-recommendation.mjs';
import { analyzeAudioTrack } from './audio-analysis-runtime.mjs';
import { activeProjectSessionId, getProject } from './storage.mjs';

let mounted = false;

export function installPabloSectionVocalRestorationRecommendationAdapter() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', onPabloSubmitCapture, true);
}

async function onPabloSubmitCapture(event) {
  const form = event.target?.closest?.('[data-pablo-form]');
  if (!form) return;
  const input = form.querySelector('input[name="message"]');
  const original = String(input?.value || '').trim();
  const command = parseSectionVocalRestorationRecommendationCommand(original);
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
      appendMessage('Não encontrei o projeto ativo. Não avaliei nem alterei nenhuma faixa.', 'assistant', { evaluated: false });
      return;
    }
    const target = resolveSectionVocalRestorationRecommendationTarget(project, command);
    if (!target.ok) {
      appendMessage(blockedReply(command, target), 'assistant', { evaluated: false });
      return;
    }
    const analysis = await analyzeAudioTrack(target.track);
    const result = planSectionVocalRestorationRecommendation(project, command, { analysis });
    if (!result.ok) {
      appendMessage(blockedReply(command, result), 'assistant', { evaluated: false });
      return;
    }
    appendMessage(recommendationReply(command, result), 'assistant', { evaluated: true });
  } catch (error) {
    appendMessage(error?.message || 'Não consegui avaliar a restauração com segurança. Não alterei o projeto.', 'assistant', { error: true, evaluated: false });
  } finally {
    setBusy(form, false);
  }
}

function recommendationReply(command, result) {
  const where = occurrenceLabel(command, result.section);
  const pieces = [];
  if (command.scope !== 'dereverb') pieces.push(denoiseText(result.denoise));
  if (command.scope !== 'denoise') pieces.push(dereverbText(result.dereverb));
  const hum = result.hum?.count
    ? ` Detectei também ${result.hum.count} evidência(s) de hum${result.hum.frequenciesHz?.length ? ` em ${result.hum.frequenciesHz.join('/')} Hz` : ''}; isso é diagnóstico, não autorização para um notch automático.`
    : '';
  const guard = result.guard?.ready
    ? ` A proteção de timbre está válida: pitch e formantes preservados, margem vocal mínima ${formatNumber(result.guard.voicedMarginDb)} dB, denoise limitado a ${formatNumber(result.guard.maxNoiseReductionDb)} dB e de-reverb limitado a ${formatNumber(result.guard.maxDereverbAmount)}.`
    : ' A proteção de timbre não está completa, então não recomendo restauração automática nesta seção.';
  return `Avaliei ${where} sem alterar nada. ${pieces.filter(Boolean).join(' ')}${hum}${guard}`;
}

function denoiseText(item) {
  if (item.status === 'recommended') {
    return `Denoise: recomendado pelo gate v9 (${percent(item.confidence)} de confiança, piso ${formatDb(item.noiseFloorDb)}, SNR ${formatDb(item.snrDb)}, margem da voz ${formatDb(item.voicedMarginDb)}; redução sugerida até ${formatNumber(item.suggestedReductionDb)} dB).`;
  }
  if (item.status === 'guard_blocked') return 'Denoise: não recomendo porque o timbre guard não abriu o gate.';
  if (item.status === 'not_recommended') return `Denoise: há evidência, mas ela não passou o gate canônico${item.snrDb != null ? ` (SNR ${formatDb(item.snrDb)}` : ''}${item.voicedMarginDb != null ? `${item.snrDb != null ? ', ' : ' ('}margem ${formatDb(item.voicedMarginDb)}` : ''}${item.snrDb != null || item.voicedMarginDb != null ? ')' : ''}.`;
  return 'Denoise: não encontrei uma janela de ruído que precise de restauração nessa seção.';
}

function dereverbText(item) {
  if (item.status === 'recommended') {
    return `De-reverb: recomendado pelo gate v9 (${percent(item.confidence)} de confiança, reflexo ${formatNumber(item.reflectionDelayMs)} ms, correlação ${formatNumber(item.correlation)}, intensidade limitada a ${formatNumber(item.suggestedAmount)}).`;
  }
  if (item.status === 'guard_blocked') return 'De-reverb: não recomendo porque o timbre guard não abriu o gate.';
  if (item.status === 'not_recommended') {
    const consensus = item.reason === 'reflection_delay_not_consistent' ? ' O atraso do reflexo não teve consenso suficiente entre janelas.' : '';
    return `De-reverb: encontrei indício de reflexão, mas o gate canônico não aprovou a intervenção.${consensus}`;
  }
  return 'De-reverb: não encontrei reflexão de ambiente que justifique restauração nessa seção.';
}

function blockedReply(command, result) {
  if (result.reason === 'missing_confirmed_section') return `Ainda não existe ${command.label.toLowerCase()} com timing confirmado. Marque início e fim antes da recomendação.`;
  if (result.reason === 'missing_confirmed_end') return `${command.label} ainda não tem fim confirmado. Marque onde termina antes de eu avaliar só essa seção.`;
  if (result.reason === 'ambiguous_occurrence') return `Há ${result.sectionResult?.count || 'várias'} ocorrências de ${command.label.toLowerCase()}. Diga qual você quer que eu avalie.`;
  if (result.reason === 'vocal_track_missing') return 'Não encontrei uma faixa identificada com segurança como sua voz. Não escolhi uma faixa por aproximação.';
  if (result.reason === 'vocal_track_ambiguous') return 'Há mais de uma faixa vocal possível. Selecione a voz no Studio e repita a avaliação.';
  if (result.reason === 'section_outside_vocal_track') return `A faixa vocal não cobre o trecho confirmado de ${command.label.toLowerCase()}. Não avaliei outro áudio no lugar.`;
  if (result.reason === 'restoration_analysis_required') return 'Preciso analisar a própria faixa para avaliar denoise/de-reverb. Não inventei uma recomendação sem evidência.';
  return 'Não consegui avaliar essa restauração regional com segurança. Não alterei o projeto.';
}

function occurrenceLabel(command, section) {
  if (!command.occurrence) return section.label;
  const ordinal = ({ 1: 'primeiro', 2: 'segundo', 3: 'terceiro' })[command.occurrence] || `${command.occurrence}º`;
  return `${ordinal} ${section.label.toLowerCase()}`;
}
function percent(value) { return `${Math.round((Number(value) || 0) * 100)}%`; }
function formatDb(value) { return value == null ? '—' : `${Number(value).toFixed(1)} dB`; }
function formatNumber(value) { return value == null ? '—' : Number(value).toFixed(1); }
function appendMessage(text, role, result = null) {
  const log = document.querySelector('[data-pablo-log]');
  if (!log) return;
  const message = document.createElement('div');
  message.className = `pv-msg ${role}`;
  message.textContent = String(text || '');
  if (role === 'assistant' && result && !result.error) {
    const meta = document.createElement('small');
    meta.textContent = result.evaluated ? 'Studio · recomendação de restauração · somente leitura' : 'Studio · restauração não avaliada';
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
