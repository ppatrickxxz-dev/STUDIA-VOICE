import { PabloAudioEngine } from './audio-engine.mjs';
import { listProjects, getAudioAsset, saveProject as persistProject } from './storage.mjs';
import { snapshotProject } from './core/src/project.mjs';
import { BREATH_AUTOMATION_SOURCE } from './audio/src/voice/breath-intelligence.mjs';

const previewEngine = new PabloAudioEngine();
let previewTimer = 0;

export async function appendBreathReview(trackId) {
  const log = document.querySelector('[data-pablo-log]');
  if (!log) return;
  const project = await activeProject();
  const track = project?.tracks?.find((item) => item.id === trackId);
  if (!track) return;
  const regions = pabloRegions(track);
  if (!regions.length) return;

  const previous = log.querySelector('[data-breath-review]');
  previous?.remove();

  const panel = document.createElement('div');
  panel.dataset.breathReview = 'true';
  panel.className = 'pv-msg assistant pv-breath-review';
  const title = document.createElement('strong');
  title.textContent = `Revisar ${regions.length} respiração(ões)`;
  panel.appendChild(title);

  const help = document.createElement('small');
  help.textContent = 'A = original · B = suavizada. Você pode ignorar uma região ou desfazer todas.';
  panel.appendChild(help);

  for (const [index, region] of regions.entries()) {
    panel.appendChild(reviewRow(track, region, index));
  }

  const undo = button('Desfazer tudo', async () => {
    await mutateTrack(trackId, (target) => {
      target.regionAutomation = (target.regionAutomation || []).filter((event) => event?.source !== BREATH_AUTOMATION_SOURCE);
    }, 'Respirações do Pablo desfeitas');
    previewEngine.stop(false);
    panel.remove();
    appendStatus('Desfiz todas as automações de respiração criadas pelo Pablo.');
  });
  undo.classList.add('secondary');
  panel.appendChild(undo);
  log.appendChild(panel);
  panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function reviewRow(track, region, index) {
  const row = document.createElement('div');
  row.className = 'pv-breath-review-row';
  row.dataset.regionId = region.id;

  const label = document.createElement('small');
  label.textContent = `Respiração ${index + 1} · ${formatTime(region.startSeconds)}–${formatTime(region.endSeconds)} · ${Math.round(Number(region.confidence || 0) * 100)}%`;
  row.appendChild(label);

  const controls = document.createElement('div');
  controls.className = 'pv-compose-row';
  controls.append(
    button('Ouvir A', () => preview(track.id, region.id, 'original')),
    button('Ouvir B', () => preview(track.id, region.id, 'processed')),
    button('Manter', async () => {
      await setRegionEnabled(track.id, region.id, true);
      row.dataset.reviewState = 'kept';
      appendStatus(`Respiração ${index + 1}: suavização mantida.`);
    }),
    button('Ignorar', async () => {
      await setRegionEnabled(track.id, region.id, false);
      row.dataset.reviewState = 'ignored';
      appendStatus(`Respiração ${index + 1}: deixei o trecho original.`);
    }),
  );
  row.appendChild(controls);
  return row;
}

async function preview(trackId, regionId, mode) {
  clearTimeout(previewTimer);
  previewEngine.stop(false);
  const project = await activeProject();
  const track = project?.tracks?.find((item) => item.id === trackId);
  const region = track?.regionAutomation?.find((item) => item.id === regionId && item.source === BREATH_AUTOMATION_SOURCE);
  if (!track || !region) throw new Error('Trecho de respiração não está mais disponível.');

  if (!previewEngine.getBuffer(track.id)) {
    const asset = await getAudioAsset(track.assetId);
    if (!asset?.blob) throw new Error('Áudio da faixa não está disponível para prévia.');
    await previewEngine.decode(track.id, asset.blob);
  }

  const range = sourceRegionToTimeline(track, region);
  const isolated = { ...project, tracks: [track], activeTrackId: track.id };
  const start = Math.max(Number(track.offset || 0), range.start - 0.35);
  const end = Math.min(previewEngine.duration(isolated), range.end + 0.45);
  await previewEngine.play(isolated, { position: start, mode: mode === 'original' ? 'raw' : 'processed' });
  previewTimer = setTimeout(() => previewEngine.stop(false), Math.max(250, (end - start) * 1000));
}

export function sourceRegionToTimeline(track, region) {
  const rate = 2 ** (Number(track?.effects?.pitchSemitones || 0) / 12);
  const trimStart = Math.max(0, Number(track?.trimStart || 0));
  const offset = Math.max(0, Number(track?.offset || 0));
  const start = offset + Math.max(0, Number(region?.startSeconds || 0) - trimStart) / rate;
  const end = offset + Math.max(0, Number(region?.endSeconds || 0) - trimStart) / rate;
  return { start, end: Math.max(start, end) };
}

async function setRegionEnabled(trackId, regionId, enabled) {
  return mutateTrack(trackId, (track) => {
    track.regionAutomation = (track.regionAutomation || []).map((event) => event.id === regionId && event.source === BREATH_AUTOMATION_SOURCE
      ? { ...event, enabled: Boolean(enabled) }
      : event);
  }, enabled ? 'Respiração mantida' : 'Respiração ignorada');
}

async function mutateTrack(trackId, mutate, label) {
  const project = await activeProject();
  const track = project?.tracks?.find((item) => item.id === trackId);
  if (!project || !track) throw new Error('Projeto ou faixa não está mais disponível.');
  mutate(track);
  const saved = snapshotProject(project, label);
  await persistProject(saved);
  return saved;
}

async function activeProject() {
  const projects = await listProjects();
  return projects[0] || null;
}

function pabloRegions(track) {
  return (track?.regionAutomation || []).filter((event) => event?.source === BREATH_AUTOMATION_SOURCE);
}

function button(text, action) {
  const value = document.createElement('button');
  value.type = 'button';
  value.className = 'pv-btn';
  value.textContent = text;
  value.addEventListener('click', async () => {
    value.disabled = true;
    try { await action(); }
    catch (error) { appendStatus(error?.message || 'Não consegui executar essa ação.'); }
    finally { value.disabled = false; }
  });
  return value;
}

function appendStatus(text) {
  const log = document.querySelector('[data-pablo-log]');
  if (!log) return;
  const message = document.createElement('div');
  message.className = 'pv-msg assistant';
  message.textContent = text;
  log.appendChild(message);
  message.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}
