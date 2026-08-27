import { activeProjectSessionId, getAudioAsset, getProject, listProjects, saveProject } from './storage.mjs';
import { analyzeDecodedAudio } from './audio-analysis-runtime.mjs';
import { buildAudioToInstrumentPlan } from './audio/src/sampler/audio-to-instrument.mjs';
import { classifySamplerPads, padCategoryLabel } from './pad-acoustics.mjs';
import {
  createSamplerState,
  normalizeSamplerState,
  samplerPadDuration,
  selectSamplerPad,
  updateSamplerPad,
} from './sampler-engine.mjs';

let mounted = false;
let busy = false;
let activeProject = null;
let samplerState = null;
let audioContext = null;
const decodedAssets = new Map();

export function installSampler() {
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
  if (document.querySelector('link[data-sampler-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './sampler.css';
  link.dataset.samplerStyle = 'true';
  document.head.appendChild(link);
}

function mountEntryPoint() {
  const actions = document.querySelector('.pv-studio-actions');
  if (!actions || actions.querySelector('[data-sampler-open]')) return;
  const button = document.createElement('button');
  button.className = 'pv-btn';
  button.dataset.samplerOpen = 'true';
  button.textContent = '▦ Sampler';
  actions.insertBefore(button, actions.lastElementChild || null);
}

async function onClick(event) {
  const open = event.target.closest('[data-sampler-open]');
  if (open) {
    await openSampler(open);
    return;
  }
  if (event.target.closest('[data-sampler-close]')) {
    document.querySelector('[data-sampler-panel]')?.remove();
    return;
  }
  const reslice = event.target.closest('[data-sampler-reslice]');
  if (reslice && !busy) {
    await rebuildFromActiveTrack(reslice);
    return;
  }
  const padButton = event.target.closest('[data-sampler-pad]');
  if (padButton && samplerState) {
    samplerState = selectSamplerPad(samplerState, padButton.dataset.samplerPad);
    renderSampler();
    const pad = samplerState.pads.find((item) => item.id === samplerState.selectedPadId);
    if (pad) await auditionPad(pad);
  }
}

async function onChange(event) {
  const input = event.target.closest('[data-sampler-field]');
  if (!input || !samplerState?.selectedPadId || !activeProject) return;
  const field = input.dataset.samplerField;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  const pad = samplerState.pads.find((item) => item.id === samplerState.selectedPadId);
  if (!pad) return;
  const patch = { [field]: value };
  if (field === 'start' && value >= pad.end) patch.start = Math.max(0, pad.end - 0.01);
  if (field === 'end' && value <= pad.start) patch.end = pad.start + 0.01;
  samplerState = updateSamplerPad(samplerState, pad.id, patch);
  if (field === 'start' || field === 'end') await classifyCurrentPads();
  activeProject.sampler = samplerState;
  activeProject.updatedAt = Date.now();
  await saveProject(activeProject);
  renderSampler();
}

async function openSampler(button) {
  if (busy) return;
  busy = true;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Abrindo…';
  try {
    activeProject = await currentProject();
    if (!activeProject) throw new Error('Crie ou abra um projeto antes de usar o Sampler.');
    samplerState = activeProject.sampler ? normalizeSamplerState(activeProject.sampler) : null;
    if (!samplerState?.pads?.length) await rebuildSamplerState();
    else if (samplerState.pads.some((pad) => !pad.categorySource)) {
      await classifyCurrentPads();
      activeProject.sampler = samplerState;
      activeProject.updatedAt = Date.now();
      await saveProject(activeProject);
    }
    ensurePanel();
    renderSampler();
  } catch (error) {
    console.error('SAMPLER_OPEN_FAILED', error);
    toast(error?.message || 'Não consegui abrir o Sampler.', 'error');
  } finally {
    busy = false;
    button.disabled = false;
    button.textContent = original;
  }
}

async function rebuildFromActiveTrack(button) {
  busy = true;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Recortando…';
  try {
    activeProject = await currentProject();
    if (!activeProject) throw new Error('Abra um projeto primeiro.');
    await rebuildSamplerState();
    renderSampler();
    const recognized = samplerState.pads.filter((pad) => pad.category !== 'unknown' && pad.categoryConfidence >= 0.45).length;
    toast(`${samplerState.pads.length} pad(s) preparados · ${recognized} com função provável.`, 'ok');
  } catch (error) {
    console.error('SAMPLER_RESLICE_FAILED', error);
    toast(error?.message || 'Não consegui recortar essa faixa.', 'error');
  } finally {
    busy = false;
    button.disabled = false;
    button.textContent = original;
  }
}

async function rebuildSamplerState() {
  const track = activeProject.tracks?.find((item) => item.id === activeProject.activeTrackId) || activeProject.tracks?.[0];
  if (!track?.assetId) throw new Error('Escolha uma faixa de áudio primeiro.');
  const buffer = await decodedAudio(track.assetId);
  const analysis = analyzeDecodedAudio(buffer, { assetId: track.assetId });
  const plan = buildAudioToInstrumentPlan(analysis, { minConfidence: 0.45, minSliceSeconds: 0.04 });
  samplerState = createSamplerState(plan, { maxPads: 16 });
  if (!samplerState.pads.length) {
    throw new Error('Não encontrei cortes confiáveis nessa faixa. Tente um áudio com ataques mais definidos.');
  }
  samplerState = classifySamplerPads(samplerState, buffer.getChannelData(0), buffer.sampleRate);
  activeProject.sampler = samplerState;
  activeProject.updatedAt = Date.now();
  await saveProject(activeProject);
}

async function classifyCurrentPads() {
  const assetId = samplerState?.sourceAssetId || samplerState?.pads?.find((pad) => pad.sourceAssetId)?.sourceAssetId;
  if (!assetId || !samplerState?.pads?.length) return;
  const buffer = await decodedAudio(assetId);
  samplerState = normalizeSamplerState(classifySamplerPads(samplerState, buffer.getChannelData(0), buffer.sampleRate));
}

function ensurePanel() {
  if (document.querySelector('[data-sampler-panel]')) return;
  const panel = document.createElement('section');
  panel.className = 'pv-sampler-panel';
  panel.dataset.samplerPanel = 'true';
  panel.innerHTML = `
    <div class="pv-sampler-card" role="dialog" aria-modal="true" aria-label="Sampler">
      <header class="pv-sampler-head">
        <div><strong>Sampler</strong><small data-sampler-summary></small></div>
        <button class="pv-btn" type="button" data-sampler-close>Fechar</button>
      </header>
      <div class="pv-sampler-tools">
        <button class="pv-btn" type="button" data-sampler-reslice>↻ Recortar faixa ativa</button>
        <span>Toque nos pads para ouvir cada corte. As funções são sugestões acústicas, não rótulos obrigatórios.</span>
      </div>
      <div class="pv-sampler-grid" data-sampler-grid></div>
      <div class="pv-sampler-edit" data-sampler-edit></div>
    </div>`;
  document.body.appendChild(panel);
}

function renderSampler() {
  ensurePanel();
  const state = normalizeSamplerState(samplerState || {});
  samplerState = state;
  const recognized = state.pads.filter((pad) => pad.category !== 'unknown' && pad.categoryConfidence >= 0.45).length;
  const groove = state.grooveTemplate?.ready ? ` · groove ${Math.round(state.grooveTemplate.confidence * 100)}%` : '';
  const summary = document.querySelector('[data-sampler-summary]');
  if (summary) summary.textContent = `${state.pads.length} pads · ${recognized} funções prováveis${groove}`;
  const grid = document.querySelector('[data-sampler-grid]');
  if (grid) {
    grid.replaceChildren();
    state.pads.forEach((pad, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pv-sampler-pad';
      if (pad.id === state.selectedPadId) button.classList.add('active');
      button.dataset.samplerPad = pad.id;
      button.setAttribute('aria-pressed', pad.id === state.selectedPadId ? 'true' : 'false');
      const name = document.createElement('b');
      name.textContent = pad.label;
      const info = document.createElement('small');
      const category = pad.category !== 'unknown' ? `${padCategoryLabel(pad.category)} ${Math.round(pad.categoryConfidence * 100)}% · ` : '';
      info.textContent = `${category}${index + 1} · ${samplerPadDuration(pad).toFixed(2)}s`;
      button.append(name, info);
      grid.appendChild(button);
    });
  }
  renderEditor(state);
}

function renderEditor(state) {
  const edit = document.querySelector('[data-sampler-edit]');
  if (!edit) return;
  edit.replaceChildren();
  const pad = state.pads.find((item) => item.id === state.selectedPadId);
  if (!pad) {
    edit.textContent = 'Nenhum pad selecionado.';
    return;
  }
  const title = document.createElement('div');
  title.className = 'pv-sampler-edit-title';
  const category = pad.category === 'unknown'
    ? 'função acústica incerta'
    : `provável ${padCategoryLabel(pad.category)} · confiança ${Math.round(pad.categoryConfidence * 100)}%`;
  title.textContent = `${pad.label} · ${category} · ajuste sem alterar o áudio original`;
  edit.appendChild(title);
  const fields = [
    ['start', 'Começo', pad.start, 0, Math.max(pad.end - 0.01, 0), 0.01],
    ['end', 'Fim', pad.end, pad.start + 0.01, pad.end + Math.max(1, samplerPadDuration(pad)), 0.01],
    ['gain', 'Volume', pad.gain, 0, 2, 0.05],
    ['fadeIn', 'Entrada suave', pad.fadeIn, 0, Math.max(0.01, samplerPadDuration(pad) / 2), 0.005],
    ['fadeOut', 'Saída suave', pad.fadeOut, 0, Math.max(0.01, samplerPadDuration(pad) / 2), 0.005],
  ];
  const wrap = document.createElement('div');
  wrap.className = 'pv-sampler-fields';
  for (const [field, label, value, min, max, step] of fields) {
    const row = document.createElement('label');
    row.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.dataset.samplerField = field;
    input.value = Number(value).toFixed(field === 'gain' ? 2 : 3);
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    row.appendChild(input);
    wrap.appendChild(row);
  }
  edit.appendChild(wrap);
}

async function auditionPad(pad) {
  const assetId = pad.sourceAssetId || samplerState?.sourceAssetId;
  if (!assetId) return;
  const buffer = await decodedAudio(assetId);
  const context = ensureAudioContext();
  await context.resume?.();
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  source.playbackRate.value = pad.playbackRate || 1;
  source.connect(gain).connect(context.destination);
  const duration = Math.max(0.01, Math.min(buffer.duration - pad.start, pad.end - pad.start));
  const now = context.currentTime;
  const level = Math.max(0.0001, pad.gain || 0.0001);
  const fadeIn = Math.min(pad.fadeIn || 0, duration / 2);
  const fadeOut = Math.min(pad.fadeOut || 0, duration / 2);
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(fadeIn > 0 ? 0.0001 : level, now);
  if (fadeIn > 0) gain.gain.linearRampToValueAtTime(level, now + fadeIn);
  if (fadeOut > 0) {
    gain.gain.setValueAtTime(level, Math.max(now + fadeIn, now + duration - fadeOut));
    gain.gain.linearRampToValueAtTime(0.0001, now + duration);
  }
  source.start(0, Math.max(0, pad.start), duration);
}

async function decodedAudio(assetId) {
  if (decodedAssets.has(assetId)) return decodedAssets.get(assetId);
  const asset = await getAudioAsset(assetId);
  if (!asset?.blob) throw new Error('O áudio desse pad não está disponível no aparelho.');
  const bytes = await asset.blob.arrayBuffer();
  const buffer = await ensureAudioContext().decodeAudioData(bytes.slice(0));
  decodedAssets.set(assetId, buffer);
  return buffer;
}

function ensureAudioContext() {
  if (audioContext && audioContext.state !== 'closed') return audioContext;
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) throw new Error('A reprodução de samples não está disponível neste aparelho.');
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
