import { listProjects, getAudioAsset, saveProject as persistProject } from './storage.mjs';
import { RemoteAuthAdapter } from './remote-auth.mjs';
import { snapshotProject } from './core/src/project.mjs';
import { executeNaturalLanguageEdit } from './core/src/natural-language-edit.mjs';
import { analyzeWaveform } from './audio/src/analyzers/waveform-basic.mjs';
import { detectOnsets } from './audio/src/analyzers/onset-basic.mjs';
import { analyzeMusicalAudio } from './audio/src/analyzers/pipeline.mjs';
import { replaceBreathAutomation } from './audio/src/voice/breath-intelligence.mjs';
import { buildProjectMixState } from './audio/src/mix/mix-intelligence-graph.mjs';
import { createPabloVoiceAudioToolRuntime } from './providers/src/pablovoice-audio-tools.mjs';
import { executePabloAudioMessage } from './pablo-conversation-audio.mjs';

const analysisCache = new Map();
const remoteAuth = new RemoteAuthAdapter();
const REVIEWED_SONG_COMMANDS = new Set(['generate', 'continue_section', 'rewrite', 'adapt_genre']);
let injecting = false;

remoteAuth.consumeBootstrapFragment();

export function installPabloConversationUI() {
  const observer = new MutationObserver(() => injectConversationBox());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  injectConversationBox();
  return () => observer.disconnect();
}

async function activeProject() {
  const projects = await listProjects();
  return projects[0] || null;
}

async function analyzeTrack(track) {
  if (!track?.assetId) return null;
  if (analysisCache.has(track.assetId)) return analysisCache.get(track.assetId);
  const asset = await getAudioAsset(track.assetId);
  if (!asset?.blob) return null;

  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) throw new Error('Análise de áudio não é suportada neste navegador.');
  const context = new AudioCtx();
  try {
    const bytes = await asset.blob.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    const samples = buffer.getChannelData(0);
    const waveform = analyzeWaveform(samples, { sampleRate: buffer.sampleRate });
    const onsets = detectOnsets(samples, { sampleRate: buffer.sampleRate });
    const musical = analyzeMusicalAudio({
      samples,
      sampleRate: buffer.sampleRate,
      onsets,
      durationSeconds: buffer.duration,
    });
    const spectralEnvelope = coarseSpectrum(samples, buffer.sampleRate);
    const analysis = {
      schemaVersion: 2,
      assetId: track.assetId,
      source: { sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, durationSeconds: buffer.duration },
      music: musical.music,
      signal: { ...waveform.signal, onsets, transients: onsets, spectralEnvelope },
      voice: musical.voice,
      confidence: musical.confidence,
      validity: { complete: true, invalidatedRanges: [] },
    };
    analysisCache.set(track.assetId, analysis);
    return analysis;
  } finally {
    context.close?.().catch?.(() => {});
  }
}

async function getAnalysis(assetId) {
  const project = await activeProject();
  const track = project?.tracks?.find((item) => item.assetId === assetId);
  return track ? analyzeTrack(track) : null;
}

async function getMixState(projectId) {
  const project = await activeProject();
  if (!project || (projectId && project.id !== projectId)) return null;
  const tracks = [];
  for (const track of project.tracks || []) {
    const analysis = await analyzeTrack(track);
    if (!analysis) continue;
    tracks.push({
      trackId: track.id,
      role: track.kind === 'recording' ? 'lead-vocal' : 'instrumental',
      analysis,
      confidence: analysis.confidence?.voice ?? analysis.confidence?.pitch ?? 0,
    });
  }
  return buildProjectMixState({ tracks });
}

const audioToolRuntime = createPabloVoiceAudioToolRuntime({ getAnalysis, getMixState });

async function executeDeterministicEdit(message, trackId) {
  const project = await activeProject();
  if (!project) throw new Error('Crie ou abra um projeto primeiro.');
  const result = executeNaturalLanguageEdit(project, message, { trackId });
  await persistProject(result.project);
  return result;
}

async function applyBreathAutomation(result, trackId) {
  const project = await activeProject();
  if (!project) throw new Error('Crie ou abra um projeto primeiro.');
  const target = project.tracks?.find((track) => track.id === trackId) || project.tracks?.[0];
  if (!target) throw new Error('Nenhuma faixa disponível para aplicar respirações.');
  const plan = Array.isArray(result?.result?.data?.events) ? result.result.data.events : [];
  target.regionAutomation = replaceBreathAutomation(target.regionAutomation, plan);
  const automatic = target.regionAutomation.filter((event) => event.source === 'pablo-breath-intelligence-v1').length;
  const saved = snapshotProject(project, 'Respirações ajustadas pelo Pablo');
  await persistProject(saved);
  return automatic;
}

async function persistAuthorialMemoryState(authorialMemory, feedback) {
  const project = await activeProject();
  if (!project) throw new Error('Crie ou abra um projeto primeiro.');
  project.authorialMemory = authorialMemory ? structuredClone(authorialMemory) : null;
  const action = feedback?.decision === 'rejected' ? 'evitar' : 'priorizar';
  const value = String(feedback?.value || '').slice(0, 48);
  const saved = snapshotProject(project, `Preferência autoral: ${action}${value ? ` ${value}` : ''}`);
  await persistProject(saved);
  return {
    ok: true,
    projectId: saved.id,
    evidenceCount: Number(saved.authorialMemory?.evidenceCount || 0),
  };
}

async function generateMusicDraft(request) {
  const project = await activeProject();
  if (!project) throw new Error('Crie ou abra um projeto primeiro.');
  if (!REVIEWED_SONG_COMMANDS.has(request?.command)) throw new Error('Esse tipo de geração ainda não foi liberado no Composer.');

  const health = await remoteAuth.agentHealth();
  if (!health?.available) throw new Error('O Composer online não está disponível agora. Seu projeto local continua intacto.');
  const linked = await remoteAuth.ensureRemoteProject(project);
  if (!linked?.ok || !linked.project?.id) throw new Error('Não consegui ligar este projeto ao Composer agora.');

  const result = await remoteAuth.agentTurn({
    command: request.command,
    project_id: linked.project.id,
    task: String(request.task || '').slice(0, 4000),
    context_pack: {
      ...(request.contextPack || {}),
      local_project_id: project.id,
      project_title: project.name,
      preset: project.preset,
    },
    author_samples: Array.isArray(request.authorSamples) ? request.authorSamples.slice(0, 3) : [],
    constraints: { ...(request.constraints || {}), review_before_apply: true },
    best_of_n: 1,
  });
  const text = String(result?.reply || result?.text || '').trim();
  if (!result?.ok || !text) throw new Error(composerError(result?.error));
  return {
    text,
    provider: result.provider || health.provider || 'remote',
    model: result.model || health.model || null,
  };
}

async function applyPmiGeneratedDraft(text, mode = 'replace') {
  const value = String(text || '').trim();
  if (!value) return false;
  const project = await activeProject();
  if (!project) throw new Error('Crie ou abra um projeto primeiro.');
  const current = String(project.lyrics || '').trimEnd();
  project.lyrics = mode === 'append' && current ? `${current}\n\n${value}` : value;
  const label = mode === 'append' ? 'Rascunho PMI adicionado à letra' : 'Rascunho PMI usado como letra';
  const saved = snapshotProject(project, label);
  await persistProject(saved);
  const lyrics = document.querySelector('#lyrics');
  if (lyrics) lyrics.value = saved.lyrics;
  return true;
}

async function contextForMessage() {
  const project = await activeProject();
  const active = project?.tracks?.find((track) => track.id === project.activeTrackId) || project?.tracks?.[0] || null;
  const other = project?.tracks?.find((track) => track.id !== active?.id) || null;
  return {
    projectId: project?.id || null,
    trackId: active?.id || null,
    assetId: active?.assetId || null,
    referenceAssetId: active?.assetId || null,
    targetAssetId: other?.assetId || null,
    lyrics: String(project?.lyrics || '').slice(0, 12000),
    notes: String(project?.notes || '').slice(0, 4000),
    preset: project?.preset || null,
    authorialMemory: project?.authorialMemory ? structuredClone(project.authorialMemory) : null,
  };
}

function remoteContextPack(project) {
  const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
  return {
    source: 'pablovoice-unified-local-first',
    project: {
      local_id: project?.id || null,
      title: project?.name || 'Projeto PabloVoice',
      preset: project?.preset || null,
      track_count: tracks.length,
      active_track_id: project?.activeTrackId || null,
      lyrics: String(project?.lyrics || '').slice(0, 12000),
      notes: String(project?.notes || '').slice(0, 4000),
    },
    tracks: tracks.slice(0, 16).map((track) => ({
      id: track.id,
      name: track.name,
      kind: track.kind,
      duration: Number(track.duration || 0),
      gain: Number(track.gain ?? 1),
      pan: Number(track.pan || 0),
      muted: Boolean(track.muted),
      solo: Boolean(track.solo),
      effects: track.effects || {},
    })),
  };
}

async function tryRemoteReasoning(message) {
  const project = await activeProject();
  if (!project) return null;
  const health = await remoteAuth.agentHealth();
  if (!health?.available || !health?.authenticated) return null;
  const linked = await remoteAuth.ensureRemoteProject(project);
  if (!linked?.ok || !linked.project?.id) return null;
  const result = await remoteAuth.agentTurn({
    project_id: linked.project.id,
    message,
    intent: { mode: 'advice_only', destructive_actions: false, source: 'unified_pablo_chat' },
    context_pack: remoteContextPack(project),
    tools: [],
  });
  if (!result?.ok || !String(result.reply || '').trim()) return null;
  return {
    supported: true,
    kind: 'remote_reasoning',
    reply: String(result.reply).trim(),
    provider: result.provider || health.provider || 'remote',
    model: result.model || health.model || null,
  };
}

async function submitMessage(form) {
  const input = form.querySelector('input[name="message"]');
  const message = input?.value.trim();
  if (!message) return;
  input.value = '';
  appendMessage(message, 'user');
  setBusy(form, true);
  try {
    const context = await contextForMessage();
    const result = await executePabloAudioMessage(message, context, {
      audioToolRuntime,
      executeDeterministicEdit,
      persistAuthorialMemory: persistAuthorialMemoryState,
      generateMusicDraft,
    });
    if (result?.supported) {
      appendMessage(formatResult(result), 'assistant', result);
      if (result.kind === 'deterministic_edit' && result.canApply) {
        appendMessage('A edição determinística foi aplicada e salva. Reabra o Studio para ouvir a prévia atualizada.', 'assistant');
      }
      if (result.tool === 'soften_breaths' && result.canApply) {
        const applied = await applyBreathAutomation(result, context.trackId);
        appendMessage(`${applied} respiração(ões) de alta confiança receberam automação reversível. Use a revisão A/B abaixo para ouvir e decidir trecho por trecho.`, 'assistant');
      }
    } else {
      const remote = await tryRemoteReasoning(message);
      if (remote) appendMessage(remote.reply, 'assistant', remote);
      else appendMessage('Ainda não tenho uma ação ou resposta remota segura para esse pedido. Não alterei o projeto.', 'assistant');
    }
  } catch (error) {
    appendMessage(error?.message || 'Não consegui executar esse pedido com segurança.', 'assistant', { error: true });
  } finally {
    setBusy(form, false);
  }
}

function injectConversationBox() {
  if (injecting) return;
  const shell = document.querySelector('.pv-chat-shell .pv-card.chrome');
  if (!shell || shell.querySelector('[data-pablo-conversation]')) return;
  injecting = true;
  const box = document.createElement('div');
  box.dataset.pabloConversation = 'true';
  box.className = 'pv-conversation';
  box.innerHTML = `<div class="pv-conversation-log" data-pablo-log>
    <div class="pv-msg assistant">Pode falar do seu jeito: “quero criar uma música sobre…”, “escreve um refrão dessa ideia”, “não use essa palavra” ou “deixa minha voz mais na frente”.<small>PMI local · Composer sob pedido · revisão antes de aplicar</small></div>
  </div>
  <form class="pv-compose-row" data-pablo-form>
    <input class="pv-field" name="message" autocomplete="off" placeholder="O que você quer criar ou fazer com o som?" aria-label="Falar com Pablo sobre música e áudio">
    <button class="pv-btn primary" type="submit">Enviar</button>
  </form>`;
  shell.appendChild(box);
  box.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    submitMessage(event.currentTarget);
  });
  injecting = false;
}

function appendMessage(text, role, result = null) {
  const log = document.querySelector('[data-pablo-log]');
  if (!log) return;
  const message = document.createElement('div');
  message.className = `pv-msg ${role}`;
  message.textContent = text;
  let metaText = '';
  if (result?.data?.decision) metaText = `confiança: ${Math.round((result.data.confidence || 0) * 100)}% · ${result.data.decision}`;
  else if (result?.kind === 'pmi_music_session') metaText = 'PMI Music 1.0 · direção criativa local';
  else if (result?.kind === 'pmi_authorial_feedback') metaText = `PMI · memória autoral${result.canApply ? ' salva' : ' em prévia'}`;
  else if (result?.kind === 'pmi_generated_draft') metaText = `PMI → Composer · ${result.provider || 'IA remota'}${result.model ? ` · ${result.model}` : ''} · revisar antes de usar`;
  else if (result?.kind === 'pmi_generation_blocked') metaText = 'PMI · geração não executada';
  else if (result?.kind === 'remote_reasoning') metaText = `IA remota · ${result.provider}${result.model ? ` · ${result.model}` : ''}`;
  if (metaText) {
    const meta = document.createElement('small');
    meta.textContent = metaText;
    message.appendChild(meta);
  }
  if (result?.kind === 'pmi_generated_draft' && String(result.text || '').trim()) {
    const actions = document.createElement('div');
    actions.className = 'pv-actions';
    for (const [mode, label] of [['replace', 'Usar como letra'], ['append', 'Adicionar à letra']]) {
      const button = document.createElement('button');
      button.className = 'pv-btn';
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', async () => {
        const buttons = [...actions.querySelectorAll('button')];
        buttons.forEach((item) => { item.disabled = true; });
        try {
          await applyPmiGeneratedDraft(result.text, mode);
          appendMessage(mode === 'append' ? 'Adicionei o rascunho à letra e salvei uma revisão.' : 'Usei o rascunho como letra e salvei uma revisão.', 'assistant');
        } catch (error) {
          appendMessage(error?.message || 'Não consegui aplicar esse rascunho.', 'assistant', { error: true });
          buttons.forEach((item) => { item.disabled = false; });
        }
      });
      actions.appendChild(button);
    }
    message.appendChild(actions);
  }
  log.appendChild(message);
  message.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function formatResult(result) {
  if (!result?.supported) return 'Ainda não tenho uma ação segura para esse pedido. Não alterei o projeto.';
  if (['pmi_music_session', 'pmi_authorial_feedback', 'pmi_generation_request', 'pmi_generation_blocked', 'pmi_generated_draft'].includes(result.kind)) {
    return result.reply || result.text || 'Entendi sua direção criativa.';
  }
  if (result.kind === 'deterministic_edit') return result.canApply ? 'Entendi e apliquei a edição reversível no projeto.' : 'Entendi a edição, mas mantive somente como prévia.';
  if (!result.result?.ok) return `Não consegui usar essa análise: ${result.result?.reason || 'dados insuficientes'}.`;
  const data = result.result.data || {};
  if (result.tool === 'inspect_audio') {
    const bpm = featureValue(data.music?.bpm ?? data.music?.bpm?.value);
    const pitch = featureValue(data.voice?.pitchHz ?? data.voice?.pitchHz?.value);
    return `Analisei o áudio${bpm ? `: cerca de ${Math.round(bpm)} BPM` : ''}${pitch ? `, pitch central ~${Math.round(pitch)} Hz` : ''}.`;
  }
  if (result.tool === 'inspect_mix') return `Analisei ${data.tracks?.length || 0} faixa(s) e ${data.relations?.length || 0} relação(ões) no mix.`;
  if (result.tool === 'bring_voice_forward' || result.tool === 'make_vocal_space') return data.execution === 'allowed' ? 'Montei um plano seguro para abrir espaço e trazer a voz para frente. Ele está pronto para prévia.' : 'Montei uma sugestão de mix, mas a confiança ainda pede revisão antes de aplicar.';
  if (result.tool === 'soften_breaths') return `Encontrei ${data.total ?? data.events?.length ?? data.length ?? 0} evento(s) de respiração no plano. Nada de baixa confiança será removido sozinho.`;
  if (result.tool === 'align_vocals') return Number.isFinite(data.offsetMs) ? `O vocal secundário está deslocado em cerca de ${Math.round(data.offsetMs)} ms. ${data.execution === 'allowed' ? 'A correção está elegível para prévia.' : 'Vou manter como sugestão.'}` : 'Não encontrei evidência suficiente para alinhar automaticamente.';
  if (result.tool === 'audio_to_instrument') return data.chromatic?.ready ? `O áudio pode virar instrumento cromático a partir da nota MIDI ${data.chromatic.rootMidi}.` : 'Ainda não há pitch confiável o suficiente para transformar este áudio em instrumento automaticamente.';
  return 'Análise concluída. Mantive o resultado como preview seguro.';
}

function composerError(code) {
  const known = {
    auth_required: 'Entre no PabloVoice para usar o Composer online.',
    invalid_session: 'Sua sessão do PabloVoice expirou. Entre novamente.',
    project_not_found: 'Não consegui confirmar este projeto no Composer.',
    composer_key_unavailable: 'O Composer online ainda não está configurado no servidor.',
    remote_provider_failed: 'O Composer online falhou agora. Sua letra local foi preservada.',
    remote_empty_response: 'O Composer não devolveu um rascunho utilizável. Sua letra local foi preservada.',
  };
  return known[code] || 'Não consegui gerar esse rascunho agora. Sua letra local foi preservada.';
}

function coarseSpectrum(samples, sampleRate, bands = 8) {
  const size = Math.min(2048, samples.length);
  if (size < 64) return [];
  const start = Math.max(0, Math.floor((samples.length - size) / 2));
  const frame = samples.subarray(start, start + size);
  const nyquist = sampleRate / 2;
  const values = [];
  for (let band = 0; band < bands; band += 1) {
    const low = 40 * Math.pow(nyquist / 40, band / bands);
    const high = 40 * Math.pow(nyquist / 40, (band + 1) / bands);
    const center = Math.sqrt(low * high);
    const k = Math.max(1, Math.min(Math.floor(size / 2) - 1, Math.round(center * size / sampleRate)));
    let re = 0, im = 0;
    for (let n = 0; n < size; n += 1) {
      const angle = 2 * Math.PI * k * n / size;
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (size - 1));
      re += frame[n] * window * Math.cos(angle);
      im -= frame[n] * window * Math.sin(angle);
    }
    values.push(Math.sqrt(re * re + im * im));
  }
  const max = Math.max(...values, 1e-9);
  return values.map((value, index) => ({ band: index, value: value / max }));
}

function featureValue(value) {
  const n = Number(value?.value ?? value);
  return Number.isFinite(n) ? n : null;
}

function setBusy(form, busy) {
  const button = form.querySelector('button');
  const input = form.querySelector('input');
  if (button) { button.disabled = busy; button.textContent = busy ? 'Analisando…' : 'Enviar'; }
  if (input) input.disabled = busy;
}
