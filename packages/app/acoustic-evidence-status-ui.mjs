import { classifyHarmonyPairReadiness } from './providers/src/kaggle-harmony-client.mjs';

let observer;

export function installAcousticEvidenceStatusUI() {
  if (observer) return () => observer.disconnect();
  observer = new MutationObserver(() => injectEvidenceStatus());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  injectEvidenceStatus();
  return () => {
    observer?.disconnect();
    observer = null;
  };
}

function injectEvidenceStatus() {
  const panel = document.querySelector('#pv-ai-voice-harmony');
  if (!panel || panel.querySelector('#pv-acoustic-evidence-status')) return;

  const pair = classifyHarmonyPairReadiness();
  const card = document.createElement('div');
  card.id = 'pv-acoustic-evidence-status';
  card.className = 'pv-note';
  card.setAttribute('role', 'status');
  card.dataset.voiceEvidence = 'pending';
  card.dataset.harmonyEvidence = pair.state;
  card.textContent = 'Evidência acústica: identidade vocal ainda não medida. Harmonias high + low aguardam validação das duas camadas. Áudio pronto não significa voz aprovada.';

  const voiceList = panel.querySelector('#pv-ai-voice-list');
  if (voiceList) voiceList.insertAdjacentElement('beforebegin', card);
  else panel.append(card);
}

export function acousticEvidenceStatusModel({ voiceEvidence = null, highEvidence = null, lowEvidence = null } = {}) {
  const pair = classifyHarmonyPairReadiness({ highEvidence, lowEvidence });
  const voiceValidated = voiceEvidence?.state === 'validated' && voiceEvidence?.promotable === true;
  return Object.freeze({
    voice: voiceValidated ? 'validated' : voiceEvidence ? 'not_validated' : 'pending',
    harmony: pair.state,
    pairValidated: pair.pairValidated,
    promotable: voiceValidated && pair.pairValidated,
  });
}
