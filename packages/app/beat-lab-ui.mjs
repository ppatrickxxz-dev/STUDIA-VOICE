import { createId, createTrack, snapshotProject } from './core/src/project.mjs';
import { activeProjectSessionId, getAudioAsset, getProject, listProjects, saveAudioAsset, saveProject } from './storage.mjs';
import { encodePcmWav } from './instrument-engine.mjs';
import { normalizeSamplerState, samplerPadDuration } from './sampler-engine.mjs';
import {
  activeBeatStepCount,
  beatPatternDurationSeconds,
  clearBeatPattern,
  createBeatLabState,
  duplicateBeatPattern,
  generateBeatFill,
  normalizeBeatLabState,
  refreshBeatLanesFromSampler,
  sequenceBeatEvents,
  setBeatBpm,
  setBeatGrooveAmount,
  setBeatHumanize,
  setBeatStepCount,
  setBeatStepVelocity,
  setBeatSwing,
  toggleBeatStep,
} from './beat-lab-engine.mjs';

let mounted = false;
let activeProject = null;
let samplerState = null;
let beatState = null;
let selectedCell = null;
let audioContext = null;
const decodedAssets = new Map();
const activeSources = new Set();

export function installBeatLab() {
  if (mounted) return;
  mounted = true;
  ensureStylesheet();
  const observer = new MutationObserver(mountEntryPoint);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  mountEntryPoint();
}

function ensureStylesheet() {
  if (document.querySelector('link[data-beat-lab-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './beat-lab.css';
  link.dataset.beatLabStyle = 'true';
  document.head.appendChild(link);
}

function mountEntryPoint() {
  const actions = document.querySelector('.pv-studio-actions');
  if (!actions || actions.querySelector('[data-beat-lab-open]')) return;
  const button = document.createElement('button');
  button.className = 'pv-btn';
  button.dataset.beatLabOpen = 'true';
  button.textContent = '▦ Beat Lab';
  actions.insertBefore(button, actions.lastElementChild || null);
}

async function onClick(event) {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.beatLabOpen) { await showBeatLab(); return; }
  if (button.dataset.beatLabClose) { hideBeatLab(); return; }
  if (!document.querySelector('[data-beat-lab-modal]') || !beatState) return;
  if (button.dataset.beatLane && button.dataset.beatStep != null) {
    selectedCell = { laneId: button.dataset.beatLane, stepIndex: Number(button.dataset.beatStep) };
    beatState = toggleBeatStep(beatState, selectedCell.laneId, selectedCell.stepIndex);
    await persistBeatState();
    renderBeatLab();
    return;
  }
  if (button.dataset.beatPlay) { await previewBeat(); return; }
  if (button.dataset.beatStop) { stopPreview(); return; }
  if (button.dataset.beatOrganize) {
    stopPreview();
    beatState = refreshBeatLanesFromSampler(beatState, samplerState);
    selectedCell = null;
    await persistBeatState();
    renderBeatLab();
    toast('Lanes reorganizadas pelas funções acústicas prováveis, preservando passos dos mesmos pads.', 'ok');
    return;
  }
  if (button.dataset.beatFill) {
    const before = activeBeatStepCount(beatState);
    beatState = generateBeatFill(beatState, { intensity: 0.65 });
    await persistBeatState();
    renderBeatLab();
    const after = activeBeatStepCount(beatState);
    if (beatState.lastOperation?.ok && after >= before) toast('Virada criada no fim do padrão.', 'ok');
    else toast('Ainda não há uma lane percussiva confiável para criar a virada automaticamente.', 'error');
    return;
  }
  if (button.dataset.beatClear) {
    stopPreview();
    beatState = clearBeatPattern(beatState);
    selectedCell = null;
    await persistBeatState();
    renderBeatLab();
    return;
  }
  if (button.dataset.beatDuplicate) {
    beatState = duplicateBeatPattern(beatState);
    await persistBeatState();
    renderBeatLab();
    return;
  }
  if (button.dataset.beatSave) {
    await persistBeatState();
    toast('Beat salvo no projeto.', 'ok');
    return;
  }
  if (button.dataset.beatRender) { await renderBeatToProject(button); }
}

async function onChange(event) {
  if (!beatState || !document.querySelector('[data-beat-lab-modal]')) return;
  const target = event.target;
  if (target.matches('[data-beat-bpm]')) beatState = setBeatBpm(beatState, target.value);
  else if (target.matches('[data-beat-swing]')) beatState = setBeatSwing(beatState, Number(target.value) / 100);
  else if (target.matches('[data-beat-groove]')) beatState = setBeatGrooveAmount(beatState, Number(target.value) / 100);
  else if (target.matches('[data-beat-humanize]')) beatState = setBeatHumanize(beatState, Number(target.value) / 100);
  else if (target.matches('[data-beat-length]')) beatState = setBeatStepCount(beatState, target.value);
  else if (target.matches('[data-beat-velocity]') && selectedCell) beatState = setBeatStepVelocity(beatState, selectedCell.laneId, selectedCell.stepIndex, target.value);
  else return;
  await persistBeatState();
  renderBeatLab();
}

async function showBeatLab() {
  try {
    activeProject = await currentProject();
    if (!activeProject) throw new Error('Crie ou abra um projeto antes de usar o Beat Lab.');
    samplerState = normalizeSamplerState(activeProject.sampler || {});
    if (!samplerState.pads.length) throw new Error('Crie pads no Sampler primeiro. O Beat Lab usa os samples do seu projeto.');
    const preferredBpm = activeProject.instrumentLab?.bpm || samplerState.grooveTemplate?.bpm || 120;
    beatState = activeProject.beatLab
      ? normalizeBeatLabState(activeProject.beatLab, samplerState)
      : createBeatLabState(samplerState, { bpm: preferredBpm });
    activeProject.beatLab = beatState;
    await saveProject(activeProject);
    selectedCell = null;
    renderBeatLab();
  } catch (error) {
    console.error('BEAT_LAB_OPEN_FAILED', error);
    toast(error?.message || 'Não consegui abrir o Beat Lab.', 'error');
  }
}

function hideBeatLab() {
  stopPreview();
  selectedCell = null;
  document.querySelector('[data-beat-lab-modal]')?.remove();
}

function renderBeatLab() {
  document.querySelector('[data-beat-lab-modal]')?.remove();
  if (!beatState || !samplerState) return;
  const state = normalizeBeatLabState(beatState, samplerState);
  beatState = state;
  const activeSteps = activeBeatStepCount(state);
  const grooveReady = Boolean(state.grooveTemplate?.ready);
  const grooveConfidence = Math.round(Number(state.grooveTemplate?.confidence || 0) * 100);
  const overlay = document.createElement('div');
  overlay.className = 'pv-beat-overlay';
  overlay.dataset.beatLabModal = 'true';
  overlay.innerHTML = `<section class="pv-beat-modal" role="dialog" aria-modal="true" aria-label="Beat Lab">
    <header class="pv-beat-head">
      <div><small>BEAT LAB · SAMPLES DO PROJETO</small><h2>Monte a batida em passos</h2><p>As lanes usam os pads reais do Sampler. Funções acústicas e groove são sugestões reversíveis.</p></div>
      <button class="pv-btn" type="button" data-beat-lab-close>Fechar</button>
    </header>
    <div class="pv-beat-controls">
      <label>BPM <input type="number" min="40" max="240" value="${state.bpm}" data-beat-bpm></label>
      <label>Swing <input type="range" min="0" max="100" step="1" value="${Math.round(state.swing * 100)}" data-beat-swing><b>${Math.round(state.swing * 100)}%</b></label>
      <label>Groove do áudio <input type="range" min="0" max="100" step="1" value="${Math.round(state.grooveAmount * 100)}" data-beat-groove ${grooveReady ? '' : 'disabled'}><b>${grooveReady ? `${Math.round(state.grooveAmount * 100)}% · conf. ${grooveConfidence}%` : 'sem evidência suficiente'}</b></label>
      <label>Humanizar <input type="range" min="0" max="100" step="1" value="${Math.round(state.humanize * 100)}" data-beat-humanize><b>${Math.round(state.humanize * 100)}%</b></label>
      <label>Tamanho <select data-beat-length>${[8,16,32].map((count) => `<option value="${count}" ${count === state.stepCount ? 'selected' : ''}>${count} passos</option>`).join('')}</select></label>
      <span class="pv-beat-status">${activeSteps} passo(s) ativo(s) · ${beatPatternDurationSeconds(state).toFixed(2)}s</span>
    </div>
    <div class="pv-beat-grid-wrap"><div class="pv-beat-grid">${renderRows(state)}</div></div>
    ${renderSelectedEditor(state)}
    <div class="pv-beat-actions">
      <button class="pv-btn" type="button" data-beat-play ${activeSteps ? '' : 'disabled'}>▶ Ouvir</button>
      <button class="pv-btn" type="button" data-beat-stop>■ Parar</button>
      <button class="pv-btn" type="button" data-beat-organize>Organizar sons</button>
      <button class="pv-btn" type="button" data-beat-fill>＋ Virada</button>
      <button class="pv-btn" type="button" data-beat-duplicate ${state.stepCount >= 32 ? 'disabled' : ''}>⧉ Duplicar padrão</button>
      <button class="pv-btn" type="button" data-beat-clear ${activeSteps ? '' : 'disabled'}>Limpar</button>
    </div>
    <footer class="pv-beat-footer">
      <span class="pv-beat-status">Pads: ${state.lanes.length} · velocity · swing · groove/humanização não destrutivos</span>
      <div><button class="pv-btn" type="button" data-beat-save>Salvar padrão</button> <button class="pv-btn primary" type="button" data-beat-render ${activeSteps ? '' : 'disabled'}>Criar faixa no Studio</button></div>
    </footer>
  </section>`;
  document.body.appendChild(overlay);
}
function renderRows(state) {
  return state.lanes.map((lane) => {
    const steps = lane.steps.map((step, index) => {
      const classes = ['pv-beat-step'];
      if (step.active) classes.push('active');
      if (index % 4 === 0) classes.push('beat-mark');
      if (selectedCell?.laneId === lane.id && selectedCell?.stepIndex === index) classes.push('selected');
      return `<button type="button" class="${classes.join(' ')}" data-beat-lane="${escapeHtml(lane.id)}" data-beat-step="${index}" aria-pressed="${step.active ? 'true' : 'false'}" aria-label="${escapeHtml(lane.label)} passo ${index + 1}">${index + 1}</button>`;
    }).join('');
    const confidence = lane.category === 'unknown' ? '' : ` · ${Math.round(lane.categoryConfidence * 100)}%`;
    return `<div class="pv-beat-row steps-${state.stepCount}"><b class="pv-beat-lane" title="${escapeHtml(lane.label)}${confidence}">${escapeHtml(lane.label)}${confidence}</b>${steps}</div>`;
  }).join('');
}

function renderSelectedEditor(state) {
  if (!selectedCell) return '<div class="pv-beat-editor">Toque em um passo para ativar e ajustar a força.</div>';
  const lane = state.lanes.find((item) => item.id === selectedCell.laneId);
  const step = lane?.steps?.[selectedCell.stepIndex];
  if (!lane || !step) return '<div class="pv-beat-editor">Selecione um passo.</div>';
  return `<div class="pv-beat-editor"><b>${escapeHtml(lane.label)} · passo ${selectedCell.stepIndex + 1}</b><label>Força <input type="range" min="1" max="127" step="1" value="${step.velocity}" data-beat-velocity> <span>${step.velocity}/127</span></label><span>${step.active ? 'ativo' : 'desligado'}</span></div>`;
}

async function persistBeatState() {
  if (!activeProject || !beatState || !samplerState) return;
  beatState = normalizeBeatLabState(beatState, samplerState);
  activeProject.beatLab = beatState;
  activeProject.updatedAt = Date.now();
  await saveProject(activeProject);
}

async function previewBeat() {
  stopPreview();
  const events = sequenceBeatEvents(beatState);
  if (!events.length) { toast('Ative alguns passos antes de ouvir.', 'error'); return; }
  try {
    const context = ensureAudioContext();
    await context.resume?.();
    const padById = new Map(samplerState.pads.map((pad) => [pad.id, pad]));
    const usedPads = events.map((event) => padById.get(event.padId)).filter(Boolean);
    await Promise.all([...new Set(usedPads.map((pad) => pad.sourceAssetId).filter(Boolean))].map(decodedAudio));
    const startAt = context.currentTime + 0.05;
    for (const event of events) {
      const pad = padById.get(event.padId);
      if (!pad) continue;
      const buffer = decodedAssets.get(pad.sourceAssetId);
      if (!buffer) continue;
      const source = schedulePad(context, context.destination, buffer, pad, startAt + event.timeSeconds, event.velocity / 127);
      if (source) trackSource(source);
    }
    toast('Reproduzindo o padrão.', 'ok');
  } catch (error) {
    console.error('BEAT_LAB_PREVIEW_FAILED', error);
    toast(error?.message || 'Não consegui reproduzir a batida.', 'error');
  }
}

function stopPreview() {
  for (const source of activeSources) {
    try { source.stop(); } catch {}
  }
  activeSources.clear();
}

function trackSource(source) {
  activeSources.add(source);
  source.addEventListener?.('ended', () => activeSources.delete(source), { once: true });
  source.onended = () => activeSources.delete(source);
}

function schedulePad(context, destination, buffer, pad, startTime, velocityScale = 1) {
  const available = buffer.duration - Number(pad.start || 0);
  const sliceDuration = Math.min(available, Math.max(0, Number(pad.end || 0) - Number(pad.start || 0)));
  if (!Number.isFinite(sliceDuration) || sliceDuration <= 0.005) return null;
  const rate = Math.max(0.25, Math.min(4, Number(pad.playbackRate) || 1));
  const audibleDuration = sliceDuration / rate;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.connect(gain).connect(destination);
  const level = Math.max(0.0001, Math.min(2, Number(pad.gain) || 1) * Math.max(0.01, Math.min(1, velocityScale)));
  const fadeIn = Math.min(Number(pad.fadeIn) || 0, audibleDuration / 2);
  const fadeOut = Math.min(Number(pad.fadeOut) || 0, audibleDuration / 2);
  gain.gain.setValueAtTime(fadeIn > 0 ? 0.0001 : level, startTime);
  if (fadeIn > 0) gain.gain.linearRampToValueAtTime(level, startTime + fadeIn);
  if (fadeOut > 0) {
    gain.gain.setValueAtTime(level, Math.max(startTime + fadeIn, startTime + audibleDuration - fadeOut));
    gain.gain.linearRampToValueAtTime(0.0001, startTime + audibleDuration);
  }
  source.start(startTime, Math.max(0, Number(pad.start) || 0), sliceDuration);
  return source;
}

async function renderBeatToProject(button) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    const events = sequenceBeatEvents(beatState);
    if (!events.length) throw new Error('Ative alguns passos antes de criar a faixa.');
    const rendered = await renderBeatWav(events);
    const assetId = createId('asset');
    const name = `Beat Lab · ${beatState.stepCount} passos`;
    await saveAudioAsset({ id: assetId, blob: rendered.blob, name: `${name}.wav`, type: 'audio/wav' });
    const track = createTrack({ name, assetId, type: 'audio/wav', duration: rendered.duration, sampleRate: rendered.sampleRate, channels: rendered.channels.length, kind: 'beat' });
    track.trimEnd = rendered.duration;
    activeProject.tracks.push(track);
    activeProject.activeTrackId = track.id;
    activeProject.beatLab = normalizeBeatLabState(beatState, samplerState);
    const saved = await saveProject(snapshotProject(activeProject, 'Beat criado'));
    try { sessionStorage.setItem('pablovoice.activeProjectId', saved.id); } catch {}
    toast('Beat criado como faixa real no projeto.', 'ok');
    setTimeout(() => location.reload(), 350);
  } catch (error) {
    console.error('BEAT_LAB_RENDER_FAILED', error);
    toast(error?.message || 'Não consegui criar a faixa do Beat Lab.', 'error');
    button.disabled = false;
  }
}

async function renderBeatWav(events) {
  const OfflineCtx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OfflineCtx) throw new Error('A renderização do Beat Lab não está disponível neste aparelho.');
  const padById = new Map(samplerState.pads.map((pad) => [pad.id, pad]));
  const usedPads = events.map((event) => padById.get(event.padId)).filter(Boolean);
  await Promise.all([...new Set(usedPads.map((pad) => pad.sourceAssetId).filter(Boolean))].map(decodedAudio));
  let endSeconds = beatPatternDurationSeconds(beatState);
  for (const event of events) {
    const pad = padById.get(event.padId);
    const buffer = pad ? decodedAssets.get(pad.sourceAssetId) : null;
    if (!pad || !buffer) continue;
    const slice = Math.max(0, Math.min(buffer.duration - pad.start, samplerPadDuration(pad)));
    endSeconds = Math.max(endSeconds, event.timeSeconds + slice / Math.max(0.25, Number(pad.playbackRate) || 1));
  }
  const duration = Math.min(240, Math.max(0.25, endSeconds + 0.05));
  const sampleRate = 48000;
  const frameCount = Math.ceil(duration * sampleRate);
  const offline = new OfflineCtx(2, frameCount, sampleRate);
  const master = offline.createGain();
  master.gain.value = 0.82;
  master.connect(offline.destination);
  for (const event of events) {
    const pad = padById.get(event.padId);
    const buffer = pad ? decodedAssets.get(pad.sourceAssetId) : null;
    if (pad && buffer) schedulePad(offline, master, buffer, pad, event.timeSeconds, event.velocity / 127);
  }
  const renderedBuffer = await offline.startRendering();
  const rendered = {
    channels: Array.from({ length: renderedBuffer.numberOfChannels }, (_, channel) => renderedBuffer.getChannelData(channel)),
    sampleRate: renderedBuffer.sampleRate,
    frameCount: renderedBuffer.length,
    duration: renderedBuffer.duration,
  };
  return { ...rendered, blob: encodePcmWav(rendered) };
}

async function decodedAudio(assetId) {
  if (decodedAssets.has(assetId)) return decodedAssets.get(assetId);
  const asset = await getAudioAsset(assetId);
  if (!asset?.blob) throw new Error('Um sample usado no Beat Lab não está mais disponível no aparelho.');
  const bytes = await asset.blob.arrayBuffer();
  const buffer = await ensureAudioContext().decodeAudioData(bytes.slice(0));
  decodedAssets.set(assetId, buffer);
  return buffer;
}

function ensureAudioContext() {
  if (audioContext && audioContext.state !== 'closed') return audioContext;
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) throw new Error('Web Audio não está disponível neste aparelho.');
  audioContext = new AudioCtx();
  return audioContext;
}

async function currentProject() {
  const id = activeProjectSessionId();
  if (id) {
    const project = await getProject(id);
    if (project) return project;
  }
  return (await listProjects())[0] || null;
}

function toast(message, kind = '') {
  const wrap = document.querySelector('[data-toasts]');
  if (!wrap) return;
  const item = document.createElement('div');
  item.className = `pv-toast ${kind}`;
  item.textContent = message;
  wrap.appendChild(item);
  setTimeout(() => item.remove(), 3500);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[char]);
}