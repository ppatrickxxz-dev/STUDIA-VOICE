const pmiSessionCache = new Map();
const pmiPendingDraftCache = new Map();

export const CONVERSATIONAL_AUDIO_INTENTS = Object.freeze({
  voice_forward: 'bring_voice_forward', make_vocal_space: 'make_vocal_space', soften_breaths: 'soften_breaths', remove_breaths: 'soften_breaths', align_vocals: 'align_vocals', audio_to_instrument: 'audio_to_instrument', inspect_audio: 'inspect_audio', inspect_mix: 'inspect_mix',
});

export function interpretPabloAudioMessage(message, context = {}) {
  const text = normalize(message); if (!text) return unsupported('empty_message');
  const trackId = context.trackId || null, assetId = context.assetId || null, projectId = context.projectId || null;
  if (matches(text, ['voz mais na frente', 'minha voz na frente', 'destaca minha voz', 'voz mais presente no mix'])) return tool('bring_voice_forward', { projectId, trackId }, 'preview_then_apply');
  if (matches(text, ['abre espaco pra voz', 'abre espaco para voz', 'abre espaco pra minha voz', 'menos embolado com a voz'])) return tool('make_vocal_space', { projectId, trackId }, 'preview_then_apply');
  if (matches(text, ['suaviza minhas respiracoes', 'suavizar respiracoes', 'respiracao mais natural', 'respiracoes mais naturais'])) return tool('soften_breaths', { assetId, mode: 'soften' }, 'preview_then_apply');
  if (matches(text, ['remove minhas respiracoes', 'tirar respiracoes', 'remove as respiracoes'])) return tool('soften_breaths', { assetId, mode: 'remove' }, 'preview_then_apply');
  if (matches(text, ['alinha minhas vozes', 'alinhar vocais', 'alinhar double', 'alinha o double', 'alinha backing'])) return tool('align_vocals', { referenceAssetId: context.referenceAssetId || assetId, targetAssetId: context.targetAssetId || null }, 'preview_then_apply');
  if (matches(text, ['transforma isso em instrumento', 'vira instrumento', 'tocar isso como instrumento', 'audio para instrumento'])) return tool('audio_to_instrument', { assetId, mode: 'chromatic', preserveFormants: true }, 'preview_only');
  if (matches(text, ['analisa esse audio', 'o que tem nesse audio', 'inspeciona esse audio'])) return tool('inspect_audio', { assetId }, 'read_only');
  if (matches(text, ['analisa meu mix', 'como esta meu mix', 'o que esta embolando', 'por que esta embolado'])) return tool('inspect_mix', { projectId }, 'read_only');
  if (looksLikeDeterministicEdit(text)) return { supported: true, kind: 'deterministic_edit', command: message, trackId, previewPolicy: 'preview_then_apply' };
  return unsupported('no_safe_audio_intent');
}

export async function executePabloAudioMessage(message, context = {}, { audioToolRuntime, executeDeterministicEdit, persistAuthorialMemory, generateMusicDraft } = {}) {
  const music = await tryMusicIntelligence(message, context);
  if (music?.supported) {
    if (music.kind === 'pmi_authorial_feedback') {
      if (typeof persistAuthorialMemory !== 'function') return { ...music, execution: 'preview_only', canApply: false };
      const persistence = await persistAuthorialMemory(music.authorialMemory, music.feedback);
      return { ...music, persistence, execution: 'allowed', canApply: true };
    }
    if (music.kind === 'pmi_generation_request' || music.kind === 'pmi_draft_revision_request') {
      if (music.blocked) return { ...music, kind: 'pmi_generation_blocked', reply: music.reason === 'lyrics_required' ? 'Esse pedido precisa de uma letra ou trecho no projeto primeiro. Não gerei nada por fora do seu contexto.' : 'Esse pedido ainda não está pronto para geração.', execution: 'none', canApply: false };
      if (typeof generateMusicDraft !== 'function') return { ...music, reply: 'O plano criativo está pronto, mas a geração online não está disponível nesta sessão. Não alterei sua letra.', execution: 'preview_only', canApply: false };
      const generated = await generateMusicDraft(music.request);
      const draft = {
        text: String(generated?.text || '').trim(), command: music.command, targetSection: music.targetSection || null, targetGenre: music.targetGenre || null,
      };
      if (context.projectId && draft.text) pmiPendingDraftCache.set(String(context.projectId), Object.freeze(draft));
      return { supported: true, kind: 'pmi_generated_draft', ...draft, session: music.session || null, revisedPendingDraft: music.kind === 'pmi_draft_revision_request', reply: draft.text, provider: generated?.provider || null, model: generated?.model || null, execution: 'preview_only', canApply: false, reviewRequired: true };
    }
    return { ...music, execution: 'read_only', canApply: false };
  }
  const parsed = interpretPabloAudioMessage(message, context); if (!parsed.supported) return parsed;
  if (parsed.kind === 'tool_call') {
    if (typeof audioToolRuntime !== 'function') throw new TypeError('audioToolRuntime is required for tool calls');
    const result = await audioToolRuntime(parsed.tool, parsed.args);
    return { ...parsed, result, execution: result?.data?.execution || parsed.previewPolicy, canApply: result?.ok === true && result?.data?.execution === 'allowed' };
  }
  if (typeof executeDeterministicEdit !== 'function') return { ...parsed, execution: 'preview_only', canApply: false };
  const result = await executeDeterministicEdit(message, parsed.trackId); return { ...parsed, result, execution: 'allowed', canApply: true };
}

async function tryMusicIntelligence(message, context = {}) {
  const intelligence = await loadMusicIntelligence(); if (!intelligence) return null;
  const projectId = String(context.projectId || '');
  const enrichedContext = {
    ...context,
    ...(projectId && pmiSessionCache.has(projectId) ? { pmiSession: pmiSessionCache.get(projectId) } : {}),
    ...(projectId && pmiPendingDraftCache.has(projectId) ? { pendingDraft: pmiPendingDraftCache.get(projectId) } : {}),
  };
  const feedback = intelligence.respondToAuthorialFeedback(message, enrichedContext); if (feedback?.supported) return feedback;
  const draftRevision = intelligence.planPendingDraftRevision?.(message, enrichedContext); if (draftRevision?.supported) return draftRevision;
  const generation = intelligence.planComposerGeneration(message, enrichedContext);
  if (generation?.supported) { rememberPmiSession(projectId, generation.session); return generation; }
  const planning = intelligence.respondToMusicCreation(message, enrichedContext); if (planning?.supported) rememberPmiSession(projectId, planning.session); return planning;
}

function rememberPmiSession(projectId, session) { if (projectId && session?.schema === 'pmi_music_session_v1') pmiSessionCache.set(projectId, session); }
async function loadMusicIntelligence() { for (const specifier of ['./music-intelligence/src/index.mjs', '../music-intelligence/src/index.mjs']) { try { return await import(specifier); } catch {} } return null; }
function looksLikeDeterministicEdit(text) { return /\b(limpa|limpar|limpeza|presente|presenca|quente|calor|sibilancia|sibilante|de-?esser|centraliza|centralizado|centro|fade)\b/.test(text); }
function tool(name, args, previewPolicy) { return { supported: true, kind: 'tool_call', tool: name, args, previewPolicy }; }
function unsupported(reason) { return { supported: false, kind: 'unsupported', reason, previewPolicy: 'none' }; }
function matches(text, phrases) { return phrases.some((phrase) => text.includes(phrase)); }
function normalize(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9# +.-]/g, ' ').replace(/\s+/g, ' ').trim(); }
