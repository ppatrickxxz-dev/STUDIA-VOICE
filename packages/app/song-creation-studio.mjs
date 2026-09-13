import { createId, createTrack, snapshotProject } from './core/src/project.mjs';
import { upsertConfirmedSection } from './core/src/section-map.mjs';
import { NativeMusicGenerationClient } from './native-music-generation-client.mjs';
import { buildSongCreationIntelligence } from './song-creation-intelligence.mjs';
import { activeProjectSessionId, getProject, listProjects, rememberActiveProject, saveAudioAsset, saveProject } from './storage.mjs';
import { describeSongPlan, SONG_CREATION_SCHEMA } from './song-creation-engine.mjs';
import { createProfessionalSongPlan } from './professional-song-plan.mjs';

const OPEN_STUDIO_KEY = 'pablovoice.songCreation.openStudio';
const PENDING_GENERATIONS_KEY = 'pablovoice.pendingMusicGenerations.v2';
const DEFAULT_CANDIDATES = 2;

const runtime = {
  observer: null,
  busy: false,
  dirtyProjectId: null,
  urls: [],
  result: null,
  highQualityClient: null,
};

export function installSongCreationStudio() {
  if (runtime.observer) return () => disconnect();
  runtime.observer = new MutationObserver(injectSongCreator);
  runtime.observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('submit', handleSubmit, true);
  document.addEventListener('click', handleClick, true);
  window.addEventListener('online', handleOnline);
  injectSongCreator();
  consumeOpenStudioRequest();
  return disconnect;
}

function disconnect() {
  runtime.observer?.disconnect();
  runtime.observer = null;
  document.removeEventListener('submit', handleSubmit, true);
  document.removeEventListener('click', handleClick, true);
  window.removeEventListener('online', handleOnline);
  revokeUrls();
}

function injectSongCreator() {
  const lyrics = document.querySelector('#lyrics');
  if (!lyrics || document.querySelector('#pv-song-creator')) return;
  const lyricsGrid = lyrics.closest('.pv-grid') || lyrics.parentElement;
  if (!lyricsGrid) return;
  const anchor = document.querySelector('#pv-ai-composer') || lyricsGrid;
  const panel = document.createElement('article');
  panel.id = 'pv-song-creator';
  panel.className = 'pv-card chrome pv-song-creator pv-song-creator-v2';
  panel.innerHTML = `
    <div class="pv-card-head pv-create-head">
      <div>
        <span class="pv-kicker">PABLOVOICE · CRIAR</span>
        <h2>Criar uma música de verdade</h2>
        <p>Sua letra e sua direção artística viram versões completas. Nada é substituído sem você escolher.</p>
      </div>
      <span class="pv-tag ok">SONG-FIRST</span>
    </div>
    <form data-song-create-form class="pv-create-v2">
      <div class="pv-create-kind" role="group" aria-label="Tipo de criação">
        <button type="button" class="pv-btn active" data-pv-kind="song" aria-pressed="true">🎤 Música com voz</button>
        <button type="button" class="pv-btn" data-pv-kind="instrumental" aria-pressed="false">🎹 Instrumental</button>
      </div>
      <input type="checkbox" name="instrumentalFirst" hidden>

      <label class="pv-create-direction"><span>Como você quer que essa música soe?</span>
        <textarea class="pv-field" name="brief" rows="5" maxlength="4000" placeholder="Ex.: R&B brasileiro 2000s, sensual e noturno; groove humano, baixo synth profundo, bateria solta, refrão maior, voz masculina próxima; sem trap, sem dembow pesado…" required></textarea>
      </label>

      <div class="pv-create-lyrics-summary">
        <div><strong>Letra do projeto</strong><small data-pv-lyrics-status>A estrutura escrita na letra será preservada na geração.</small></div>
        <button class="pv-btn" type="button" data-edit-lyrics>Editar letra</button>
      </div>

      <details class="pv-create-adjustments">
        <summary>Ajustes</summary>
        <div class="pv-song-fields">
          <label>Base de estilo
            <select class="pv-field" name="genre">
              <option value="rnb" selected>R&B</option>
              <option value="pop">Pop</option>
              <option value="funk">Funk</option>
              <option value="mpb">MPB</option>
              <option value="rap">Rap / Hip-hop</option>
              <option value="dance">Dance / eletrônico</option>
            </select>
          </label>
          <label>BPM<input class="pv-field" name="bpm" type="number" min="60" max="180" value="120" inputmode="numeric"></label>
          <label>Duração
            <select class="pv-field" name="duration">
              <option value="120">2:00</option>
              <option value="180">3:00</option>
              <option value="200" selected>3:20</option>
              <option value="210">3:30</option>
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
        <label>Clima<input class="pv-field" name="mood" maxlength="240" placeholder="íntimo, noturno, elegante, sensual"></label>
        <label>Evitar<textarea class="pv-field" name="negative" rows="2" maxlength="1200" placeholder="trap; dembow pesado; voz feminina; drop EDM; loop repetitivo"></textarea></label>
        <fieldset class="pv-song-vocal-profile">
          <legend>Voz da versão gerada</legend>
          <div class="pv-song-fields">
            <label>Tipo<select class="pv-field" name="voiceType"><option value="masculina" selected>Masculina</option><option value="feminina">Feminina</option><option value="neutra">Neutra</option></select></label>
            <label>Nota grave<input class="pv-field" name="lowMidi" type="number" min="36" max="84" value="48"></label>
            <label>Nota aguda<input class="pv-field" name="highMidi" type="number" min="41" max="96" value="67"></label>
            <label>Idioma<input class="pv-field" name="vocalLanguage" maxlength="16" value="pt-BR"></label>
          </div>
          <label>Timbre<input class="pv-field" name="vocalTone" maxlength="180" value="quente, natural, próximo e masculino"></label>
          <label>Interpretação<input class="pv-field" name="vocalDelivery" maxlength="240" value="dicção brasileira clara, fraseado natural, sensual e confortável"></label>
          <label class="pv-song-start-mode"><input type="checkbox" name="falsetto"><span>Permitir falsete controlado</span></label>
        </fieldset>
      </details>

      <div class="pv-create-actions">
        <button class="pv-btn primary pv-create-main" type="submit" data-song-create-hq>✦ Criar 2 versões</button>
        <small>O PabloVoice gera alternativas profissionais e preserva todas as versões até você escolher.</small>
      </div>
      <div class="pv-note" id="pv-song-create-status">Sua letra + sua direção → duas versões completas → você escolhe → Studio.</div>
    </form>
    <div id="pv-song-create-result"></div>`;
  anchor.insertAdjacentElement('afterend', panel);
  syncKindButtons(panel);
  syncLyricsStatus();
  if (runtime.result) renderResult(runtime.result);
}

async function handleSubmit(event) {
  if (!event.target.matches('[data-song-create-form]')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  await runCreation(event.target);
}

async function runCreation(form) {
  if (runtime.busy) return;
  const status = form.querySelector('#pv-song-create-status') || document.querySelector('#pv-song-create-status');
  const button = form.querySelector('[data-song-create-hq]');
  const lyrics = String(document.querySelector('#lyrics')?.value || '').trim();
  const brief = String(form.elements.brief?.value || '').trim();
  const instrumental = Boolean(form.elements.instrumentalFirst?.checked);

  if (!brief) return setStatus(status, 'Descreva como você quer que a música soe.', 'error');
  if (!instrumental && !lyrics) return setStatus(status, 'Para criar uma música cantada, escreva ou cole a letra primeiro.', 'error');

  const request = collectCreationRequest(form, { brief, lyrics, instrumental });
  if (navigator.onLine === false) {
    await queueOfflineGeneration(request);
    setStatus(status, 'Sem conexão para gerar agora. O pedido ficou salvo neste aparelho e sua música continua editável.', 'warn');
    return;
  }

  runtime.busy = true;
  setBusy(button, true, 'Preparando a música…');
  setStatus(status, 'Lendo sua letra e montando o mapa real da música…', 'warn');
  await nextPaint();

  try {
    const project = await resolveActiveProject();
    if (!project) throw new Error('Crie ou abra um projeto antes de gerar a música.');

    const intelligence = buildSongCreationIntelligence({
      brief,
      genre: request.genre,
      mood: request.mood,
      lyrics,
      creationMode: instrumental ? 'instrumental_first' : 'lyrics_guided',
    });

    const plan = createProfessionalSongPlan({
      brief,
      lyrics,
      genre: request.genre,
      mood: request.mood,
      bpm: request.bpm,
      durationSeconds: request.durationSeconds,
      key: request.key,
      singerProfile: request.singerProfile,
    });

    setStatus(status, `Mapa fechado: ${plan.sections.length} seções · ${plan.totalBars} compassos. Criando duas alternativas…`, 'warn');

    const candidates = [];
    const failures = [];
    for (let index = 0; index < DEFAULT_CANDIDATES; index += 1) {
      const label = String.fromCharCode(65 + index);
      setBusy(button, true, `Criando versão ${label}…`);
      const highQuality = await highQualityClient().generate({
        localProject: project,
        plan,
        negativeStyles: request.negativeStyles,
        instrumental,
        variation: index === 0 ? 0.52 : 0.82,
        onProgress: (current) => setStatus(status, `Versão ${label} · ${nativeMusicProgress(current, instrumental)}`, 'warn'),
      });
      if (!highQuality?.ok) {
        failures.push({ label, error: humanHighQualityError(highQuality) });
        continue;
      }

      const finalPlan = highQuality.directedPlan || plan;
      const validation = validateCandidate(highQuality, { plan: finalPlan, instrumental, lyrics });
      if (!validation.ok) {
        failures.push({ label, error: validation.message });
        continue;
      }

      setStatus(status, `Versão ${label} chegou íntegra. Salvando sem apagar as outras…`, 'warn');
      const saved = await persistHighQualitySongTake(project, finalPlan, highQuality, lyrics, intelligence, {
        candidateLabel: label,
        instrumental,
        validation,
      });
      candidates.push({
        ...saved,
        label,
        blob: highQuality.blob,
        type: highQuality.type,
        plan: finalPlan,
        aiDirection: highQuality.aiDirection,
        director: highQuality.director,
        validation,
      });
    }

    if (!candidates.length) {
      const detail = failures.map((item) => `${item.label}: ${item.error}`).join(' · ');
      throw new Error(detail || 'Nenhuma versão chegou em condição segura para entrar no projeto.');
    }

    const first = candidates[0];
    await selectCandidate(project, first.takeId, first.trackId, { saveSnapshot: false });
    await saveSongSnapshot(project, `${candidates.length} versões profissionais geradas`);

    runtime.result = {
      projectId: project.id,
      candidates,
      failures,
      plan,
      intelligence,
      instrumental,
      selectedTakeId: first.takeId,
    };
    runtime.dirtyProjectId = project.id;
    renderResult(runtime.result);

    const vocalCopy = instrumental
      ? 'Instrumentais criados. Ouça e escolha a base que quer levar ao Studio.'
      : 'Versões cantadas solicitadas. Ouça e escolha; a auditoria acústica de vocal ainda precisa confirmar a presença da voz antes de chamar de Final.';
    setStatus(status, `${candidates.length} versão(ões) criada(s). ${vocalCopy}`, candidates.length === DEFAULT_CANDIDATES ? 'ok' : 'warn');
  } catch (error) {
    console.error('PABLOVOICE_SONG_CREATION_FAILED', error);
    setStatus(status, error?.message || 'Não consegui criar a música. Suas versões anteriores foram preservadas.', 'error');
  } finally {
    runtime.busy = false;
    setBusy(button, false, '✦ Criar 2 versões');
  }
}

function collectCreationRequest(form, { brief, lyrics, instrumental }) {
  return Object.freeze({
    schema: 'pablovoice_generation_request_v2',
    brief,
    lyrics,
    instrumental,
    genre: String(form.elements.genre?.value || 'rnb'),
    mood: String(form.elements.mood?.value || '').trim(),
    bpm: Number(form.elements.bpm?.value) || 120,
    durationSeconds: Number(form.elements.duration?.value) || 200,
    key: String(form.elements.key?.value || '').trim() || null,
    negativeStyles: parseNegativeStyles(form.elements.negative?.value),
    singerProfile: {
      voiceType: String(form.elements.voiceType?.value || 'masculina'),
      lowMidi: Number(form.elements.lowMidi?.value) || 48,
      highMidi: Number(form.elements.highMidi?.value) || 67,
      language: String(form.elements.vocalLanguage?.value || 'pt-BR'),
      tone: String(form.elements.vocalTone?.value || '').trim(),
      delivery: String(form.elements.vocalDelivery?.value || '').trim(),
      falsetto: Boolean(form.elements.falsetto?.checked),
    },
    createdAt: Date.now(),
  });
}

function validateCandidate(highQuality, { plan, instrumental, lyrics }) {
  const blobSize = Number(highQuality?.blob?.size || 0);
  const assetDuration = Number(highQuality?.asset?.duration_seconds || 0);
  const expected = Number(plan?.durationSeconds || 0);
  const proofVerified = highQuality?.job?.proof?.verified === true;
  if (blobSize <= 4096) return { ok: false, code: 'audio_too_small', message: 'O arquivo gerado é pequeno demais para ser uma música válida.' };
  if (!proofVerified) return { ok: false, code: 'proof_missing', message: 'A versão voltou sem prova de integridade e foi bloqueada.' };
  if (assetDuration > 0 && expected > 0 && (assetDuration < expected * 0.55 || assetDuration > expected * 1.45)) {
    return { ok: false, code: 'duration_implausible', message: 'A duração retornada ficou muito fora da música planejada.' };
  }
  if (!instrumental && !String(lyrics || '').trim()) return { ok: false, code: 'lyrics_missing', message: 'A geração vocal ficou sem letra vinculada.' };
  return Object.freeze({
    ok: true,
    code: instrumental ? 'instrumental_integrity_passed' : 'vocal_generation_integrity_passed',
    proofVerified,
    audioBytes: blobSize,
    durationSeconds: assetDuration || expected,
    vocalRequested: !instrumental,
    vocalContentAudit: instrumental ? 'not_applicable' : 'pending_acoustic_verification',
    lyricsAttached: !instrumental && Boolean(String(lyrics || '').trim()),
  });
}

async function persistHighQualitySongTake(project, plan, highQuality, lyrics, intelligence, { candidateLabel, instrumental, validation }) {
  const takeId = createId('songtake');
  const takeNumber = nextTakeNumber(project);
  const assetId = createId('asset');
  const extension = highQuality.type === 'audio/flac' ? 'flac' : highQuality.type === 'audio/mpeg' ? 'mp3' : 'audio';
  const remoteAsset = highQuality.asset || {};
  const duration = Number(remoteAsset.duration_seconds) || plan.durationSeconds;
  const sampleRate = Number(remoteAsset.sample_rate) || 48000;
  const channels = Number(remoteAsset.channels) || 2;

  await saveAudioAsset({
    id: assetId,
    blob: highQuality.blob,
    name: `Versão ${candidateLabel} · Take ${takeNumber}.${extension}`,
    type: highQuality.type || 'audio/flac',
  });

  const track = createTrack({
    name: instrumental ? `Instrumental ${candidateLabel} · Take ${takeNumber}` : `Música ${candidateLabel} · Take ${takeNumber}`,
    assetId,
    type: highQuality.type || 'audio/flac',
    duration,
    sampleRate,
    channels,
    kind: instrumental ? 'ai_music_instrumental' : 'ai_music_song',
  });
  Object.assign(track, {
    role: 'reference_mix',
    songTakeId: takeId,
    source: highQuality.source || 'pablovoice_native_music_v2_3',
    candidateLabel,
    vocalRequested: !instrumental,
    vocalContentAudit: validation.vocalContentAudit,
    provider: highQuality.provider,
    providerModel: highQuality.model,
    providerModelRevision: highQuality.modelRevision || null,
    requestId: highQuality.requestId,
    remoteAssetId: remoteAsset.id || null,
    remoteSha256: highQuality.sha256 || remoteAsset.sha256 || null,
  });

  commitSongTake(project, plan, lyrics, {
    takeId,
    tracks: [track],
    activeTrackId: track.id,
    take: {
      candidateLabel,
      referenceTrackId: track.id,
      providerSongId: highQuality.songId || null,
      remoteProjectId: highQuality.remoteProjectId,
      remoteAssetId: remoteAsset.id || null,
      intelligence,
      aiDirection: highQuality.aiDirection || null,
      director: highQuality.director || null,
      professionalBlueprint: plan.professionalBlueprint || null,
      validation,
      render: {
        provider: highQuality.provider,
        model: highQuality.model,
        modelRevision: highQuality.modelRevision || null,
        requestId: highQuality.requestId,
        sha256: highQuality.sha256 || remoteAsset.sha256 || null,
        format: highQuality.type || 'audio/flac',
        sampleRate,
        channels,
        purpose: instrumental ? 'professional_instrumental_candidate' : 'professional_vocal_song_candidate',
      },
    },
  });
  return { projectId: project.id, takeId, takeNumber, trackId: track.id, track };
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
    sections: plan.sections,
    guideLines: plan.guideLines,
    lyricsSnapshot: String(lyrics || '').slice(0, 16000),
    ...take,
  };
  const takes = [...(project.songCreation?.takes || []), nextTake].slice(-24);
  project.songCreation = { schema: SONG_CREATION_SCHEMA, latestTakeId: takeId, takes };
}

async function selectCandidate(project, takeId, trackId, { saveSnapshot = true } = {}) {
  if (!project || !takeId || !trackId) return;
  project.activeTrackId = trackId;
  project.songCreation = { ...(project.songCreation || {}), latestTakeId: takeId };
  if (saveSnapshot) await saveSongSnapshot(project, `Versão ${candidateLabelForTake(project, takeId)} escolhida`);
}

function renderResult(result) {
  const host = document.querySelector('#pv-song-create-result');
  if (!host || !result) return;
  revokeUrls();
  const candidates = result.candidates.map((candidate) => {
    const url = URL.createObjectURL(candidate.blob);
    runtime.urls.push(url);
    const selected = candidate.takeId === result.selectedTakeId;
    const vocalStatus = candidate.validation?.vocalRequested
      ? 'Voz solicitada · auditoria acústica pendente'
      : 'Instrumental';
    return `<article class="pv-song-candidate ${selected ? 'selected' : ''}" data-candidate-take="${escapeHtml(candidate.takeId)}">
      <div class="pv-card-head"><div><span class="pv-kicker">VERSÃO ${escapeHtml(candidate.label)}</span><h3>Take ${candidate.takeNumber}</h3><p>${escapeHtml(vocalStatus)}</p></div><span class="pv-tag ${selected ? 'ok' : ''}">${selected ? 'ESCOLHIDA' : 'CANDIDATA'}</span></div>
      <audio controls preload="metadata" src="${url}"></audio>
      ${candidate.aiDirection?.text ? `<p class="pv-note"><b>Direção usada:</b> ${escapeHtml(candidate.aiDirection.text)}</p>` : ''}
      <div class="pv-actions"><button class="pv-btn ${selected ? '' : 'primary'}" type="button" data-song-select-candidate data-take-id="${escapeHtml(candidate.takeId)}" data-track-id="${escapeHtml(candidate.trackId)}">${selected ? '✓ Versão escolhida' : 'Usar esta versão'}</button></div>
    </article>`;
  }).join('');

  const failures = result.failures?.length
    ? `<div class="pv-note error">${result.failures.map((failure) => `Versão ${escapeHtml(failure.label)} bloqueada: ${escapeHtml(failure.error)}`).join('<br>')}</div>`
    : '';

  host.innerHTML = `<section class="pv-song-result pv-song-result-v2">
    <div class="pv-card-head"><div><h3>Escolha a música que vale continuar</h3><p>${escapeHtml(describeSongPlan(result.plan))}</p></div><span class="pv-tag ok">${result.candidates.length} TAKE${result.candidates.length > 1 ? 'S' : ''}</span></div>
    <p class="pv-note">Nada aqui é chamado de Final automaticamente. Escolha uma versão; depois o Studio continua a produção sem apagar as outras.</p>
    <div class="pv-song-candidates">${candidates}</div>
    ${failures}
    <div class="pv-actions"><button class="pv-btn primary" type="button" data-song-open-studio>◉ Continuar no Studio</button><button class="pv-btn" type="button" data-song-create-again>＋ Criar novas versões</button></div>
  </section>`;
}

async function handleClick(event) {
  const kind = event.target.closest('[data-pv-kind]');
  if (kind) {
    const form = kind.closest('[data-song-create-form]');
    if (!form) return;
    event.preventDefault();
    const instrumental = kind.dataset.pvKind === 'instrumental';
    form.elements.instrumentalFirst.checked = instrumental;
    syncKindButtons(form);
    return;
  }

  const editLyrics = event.target.closest('[data-edit-lyrics]');
  if (editLyrics) {
    event.preventDefault();
    const lyrics = document.querySelector('#lyrics');
    lyrics?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => lyrics?.focus(), 180);
    return;
  }

  const choose = event.target.closest('[data-song-select-candidate]');
  if (choose) {
    event.preventDefault();
    const project = await resolveActiveProject();
    if (!project) return;
    await selectCandidate(project, choose.dataset.takeId, choose.dataset.trackId);
    if (runtime.result) {
      runtime.result.selectedTakeId = choose.dataset.takeId;
      renderResult(runtime.result);
      runtime.dirtyProjectId = project.id;
    }
    setStatus(document.querySelector('#pv-song-create-status'), 'Versão escolhida e preservada. Você pode continuar no Studio sem perder as alternativas.', 'ok');
    return;
  }

  const open = event.target.closest('[data-song-open-studio]');
  if (open) {
    event.preventDefault();
    return reloadIntoStudio();
  }

  const again = event.target.closest('[data-song-create-again]');
  if (again) {
    event.preventDefault();
    document.querySelector('[data-song-create-form] textarea[name="brief"]')?.focus();
    return;
  }

  const studio = event.target.closest('[data-route="studio"]');
  if (studio && runtime.dirtyProjectId) {
    event.preventDefault();
    event.stopImmediatePropagation();
    reloadIntoStudio();
  }
}

function syncKindButtons(root = document) {
  const form = root.matches?.('[data-song-create-form]') ? root : root.querySelector?.('[data-song-create-form]');
  if (!form) return;
  const instrumental = Boolean(form.elements.instrumentalFirst?.checked);
  form.querySelectorAll('[data-pv-kind]').forEach((button) => {
    const active = button.dataset.pvKind === (instrumental ? 'instrumental' : 'song');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function syncLyricsStatus() {
  const target = document.querySelector('[data-pv-lyrics-status]');
  const lyrics = String(document.querySelector('#lyrics')?.value || '').trim();
  if (!target) return;
  const sectionCount = (lyrics.match(/^\s*\[[^\]]+\]\s*$/gm) || []).length;
  target.textContent = lyrics
    ? `${sectionCount || 'Sem'} seções marcadas · a ordem e os compassos escritos na letra terão prioridade.`
    : 'Escreva a letra para criar uma música cantada.';
}

async function queueOfflineGeneration(request) {
  const project = await resolveActiveProject();
  const pending = readPendingGenerations();
  pending.push({ ...request, localProjectId: project?.id || null, queuedAt: Date.now() });
  localStorage.setItem(PENDING_GENERATIONS_KEY, JSON.stringify(pending.slice(-12)));
}

function readPendingGenerations() {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_GENERATIONS_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function handleOnline() {
  const pending = readPendingGenerations();
  if (!pending.length) return;
  const status = document.querySelector('#pv-song-create-status');
  setStatus(status, `${pending.length} pedido(s) salvo(s) enquanto você estava sem internet. Abra o Criar e confirme quando quiser gerar.`, 'warn');
}

function applyArrangementMap(current, sections) {
  let map = current;
  for (const section of sections || []) {
    const kind = arrangementKind(section.id);
    if (!kind) continue;
    map = upsertConfirmedSection(map, {
      kind,
      startSeconds: section.startSeconds,
      endSeconds: section.endSeconds,
      source: 'professional_song_blueprint_v2',
      confidence: 1,
    });
  }
  return map;
}

function arrangementKind(id = '') {
  if (id === 'intro') return 'intro';
  if (id === 'outro') return 'outro';
  if (/verso/.test(id)) return 'verse';
  if (/pre/.test(id)) return 'prechorus';
  if (/refr/.test(id)) return 'chorus';
  if (/ponte_rap/.test(id)) return 'rap';
  if (/ponte/.test(id)) return 'bridge';
  return null;
}

async function saveSongSnapshot(project, label) {
  const snapshot = snapshotProject(project, label);
  await saveProject(snapshot);
  rememberActiveProject(project.id);
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

function candidateLabelForTake(project, takeId) {
  return project?.songCreation?.takes?.find((take) => take.id === takeId)?.candidateLabel || 'escolhida';
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
    if (document.documentElement.dataset.pvReady !== 'true') return requestAnimationFrame(openWhenReady);
    try { sessionStorage.removeItem(OPEN_STUDIO_KEY); } catch {}
    document.querySelector('[data-route="studio"]')?.click();
  };
  requestAnimationFrame(openWhenReady);
}

function nextTakeNumber(project) {
  return Math.max(1, Number(project.songCreation?.takes?.length || 0) + 1);
}

function parseNegativeStyles(value) {
  return String(value || '').split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

function nativeMusicProgress(current = {}, instrumental = false) {
  const progress = Math.max(0, Math.min(100, Math.round(Number(current.progress) || 0)));
  if (current.human_message) return `${current.human_message}${progress ? ` · ${progress}%` : ''}`;
  if (current.status === 'creative_direction') return 'Pablo está fechando groove, timbres, seções e voz…';
  if (current.status === 'completed' || progress >= 100) return 'Áudio concluído. Verificando integridade…';
  return `${instrumental ? 'Criando o instrumental' : 'Criando a música'}${progress ? ` · ${progress}%` : '…'}`;
}

function humanHighQualityError(result = {}) {
  if (['connection_required', 'auth_required', 'invalid_session'].includes(result.error)) return 'A conexão com o motor musical caiu. Sua música anterior continua intacta.';
  if (result.error === 'project_link_failed') return 'Não consegui ligar este projeto ao motor musical. Nenhuma versão anterior foi alterada.';
  if (result.error === 'creative_direction_unavailable') return 'Não consegui fechar uma direção musical segura para esta tentativa; não enviei um prompt genérico no lugar.';
  if (result.error === 'music_compute_busy_timeout') return 'A GPU não liberou vaga nesta tentativa. O projeto e as versões anteriores foram preservados.';
  if (['music_sha256_mismatch', 'music_size_mismatch', 'music_proof_missing'].includes(result.error)) return 'O áudio retornou, mas falhou na verificação de integridade e foi bloqueado.';
  if (['kaggle_dispatch_failed', 'kaggle_dispatch_rejected'].includes(result.error)) return 'A GPU recusou esta geração. Nenhuma versão anterior foi substituída.';
  return `A criação não concluiu (${result.error || 'erro do motor'}). Nenhuma versão anterior foi substituída.`;
}

function setBusy(button, busy, text) {
  if (!button) return;
  button.disabled = Boolean(busy);
  button.classList.toggle('busy', Boolean(busy));
  if (text) button.textContent = text;
}

function setStatus(node, text, kind = '') {
  if (!node) return;
  node.textContent = text;
  if (kind) node.dataset.kind = kind;
  else delete node.dataset.kind;
}

function revokeUrls() {
  for (const url of runtime.urls) URL.revokeObjectURL(url);
  runtime.urls = [];
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

export const PABLOVOICE_SONG_CREATOR_POLICY = Object.freeze({
  version: '3.0.0',
  product: 'single_song_first_studio',
  professionalCandidates: DEFAULT_CANDIDATES,
  authoredLyricsStructureWins: true,
  localToyFallback: false,
  syntheticGuidePresentedAsVocal: false,
  finalIsUserApprovedOnly: true,
  offlineGenerationRequestQueue: true,
  vocalSuccessRequiresFutureAcousticAudit: true,
});
