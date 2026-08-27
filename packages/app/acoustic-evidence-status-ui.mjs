import { acousticEvidenceStatusModel } from './providers/src/acoustic-evidence-status.mjs';

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

  const status = acousticEvidenceStatusModel();
  const card = document.createElement('div');
  card.id = 'pv-acoustic-evidence-status';
  card.className = 'pv-note';
  card.setAttribute('role', 'status');
  card.dataset.voiceEvidence = status.voice;
  card.dataset.harmonyEvidence = status.harmony;
  card.textContent = 'Evidência acústica: identidade vocal ainda não medida. Harmonias high + low aguardam validação das duas camadas. Áudio pronto não significa voz aprovada.';

  const voiceList = panel.querySelector('#pv-ai-voice-list');
  if (voiceList) voiceList.insertAdjacentElement('beforebegin', card);
  else panel.append(card);
}
