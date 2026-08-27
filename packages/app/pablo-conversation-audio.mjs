const pmiSessionCache = new Map();
const pmiPendingDraftCache = new Map();

export const CONVERSATIONAL_AUDIO_INTENTS = Object.freeze({
  voice_forward: 'bring_voice_forward',
  make_vocal_space: 'make_vocal_space',
  soften_breaths: 'soften_breaths',
  remove_breaths: 'soften_breaths',
  align_vocals: 'align_vocals',
  audio_to_instrument: 'audio_to_instrument',
  inspect_audio: 'inspect_audio',
  inspect_mix: 'inspect_mix',
  beat_organize: 'beat_organize',
  beat_humanize: 'beat_humanize',
  beat_reference_groove: 'beat_reference_groove',
  beat_fill: 'beat_fill',
});

export function interpretPabloAudioMessage(message, context = {}) {
  const text = normalize(message);
  if (!text) return unsupported('empty_message');

  const trackId = context.trackId || null;
  const assetId = context.assetId || null;
  const projectId = context.projectId || null;

  if (matches(text, ['virada antes do refrao', 'faz uma virada antes do refrao', 'cria uma virada antes do refrao'])) {
    return beatOperation('fill_before_section', { section: 'chorus', position: 'before', intensity: 0.65 }, 'preview_only');
  }

  if (matches(text, ['faz bateria funk aqui', 'cria uma bateria funk', 'faz um beat funk aqui', 'faz um beat de funk aqui'])) {
    return {
      supported: true,
      kind: 'beat_generation_plan',
      action: 'genre_pattern',
      args: { genre: 'funk' },
      previewPolicy: 'preview_only',
      reply: 'Entendi o pedido de uma bateria funk, mas os padrões por gênero ainda precisam do gate musical antes de eu aplicar um automaticamente.',
    };
  }

  if (matches(text, ['organiza os pads da bateria', 'organiza os sons da bateria', 'organiza os pads', 'organiza o beat'])) {
    return beatOperation('organize', {}, 'preview_then_apply');
  }

  if (matches(text, ['deixa essa bateria menos reta', 'deixa a bateria menos reta', 'humaniza essa bateria', 'humaniza a bateria', 'deixa o beat mais humano'])) {
    return beatOperation('humanize', { amount: humanizeAmount(text) }, 'preview_then_apply');
  }

  if (matches(text, ['usa o groove desse audio', 'usa o groove do audio', 'aplica o groove desse audio', 'pega o groove desse audio', 'segue o groove desse audio'])) {
    return beatOperation('apply_groove', { amount: grooveAmount(text) }, 'preview_then_apply');
  }

  if (matches(text, ['faz uma virada', 'cria uma virada', 'coloca uma virada', 'adiciona uma virada'])) {
    return beatOperation('fill', { intensity: fillIntensity(text) }, 'preview_then_apply');
  }

  if (matches(text, ['voz mais na frente', 'minha voz na frente', 'destaca minha voz', 'voz mais presente no mix'])) {
    return tool('bring_voice_forward', { projectId, trackId }, 'preview_then_apply');
  }

  if (matches(text, ['abre espaco pra voz', 'abre espaco para voz', 'abre espaco pra minha voz', 'menos embolado com a voz'])) {
    return tool('make_vocal_space', { projectId, trackId }, 'preview_then_apply');
  }

  if (matches(text, ['suaviza minhas respiracoes', 'suavizar respiracoes', 'respiracao mais natural', 'respiracoes mais naturais'])) {
    return tool('soften_breaths', { assetId, mode: 'soften' }, 'preview_then_apply');
  }

  if (matches(text, ['remove minhas respiracoes', 'tirar respiracoes', 'remove as respiracoes'])) {
    return tool('soften_breaths', { assetId, mode: 'remove' }, 'preview_then_apply');
  }

  if (matches(text, ['alinha minhas vozes', 'alinhar vocais', 'alinhar double', 'alinha o double', 'alinha backing'])) {
    return tool('align_vocals', {
      referenceAssetId: context.referenceAssetId || assetId,
      targetAssetId: context.targetAssetId || null,
    }, 'preview_then_apply');
  }

  if (matches(text, ['transforma isso em instrumento', 'vira instrumento', 'tocar isso como instrumento', 'audio para instrumento'])) {
    return tool('audio_to_instrument', { assetId, mode: 'chromatic', preserveFormants: true }, 'preview_only');
  }

  if (matches(text, ['analisa esse audio', 'o que tem nesse audio', 'inspeciona esse audio'])) {
    return tool('inspect_audio', { assetId }, 'read_only');
  }

  if (matches(text, ['analisa meu mix', 'como esta meu mix', 'o que esta embolando', 'por que esta embolado'])) {
    return tool('inspect_mix', { projectId }, 'read_only');
  }

  if (looksLikeDeterministicEdit(text)) {
    return {
      supported: true,
      kind: 'deterministic_edit',
      command: message,
      trackId,
      previewPolicy: 'preview_then_apply',
    };
  }

  return unsupported('no_safe_audio_intent');
}

export async function executePabloAudioMessage(message, context, {
  audioToolRuntime,
  executeDeterministicEdit,
  executeBeatOperation,
  persistAuthorialMemory,
  generateMusicDraft,
} = {}) {
  const direct = interpretPabloAudioMessage(message, context);
  if (direct.supported && direct.kind === 'beat_generation_plan') {
    return { ...direct, execution: 'preview_only', canApply: false };
  }
  if (direct.supported && direct.kind === 'beat_operation') {
    const executor = typeof executeBeatOperation === 'function' ? executeBeatOperation : executeDefaultBeatOperation;
    const result = await executor(direct, context);
    if (!result) return { ...direct, execution: 'preview_only', canApply: false };
    return {
      ...direct,
      result,
      reply: result?.reply || direct.reply || null,
      execution: result?.ok === true ? 'allowed' : 'preview_only',
      canApply: result?.ok === true && result?.mutated === true,
    };
  }

  const music = await tryMusicIntelligence(message, context);
  if (music?.supported) {
    if (music.kind === 'pmi_authorial_feedback') {
      if (typeof persistAuthorialMemory !== 'function') {
        return { ...music, execution: 'preview_only', canApply: false };
      }
      const persistence = await persistAuthorialMemory(music.authorialMemory, music.feedback);
      return { ...music, persistence, execution: 'allowed', canApply: true };
    }
    if (music.kind === 'pmi_draft_revision_request') {
      if (typeof generateMusicDraft !== 'function') {
        return {
          ...music,
          reply: 'Entendi a revisão do rascunho, mas o Composer online não está disponível nesta sessão. Mantive a versão atual intacta.',
          execution: 'preview_only',
          canApply: false,
        };
      }
      const generated = await generateMusicDraft(music.request);
      const pending = rememberPendingDraft(context?.projectId, {
        text: generated?.text,
        command: music.command,
        targetSection: music.targetSection,
        targetGenre: music.targetGenre,
        pendingVersion: music.pendingVersion,
      }, { revision: true });
      return generatedDraftResult(music, generated, pending, { revisionOfPending: true });
    }
    if (music.kind === 'pmi_generation_request') {
      if (music.blocked) {
        return {
          ...music,
          kind: 'pmi_generation_blocked',
          reply: music.reason === 'lyrics_required'
            ? 'Esse pedido precisa de uma letra ou trecho no projeto primeiro. Não gerei nada por fora do seu contexto.'
            : 'Esse pedido ainda não está pronto para geração.',
          execution: 'none',
          canApply: false,
        };
      }
      if (typeof generateMusicDraft !== 'function') {
        return {
          ...music,
          reply: 'O plano criativo está pronto, mas a geração online não está disponível nesta sessão. Não alterei sua letra.',
          execution: 'preview_only',
          canApply: false,
        };
      }
      const generated = await generateMusicDraft(music.request);
      const pending = rememberPendingDraft(context?.projectId, {
        text: generated?.text,
        command: music.command,
        targetSection: music.targetSection,
        targetGenre: music.targetGenre,
        baseLyrics: context?.lyrics,
      });
      return generatedDraftResult(music, generated, pending);
    }
    return { ...music, execution: 'read_only', canApply: false };
  }

  const parsed = direct;
  if (!parsed.supported) return parsed;

  if (parsed.kind === 'tool_call') {
    if (typeof audioToolRuntime !== 'function') throw new TypeError('audioToolRuntime is required for tool calls');
    const result = await audioToolRuntime(parsed.tool, parsed.args);
    return {
      ...parsed,
      result,
      execution: result?.data?.execution || parsed.previewPolicy,
      canApply: result?.ok === true && result?.data?.execution === 'allowed',
    };
  }

  if (typeof executeDeterministicEdit !== 'function') {
    return { ...parsed, execution: 'preview_only', canApply: false };
  }

  const result = await executeDeterministicEdit(message, parsed.trackId);
  return { ...parsed, result, execution: 'allowed', canApply: true };
}

export function clearPmiPendingDraft(projectId = '') {
  const key = String(projectId || '');
  return key ? pmiPendingDraftCache.delete(key) : false;
}

async function executeDefaultBeatOperation(operation, context = {}) {
  try {
    const runtime = await import('./pablo-beat-runtime.mjs');
    if (typeof runtime.executePersistedPabloBeatOperation !== 'function') return null;
    return runtime.executePersistedPabloBeatOperation(operation, context);
  } catch {
    return null;
  }
}

async function tryMusicIntelligence(message, context = {}) {
  const intelligence = await loadMusicIntelligence();
  if (!intelligence) return null;
  const projectId = String(context.projectId || '');
  let enrichedContext = { ...context };
  if (projectId && pmiSessionCache.has(projectId)) enrichedContext.pmiSession = pmiSessionCache.get(projectId);
  if (projectId && pmiPendingDraftCache.has(projectId)) {
    const pending = pmiPendingDraftCache.get(projectId);
    const currentLyrics = boundedLyrics(context.lyrics);
    if (pending.baseLyrics !== currentLyrics) pmiPendingDraftCache.delete(projectId);
    else enrichedContext.pendingDraft = pending;
  }

  const feedback = intelligence.respondToAuthorialFeedback(message, enrichedContext);
  if (feedback?.supported) return feedback;

  const revision = intelligence.planPendingDraftRevision(message, enrichedContext);
  if (revision?.supported) return revision;

  const generation = intelligence.planComposerGeneration(message, enrichedContext);
  if (generation?.supported) {
    rememberPmiSession(projectId, generation.session);
    return generation;
  }

  const planning = intelligence.respondToMusicCreation(message, enrichedContext);
  if (planning?.supported) rememberPmiSession(projectId, planning.session);
  return planning;
}

function rememberPmiSession(projectId, session) {
  if (!projectId || !session || session.schema !== 'pmi_music_session_v1') return;
  pmiSessionCache.set(projectId, session);
}

function rememberPendingDraft(projectId, draft = {}, { revision = false } = {}) {
  const key = String(projectId || '');
  const prior = key ? pmiPendingDraftCache.get(key) : null;
  const text = String(draft.text || '').trim().slice(0, 12000);
  const baseVersion = Math.max(1, Math.floor(Number(prior?.version || draft.pendingVersion) || 1));
  const pending = Object.freeze({
    text,
    version: revision ? Math.min(99, baseVersion + 1) : 1,
    command: String(draft.command || prior?.command || '').slice(0, 64) || null,
    targetSection: String(draft.targetSection || prior?.targetSection || '').slice(0, 64) || null,
    targetGenre: String(draft.targetGenre || prior?.targetGenre || '').slice(0, 64) || null,
    baseLyrics: revision ? String(prior?.baseLyrics ?? '').slice(0, 12000) : boundedLyrics(draft.baseLyrics),
  });
  if (key && text) pmiPendingDraftCache.set(key, pending);
  return pending;
}

function generatedDraftResult(music, generated, pending, { revisionOfPending = false } = {}) {
  const text = String(generated?.text || '').trim();
  const version = pending?.version || 1;
  return {
    supported: true,
    kind: 'pmi_generated_draft',
    command: music.command,
    targetSection: music.targetSection,
    targetGenre: music.targetGenre,
    session: music.session || null,
    text,
    reply: `Rascunho v${version} · revise antes de aplicar.\n\n${text}`,
    provider: generated?.provider || null,
    model: generated?.model || null,
    draftVersion: version,
    revisionOfPending,
    previousDraftVersion: revisionOfPending ? Math.max(1, version - 1) : null,
    execution: 'preview_only',
    canApply: false,
    reviewRequired: true,
  };
}

async function loadMusicIntelligence() {
  for (const specifier of ['./music-intelligence/src/index.mjs', '../music-intelligence/src/index.mjs']) {
    try {
      return await import(specifier);
    } catch {
      // Source tests and packaged runtime resolve the canonical package from different roots.
    }
  }
  return null;
}

function looksLikeDeterministicEdit(text) {
  return /\b(limpa|limpar|limpeza|presente|presenca|quente|calor|sibilancia|sibilante|de-?esser|centraliza|centralizado|centro|fade)\b/.test(text);
}

function beatOperation(action, args, previewPolicy) {
  return { supported: true, kind: 'beat_operation', action, args, previewPolicy };
}

function humanizeAmount(text) {
  if (/\b(muito|bem mais|bastante)\b/.test(text)) return 0.65;
  if (/\b(pouco|sutil|leve)\b/.test(text)) return 0.22;
  return 0.35;
}

function grooveAmount(text) {
  if (/\b(muito|forte|bastante)\b/.test(text)) return 0.85;
  if (/\b(pouco|sutil|leve)\b/.test(text)) return 0.35;
  return 0.65;
}

function fillIntensity(text) {
  if (/\b(grande|forte|intensa|pesada)\b/.test(text)) return 0.9;
  if (/\b(curta|simples|leve|sutil)\b/.test(text)) return 0.4;
  return 0.65;
}

function tool(name, args, previewPolicy) {
  return { supported: true, kind: 'tool_call', tool: name, args, previewPolicy };
}

function unsupported(reason) {
  return { supported: false, kind: 'unsupported', reason, previewPolicy: 'none' };
}

function matches(text, phrases) {
  return phrases.some((phrase) => text.includes(phrase));
}

function boundedLyrics(value = '') {
  return String(value || '').slice(0, 12000);
}

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9# +.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
