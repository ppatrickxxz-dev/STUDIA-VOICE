import { RemoteAuthAdapter } from './remote-auth.mjs';
import { VoiceIdentityReferenceClient } from './providers/src/voice-identity-reference-client.mjs';

const PROJECT_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const auth = new RemoteAuthAdapter();
const identityClient = new VoiceIdentityReferenceClient({ supabaseUrl: PROJECT_URL, publishableKey: PUBLISHABLE_KEY });
let agentHealth = null;
let voiceHealth = Object.freeze({ state: 'checking', configured: false, voiceModel: null, reference: null });
let observer;
let healthRequested = false;
let voiceHealthRequested = false;
let identityListenerInstalled = false;

export function installRuntimeCapabilityStatus() {
  if (observer) return () => observer.disconnect();
  observer = new MutationObserver(() => patchCapabilityUi());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (!identityListenerInstalled) {
    document.addEventListener('pablovoice:identity-reference-changed', handleIdentityReferenceChanged);
    identityListenerInstalled = true;
  }
  patchCapabilityUi();
  requestAgentHealth();
  requestVoiceHealth();
  return () => {
    observer?.disconnect();
    observer = null;
    if (identityListenerInstalled) {
      document.removeEventListener('pablovoice:identity-reference-changed', handleIdentityReferenceChanged);
      identityListenerInstalled = false;
    }
  };
}

function handleIdentityReferenceChanged() {
  refreshVoiceCapabilityStatus();
}

async function requestAgentHealth() {
  if (healthRequested) return;
  healthRequested = true;
  agentHealth = await auth.agentHealth().catch(() => ({ available: false, authenticated: false }));
  patchCapabilityUi();
}

async function requestVoiceHealth() {
  if (voiceHealthRequested) return;
  voiceHealthRequested = true;
  voiceHealth = Object.freeze({ state: 'checking', configured: false, voiceModel: null, reference: null });
  patchCapabilityUi();
  try {
    const session = await auth.ensureSession();
    if (!session?.accessToken) {
      voiceHealth = classifyVoiceConversionCapability({ authenticated: false });
    } else {
      const snapshot = await identityClient.list({ accessToken: session.accessToken });
      voiceHealth = classifyVoiceConversionCapability({
        authenticated: true,
        voiceModel: snapshot.voiceModel,
        reference: snapshot.reference,
      });
    }
  } catch (error) {
    voiceHealth = Object.freeze({
      state: 'unavailable',
      configured: false,
      voiceModel: null,
      reference: null,
      message: String(error?.message || 'voice_capability_check_failed').slice(0, 240),
    });
  } finally {
    voiceHealthRequested = false;
    patchCapabilityUi();
  }
}

export function refreshVoiceCapabilityStatus() {
  voiceHealthRequested = false;
  return requestVoiceHealth();
}

export function classifyVoiceConversionCapability({ authenticated = false, voiceModel = null, reference = null } = {}) {
  if (!authenticated) return Object.freeze({ state: 'disconnected', configured: false, voiceModel: null, reference: null });
  if (!voiceModel?.id || String(voiceModel?.status || '') !== 'ready') {
    return Object.freeze({ state: 'model_pending', configured: false, voiceModel: voiceModel || null, reference: null });
  }
  if (!reference?.id || reference?.is_active !== true || !/^[0-9a-f]{64}$/i.test(String(reference?.source_sha256 || ''))) {
    return Object.freeze({ state: 'reference_pending', configured: false, voiceModel, reference: reference || null });
  }
  return Object.freeze({ state: 'configured', configured: true, voiceModel, reference });
}

function setText(node, value) {
  if (!node) return;
  const next = String(value || '');
  if (node.textContent !== next) node.textContent = next;
}

function setClass(node, value) {
  if (!node) return;
  if (node.className !== value) node.className = value;
}

function voicePresentation(state = voiceHealth?.state) {
  if (state === 'configured') return {
    chip: '✓ Conversão vocal · identidade configurada',
    engine: 'RVC/Applio · identidade pronta; guia vocal por projeto',
    status: 'CONFIGURADA',
    statusClass: 'ok',
  };
  if (state === 'reference_pending') return {
    chip: '◐ Conversão vocal · escolha sua voz de referência',
    engine: 'RVC/Applio · modelo pronto; falta referência de identidade',
    status: 'REFERÊNCIA',
    statusClass: 'off',
  };
  if (state === 'model_pending') return {
    chip: '◐ Conversão vocal · modelo de voz pendente',
    engine: 'RVC/Applio · configure um modelo de voz verificado',
    status: 'MODELO',
    statusClass: 'off',
  };
  if (state === 'disconnected') return {
    chip: '◐ Conversão vocal · conecte sua conta',
    engine: 'RVC/Applio · requer sessão para verificar sua voz',
    status: 'CONECTAR',
    statusClass: 'off',
  };
  if (state === 'checking') return {
    chip: '◐ Conversão vocal · verificando configuração',
    engine: 'RVC/Applio · verificando modelo e identidade',
    status: 'VERIFICANDO',
    statusClass: 'off',
  };
  return {
    chip: '◐ Conversão vocal · configuração indisponível',
    engine: 'RVC/Applio · não foi possível verificar a configuração agora',
    status: 'INDISPONÍVEL',
    statusClass: 'off',
  };
}

function patchCapabilityUi() {
  const voice = voicePresentation();
  for (const chip of document.querySelectorAll('.pv-chip')) {
    const text = chip.textContent || '';
    if (text.includes('IA generativa')) {
      chip.classList.remove('off');
      chip.classList.toggle('on', Boolean(agentHealth?.available));
      setText(chip, agentHealth?.available ? '✓ IA generativa · provider online' : '◐ IA generativa · provider gated');
    } else if (text.includes('Separação de stems')) {
      chip.classList.remove('off');
      setText(chip, '◐ Separação de stems · Demucs candidate');
    } else if (text.includes('Conversão vocal')) {
      chip.classList.remove('off', 'on');
      chip.classList.toggle('on', voiceHealth?.configured === true);
      setText(chip, voice.chip);
    }
  }

  for (const row of document.querySelectorAll('.pv-cap-table > div')) {
    const name = row.querySelector('b')?.textContent?.trim();
    const engine = row.querySelector('span');
    const status = row.querySelector('em');
    if (!engine || !status) continue;
    if (name === 'IA generativa') {
      setText(engine, agentHealth?.available ? `${agentHealth.provider || 'provider'} · ${agentHealth.model || 'modelo remoto'}` : 'Generator Adapter remoto');
      setText(status, agentHealth?.available ? 'ONLINE' : 'GATED');
      setClass(status, agentHealth?.available ? 'ok' : 'off');
    } else if (name === 'Separação de stems') {
      setText(engine, 'Demucs htdemucs · rota standalone');
      setText(status, 'CANDIDATE');
      setClass(status, 'off');
    } else if (name === 'Conversão vocal') {
      setText(engine, voice.engine);
      setText(status, voice.status);
      setClass(status, voice.statusClass);
    }
  }
}

export const CAPABILITY_STATUS_POLICY = Object.freeze({
  buildDoesNotEqualFunctionalProof: true,
  remoteGenerationRequiresHealthyProvider: true,
  stemsRequiresLiveRouteCanaryForPromotion: true,
  voiceConversionRequiresAuthenticatedAccount: true,
  voiceConversionRequiresVerifiedVoiceModel: true,
  voiceConversionRequiresActiveIdentityReference: true,
  voiceConversionGuideReadinessIsProjectSpecific: true,
  configuredIdentityDoesNotClaimProjectReady: true,
  domUpdatesAreIdempotent: true,
});
