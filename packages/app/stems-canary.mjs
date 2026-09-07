import { RemoteAuthAdapter } from './remote-auth.mjs';
import { getAudioAsset, listProjects } from './storage.mjs';
import { encodeWav } from './audio/src/presets.mjs';
import { importStandaloneStems, waitForStandaloneStems } from './stems-result-runtime.mjs';

const PROJECT_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const DISPATCHER = 'compute-kaggle-v54';
const ACTIVE_PROJECT_KEY = 'pablovoice.stems.canary.activeProjectId';
const auth = new RemoteAuthAdapter();
let running = false;
let resumeAfterAuth = false;

auth.consumeBootstrapFragment();

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action="open-project"][data-id]');
  if (target?.dataset.id) localStorage.setItem(ACTIVE_PROJECT_KEY, target.dataset.id);
}, { capture: true });

document.addEventListener('pablovoice:remote-authenticated', () => {
  if (!resumeAfterAuth) return;
  resumeAfterAuth = false;
  setTimeout(() => runStemsSeparation(), 80);
});
window.addEventListener('online', ensureUi);
window.addEventListener('offline', ensureUi);

function headers(token = '', json = true) {
  const h = { apikey: PUBLISHABLE_KEY };
  if (token) h.authorization = `Bearer ${token}`;
  if (json) h['content-type'] = 'application/json';
  return h;
}

async function api(slug, token, body) {
  const response = await fetch(`${PROJECT_URL}/functions/v1/${slug}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.ok !== true) throw Error(json?.error || `${slug}_${response.status}`);
  return json;
}

async function sha256(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function wavFromBlob(blob) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) throw Error('Web Audio indisponível.');
  const context = new Context();
  try {
    const buffer = await context.decodeAudioData((await blob.arrayBuffer()).slice(0));
    return {
      blob: new Blob([encodeWav(buffer)], { type: 'audio/wav' }),
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: Math.min(2, buffer.numberOfChannels),
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function resolveVisibleProject() {
  const visibleName = document.querySelector('.pv-hero.compact .pv-title')?.textContent?.trim() || '';
  const visibleTrack = document.querySelector('.pv-hero.compact .pv-lead')?.textContent?.trim() || '';
  if (!visibleName) throw Error('Abra o Studio de um projeto antes de separar stems.');
  const projects = await listProjects();
  const candidates = projects.filter((project) => project?.name === visibleName && (visibleTrack ? project?.tracks?.some((track) => track.name === visibleTrack) : true));
  const remembered = localStorage.getItem(ACTIVE_PROJECT_KEY);
  if (remembered) {
    const rememberedVisible = candidates.find((project) => project.id === remembered);
    if (rememberedVisible) return rememberedVisible;
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) throw Error('Há mais de um projeto compatível com a tela atual. Reabra o projeto para separar a faixa correta.');
  throw Error('Não foi possível identificar com segurança o projeto aberto. Reabra-o em Meus projetos e tente novamente.');
}

async function uploadSource({ token, projectId, track, asset }) {
  status('Preparando uma cópia WAV verificada…', 'warn');
  const wav = await wavFromBlob(asset.blob);
  if (wav.blob.size > 96 * 1024 * 1024) throw Error('Esta faixa excede o limite de 96 MB da separação conectada.');
  const hash = await sha256(wav.blob);
  const ticket = await api('recording-ticket-v63', token, {
    project_id: projectId,
    mime_type: 'audio/wav',
    size_bytes: wav.blob.size,
    timeline_start: 0,
    original_name: `Stems-${String(asset.name || track.name || 'source').replace(/[^\p{L}\p{N}._-]+/gu, '_')}.wav`,
    recorder: 'PabloVoice Connected Stems',
    source_type: 'source_import',
    track_name: `Fonte stems · ${track.name || 'faixa'}`,
  });
  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', wav.blob, 'source.wav');
  status('Enviando a faixa para separação privada…', 'warn');
  const upload = await fetch(ticket.signed_url, {
    method: 'PUT',
    headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token}`, 'x-upsert': 'false' },
    body: form,
  });
  if (!upload.ok) throw Error(`Falha no upload remoto (${upload.status}).`);
  status('Validando a fonte antes de separar…', 'warn');
  const finalized = await api('recording-finalize-v63', token, {
    upload_id: ticket.upload_id,
    sha256: hash,
    duration_seconds: wav.duration,
    sample_rate: wav.sampleRate,
    channels: wav.channels,
  });
  if (!finalized.asset_id) throw Error('A fonte remota não retornou asset_id.');
  return { assetId: finalized.asset_id, sha256: hash, duration: wav.duration };
}

async function dispatchStems({ token, projectId, sourceAssetId }) {
  status('Separando Vocal + Instrumental…', 'warn');
  const out = await api(DISPATCHER, token, { project_id: projectId, source_asset_id: sourceAssetId });
  if (!out.job_id) throw Error('A separação não retornou job_id.');
  return out;
}

export async function runStemsSeparation() {
  if (running) return;
  if (navigator.onLine === false) {
    status('Stems precisam de conexão. O restante do projeto continua disponível offline.', 'error');
    ensureUi();
    return;
  }
  running = true;
  buttonDisabled(true);
  try {
    const session = await auth.ensureSession().catch(() => null);
    if (!session?.accessToken) {
      resumeAfterAuth = true;
      status('Reconheça este aparelho para separar stems.', 'warn');
      document.dispatchEvent(new CustomEvent('pablovoice:request-online-auth', { detail: { reason: 'Separar Vocal + Instrumental' } }));
      return;
    }

    const project = await resolveVisibleProject();
    if (!project?.tracks?.length) throw Error('Crie ou abra um projeto com áudio antes de separar stems.');
    localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);
    const track = project.tracks.find((item) => item.id === project.activeTrackId) || project.tracks[0];
    const asset = await getAudioAsset(track.assetId);
    if (!asset?.blob) throw Error('A faixa ativa não possui áudio local disponível.');

    status('Ligando o projeto ao runtime conectado…', 'warn');
    const remote = await auth.ensureRemoteProject(project);
    if (!remote?.ok || !remote.project?.id) throw Error('Não foi possível ligar este projeto ao runtime conectado.');
    const source = await uploadSource({ token: session.accessToken, projectId: remote.project.id, track, asset });
    const job = await dispatchStems({ token: session.accessToken, projectId: remote.project.id, sourceAssetId: source.assetId });
    const evidence = {
      jobId: job.job_id,
      localProjectId: project.id,
      remoteProjectId: remote.project.id,
      sourceAssetId: source.assetId,
      sourceSha256: source.sha256,
      startedAt: new Date().toISOString(),
      dispatcher: DISPATCHER,
    };
    localStorage.setItem('pablovoice.stems.canary.last', JSON.stringify(evidence));

    const completed = await waitForStandaloneStems({
      token: session.accessToken,
      jobId: job.job_id,
      onProgress: (current) => status(`Separação ${Math.max(0, Number(current.progress || 0))}% · ${current.status}`, 'warn'),
    });
    const consumed = await importStandaloneStems({ token: session.accessToken, job: completed, project });
    const retained = {
      ...evidence,
      finishedAt: completed.finished_at || new Date().toISOString(),
      status: completed.status,
      provider: completed.provider || 'kaggle',
      engine: completed.proof?.engine || completed.engine || 'Demucs',
      model: completed.proof?.model || 'htdemucs',
      externalJobId: completed.external_job_id || null,
      outputAssetIds: completed.output_asset_ids,
      proof: completed.proof,
      stems: consumed.imported,
      routeValidated: true,
      acousticPromotion: false,
    };
    localStorage.setItem('pablovoice.stems.canary.last', JSON.stringify(retained));
    const associated = completed.output_asset_ids.every((id) => project.tracks.some((item) => item.renderJobId === completed.id && item.remoteAssetId === id));
    if (!associated) throw Error('Os stems concluíram, mas não foram associados ao projeto local.');

    status('Vocal + Instrumental adicionados ao projeto. Compare com o mix original antes de escolher.', 'ok');
    document.dispatchEvent(new CustomEvent('pablovoice:stems-imported', {
      detail: { projectId: project.id, jobId: completed.id, imported: consumed.imported.map((item) => ({ trackId: item.trackId, kind: item.kind })) },
    }));
  } catch (error) {
    console.error('PabloVoice connected stems', error);
    status(error?.message || 'A separação de stems falhou.', 'error');
  } finally {
    running = false;
    buttonDisabled(false);
    ensureUi();
  }
}

function status(text, kind = '') {
  const element = document.querySelector('#pv-stems-canary-status');
  if (element) {
    element.textContent = text;
    element.dataset.kind = kind;
  }
}

function buttonDisabled(value) {
  const button = document.querySelector('#pv-stems-canary-run');
  if (button) button.disabled = value;
}

function ensureUi() {
  const studio = document.querySelector('.pv-studio-actions');
  if (!studio) return;
  let wrap = document.querySelector('#pv-stems-canary');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'pv-stems-canary';
    wrap.className = 'pv-studio-actions pv-connected-stems';
    wrap.dataset.capability = 'connected_stems';
    wrap.innerHTML = '<button id="pv-stems-canary-run" class="pv-btn" type="button">Separar Vocal + Instrumental</button><span id="pv-stems-canary-status" class="pv-health">Separação conectada · os stems voltam como tracks do projeto para comparação.</span>';
    studio.insertAdjacentElement('afterend', wrap);
    wrap.querySelector('#pv-stems-canary-run')?.addEventListener('click', runStemsSeparation);
  }
  const button = wrap.querySelector('#pv-stems-canary-run');
  if (button && !running) {
    button.disabled = navigator.onLine === false;
    button.textContent = navigator.onLine === false ? 'Stems · precisa de conexão' : 'Separar Vocal + Instrumental';
  }
  if (navigator.onLine === false && !running) {
    status('Sem rede: stems ficam indisponíveis; edição e geração local continuam preservadas.', 'warn');
  }
}

new MutationObserver(ensureUi).observe(document.documentElement, { subtree: true, childList: true });
ensureUi();

// Kept for compatibility with existing evidence contracts. Route validation is
// distinct from acoustic B09 promotion and must not be conflated with it.
export const STANDALONE_STEMS_CANARY = Object.freeze({
  dispatcher: DISPATCHER,
  engine: 'Demucs',
  model: 'htdemucs',
  routeValidated: true,
  b09AcousticValidated: false,
});

export const PABLOVOICE_STEMS_PRODUCT_POLICY = Object.freeze({
  connectedActionVisible: true,
  importsIntoCurrentProject: true,
  expectedKinds: ['guide_vocal', 'instrumental'],
  routeValidated: true,
  acousticPromotion: false,
  requiresUserComparisonBeforePromotion: true,
});
