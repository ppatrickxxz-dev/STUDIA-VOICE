import { RemoteAuthAdapter } from './remote-auth.mjs';

const auth = new RemoteAuthAdapter();
let agentHealth = null;
let observer;
let healthRequested = false;

export function installRuntimeCapabilityStatus() {
  if (observer) return () => observer.disconnect();
  observer = new MutationObserver(() => patchCapabilityUi());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  patchCapabilityUi();
  requestAgentHealth();
  return () => { observer?.disconnect(); observer = null; };
}

async function requestAgentHealth() {
  if (healthRequested) return;
  healthRequested = true;
  agentHealth = await auth.agentHealth().catch(() => ({ available: false, authenticated: false }));
  patchCapabilityUi();
}

function patchCapabilityUi() {
  for (const chip of document.querySelectorAll('.pv-chip')) {
    const text = chip.textContent || '';
    if (text.includes('IA generativa')) {
      chip.classList.remove('off');
      chip.classList.toggle('on', Boolean(agentHealth?.available));
      chip.textContent = agentHealth?.available ? '✓ IA generativa · provider online' : '◐ IA generativa · provider gated';
    } else if (text.includes('Separação de stems')) {
      chip.classList.remove('off');
      chip.textContent = '◐ Separação de stems · Demucs candidate';
    } else if (text.includes('Conversão vocal')) {
      chip.classList.remove('off');
      chip.textContent = '◐ Conversão vocal · RVC/Applio gated';
    }
  }

  for (const row of document.querySelectorAll('.pv-cap-table > div')) {
    const name = row.querySelector('b')?.textContent?.trim();
    const engine = row.querySelector('span');
    const status = row.querySelector('em');
    if (!engine || !status) continue;
    if (name === 'IA generativa') {
      engine.textContent = agentHealth?.available ? `${agentHealth.provider || 'provider'} · ${agentHealth.model || 'modelo remoto'}` : 'Generator Adapter remoto';
      status.textContent = agentHealth?.available ? 'ONLINE' : 'GATED';
      status.className = agentHealth?.available ? 'ok' : 'off';
    } else if (name === 'Separação de stems') {
      engine.textContent = 'Demucs htdemucs · rota standalone';
      status.textContent = 'CANDIDATE';
      status.className = 'off';
    } else if (name === 'Conversão vocal') {
      engine.textContent = 'RVC/Applio · Natural / Identity / Smooth';
      status.textContent = 'GATED';
      status.className = 'off';
    }
  }
}

export const CAPABILITY_STATUS_POLICY = Object.freeze({
  buildDoesNotEqualFunctionalProof: true,
  remoteGenerationRequiresHealthyProvider: true,
  stemsRequiresLiveRouteCanaryForPromotion: true,
  voiceConversionRequiresVerifiedGuideAndVoiceModel: true,
});
