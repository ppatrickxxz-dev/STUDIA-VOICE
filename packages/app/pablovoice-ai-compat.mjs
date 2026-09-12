import { RemoteAuthAdapter } from './remote-auth.mjs';

const PATCH_FLAG = Symbol.for('pablovoice.ai.transparent.compat.v1');
const prototype = RemoteAuthAdapter.prototype;

if (!prototype[PATCH_FLAG]) {
  Object.defineProperty(prototype, PATCH_FLAG, { value: true, configurable: false });

  const originalHealth = prototype.agentHealth;
  prototype.agentHealth = async function pabloVoiceAgentHealth(...args) {
    const result = await originalHealth.apply(this, args);
    return {
      ...result,
      connected: Boolean(result?.connected),
      authenticated: Boolean(result?.connected),
    };
  };

  const originalTurn = prototype.agentTurn;
  prototype.agentTurn = async function pabloVoiceAgentTurn(payload = {}, options = {}) {
    let next = payload;
    let nextOptions = options;

    // The product chat historically sent an advice-only message without a
    // Composer command, while the connected Cloudflare agent accepts reviewed
    // music commands. Translate that legacy shape invisibly so Pablo actually
    // answers instead of falling through to a local "unsupported" message.
    if (!String(payload?.command || '').trim() && String(payload?.message || '').trim()) {
      const message = String(payload.message).trim().slice(0, 5000);
      next = {
        ...payload,
        command: 'generate',
        task: [
          'Responda como o assistente musical e produtor do PabloVoice.',
          'Este é um pedido de orientação/conversa dentro do projeto, não um pedido para substituir a letra automaticamente.',
          'Responda de forma prática, específica ao contexto musical fornecido e em português brasileiro quando o usuário escrever em português.',
          'Não invente que executou alterações. Se sugerir uma mudança, descreva exatamente o que faria.',
          `Pedido: ${message}`,
        ].join('\n'),
        constraints: {
          ...(payload?.constraints || {}),
          advice_only: true,
          destructive_actions: false,
          no_automatic_apply: true,
        },
      };
      delete next.message;
      nextOptions = { ...options, bypassGeneratorAdapter: true };
    }

    const result = await originalTurn.call(this, next, nextOptions);
    if (!result?.ok && ['auth_required', 'invalid_session'].includes(result?.error)) {
      return { ...result, error: 'connection_required', fallback_allowed: false };
    }
    return result;
  };
}

export const PABLOVOICE_AI_COMPAT = Object.freeze({
  transparentAccess: true,
  adviceUsesRemoteModel: true,
  visibleLoginRequired: false,
  automaticApply: false,
});