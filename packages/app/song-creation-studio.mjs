import { createId, createTrack, snapshotProject } from './core/src/project.mjs';
import { upsertConfirmedSection } from './core/src/section-map.mjs';
import { activeProjectSessionId, getProject, listProjects, rememberActiveProject, saveAudioAsset, saveProject } from './storage.mjs';
import { createSongCreationPlan, describeSongPlan, renderSongCreation, SONG_CREATION_SCHEMA } from './song-creation-engine.mjs';

const OPEN_STUDIO_KEY = 'pablovoice.songCreation.openStudio';
const runtime = {
  observer: null,
  busy: false,
  dirtyProjectId: null,
  urls: [],
  result: null,
};

export function installSongCreationStudio() {
  if (runtime.observer) return () => runtime.observer.disconnect();
  runtime.observer = new MutationObserver(() => injectSongCreator());
  runtime.observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('click', handleClick, true);
  injectSongCreator();
  consumeOpenStudioRequest();
  return () => {
    runtime.observer?.disconnect();
    runtime.observer = null;
    document.removeEventListener('submit', handleSubmit);
    document.removeEventListener('click', handleClick, true);
    revokeUrls();
  };
}

function injectSongCreator() {
  const lyrics = document.querySelector('#lyrics');
  if (!lyrics || document.querySelector('#pv-song-creator')) return;
  const lyricsGrid = lyrics.closest('.pv-grid');
  if (!lyricsGrid) return;
  const anchor = document.querySelector('#pv-ai-composer') || lyricsGrid;
  const panel = document.createElement('article');
  panel.id = 'pv-song-creator';
  panel.className = 'pv-card chrome pv-song-creator';
  panel.innerHTML = `
    <div class="pv-card-head">
      <div><h3>Criar música</h3><p>Transforme a letra em um arranjo real com instrumental e guia melódica editáveis no Studio.</p></div>
      <span class="pv-tag ok">AUDIO</span>
    </div>
    <form data-song-create-form class="pv-panel-grid">
      <label class="pv-song-wide">Direção musical
        <input class="pv-field" name="brief" maxlength="1200" placeholder="Ex.: pop R&B sensual, synths, grave redondo, refrão grande" required>
      </label>
      <div class="pv-song-fields">
        <label>Estilo
          <select class="pv-field" name="genre">
            <option value="pop">Pop</option>
            <option value="rnb">R&B</option>
            <option value="funk">Funk</option>
            <option value="mpb">MPB</option>
            <option value="rap">Rap / Hip-hop</option>
            <option value="dance">Dance / eletrônico</option>
          </select>
        </label>
        <label>BPM
          <input class="pv-field" name="bpm" type="number" min="60" max="180" value="112" inputmode="numeric">
        </label>
        <label>Duração
          <select class="pv-field" name="duration">
            <option value="60">1:00 · rascunho</option>
            <option value="120" selected>2:00 · demo</option>
            <option value="180">3:00 · música</option>
          </select>
        </label>
        <label>Tonalidade
          <select class="pv-field" name="key">
            <option value="">Automática</option>
            <option>C</option><option>Db</option><option>D</option><option>Eb</option><option>E</option><option>F</option>
            <option>Gb</option><option>G</option><option>Ab</option><option>A</option><option>Bb</option><option>B</option>
          </select>
        </label>
      </div>
      <label class="pv-song-wide">Clima
        <input class="pv-field" name="mood" maxlength="120" placeholder="Ex.: íntimo, noturno, elegante">
      </label>
      <div class="pv-actions">
        <button class="pv-btn primary" type="submit" data-song-create-button>♫ Criar instrumental + guia</button>
      </div>
      <div class="pv-note" id="pv-song-create-status">A geração local cria áudio WAV de verdade e salva duas faixas no projeto. A guia é melódica/sintetizada — não finge ser uma voz humana.</div>
    </form>
    <div id="pv-song-create-result"></div>`;
  anchor.insertAdjacentElement('afterend', panel);
  if (runtime.result) renderResult(runtime.result);
}

async function handleSubmit(event) {
  if (!event.target.matches('[data-song-create-form]')) return;
  event.preventDefault();
  if (runtime.busy) return;
  const form = event.target;
  const button = form.querySelector('[data-song-create-button]');
  const status = document.querySelector('#pv-song-create-status');
  const lyrics = String(document.querySelector('#lyrics')?.value || '').trim();
  const brief = String(form.elements.brief?.value || '').trim();
  if (!brief) return setText(status, 'Diga que tipo de música você quer criar.');
  if (!lyrics) return setText(status, 'Escreva ou gere a letra primeiro; ela guia a melodia e o mapa de seções.');

  runtime.busy = true;
  setBusy(button, true);
  setText(status, 'Montando estrutura, harmonia, groove, baixo e melodia…');
  await nextPaint();
  try {
    const project = await resolveActiveProject();
    if (!project) throw new Error('Crie ou abra um projeto antes de gerar a música.');
    const plan = createSongCreationPlan({
      brief,
      lyrics,
      genre: form.elements.genre?.value,
      mood: form.elements.mood?.value,
      bpm: Number(form.elements.bpm?.value),
      durationSeconds: Number(form.elements.duration?.value),
      key: form.elements.key?.value || null,
    });
    setText(status, `Renderizando ${Math.round(plan.durationSeconds)}s de áudio no aparelho…`);
    await nextPaint();
    const audio = renderSongCreation(plan);
    setText(status, 'Salvando instrumental, guia e mapa de seções no projeto…');
    await nextPaint();
    const saved = await persistSongTake(project, plan, audio, lyrics);
    runtime.dirtyProjectId = project.id;
    runtime.result = { ...saved, plan, audio };
    renderResult(runtime.result);
    setText(status, `Pronto. ${saved.instrumentalTrack.name} e ${saved.guideTrack.name} foram salvas no projeto.`);
  } catch (error) {
    console.error('PABLOVOICE_SONG_CREATION_FAILED', error);
    setText(status, error?.message || 'Não consegui criar a música. O projeto anterior foi preservado.');
  } finally {
    runtime.busy = false;
    setBusy(button, false);
  }
}

async function persistSongTake(project, plan, audio, lyrics) {
  const takeId = createId('songtake');
  const takeNumber = Math.max(1, Number(project.songCreation?.takes?.length || 0) + 1);
  const instrumentalAssetId = createId('asset');
  const guideAssetId = createId('asset');
  await saveAudioAsset({ id: instrumentalAssetId, blob: audio.instrumental.blob, name: `Instrumental · Take ${takeNumber}.wav`, type: 'audio/wav' });
  try {
    await saveAudioAsset({ id: guideAssetId, blob: audio.guide.blob, name: `Guia melódica · Take ${takeNumber}.wav`, type: 'audio/wav' });
  } catch (error) {
    throw new Error(`O instrumental foi renderizado, mas a guia não pôde ser salva: ${error?.message || 'falha de armazenamento'}`);
  }

  const instrumentalTrack = createTrack({ name: `Instrumental · Take ${takeNumber}`, assetId: instrumentalAssetId, type: 'audio/wav', duration: audio.duration, sampleRate: audio.sampleRate, channels: 1, kind: 'generated_instrumental' });
  Object.assign(instrumentalTrack, { role: 'instrumental', songTakeId: takeId, source: 'song_creation_runtime_v1' });
  const guideTrack = createTrack({ name: `Guia melódica · Take ${takeNumber}`, assetId: guideAssetId, type: 'audio/wav', duration: audio.duration, sampleRate: audio.sampleRate, channels: 1, kind: 'guide_melody' });
  Object.assign(guideTrack, { role: 'guide_vocal_target', songTakeId: takeId, source: 'song_creation_runtime_v1', guideType: 'synth_melody', replaceableByVoice: true, gain: 0.62 });

  project.lyrics = lyrics;
  project.preset = 'music';
  project.tracks = [...(project.tracks || []), instrumentalTrack, guideTrack];
  project.activeTrackId = instrumentalTrack.id;
  project.arrangementMap = applyArrangementMap(project.arrangementMap, plan.sections);
  const take = {
    id: takeId,
    schema: SONG_CREATION_SCHEMA,
    createdAt: Date.now(),
    brief: plan.brief,
    genre: plan.genre,
    mood: plan.mood,
    bpm: plan.bpm,
    key: plan.key,
    mode: plan.mode,
    durationSeconds: plan.durationSeconds,
    instrumentalTrackId: instrumentalTrack.id,
    guideTrackId: guideTrack.id,
    guideType: 'synth_melody',
    guideLines: plan.guideLines,
    sections: plan.sections,
    lyricsSnapshot: lyrics.slice(0, 16000),
    render: { provider: 'local_dsp', sampleRate: audio.sampleRate, format: 'audio/wav' },
  };
  const takes = [...(project.songCreation?.takes || []), take].slice(-12);
  project.songCreation = { schema: SONG_CREATION_SCHEMA, latestTakeId: takeId, takes };
  const snapshot = snapshotProject(project, `Música criada · Take ${takeNumber}`);
  await saveProject(snapshot);
  rememberActiveProject(project.id);
  return { projectId: project.id, takeId, takeNumber, instrumentalTrack, guideTrack };
}

function applyArrangementMap(current, sections) {
  let map = current;
  for (const section of sections) {
    const kind = arrangementKind(section.id);
    if (!kind) continue;
    map = upsertConfirmedSection(map, { kind, startSeconds: section.startSeconds, endSeconds: section.endSeconds, source: 'song_creation_runtime_v1', confidence: 1 });
  }
  return map;
}

function arrangementKind(id) {
  if (id === 'intro') return 'intro';
  if (id === 'outro') return 'outro';
  if (/verso/.test(id)) return 'verse';
  if (/pre/.test(id)) return 'prechorus';
  if (/refr/.test(id)) return 'chorus';
  if (/ponte_rap/.test(id)) return 'rap';
  if (/ponte/.test(id)) return 'bridge';
  return null;
}

async function resolveActiveProject() {
  const activeId = activeProjectSessionId();
  if (activeId) {
    const project = await getProject(activeId);
    if (project) return project;
  }
  const projects = await listProjects();
  return projects[0] || null;
}

function renderResult(result) {
  const host = document.querySelector('#pv-song-create-result');
  if (!host || !result) return;
  revokeUrls();
  const instrumentalUrl = URL.createObjectURL(result.audio.instrumental.blob);
  const guideUrl = URL.createObjectURL(result.audio.guide.blob);
  runtime.urls.push(instrumentalUrl, guideUrl);
  host.innerHTML = `<div class="pv-song-result">
    <div class="pv-card-head"><div><h3>Take ${result.takeNumber}</h3><p>${escapeHtml(describeSongPlan(result.plan))}</p></div><span class="pv-tag ok">SALVO</span></div>
    <div class="pv-song-audios">
      <label><strong>Instrumental</strong><audio controls preload="metadata" src="${instrumentalUrl}"></audio></label>
      <label><strong>Guia melódica</strong><audio controls preload="metadata" src="${guideUrl}"></audio><small>Melodia sintetizada para cantar por cima, gravar ou substituir depois.</small></label>
    </div>
    <div class="pv-actions"><button class="pv-btn primary" type="button" data-song-open-studio>◉ Abrir no Studio</button><button class="pv-btn" type="button" data-song-create-again>＋ Criar outro take</button></div>
  </div>`;
}

function handleClick(event) {
  const open = event.target.closest('[data-song-open-studio]');
  if (open) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return reloadIntoStudio();
  }
  const again = event.target.closest('[data-song-create-again]');
  if (again) {
    event.preventDefault();
    document.querySelector('[data-song-create-form] input[name="brief"]')?.focus();
    return;
  }
  const studio = event.target.closest('[data-route="studio"]');
  if (studio && runtime.dirtyProjectId) {
    event.preventDefault();
    event.stopImmediatePropagation();
    reloadIntoStudio();
  }
}

function reloadIntoStudio() {
  try { sessionStorage.setItem(OPEN_STUDIO_KEY, '1'); } catch {}
  location.reload();
}

function consumeOpenStudioRequest() {
  let shouldOpen = false;
  try { shouldOpen = sessionStorage.getItem(OPEN_STUDIO_KEY) === '1'; sessionStorage.removeItem(OPEN_STUDIO_KEY); } catch {}
  if (!shouldOpen) return;
  setTimeout(() => document.querySelector('[data-route="studio"]')?.click(), 0);
}

function revokeUrls() { for (const url of runtime.urls) URL.revokeObjectURL(url); runtime.urls = []; }
function setText(node, text) { if (node) node.textContent = text; }
function setBusy(button, busy) { if (!button) return; button.disabled = busy; button.textContent = busy ? 'Criando música…' : '♫ Criar instrumental + guia'; }
function nextPaint() { return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))); }
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
