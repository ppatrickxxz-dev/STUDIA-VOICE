import { createId, createTrack } from './core/src/project.mjs';
import { getProject, listProjects, saveAudioAsset, saveProject } from './storage.mjs';
import { RemoteAuthAdapter } from './remote-auth.mjs';

const PROJECT_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const VOICE_ENDPOINT = 'compute-kaggle-voice-v70';
const HARMONY_ENDPOINT = 'progress-kaggle-harmony-v73';
const auth = new RemoteAuthAdapter();

const state = {
  generated: '',
  generationMeta: null,
  voice: { busy: false, variants: [], job: null, message: '' },
  harmony: { busy: false, harmonies: [], job: null, capability: null, message: '' },
  pollers: new Map(),
};

let observer;
auth.consumeBootstrapFragment();

export function installAdvancedAIStudio() {
  if (observer) return () => observer.disconnect();
  observer = new MutationObserver(() => injectAll());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  injectAll();
  document.addEventListener('click', handleClick);
  document.addEventListener('submit', handleSubmit);
  return () => {
    observer?.disconnect();
    observer = null;
    document.removeEventListener('click', handleClick);
    document.removeEventListener('submit', handleSubmit);
    for (const timer of state.pollers.values()) clearInterval(timer);
    state.pollers.clear();
  };
}

async function activeProject() {
  const projects = await listProjects();
  return projects[0] || null;
}

async function remoteProject() {
  const local = await activeProject();
  if (!local) throw new Error('Crie ou abra um projeto primeiro.');
  const session = await auth.ensureSession();
  if (!session?.accessToken) throw new Error('Sessão do PabloVoice necessária para usar IA online.');
  const linked = await auth.ensureRemoteProject(local);
  if (!linked?.ok || !linked.project?.id) throw new Error('Não consegui ligar este projeto ao backend agora.');
  return { local, remoteId: linked.project.id, token: session.accessToken };
}

function headers(token = '') {
  const value = { apikey: PUBLISHABLE_KEY, 'content-type': 'application/json' };
  if (token) value.authorization = `Bearer ${token}`;
  return value;
}

async function api(slug, token, body) {
  const response = await fetch(`${PROJECT_URL}/functions/v1/${slug}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    const error = new Error(humanError(data?.error || `${slug}_${response.status}`, data));
    error.code = data?.error || '';
    error.payload = data;
    throw error;
  }
  return data;
}

function humanError(code, payload = {}) {
  const known = {
    auth_required: 'Entre no PabloVoice para usar esta IA.',
    invalid_session: 'Sua sessão expirou. Entre novamente no PabloVoice.',
    kaggle_not_connected: 'A GPU gratuita do PabloVoice ainda não está conectada para esta conta.',
    guide_vocal_missing_or_unverified: 'Primeiro use “Separar voz + instrumental” para criar uma guia vocal verificada.',
    voice_model_missing_or_unverified: 'Seu modelo Pablo Voice ainda não está pronto ou verificado no backend.',
    pablo_voice_source_missing: 'Crie primeiro uma variante vocal Natural/Identity/Smooth para harmonizar.',
    adaptive_harmony_requires_reanalysis: 'O mapa de acordes ainda não é confiável. Peça ao Pablo para mapear a música antes.',
    adaptive_partial_not_ready: 'Ainda não há trechos harmônicos confiáveis suficientes para a harmonia parcial.',
    remote_provider_not_configured: 'A IA generativa remota ainda não tem provider ativo.',
  };
  return payload?.human_message || known[code] || String(code || 'Falha na IA do PabloVoice.');
}

function injectAll() {
  injectComposer();
  injectVoiceAndHarmony();
}

function injectComposer() {
  const lyrics = document.querySelector('#lyrics');
  if (!lyrics || document.querySelector('#pv-ai-composer')) return;
  const grid = lyrics.closest('.pv-grid');
  if (!grid) return;
  const panel = document.createElement('article');
  panel.id = 'pv-ai-composer';
  panel.className = 'pv-card chrome';
  panel.innerHTML = `<div class="pv-card-head"><div><h3>Pablo Composer · IA</h3><p>Geração opcional com contexto do projeto; sua análise local continua ativa.</p></div><span class="pv-tag">REMOTE</span></div>
    <form class="pv-panel-grid" data-ai-compose-form>
      <div class="pv-compose-row">
        <select class="pv-field" name="command" aria-label="Ação de composição">
          <option value="generate">Gerar</option>
          <option value="continue_section">Continuar trecho</option>
          <option value="rewrite">Reescrever preservando minha voz</option>
          <option value="adapt_genre">Adaptar gênero</option>
        </select>
        <input class="pv-field" name="task" maxlength="4000" placeholder="Ex.: refrão R&B + funk, íntimo e brasileiro" aria-label="Pedido para o Pablo Composer">
        <button class="pv-btn primary" type="submit">Criar</button>
      </div>
      <div class="pv-note" id="pv-ai-compose-status">O texto só é enviado ao provider quando você toca em Criar.</div>
    </form>
    <div class="pv-tips"><div class="pv-msg assistant" id="pv-ai-compose-result">${state.generated ? escapeHtml(state.generated) : 'O resultado da IA aparece aqui para você revisar antes de aplicar.'}</div></div>
    <div class="pv-actions"><button class="pv-btn" type="button" data-ai-apply="replace" ${state.generated ? '' : 'disabled'}>Usar como letra</button><button class="pv-btn" type="button" data-ai-apply="append" ${state.generated ? '' : 'disabled'}>Adicionar à letra</button></div>`;
  grid.insertAdjacentElement('afterend', panel);
}

function injectVoiceAndHarmony() {
  if (document.querySelector('#pv-ai-voice-harmony')) return;
  const heading = [...document.querySelectorAll('h3')].find((node) => node.textContent?.trim() === 'Tratamento vocal');
  const grid = heading?.closest('.pv-grid');
  if (!grid) return;
  const panel = document.createElement('article');
  panel.id = 'pv-ai-voice-harmony';
  panel.className = 'pv-card chrome';
  panel.innerHTML = `<div class="pv-card-head"><div><h3>IA vocal · Pablo Voice</h3><p>RVC/Applio preservando identidade, com comparação antes de entrar no projeto.</p></div><span class="pv-tag">GPU</span></div>
    <div class="pv-actions">
      <button class="pv-btn" type="button" data-ai-voice="natural">Natural</button>
      <button class="pv-btn" type="button" data-ai-voice="identity">Identity</button>
      <button class="pv-btn" type="button" data-ai-voice="smooth">Smooth</button>
      <button class="pv-btn" type="button" data-ai-refresh="voice">Atualizar</button>
    </div>
    <div class="pv-note" id="pv-ai-voice-status">${escapeHtml(state.voice.message || 'Use uma guia vocal verificada e seu modelo Pablo Voice ativo.')}</div>
    <div class="pv-list" id="pv-ai-voice-list"></div>
    <div class="pv-card-head"><div><h3>Harmonias high + low</h3><p>Rubber Band + librosa, formantes preservados e confidence gate.</p></div></div>
    <div class="pv-actions">
      <button class="pv-btn" type="button" data-ai-harmony="high">Harmonia alta</button>
      <button class="pv-btn" type="button" data-ai-harmony="low">Harmonia baixa</button>
      <button class="pv-btn" type="button" data-ai-refresh="harmony">Atualizar</button>
    </div>
    <div class="pv-note" id="pv-ai-harmony-status">${escapeHtml(state.harmony.message || 'O modo parcial só atua onde voz e acordes têm confiança suficiente.')}</div>
    <div class="pv-list" id="pv-ai-harmony-list"></div>`;
  grid.insertAdjacentElement('afterend', panel);
  renderVoiceList();
  renderHarmonyList();
}

async function handleSubmit(event) {
  if (!event.target.matches('[data-ai-compose-form]')) return;
  event.preventDefault();
  const form = event.target;
  const command = String(form.elements.command?.value || 'generate');
  const task = String(form.elements.task?.value || '').trim();
  await runComposer({ command, task, form });
}

async function handleClick(event) {
  const apply = event.target.closest('[data-ai-apply]');
  if (apply) return applyGenerated(apply.dataset.aiApply);
  const voice = event.target.closest('[data-ai-voice]');
  if (voice) return runVoice(voice.dataset.aiVoice, voice);
  const harmony = event.target.closest('[data-ai-harmony]');
  if (harmony) return runHarmony(harmony.dataset.aiHarmony, harmony);
  const refresh = event.target.closest('[data-ai-refresh]');
  if (refresh?.dataset.aiRefresh === 'voice') return refreshVoice();
  if (refresh?.dataset.aiRefresh === 'harmony') return refreshHarmony();
  const importButton = event.target.closest('[data-ai-import-kind][data-ai-import-index]');
  if (importButton) return importRemoteAsset(importButton.dataset.aiImportKind, Number(importButton.dataset.aiImportIndex));
}

async function runComposer({ command, task, form }) {
  const status = document.querySelector('#pv-ai-compose-status');
  const button = form.querySelector('button[type="submit"]');
  const lyrics = String(document.querySelector('#lyrics')?.value || '');
  if (!task && command !== 'rewrite') {
    setText(status, 'Diga o que você quer criar.');
    return;
  }
  if (command === 'rewrite' && !lyrics.trim()) {
    setText(status, 'Escreva ou gere uma letra antes de pedir reescrita.');
    return;
  }
  setBusy(button, true, 'Criando…');
  setText(status, 'Ligando o projeto ao Pablo Composer…');
  try {
    const { local, remoteId } = await remoteProject();
    const health = await auth.agentHealth();
    if (!health?.available) throw new Error('A IA generativa remota ainda não tem provider ativo.');
    const result = await auth.agentTurn({
      command,
      project_id: remoteId,
      task: task || 'Reescreva a letra preservando intenção, oralidade, perspectiva e identidade autoral; altere apenas o necessário.',
      context_pack: {
        source: 'pablovoice-unified-composer',
        local_project_id: local.id,
        project_title: local.name,
        preset: local.preset,
        lyrics,
        notes: String(local.notes || '').slice(0, 4000),
      },
      author_samples: lyrics.trim() ? [lyrics.slice(0, 10000)] : [],
      constraints: { language: 'pt-BR', preserve_authorial_voice: true, no_artist_imitation: true },
      best_of_n: 1,
    });
    if (!result?.ok || !String(result.reply || result.text || '').trim()) throw new Error(humanError(result?.error || 'remote_empty_response', result));
    state.generated = String(result.reply || result.text).trim();
    state.generationMeta = { command, provider: result.provider || health.provider, model: result.model || health.model };
    const output = document.querySelector('#pv-ai-compose-result');
    setText(output, state.generated);
    document.querySelectorAll('[data-ai-apply]').forEach((node) => { node.disabled = false; });
    setText(status, `Pronto · ${state.generationMeta.provider || 'provider'}${state.generationMeta.model ? ` · ${state.generationMeta.model}` : ''}. Revise antes de aplicar.`);
  } catch (error) {
    setText(status, error?.message || 'Não consegui gerar agora. Sua letra local foi preservada.');
  } finally {
    setBusy(button, false, 'Criar');
  }
}

function applyGenerated(mode) {
  if (!state.generated) return;
  const lyrics = document.querySelector('#lyrics');
  if (!lyrics) return;
  const current = String(lyrics.value || '').trimEnd();
  lyrics.value = mode === 'append' && current ? `${current}\n\n${state.generated}` : state.generated;
  lyrics.dispatchEvent(new Event('input', { bubbles: true }));
  setTimeout(() => setText(document.querySelector('#pv-ai-compose-status'), mode === 'append' ? 'Trecho adicionado e salvo no projeto.' : 'Letra aplicada e salva no projeto.'), 0);
}

async function runVoice(profile, button) {
  setBusy(button, true, 'Enviando…');
  setText(document.querySelector('#pv-ai-voice-status'), `Preparando variante ${profile}…`);
  try {
    const { remoteId, token } = await remoteProject();
    const result = await api(VOICE_ENDPOINT, token, { action: 'dispatch', project_id: remoteId, profile });
    state.voice.job = { id: result.job_id, status: result.status, profile };
    state.voice.message = result.deduplicated ? 'Uma conversão vocal já está em andamento.' : `Variante ${profile} enviada para GPU.`;
    setText(document.querySelector('#pv-ai-voice-status'), state.voice.message);
    startPolling('voice');
  } catch (error) {
    state.voice.message = error?.message || 'Falha ao iniciar conversão vocal.';
    setText(document.querySelector('#pv-ai-voice-status'), state.voice.message);
  } finally {
    setBusy(button, false, profileLabel(profile));
  }
}

async function refreshVoice({ sync = true } = {}) {
  try {
    const { remoteId, token } = await remoteProject();
    const data = await api(VOICE_ENDPOINT, token, { action: sync ? 'sync' : 'status', project_id: remoteId });
    state.voice.variants = Array.isArray(data.variants) ? data.variants : [];
    state.voice.job = data.job || data.active_job || null;
    if (data.status === 'error') state.voice.message = humanError(data.error || 'Falha na conversão vocal.', data);
    else if (data.active || state.voice.job) state.voice.message = state.voice.job?.human_message || `Conversão vocal · ${state.voice.job?.progress ?? 0}%`;
    else if (state.voice.variants.length) state.voice.message = `${state.voice.variants.length} variante(s) disponível(is).`;
    else state.voice.message = 'Nenhuma variante vocal remota pronta ainda.';
    setText(document.querySelector('#pv-ai-voice-status'), state.voice.message);
    renderVoiceList();
    if (!data.active && state.voice.variants.length) stopPolling('voice');
    return data;
  } catch (error) {
    state.voice.message = error?.message || 'Não consegui consultar as variantes.';
    setText(document.querySelector('#pv-ai-voice-status'), state.voice.message);
    return null;
  }
}

async function runHarmony(voice, button) {
  setBusy(button, true, 'Enviando…');
  setText(document.querySelector('#pv-ai-harmony-status'), `Preparando harmonia ${voice === 'high' ? 'alta' : 'baixa'}…`);
  try {
    const { remoteId, token } = await remoteProject();
    const result = await api(HARMONY_ENDPOINT, token, { action: 'dispatch', project_id: remoteId, mode: 'adaptive_partial', voice });
    state.harmony.job = { id: result.job_id, status: result.status, voice };
    state.harmony.message = result.deduplicated ? 'Uma harmonia já está em andamento.' : `Harmonia ${voice === 'high' ? 'alta' : 'baixa'} enviada para GPU.`;
    setText(document.querySelector('#pv-ai-harmony-status'), state.harmony.message);
    startPolling('harmony');
  } catch (error) {
    state.harmony.message = error?.message || 'Falha ao iniciar harmonia.';
    setText(document.querySelector('#pv-ai-harmony-status'), state.harmony.message);
  } finally {
    setBusy(button, false, voice === 'high' ? 'Harmonia alta' : 'Harmonia baixa');
  }
}

async function refreshHarmony({ sync = true } = {}) {
  try {
    const { remoteId, token } = await remoteProject();
    const data = await api(HARMONY_ENDPOINT, token, { action: sync ? 'sync' : 'status', project_id: remoteId });
    state.harmony.harmonies = Array.isArray(data.harmonies) ? data.harmonies : [];
    state.harmony.job = data.job || data.active_job || null;
    state.harmony.capability = data.capability || null;
    if (data.active || state.harmony.job) state.harmony.message = state.harmony.job?.human_message || `Harmonia · ${state.harmony.job?.progress ?? 0}%`;
    else if (state.harmony.harmonies.length) state.harmony.message = `${state.harmony.harmonies.length} harmonia(s) disponível(is).`;
    else state.harmony.message = 'Nenhuma harmonia remota pronta ainda.';
    setText(document.querySelector('#pv-ai-harmony-status'), state.harmony.message);
    renderHarmonyList();
    if (!data.active && state.harmony.harmonies.length) stopPolling('harmony');
    return data;
  } catch (error) {
    state.harmony.message = error?.message || 'Não consegui consultar as harmonias.';
    setText(document.querySelector('#pv-ai-harmony-status'), state.harmony.message);
    return null;
  }
}

function startPolling(kind) {
  stopPolling(kind);
  let attempts = 0;
  const tick = async () => {
    attempts += 1;
    const result = kind === 'voice' ? await refreshVoice({ sync: true }) : await refreshHarmony({ sync: true });
    if (attempts >= 90 || (result && result.active === false)) stopPolling(kind);
  };
  const timer = setInterval(tick, 10000);
  state.pollers.set(kind, timer);
}

function stopPolling(kind) {
  const timer = state.pollers.get(kind);
  if (timer) clearInterval(timer);
  state.pollers.delete(kind);
}

function renderVoiceList() {
  const list = document.querySelector('#pv-ai-voice-list');
  if (!list) return;
  list.replaceChildren(...state.voice.variants.slice(0, 6).map((item, index) => remoteRow(item, 'voice', index)));
  if (!state.voice.variants.length) list.textContent = 'As variantes prontas aparecem aqui.';
}

function renderHarmonyList() {
  const list = document.querySelector('#pv-ai-harmony-list');
  if (!list) return;
  list.replaceChildren(...state.harmony.harmonies.slice(0, 6).map((item, index) => remoteRow(item, 'harmony', index)));
  if (!state.harmony.harmonies.length) list.textContent = 'As harmonias prontas aparecem aqui.';
}

function remoteRow(item, kind, index) {
  const row = document.createElement('div');
  row.className = 'pv-row';
  const meta = document.createElement('span');
  const label = item?.metadata?.profile || item?.metadata?.voice || kind;
  meta.innerHTML = `<b>${escapeHtml(item.original_name || `Pablo Voice · ${label}`)}</b><span>${escapeHtml(label)} · ${Number(item.duration_seconds || 0).toFixed(1)} s</span>`;
  const preview = document.createElement('button');
  preview.className = 'pv-btn';
  preview.type = 'button';
  preview.textContent = 'Ouvir';
  preview.addEventListener('click', () => previewRemote(item));
  const add = document.createElement('button');
  add.className = 'pv-btn primary';
  add.type = 'button';
  add.dataset.aiImportKind = kind;
  add.dataset.aiImportIndex = String(index);
  add.textContent = 'Adicionar ao projeto';
  row.append(meta, preview, add);
  return row;
}

async function previewRemote(item) {
  if (!item?.url) return;
  try {
    const response = await fetch(item.url);
    if (!response.ok) throw new Error(`preview_${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
    audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
    await audio.play();
  } catch {
    setText(document.querySelector(item?.metadata?.voice ? '#pv-ai-harmony-status' : '#pv-ai-voice-status'), 'Não consegui abrir a prévia agora. Atualize a lista para renovar o link.');
  }
}

async function importRemoteAsset(kind, index) {
  const collection = kind === 'voice' ? state.voice.variants : state.harmony.harmonies;
  const item = collection[index];
  const statusSelector = kind === 'voice' ? '#pv-ai-voice-status' : '#pv-ai-harmony-status';
  if (!item?.url) return setText(document.querySelector(statusSelector), 'Atualize a lista antes de importar.');
  try {
    const current = await activeProject();
    if (!current) throw new Error('Abra um projeto antes de importar.');
    const project = await getProject(current.id);
    if (!project) throw new Error('Projeto local não encontrado.');
    const response = await fetch(item.url);
    if (!response.ok) throw new Error(`Falha ao baixar resultado (${response.status}).`);
    const blob = await response.blob();
    const assetId = createId('audio');
    const track = createTrack({
      name: item.original_name || (kind === 'voice' ? 'Pablo Voice · variante' : 'Pablo Voice · harmonia'),
      assetId,
      type: blob.type || 'audio/flac',
      duration: Number(item.duration_seconds || 0),
      sampleRate: Number(item.sample_rate || 48000),
      channels: Number(item.channels || 1),
      kind: kind === 'voice' ? 'voice_variant' : 'harmony',
    });
    track.remoteEvidence = {
      remoteAssetId: item.id || null,
      sha256: item.sha256 || null,
      metadata: item.metadata || {},
    };
    await saveAudioAsset({ id: assetId, blob, name: track.name, type: blob.type || 'audio/flac' });
    project.tracks.push(track);
    project.activeTrackId = track.id;
    project.updatedAt = Date.now();
    await saveProject(project);
    setText(document.querySelector(statusSelector), `${track.name} foi adicionada ao projeto local. Abra/reabra o Studio para editar e mixar.`);
  } catch (error) {
    setText(document.querySelector(statusSelector), error?.message || 'Falha ao importar o resultado para o projeto.');
  }
}

function setBusy(button, busy, text) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = text;
}

function setText(node, text) {
  if (node) node.textContent = String(text || '');
}

function profileLabel(profile) {
  return profile === 'identity' ? 'Identity' : profile === 'smooth' ? 'Smooth' : 'Natural';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}

export const ADVANCED_AI_STUDIO = Object.freeze({
  songwriting: ['generate', 'continue_section', 'rewrite', 'adapt_genre'],
  voiceProfiles: ['natural', 'identity', 'smooth'],
  harmonyVoices: ['high', 'low'],
  voiceEndpoint: VOICE_ENDPOINT,
  harmonyEndpoint: HARMONY_ENDPOINT,
  automaticPromotion: false,
});
