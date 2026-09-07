import { createId, createTrack, snapshotProject } from './core/src/project.mjs';
import { upsertConfirmedSection } from './core/src/section-map.mjs';
import { MusicGenerationClient } from './music-generation-client.mjs';
import { activeProjectSessionId, getProject, listProjects, rememberActiveProject, saveAudioAsset, saveProject } from './storage.mjs';
import { createSongCreationPlan, describeSongPlan, renderSongCreation, SONG_CREATION_SCHEMA } from './song-creation-engine.mjs';

const OPEN_STUDIO_KEY = 'pablovoice.songCreation.openStudio';
const runtime = {
  observer: null,
  busy: false,
  dirtyProjectId: null,
  urls: [],
  result: null,
  highQualityClient: null,
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
      <div><h3>Criar música</h3><p>Da letra para um take real: rascunho local editável ou demo IA de alta qualidade, sempre preservando versões.</p></div>
      <span class="pv-tag ok">CREATOR</span>
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
      <label class="pv-song-wide">Evitar na geração IA
        <input class="pv-field" name="negative" maxlength="700" placeholder="Ex.: dembow pesado, trap, voz feminina, drop EDM">
      </label>
      <div class="pv-song-mode-grid">
        <div class="pv-song-mode-card">
          <strong>Rascunho local</strong>
          <span>Instantâneo, offline e editável. Cria instrumental WAV + guia melódica.</span>
          <button class="pv-btn" type="submit" data-song-create-button>♫ Criar rascunho</button>
        </div>
        <div class="pv-song-mode-card emphasis">
          <strong>Alta qualidade · IA</strong>
          <span>Cria uma demo musical HQ pelo backend e mantém uma guia melódica separada para você cantar/substituir.</span>
          <button class="pv-btn primary" type="button" data-song-create-hq>✦ Criar demo HQ</button>
        </div>
      </div>
      <div class="pv-note" id="pv-song-create-status">Nada substitui automaticamente seus takes. Cada criação entra como uma nova versão do projeto.</div>
    </form>
    <div id="pv-song-create-result"></div>`;
  anchor.insertAdjacentElement('afterend', panel);
  if (runtime.result) renderResult(runtime.result);
}

async function handleSubmit(event) {
  if (!event.target.matches('[data-song-create-form]')) return;
  event.preventDefault();
  await runCreation(event.target, 'local');
}

async function runCreation(form, mode) {
  if (runtime.busy) return;
  const localButton = form.querySelector('[data-song-create-button]');
  const highQualityButton = form.querySelector('[data-song-create-hq]');
  const activeButton = mode === 'hq' ? highQualityButton : localButton;
  const status = document.querySelector('#pv-song-create-status');
  const lyrics = String(document.querySelector('#lyrics')?.value || '').trim();
  const brief = String(form.elements.brief?.value || '').trim();
  if (!brief) return setText(status, 'Diga que tipo de música você quer criar.');
  if (!lyrics) return setText(status, 'Escreva ou gere a letra primeiro; ela guia a melodia e o mapa de seções.');

  runtime.busy = true;
  setCreationButtons(localButton, highQualityButton, true, mode);
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

    let saved;
    if (mode === 'hq') {
      setText(status, 'Conectando ao motor musical de alta qualidade…');
      const highQuality = await highQualityClient().generate({
        localProject: project,
        plan,
        negativeStyles: parseNegativeStyles(form.elements.negative?.value),
      });
      if (!highQuality?.ok) throw new Error(humanHighQualityError(highQuality));
      setText(status, 'Criando guia melódica separada e salvando a nova versão…');
      await nextPaint();
      const guideAudio = renderSongCreation(plan).guide;
      saved = await persistHighQualitySongTake(project, plan, highQuality, guideAudio, lyrics);
      runtime.result = { ...saved, plan, mode: 'hq', previews: [
        { label: 'Demo IA HQ', blob: highQuality.blob, note: 'Mix de referência de alta qualidade. Pode conter voz gerada; não é rotulada como instrumental isolado.' },
        { label: 'Guia melódica', blob: guideAudio.blob, note: 'Melodia sintetizada separada para cantar por cima ou substituir pela sua voz.' },
      ] };
      setText(status, `Pronto. Demo HQ e guia foram salvas como Take ${saved.takeNumber}, sem apagar versões anteriores.`);
    } else {
      setText(status, `Renderizando ${Math.round(plan.durationSeconds)}s de áudio no aparelho…`);
      await nextPaint();
      const audio = renderSongCreation(plan);
      setText(status, 'Salvando instrumental, guia e mapa de seções no projeto…');
      await nextPaint();
      saved = await persistLocalSongTake(project, plan, audio, lyrics);
      runtime.result = { ...saved, plan, mode: 'local', previews: [
        { label: 'Instrumental', blob: audio.instrumental.blob, note: 'Instrumental local editável.' },
        { label: 'Guia melódica', blob: audio.guide.blob, note: 'Melodia sintetizada para cantar por cima, gravar ou substituir depois.' },
      ] };
      setText(status, `Pronto. ${saved.instrumentalTrack.name} e ${saved.guideTrack.name} foram salvas no projeto.`);
    }

    runtime.dirtyProjectId = project.id;
    renderResult(runtime.result);
  } catch (error) {
    console.error('PABLOVOICE_SONG_CREATION_FAILED', error);
    setText(status, error?.message || 'Não consegui criar a música. O projeto anterior foi preservado.');
  } finally {
    runtime.busy = false;
    setCreationButtons(localButton, highQualityButton, false, mode);
    activeButton?.blur?.();
  }
}

async function persistLocalSongTake(project, plan, audio, lyrics) {
  const takeId = createId('songtake');
  const takeNumber = nextTakeNumber(project);
  const instrumentalAssetId = createId('asset');
  const guideAssetId = createId('asset');
  await saveAudioAsset({ id: instrumentalAssetId, blob: audio.instrumental.blob, name: `Instrumental · Take ${takeNumber}.wav`, type: 'audio/wav' });
  await saveAudioAsset({ id: guideAssetId, blob: audio.guide.blob, name: `Guia melódica · Take ${takeNumber}.wav`, type: 'audio/wav' });

  const instrumentalTrack = createTrack({ name: `Instrumental · Take ${takeNumber}`, assetId: instrumentalAssetId, type: 'audio/wav', duration: audio.duration, sampleRate: audio.sampleRate, channels: 1, kind: 'generated_instrumental' });
  Object.assign(instrumentalTrack, { role: 'instrumental', songTakeId: takeId, source: 'song_creation_runtime_v1' });
  const guideTrack = createTrack({ name: `Guia melódica · Take ${takeNumber}`, assetId: guideAssetId, type: 'audio/wav', duration: audio.duration, sampleRate: audio.sampleRate, channels: 1, kind: 'guide_melody' });
  Object.assign(guideTrack, { role: 'guide_vocal_target', songTakeId: takeId, source: 'song_creation_runtime_v1', guideType: 'synth_melody', replaceableByVoice: true, gain: 0.62 });

  commitSongTake(project, plan, lyrics, {
    takeId,
    takeNumber,
    tracks: [instrumentalTrack, guideTrack],
    activeTrackId: instrumentalTrack.id,
    take: {
      instrumentalTrackId: instrumentalTrack.id,
      guideTrackId: guideTrack.id,
      guideType: 'synth_melody',
      render: { provider: 'local_dsp', sampleRate: audio.sampleRate, format: 'audio/wav' },
    },
  });
  await saveSongSnapshot(project, `Música criada · Take ${takeNumber}`);
  return { projectId: project.id, takeId, takeNumber, instrumentalTrack, guideTrack };
}

async function persistHighQualitySongTake(project, plan, highQuality, guideAudio, lyrics) {
  const takeId = createId('songtake');
  const takeNumber = nextTakeNumber(project);
  const referenceAssetId = createId('asset');
  const guideAssetId = createId('asset');
  const extension = highQuality.type === 'audio/mpeg' ? 'mp3' : 'audio';
  await saveAudioAsset({ id: referenceAssetId, blob: highQuality.blob, name: `Demo IA HQ · Take ${takeNumber}.${extension}`, type: highQuality.type || 'audio/mpeg' });
  await saveAudioAsset({ id: guideAssetId, blob: guideAudio.blob, name: `Guia melódica · Take ${takeNumber}.wav`, type: 'audio/wav' });

  const referenceTrack = createTrack({ name: `Demo IA HQ · Take ${takeNumber}`, assetId: referenceAssetId, type: highQuality.type || 'audio/mpeg', duration: plan.durationSeconds, sampleRate: 48000, channels: 2, kind: 'ai_music_demo' });
  Object.assign(referenceTrack, {
    role: 'reference_mix',
    songTakeId: takeId,
    source: 'elevenmusic_music_v2',
    provider: highQuality.provider,
    providerModel: highQuality.model,
    providerSongId: highQuality.songId,
    requestId: highQuality.requestId,
  });
  const guideTrack = createTrack({ name: `Guia melódica · Take ${takeNumber}`, assetId: guideAssetId, type: 'audio/wav', duration: plan.durationSeconds, sampleRate: 24000, channels: 1, kind: 'guide_melody' });
  Object.assign(guideTrack, { role: 'guide_vocal_target', songTakeId: takeId, source: 'song_creation_runtime_v1', guideType: 'synth_melody', replaceableByVoice: true, gain: 0.62 });

  commitSongTake(project, plan, lyrics, {
    takeId,
    takeNumber,
    tracks: [referenceTrack, guideTrack],
    activeTrackId: referenceTrack.id,
    take: {
      referenceTrackId: referenceTrack.id,
      guideTrackId: guideTrack.id,
      guideType: 'synth_melody',
      providerSongId: highQuality.songId,
      remoteProjectId: highQuality.remoteProjectId,
      render: {
        provider: highQuality.provider,
        model: highQuality.model,
        requestId: highQuality.requestId,
        format: highQuality.type || 'audio/mpeg',
        purpose: 'high_quality_reference_mix',
      },
    },
  });
  await saveSongSnapshot(project, `Demo IA HQ criada · Take ${takeNumber}`);
  return { projectId: project.id, takeId, takeNumber, referenceTrack, guideTrack, providerSongId: highQuality.songId };
}

function commitSongTake(project, plan, lyrics, { takeId, tracks, activeTrackId, take }) {
  project.lyrics = lyrics;
  project.preset = 'music';
  project.tracks = [...(project.tracks || []), ...tracks];
  project.activeTrackId = activeTrackId;
  project.arrangementMap = applyArrangementMap(project.arrangementMap, plan.sections);
  const nextTake = {
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
    guideLines: plan.guideLines,
    sections: plan.sections,
    lyricsSnapshot: lyrics.slice(0, 16000),
    ...take,
  };
  const takes = [...(project.songCreation?.takes || []), nextTake].slice(-12);
  project.songCreation = { schema: SONG_CREATION_SCHEMA, latestTakeId: takeId, takes };
}

async function saveSongSnapshot(project, label) {
  const snapshot = snapshotProject(project, label);
  await saveProject(snapshot);
  rememberActiveProject(project.id);
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

function highQualityClient() {
  if (!runtime.highQualityClient) runtime.highQualityClient = new MusicGenerationClient();
  return runtime.highQualityClient;
}

function renderResult(result) {
  const host = document.querySelector('#pv-song-create-result');
  if (!host || !result) return;
  revokeUrls();
  const cards = result.previews.map((preview) => {
    const url = URL.createObjectURL(preview.blob);
    runtime.urls.push(url);
    return `<label><strong>${escapeHtml(preview.label)}</strong><audio controls preload="metadata" src="${url}"></audio><small>${escapeHtml(preview.note)}</small></label>`;
  }).join('');
  const badge = result.mode === 'hq' ? 'HQ · SALVO' : 'LOCAL · SALVO';
  const providerNote = result.mode === 'hq' && result.providerSongId ? `<p class="pv-note">ID de continuidade salvo para futuras regenerações por seção.</p>` : '';
  host.innerHTML = `<div class="pv-song-result">
    <div class="pv-card-head"><div><h3>Take ${result.takeNumber}</h3><p>${escapeHtml(describeSongPlan(result.plan))}</p></div><span class="pv-tag ok">${badge}</span></div>
    <div class="pv-song-audios">${cards}</div>
    ${providerNote}
    <div class="pv-actions"><button class="pv-btn primary" type="button" data-song-open-studio>◉ Abrir no Studio</button><button class="pv-btn" type="button" data-song-create-again>＋ Criar outro take</button></div>
  </div>`;
}

function handleClick(event) {
  const highQuality = event.target.closest('[data-song-create-hq]');
  if (highQuality) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const form = highQuality.closest('[data-song-create-form]');
    if (form) void runCreation(form, 'hq');
    return;
  }
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
  try { shouldOpen = sessionStorage.getItem(OPEN_STUDIO_KEY) === '1'; } catch {}
  if (!shouldOpen) return;

  const openWhenReady = () => {
    if (document.documentElement.dataset.pvReady !== 'true') {
      requestAnimationFrame(openWhenReady);
      return;
    }
    try { sessionStorage.removeItem(OPEN_STUDIO_KEY); } catch {}
    document.querySelector('[data-route="studio"]')?.click();
  };
  requestAnimationFrame(openWhenReady);
}

function nextTakeNumber(project) { return Math.max(1, Number(project.songCreation?.takes?.length || 0) + 1); }
function parseNegativeStyles(value) { return String(value || '').split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, 12); }
function humanHighQualityError(result = {}) {
  if (result.error === 'auth_required') return 'Conecte sua sessão do PabloVoice para usar a geração de alta qualidade. O rascunho local continua disponível.';
  if (result.error === 'project_link_failed') return 'Não consegui vincular este projeto ao runtime remoto. Nenhum take local foi alterado.';
  if (result.error === 'provider_unavailable') return 'O motor de alta qualidade não está configurado ou está indisponível agora. Use o rascunho local sem perder o projeto.';
  if (result.error === 'provider_rate_limited') return 'O motor de alta qualidade atingiu o limite temporário. Seu projeto foi preservado.';
  return `A geração de alta qualidade não concluiu (${result.error || 'erro remoto'}). Nenhuma versão anterior foi substituída.`;
}
function revokeUrls() { for (const url of runtime.urls) URL.revokeObjectURL(url); runtime.urls = []; }
function setText(node, text) { if (node) node.textContent = text; }
function setCreationButtons(localButton, highQualityButton, busy, mode) {
  if (localButton) { localButton.disabled = busy; localButton.textContent = busy && mode === 'local' ? 'Criando rascunho…' : '♫ Criar rascunho'; }
  if (highQualityButton) { highQualityButton.disabled = busy; highQualityButton.textContent = busy && mode === 'hq' ? 'Gerando demo HQ…' : '✦ Criar demo HQ'; }
}
function nextPaint() { return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))); }
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
