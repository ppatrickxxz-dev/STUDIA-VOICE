import { createId, createTrack, snapshotProject } from './core/src/project.mjs';
import { upsertConfirmedSection } from './core/src/section-map.mjs';
import { createSectionRecordingIntent } from './core/src/human-vocal-workflow.mjs';
import { NativeMusicGenerationClient } from './native-music-generation-client.mjs';
import { buildSongCreationIntelligence, resolveSongCreationLyrics } from './song-creation-intelligence.mjs';
import { activeProjectSessionId, getProject, listProjects, rememberActiveProject, saveAudioAsset, saveProject } from './storage.mjs';
import { createSongCreationPlan, describeSongPlan, renderSongCreation, SONG_CREATION_SCHEMA } from './song-creation-engine.mjs';

const OPEN_STUDIO_KEY = 'pablovoice.songCreation.openStudio';
const RECORDING_INTENT_KEY = 'pablovoice.humanVocal.recordingIntent';
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
      <div><h3>Criar música</h3><p>Descreva a música do seu jeito. Pablo IA organiza letra, direção e produção; cada geração vira um novo take sem apagar o anterior.</p></div>
      <span class="pv-tag ok">CREATOR</span>
    </div>
    <form data-song-create-form class="pv-panel-grid">
      <label class="pv-song-wide">Direção musical
        <input class="pv-field" name="brief" maxlength="1200" placeholder="Ex.: R&B 2000s sensual, baixo synth redondo, bateria solta, refrão grande" required>
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
            <option value="60">1:00 · ideia</option>
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
      <label class="pv-song-wide">Evitar
        <input class="pv-field" name="negative" maxlength="700" placeholder="Ex.: dembow pesado, trap, voz feminina, drop EDM">
      </label>
      <fieldset class="pv-song-vocal-profile pv-song-wide">
        <legend>Voz-guia</legend>
        <p>A referência cantada respeita esta direção. Depois você pode substituir por sua voz, seção por seção.</p>
        <div class="pv-song-fields">
          <label>Tipo de voz
            <select class="pv-field" name="voiceType"><option value="masculina">Masculina</option><option value="feminina">Feminina</option><option value="neutra">Neutra</option></select>
          </label>
          <label>Nota mais grave<input class="pv-field" name="lowMidi" type="number" min="36" max="84" value="48"></label>
          <label>Nota mais aguda<input class="pv-field" name="highMidi" type="number" min="41" max="96" value="67"></label>
          <label>Idioma<input class="pv-field" name="vocalLanguage" maxlength="16" value="pt-BR"></label>
        </div>
        <label>Timbre e interpretação<input class="pv-field" name="vocalTone" maxlength="100" value="quente, natural e próximo"></label>
        <label>Direção vocal<input class="pv-field" name="vocalDelivery" maxlength="140" value="dicção clara, fraseado R&B e interpretação confortável"></label>
        <label class="pv-song-start-mode"><input type="checkbox" name="falsetto"><span><strong>Permitir falsete controlado</strong><small>A melodia-guia continua limitada à extensão informada.</small></span></label>
      </fieldset>
      <label class="pv-song-start-mode">
        <input type="checkbox" name="instrumentalFirst">
        <span><strong>Criar somente instrumental neste take</strong><small>A letra existente continua salva no projeto, mas não entra neste render.</small></span>
      </label>
      <div class="pv-song-mode-grid">
        <div class="pv-song-mode-card emphasis">
          <strong>PabloVoice · Alta qualidade</strong>
          <span>Pablo IA interpreta o prompt, cria letra quando necessário, dirige o arranjo e envia o take ao motor musical de alta qualidade.</span>
          <button class="pv-btn primary" type="button" data-song-create-hq>✦ Criar música</button>
        </div>
      </div>
      <div class="pv-note" id="pv-song-create-status">Escreva a direção acima e crie. Sem login, sem modo alternativo e sem substituir seus takes anteriores.</div>
    </form>
    <div id="pv-song-create-result"></div>`;
  anchor.insertAdjacentElement('afterend', panel);
  if (runtime.result) renderResult(runtime.result);
}

async function handleSubmit(event) {
  if (!event.target.matches('[data-song-create-form]')) return;
  event.preventDefault();
  await runCreation(event.target, 'hq');
}

async function runCreation(form, mode = 'hq') {
  if (runtime.busy) return;
  const localButton = form.querySelector('[data-song-create-button]');
  const highQualityButton = form.querySelector('[data-song-create-hq]');
  const activeButton = highQualityButton || localButton;
  const status = document.querySelector('#pv-song-create-status');
  const lyrics = String(document.querySelector('#lyrics')?.value || '').trim();
  const brief = String(form.elements.brief?.value || '').trim();
  if (!brief) return setText(status, 'Diga que tipo de música você quer criar.');

  const explicitInstrumental = Boolean(form.elements.instrumentalFirst?.checked);
  const lyricMode = explicitInstrumental
    ? resolveSongCreationLyrics({ lyrics, instrumentalFirst: true })
    : { creationMode: 'lyrics_guided', planLyrics: lyrics, projectLyrics: lyrics };
  const genre = form.elements.genre?.value;
  const mood = form.elements.mood?.value;

  runtime.busy = true;
  setCreationButtons(localButton, highQualityButton, true, 'hq');
  setText(status, explicitInstrumental
    ? 'Pablo IA organizando a produção do instrumental…'
    : lyrics
      ? 'Pablo IA analisando sua letra e dirigindo a música…'
      : 'Pablo IA transformando seu prompt em letra, direção e música…');
  await nextPaint();
  try {
    const project = await resolveActiveProject();
    if (!project) throw new Error('Crie ou abra um projeto antes de gerar a música.');
    const intelligence = buildSongCreationIntelligence({
      brief,
      genre,
      mood,
      lyrics: lyricMode.planLyrics,
      creationMode: lyricMode.creationMode,
    });
    const plan = createSongCreationPlan({
      brief,
      lyrics: lyricMode.planLyrics,
      genre,
      mood,
      bpm: Number(form.elements.bpm?.value),
      durationSeconds: Number(form.elements.duration?.value),
      key: form.elements.key?.value || null,
      singerProfile: {
        voiceType: form.elements.voiceType?.value,
        lowMidi: Number(form.elements.lowMidi?.value),
        highMidi: Number(form.elements.highMidi?.value),
        language: form.elements.vocalLanguage?.value,
        tone: form.elements.vocalTone?.value,
        delivery: form.elements.vocalDelivery?.value,
        falsetto: Boolean(form.elements.falsetto?.checked),
      },
    });

    setText(status, explicitInstrumental
      ? 'Conectando ao motor musical para criar o instrumental…'
      : 'Conectando Pablo IA ao motor musical…');
    const highQuality = await highQualityClient().generate({
      localProject: project,
      plan,
      negativeStyles: parseNegativeStyles(form.elements.negative?.value),
      instrumental: explicitInstrumental,
      onProgress: (current) => setText(status, nativeMusicProgress(current, explicitInstrumental ? 'instrumental_first' : 'lyrics_guided')),
    });
    if (!highQuality?.ok) throw new Error(humanHighQualityError(highQuality));

    const finalPlan = highQuality.directedPlan || plan;
    const generatedLyrics = String(highQuality.generatedLyrics?.text || '').trim();
    const finalLyrics = explicitInstrumental ? lyricMode.projectLyrics : (generatedLyrics || lyricMode.projectLyrics);
    if (generatedLyrics) {
      const lyricsField = document.querySelector('#lyrics');
      if (lyricsField) lyricsField.value = generatedLyrics;
    }

    setText(status, 'Áudio concluído. Salvando direção, letra, guia e take no projeto…');
    await nextPaint();
    const guideAudio = renderSongCreation(finalPlan).guide;
    const saved = await persistHighQualitySongTake(project, finalPlan, highQuality, guideAudio, finalLyrics, intelligence);
    runtime.result = { ...saved, plan: finalPlan, intelligence, instrumentalFirst: explicitInstrumental, mode: 'hq', aiDirection: highQuality.aiDirection, generatedLyrics: highQuality.generatedLyrics, previews: [
      { label: explicitInstrumental ? 'PabloVoice · Instrumental' : 'PabloVoice · Música', blob: highQuality.blob, note: explicitInstrumental ? 'Instrumental criado a partir da direção do prompt.' : 'Música de referência criada com direção de produção e estrutura do prompt.' },
      { label: 'Guia melódica', blob: guideAudio.blob, note: 'Guia separada para gravar, substituir ou testar interpretação por seção.' },
    ] };
    setText(status, `Pronto. Take ${saved.takeNumber} salvo com a direção usada na geração${generatedLyrics ? ' e a nova letra no projeto' : ''}.`);

    runtime.dirtyProjectId = project.id;
    renderResult(runtime.result);
  } catch (error) {
    console.error('PABLOVOICE_SONG_CREATION_FAILED', error);
    setText(status, error?.message || 'Não consegui criar a música. O projeto anterior foi preservado.');
  } finally {
    runtime.busy = false;
    setCreationButtons(localButton, highQualityButton, false, 'hq');
    activeButton?.blur?.();
  }
}

async function persistLocalSongTake(project, plan, audio, lyrics, intelligence) {
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
      intelligence,
      render: { provider: 'local_dsp', sampleRate: audio.sampleRate, format: 'audio/wav' },
    },
  });
  await saveSongSnapshot(project, `Música criada · Take ${takeNumber}`);
  return { projectId: project.id, takeId, takeNumber, instrumentalTrack, guideTrack };
}

async function persistHighQualitySongTake(project, plan, highQuality, guideAudio, lyrics, intelligence) {
  const takeId = createId('songtake');
  const takeNumber = nextTakeNumber(project);
  const referenceAssetId = createId('asset');
  const guideAssetId = createId('asset');
  const extension = highQuality.type === 'audio/flac' ? 'flac' : highQuality.type === 'audio/mpeg' ? 'mp3' : 'audio';
  const remoteAsset = highQuality.asset || {};
  const duration = Number(remoteAsset.duration_seconds) || plan.durationSeconds;
  const sampleRate = Number(remoteAsset.sample_rate) || 48000;
  const channels = Number(remoteAsset.channels) || 2;
  await saveAudioAsset({ id: referenceAssetId, blob: highQuality.blob, name: `PabloVoice GPU · Take ${takeNumber}.${extension}`, type: highQuality.type || 'audio/flac' });
  await saveAudioAsset({ id: guideAssetId, blob: guideAudio.blob, name: `Guia melódica · Take ${takeNumber}.wav`, type: 'audio/wav' });

  const referenceTrack = createTrack({ name: `PabloVoice GPU · Take ${takeNumber}`, assetId: referenceAssetId, type: highQuality.type || 'audio/flac', duration, sampleRate, channels, kind: 'ai_music_demo' });
  Object.assign(referenceTrack, {
    role: 'reference_mix',
    songTakeId: takeId,
    source: highQuality.source || 'pablovoice_native_music_v2_1',
    provider: highQuality.provider,
    providerModel: highQuality.model,
    providerModelRevision: highQuality.modelRevision || null,
    providerSongId: highQuality.songId || null,
    requestId: highQuality.requestId,
    remoteAssetId: remoteAsset.id || null,
    remoteSha256: highQuality.sha256 || remoteAsset.sha256 || null,
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
      providerSongId: highQuality.songId || null,
      remoteProjectId: highQuality.remoteProjectId,
      remoteAssetId: remoteAsset.id || null,
      intelligence,
      aiDirection: highQuality.aiDirection || null,
      generatedLyrics: highQuality.generatedLyrics ? { provider: highQuality.generatedLyrics.provider, model: highQuality.generatedLyrics.model } : null,
      director: highQuality.director || null,
      render: {
        provider: highQuality.provider,
        model: highQuality.model,
        modelRevision: highQuality.modelRevision || null,
        requestId: highQuality.requestId,
        sha256: highQuality.sha256 || remoteAsset.sha256 || null,
        format: highQuality.type || 'audio/flac',
        sampleRate,
        channels,
        purpose: 'high_quality_reference_mix',
      },
    },
  });
  await saveSongSnapshot(project, `Música PabloVoice GPU criada · Take ${takeNumber}`);
  return { projectId: project.id, takeId, takeNumber, referenceTrack, guideTrack, providerSongId: highQuality.songId || null };
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
  if (!runtime.highQualityClient) runtime.highQualityClient = new NativeMusicGenerationClient();
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
  const badge = 'IA + GPU · SALVO';
  const aiNote = result.aiDirection?.text ? `<p class="pv-note"><b>Direção usada:</b> ${escapeHtml(result.aiDirection.text)}</p>` : '';
  const generatedLyricsNote = result.generatedLyrics?.text ? `<p class="pv-note">A letra foi criada pelo Pablo IA a partir do prompt e salva no projeto para você editar.</p>` : '';
  const recordingSections = result.plan.sections.filter((section) => !['intro', 'outro'].includes(section.id)).map((section) => {
    const lyric = result.plan.guideLines.filter((line) => line.sectionId === section.id).map((line) => line.text).join(' · ');
    return `<button class="pv-song-record-section" type="button" data-song-record-section="${escapeHtml(section.id)}" data-song-take-id="${escapeHtml(result.takeId)}"><span>●</span><b>${escapeHtml(section.label)}</b><small>${escapeHtml(lyric || 'Ouça a guia e grave este trecho')}</small></button>`;
  }).join('');
  host.innerHTML = `<div class="pv-song-result">
    <div class="pv-card-head"><div><h3>Take ${result.takeNumber}</h3><p>${escapeHtml(describeSongPlan(result.plan))}</p></div><span class="pv-tag ok">${badge}</span></div>
    ${renderIntelligence(result.intelligence)}
    ${aiNote}
    ${generatedLyricsNote}
    <div class="pv-song-audios">${cards}</div>
    <section class="pv-song-human-vocal"><div class="pv-card-head"><div><h3>Agora coloque sua voz</h3><p>Grave por seção. Cada take humano entra alinhado e abaixa somente o trecho correspondente da guia.</p></div><span class="pv-tag">VOZ REAL</span></div><div class="pv-song-record-sections">${recordingSections}</div></section>
    <div class="pv-actions"><button class="pv-btn primary" type="button" data-song-open-studio>◉ Abrir no Studio</button><button class="pv-btn" type="button" data-song-create-again>＋ Criar outro take</button></div>
  </div>`;
}

function renderIntelligence(intelligence) {
  const concept = intelligence?.concept;
  if (!concept) return '';
  const mode = intelligence.creationMode === 'instrumental_first' ? 'Instrumental' : 'Música completa';
  const critique = intelligence.lyricCritique;
  const metrics = critique?.dimensions
    ? `<div class="pv-song-pmi-metrics"><span>Métrica ${Math.round(Number(critique.dimensions.meter) || 0)}</span><span>Rima ${Math.round(Number(critique.dimensions.rhyme) || 0)}</span><span>Cantabilidade ${Math.round(Number(critique.dimensions.singability) || 0)}</span></div>`
    : '<div class="pv-song-pmi-metrics"><span>Pablo IA pode criar a letra a partir do prompt</span></div>';
  return `<div class="pv-song-pmi-card">
    <div><strong>PMI · ${escapeHtml(mode)}</strong><span>${escapeHtml((concept.emotions || []).slice(0, 3).join(' · '))}</span></div>
    <p><b>Tensão:</b> ${escapeHtml(concept.tension)} <b>→ Payoff:</b> ${escapeHtml(concept.payoff)}</p>
    ${metrics}
  </div>`;
}

function handleClick(event) {
  const recordSection = event.target.closest('[data-song-record-section]');
  if (recordSection) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void prepareSectionRecording(recordSection).catch((error) => setText(document.querySelector('#pv-song-create-status'), error?.message || 'Não consegui preparar a gravação.'));
    return;
  }
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

async function prepareSectionRecording(button) {
  const project = await resolveActiveProject();
  if (!project) throw new Error('Abra o projeto antes de gravar.');
  const intent = createSectionRecordingIntent({ project, takeId: button.dataset.songTakeId, sectionId: button.dataset.songRecordSection });
  sessionStorage.setItem(RECORDING_INTENT_KEY, JSON.stringify(intent));
  sessionStorage.setItem(OPEN_STUDIO_KEY, '1');
  location.reload();
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
function nativeMusicProgress(current = {}, creationMode = '') {
  const progress = Math.max(0, Math.min(100, Math.round(Number(current.progress) || 0)));
  if (current.human_message) return `${current.human_message}${progress ? ` · ${progress}%` : ''}`;
  if (current.status === 'creative_lyrics') return 'Pablo IA criando a letra a partir do prompt…';
  if (current.status === 'creative_direction') return 'Pablo IA dirigindo groove, timbres, seções e voz…';
  if (current.status === 'completed' || progress >= 100) return 'Música concluída. Validando o áudio antes de salvar…';
  if (creationMode === 'instrumental_first') return `PabloVoice criando o instrumental… ${progress}%`;
  return `PabloVoice criando a música… ${progress}%`;
}
function humanHighQualityError(result = {}) {
  if (['connection_required', 'auth_required', 'invalid_session'].includes(result.error)) return 'Não consegui restabelecer a conexão transparente do Studio. Tente novamente; nenhuma versão anterior foi alterada.';
  if (result.error === 'project_link_failed') return 'Não consegui sincronizar este projeto com o motor musical. Nenhum take foi alterado.';
  if (result.error === 'creative_lyrics_unavailable') return 'Pablo IA não conseguiu concluir a letra desta tentativa. Ajuste o prompt ou tente novamente; não vou gerar uma música genérica no lugar.';
  if (result.error === 'creative_direction_unavailable') return 'Pablo IA não conseguiu fechar uma direção de produção confiável. Tente novamente; o Studio não enviou um prompt genérico para a música.';
  if (['music_compute_auth_role_failed', 'music_compute_lookup_failed', 'music_compute_unavailable'].includes(result.error)) return 'O motor de música não conseguiu acessar a GPU compartilhada. A falha foi bloqueada antes da geração e seus takes foram preservados.';
  if (['kaggle_dispatch_failed', 'kaggle_dispatch_rejected'].includes(result.error)) return 'A GPU não aceitou esta geração. O projeto foi preservado e nenhum take anterior foi substituído.';
  if (result.error === 'music_job_timeout') return 'A geração excedeu o tempo desta tentativa. O projeto anterior continua intacto.';
  if (['music_sha256_mismatch', 'music_size_mismatch', 'music_proof_missing'].includes(result.error)) return 'O áudio retornou, mas falhou na verificação de integridade. Ele não foi aplicado ao projeto.';
  if (result.error === 'native_music_failed') return 'O motor musical não concluiu esta geração. Nenhum take anterior foi substituído.';
  return `A criação não concluiu (${result.error || 'erro remoto'}). Nenhuma versão anterior foi substituída.`;
}
function revokeUrls() { for (const url of runtime.urls) URL.revokeObjectURL(url); runtime.urls = []; }
function setText(node, text) { if (node) node.textContent = text; }
function setCreationButtons(localButton, highQualityButton, busy) {
  if (localButton) localButton.disabled = true;
  if (highQualityButton) { highQualityButton.disabled = busy; highQualityButton.textContent = busy ? 'Criando…' : '✦ Criar música'; }
}
function nextPaint() { return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))); }
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
