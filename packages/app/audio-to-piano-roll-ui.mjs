import { activeProjectSessionId, getProject, listProjects, saveProject } from './storage.mjs';
import { analyzeAudioTrack } from './audio-analysis-runtime.mjs';
import { buildAudioToInstrumentPlan } from './audio/src/sampler/audio-to-instrument.mjs';
import { normalizeInstrumentState } from './instrument-engine.mjs';
import { applyAudioPlanToInstrumentState, summarizeAudioPlan } from './audio-to-piano-roll-bridge.mjs';

let mounted = false;
let busy = false;

export function installAudioToPianoRoll() {
  if (mounted) return;
  mounted = true;
  const observer = new MutationObserver(mountEntryPoint);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', onClick);
  mountEntryPoint();
}

function mountEntryPoint() {
  const actions = document.querySelector('.pv-studio-actions');
  if (!actions || actions.querySelector('[data-audio-to-notes]')) return;
  const button = document.createElement('button');
  button.className = 'pv-btn';
  button.dataset.audioToNotes = 'true';
  button.textContent = '♪ Áudio → notas';
  actions.insertBefore(button, actions.lastElementChild || null);
}

async function onClick(event) {
  const button = event.target.closest('[data-audio-to-notes]');
  if (!button || busy) return;
  busy = true;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Analisando…';
  try {
    const project = await currentProject();
    if (!project) throw new Error('Crie ou abra um projeto antes de transformar áudio em notas.');
    const track = project.tracks?.find((item) => item.id === project.activeTrackId) || project.tracks?.[0];
    if (!track?.assetId) throw new Error('Escolha uma faixa de áudio primeiro.');
    const analysis = await analyzeAudioTrack(track);
    const plan = buildAudioToInstrumentPlan(analysis, { preserveFormants: true });
    const summary = summarizeAudioPlan(plan);
    if (!summary.notes) {
      throw new Error('Não encontrei notas confiáveis nessa faixa. Tente uma melodia mais limpa ou uma voz/instrumento isolado.');
    }
    const base = normalizeInstrumentState(project.instrumentLab || { bpm: analysis.music?.bpm || 120 });
    base.bpm = clamp(Math.round(Number(analysis.music?.bpm) || base.bpm || 120), 40, 240);
    project.instrumentLab = applyAudioPlanToInstrumentState(base, plan, { mode: 'replace' });
    project.updatedAt = Date.now();
    await saveProject(project);
    toast(`${summary.notes} nota(s) detectadas. Abrindo no Piano Roll.`, 'ok');
    setTimeout(() => document.querySelector('[data-piano-roll-open]')?.click(), 100);
  } catch (error) {
    console.error('AUDIO_TO_PIANO_ROLL_FAILED', error);
    toast(error?.message || 'Não consegui transformar esse áudio em notas.', 'error');
  } finally {
    busy = false;
    button.disabled = false;
    button.textContent = original;
  }
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
