import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { RemoteAuthAdapter } from '../../packages/app/remote-auth.mjs';
import { NativeMusicGenerationClient } from '../../packages/app/native-music-generation-client.mjs';
import { createSongCreationPlan } from '../../packages/app/song-creation-engine.mjs';

const ORIGIN = process.env.PV_STUDIO_ORIGIN || 'https://studia-voice.ppatrickxxz.workers.dev';
const SUPABASE_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const outDir = 'test-results/real-composition';
const STEM_TERMINAL = new Set(['completed', 'error', 'failed', 'cancelled']);
const VOCAL_THRESHOLDS = Object.freeze({
  minRms: 0.0015,
  minPeak: 0.015,
  minActiveRatio: 0.02,
  minRmsVsMix: 0.04,
  minDurationSeconds: 8,
});

fs.mkdirSync(outDir, { recursive: true });

const map = new Map();
const storage = {
  getItem: (key) => map.has(key) ? map.get(key) : null,
  setItem: (key, value) => map.set(key, String(value)),
  removeItem: (key) => map.delete(key),
};
const baseFetch = globalThis.fetch.bind(globalThis);
const fetchImpl = async (input, options = {}) => {
  const url = String(input);
  const headers = new Headers(options.headers || {});
  if (url.includes('/functions/v1/device-auth')) headers.set('origin', ORIGIN);
  return baseFetch(input, { ...options, headers });
};
const location = { origin: ORIGIN, pathname: '/', search: '', hash: '', history: { replaceState() {} } };
const auth = new RemoteAuthAdapter({ storage, location, fetchImpl });
const progress = [];
const vocalProgress = [];
let linked = null;
let localProject = null;

function authHeaders(token, json = false) {
  const headers = { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token}` };
  if (json) headers['content-type'] = 'application/json';
  return headers;
}

async function readJson(response, label) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `${label}_${response.status}`);
  return data;
}

async function getStemJob(token, jobId) {
  const select = 'id,project_id,job_type,status,progress,current_stage,engine,provider,external_job_id,input_asset_ids,output_asset_ids,parameters,proof,error_message,created_at,started_at,finished_at';
  const url = `${SUPABASE_URL}/rest/v1/render_jobs?select=${encodeURIComponent(select)}&id=eq.${encodeURIComponent(jobId)}&limit=1`;
  const rows = await readJson(await fetchImpl(url, { headers: authHeaders(token) }), 'stem_job_lookup');
  const job = Array.isArray(rows) ? rows[0] : null;
  if (!job) throw new Error('stem_job_not_found');
  if (job.job_type !== 'stems') throw new Error('stem_job_type_mismatch');
  return job;
}

async function waitForStemJob(token, jobId) {
  const deadline = Date.now() + 12 * 60 * 1000;
  for (;;) {
    const job = await getStemJob(token, jobId);
    const entry = {
      status: job?.status || null,
      progress: Number(job?.progress || 0),
      stage: job?.current_stage || null,
    };
    vocalProgress.push(entry);
    console.log('PV_VOCAL_AUDIT_PROGRESS', JSON.stringify(entry));
    if (STEM_TERMINAL.has(String(job.status))) {
      if (job.status !== 'completed') throw new Error(job.error_message || `stems_job_${job.status}`);
      if (!Array.isArray(job.output_asset_ids) || job.output_asset_ids.length !== 2) throw new Error('stems_outputs_incomplete');
      return job;
    }
    if (Date.now() >= deadline) throw new Error('stems_job_timeout');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function getStemAssets(token, job) {
  const ids = Array.isArray(job?.output_asset_ids) ? job.output_asset_ids.map(String).filter(Boolean) : [];
  if (ids.length !== 2) throw new Error('stems_outputs_incomplete');
  const select = 'id,project_id,kind,storage_bucket,storage_path,original_name,mime_type,size_bytes,duration_seconds,sample_rate,channels,bit_depth,sha256,metadata,created_at';
  const idList = ids.join(',');
  const url = `${SUPABASE_URL}/rest/v1/audio_assets?select=${encodeURIComponent(select)}&id=in.(${encodeURIComponent(idList)})`;
  const rows = await readJson(await fetchImpl(url, { headers: authHeaders(token) }), 'stem_asset_lookup');
  if (!Array.isArray(rows) || rows.length !== 2) throw new Error('stems_asset_rows_incomplete');
  const byId = new Map(rows.map((asset) => [String(asset.id), asset]));
  const ordered = ids.map((id) => byId.get(id));
  if (ordered.some((asset) => !asset)) throw new Error('stems_asset_association_mismatch');
  const expectedKinds = new Set(['guide_vocal', 'instrumental']);
  for (const asset of ordered) {
    if (String(asset.project_id) !== String(job.project_id)) throw new Error('stems_asset_project_mismatch');
    if (!expectedKinds.has(String(asset.kind))) throw new Error('unexpected_stem_kind');
    if (asset.storage_bucket !== 'audio-private') throw new Error('unexpected_stem_bucket');
    if (!/^[0-9a-f]{64}$/i.test(String(asset.sha256 || ''))) throw new Error('stem_sha256_missing');
  }
  if (new Set(ordered.map((asset) => asset.kind)).size !== 2) throw new Error('duplicate_stem_kind');
  return ordered;
}

function encodedStoragePath(path = '') {
  return String(path).split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function downloadStem(token, asset) {
  const url = `${SUPABASE_URL}/storage/v1/object/authenticated/${encodeURIComponent(asset.storage_bucket)}/${encodedStoragePath(asset.storage_path)}`;
  const response = await fetchImpl(url, { headers: authHeaders(token) });
  if (!response.ok) throw new Error(`stem_download_${response.status}`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('stem_download_empty');
  if (Number(asset.size_bytes) > 0 && blob.size !== Number(asset.size_bytes)) throw new Error('stem_size_mismatch');
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  if (sha256.toLowerCase() !== String(asset.sha256).toLowerCase()) throw new Error('stem_sha256_mismatch');
  return { blob, sha256 };
}

function measurePcm(buffer, { sampleRate = 16000, activeThreshold = 0.004, frameSeconds = 0.05 } = {}) {
  const sampleCount = Math.floor(buffer.length / 2);
  assert.ok(sampleCount > sampleRate, 'decoded audio is empty');
  const frameSize = Math.max(256, Math.round(sampleRate * frameSeconds));
  let sumSq = 0;
  let peak = 0;
  let clipped = 0;
  let activeFrames = 0;
  let frames = 0;
  const frameRms = [];
  for (let start = 0; start < sampleCount; start += frameSize) {
    const end = Math.min(sampleCount, start + frameSize);
    let localSq = 0;
    let localN = 0;
    for (let i = start; i < end; i += 1) {
      const value = buffer.readInt16LE(i * 2) / 32768;
      const abs = Math.abs(value);
      sumSq += value * value;
      localSq += value * value;
      localN += 1;
      if (abs > peak) peak = abs;
      if (abs >= 0.999) clipped += 1;
    }
    if (localN) {
      const value = Math.sqrt(localSq / localN);
      frameRms.push(value);
      frames += 1;
      if (value >= activeThreshold) activeFrames += 1;
    }
  }
  const sorted = [...frameRms].sort((a, b) => a - b);
  const p10 = sorted[Math.floor((sorted.length - 1) * 0.10)] || 0;
  const p90 = sorted[Math.floor((sorted.length - 1) * 0.90)] || 0;
  return {
    rms: Math.sqrt(sumSq / sampleCount),
    peak,
    activeRatio: frames ? activeFrames / frames : 0,
    duration: sampleCount / sampleRate,
    clipRatio: clipped / sampleCount,
    rmsContrast: p90 - p10,
  };
}

function decodePcm(path) {
  const run = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'], { encoding: null, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(run.status, 0, String(run.stderr || 'ffmpeg decode failed'));
  return run.stdout;
}

function round(value) {
  return Number((Number(value) || 0).toFixed(6));
}

function evaluateVocalPresence({ vocal, mix, vocalAsset = {}, job = {} } = {}) {
  const vocalRms = Number(vocal?.rms || 0);
  const mixRms = Number(mix?.rms || 0);
  const ratio = mixRms > 0 ? vocalRms / mixRms : 0;
  const activeRatio = Number(vocal?.activeRatio || 0);
  const peak = Number(vocal?.peak || 0);
  const duration = Number(vocal?.duration || vocalAsset?.duration_seconds || 0);
  const checks = Object.freeze({
    rms: vocalRms >= VOCAL_THRESHOLDS.minRms,
    peak: peak >= VOCAL_THRESHOLDS.minPeak,
    activity: activeRatio >= VOCAL_THRESHOLDS.minActiveRatio,
    relativeLevel: ratio >= VOCAL_THRESHOLDS.minRmsVsMix,
    duration: duration >= VOCAL_THRESHOLDS.minDurationSeconds,
  });
  const metrics = Object.freeze({
    vocalRms: round(vocalRms),
    mixRms: round(mixRms),
    vocalToMixRms: round(ratio),
    vocalPeak: round(peak),
    vocalActiveRatio: round(activeRatio),
    vocalDurationSeconds: round(duration),
  });
  if (!Object.values(checks).every(Boolean)) {
    return Object.freeze({
      ok: false,
      code: 'vocal_presence_not_verified',
      message: 'A versão voltou sem presença vocal suficiente para ser aceita como música cantada.',
      checks,
      metrics,
      thresholds: VOCAL_THRESHOLDS,
      stemJobId: job?.id || null,
    });
  }
  return Object.freeze({
    ok: true,
    code: 'vocal_presence_verified',
    message: 'Vocal acústico confirmado.',
    checks,
    metrics,
    thresholds: VOCAL_THRESHOLDS,
  });
}

try {
  const session = await auth.ensureSession();
  assert.ok(session?.accessToken, 'transparent device session was not created');

  localProject = {
    id: `physical-composition-${process.env.GITHUB_RUN_ID}-${Date.now()}`,
    name: 'Canary · composição real PabloVoice',
  };
  linked = await auth.ensureRemoteProject(localProject);
  assert.equal(linked?.ok, true, `remote project link failed: ${linked?.error || 'unknown'}`);
  assert.ok(linked?.project?.id, 'remote project id missing');

  const lyrics = `[Verso]\nEu jurei que era só mais uma noite\nSem nome na agenda, sem querer lembrar\nMas quando você chega muda o meu roteiro\nE eu finjo que não vou me entregar\n\n[Pré-Refrão]\nSe essa boca já deu pista\nChega perto pra eu entender\n\n[Refrão]\nSem promessa de outro dia\nHoje é só eu e você\nQuando o sol entrar no quarto\nAmanhã a gente vê`;

  const plan = createSongCreationPlan({
    brief: 'Pop R&B brasileiro com estética Y2K/2000s, sensual e noturno, groove de funk melody/pagofunk bem sutil, bateria solta com grave tum tum ta, baixo synth redondo, pads e plucks brilhantes, versos íntimos, pré-refrão crescente e refrão forte e chiclete. Voz masculina tenor/barítono em PT-BR, dicção clara, interpretação quente. Pouco violão e pouco piano. Nada de dembow pesado, trap, batestaca, tropical, salsa ou drop EDM.',
    lyrics,
    genre: 'rnb',
    mood: 'sensual, noturno, íntimo, confiante',
    bpm: 104,
    durationSeconds: 32,
    key: 'A',
    singerProfile: {
      voiceType: 'masculina tenor/barítono',
      lowMidi: 48,
      highMidi: 67,
      language: 'pt-BR',
      tone: 'quente, natural, próximo e masculino',
      delivery: 'dicção clara, fraseado R&B, refrão aberto, ad-libs contidos',
      falsetto: true,
    },
  });

  const client = new NativeMusicGenerationClient({ authAdapter: auth, fetchImpl, pollIntervalMs: 5000 });
  const result = await client.generate({
    localProject,
    plan,
    negativeStyles: ['heavy dembow', 'trap beat', 'batestaca', 'tropical beach', 'salsa', 'EDM drop', 'female vocal'],
    instrumental: false,
    variation: 0.78,
    onProgress: (state) => {
      progress.push({
        status: state?.status || null,
        progress: Number(state?.progress || 0),
        stage: state?.current_stage || null,
        message: state?.human_message || null,
      });
      console.log('PV_COMPOSITION_PROGRESS', JSON.stringify(progress.at(-1)));
    },
  });

  if (!result?.ok) {
    fs.writeFileSync(`${outDir}/failure.json`, JSON.stringify({ result, progress, remote_project_id: linked?.project?.id || null }, null, 2));
  }
  assert.equal(result?.ok, true, `music generation failed: ${result?.error || 'unknown'} ${result?.detail || ''}`);
  assert.equal(result?.fallback_allowed, false);
  assert.ok(String(result?.aiDirection?.text || '').length >= 40, 'real AI production direction missing');
  assert.ok(String(result?.aiDirection?.text || '').length <= 430, 'AI direction exceeded product limit');
  assert.match(String(result?.director?.fingerprint || ''), /^pv2_[0-9a-f]{8}$/);
  assert.ok(result?.blob?.size > 100_000, `generated audio too small: ${result?.blob?.size || 0}`);
  assert.ok(result?.asset?.id, 'generated remote source asset id missing');

  const audioPath = `${outDir}/composition.flac`;
  fs.writeFileSync(audioPath, Buffer.from(await result.blob.arrayBuffer()));
  const probeRun = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels:format=duration', '-of', 'json', audioPath], { encoding: 'utf8' });
  assert.equal(probeRun.status, 0, probeRun.stderr || 'ffprobe failed');
  const probe = JSON.parse(probeRun.stdout || '{}');
  const duration = Number(probe?.format?.duration || 0);
  const sampleRate = Number(probe?.streams?.[0]?.sample_rate || 0);
  const channels = Number(probe?.streams?.[0]?.channels || 0);
  assert.ok(duration >= 20, `physical song duration too short: ${duration}`);
  assert.ok(sampleRate >= 32000, `sample rate too low: ${sampleRate}`);
  assert.ok(channels >= 1, `invalid channels: ${channels}`);

  const mixSignal = measurePcm(decodePcm(audioPath), { activeThreshold: 0.008, frameSeconds: 0.25 });
  assert.ok(mixSignal.rms >= 0.01, `audio is effectively silent: rms=${mixSignal.rms}`);
  assert.ok(mixSignal.peak >= 0.08, `audio has insufficient peak energy: peak=${mixSignal.peak}`);
  assert.ok(mixSignal.activeRatio >= 0.55, `too much silence: activeRatio=${mixSignal.activeRatio}`);
  assert.ok(mixSignal.clipRatio <= 0.03, `audio is excessively clipped: clipRatio=${mixSignal.clipRatio}`);

  const liveToken = auth.session?.accessToken || session.accessToken;
  const stemResponse = await fetchImpl(`${SUPABASE_URL}/functions/v1/compute-kaggle-v54`, {
    method: 'POST',
    headers: authHeaders(liveToken, true),
    body: JSON.stringify({ project_id: linked.project.id, source_asset_id: result.asset.id }),
  });
  const stemDispatch = await stemResponse.json().catch(() => ({}));
  assert.equal(stemResponse.ok, true, `vocal separation dispatch failed: ${stemDispatch?.error || stemResponse.status}`);
  assert.equal(stemDispatch?.ok, true, `vocal separation rejected: ${stemDispatch?.error || 'unknown'}`);
  assert.ok(stemDispatch?.job_id, 'vocal separation job id missing');

  const stemJob = await waitForStemJob(liveToken, stemDispatch.job_id);
  const stemAssets = await getStemAssets(liveToken, stemJob);
  const vocalAsset = stemAssets.find((asset) => asset.kind === 'guide_vocal');
  assert.ok(vocalAsset?.id, 'verified vocal stem asset missing');
  const vocalDownload = await downloadStem(liveToken, vocalAsset);
  const vocalPath = `${outDir}/vocal-stem.wav`;
  fs.writeFileSync(vocalPath, Buffer.from(await vocalDownload.blob.arrayBuffer()));
  const vocalSignal = measurePcm(decodePcm(vocalPath), { activeThreshold: 0.004, frameSeconds: 0.05 });
  const vocalPresence = evaluateVocalPresence({ vocal: vocalSignal, mix: mixSignal, vocalAsset, job: stemJob });
  fs.writeFileSync(`${outDir}/vocal-audit.json`, JSON.stringify({
    ...vocalPresence,
    stem_job_id: stemJob.id,
    vocal_asset_id: vocalAsset.id,
    vocal_sha256: vocalDownload.sha256,
    engine: stemJob.proof?.engine || stemJob.engine || 'Demucs',
    model: stemJob.proof?.model || vocalAsset.metadata?.model || 'htdemucs',
    lyric_adherence: 'pending_transcription',
    progress: vocalProgress,
  }, null, 2));
  assert.equal(vocalPresence.ok, true, `generated song has no verified acoustic vocal: ${vocalPresence.code || 'unknown'}`);

  const evidence = {
    verdict: 'REAL_COMPOSITION_PATH_VERIFIED',
    acoustic_vocal_verdict: 'ACOUSTIC_VOCAL_PRESENCE_VERIFIED',
    lyric_adherence: 'pending_transcription',
    github_sha: process.env.GITHUB_SHA,
    local_project_id: localProject.id,
    remote_project_id: linked.project.id,
    request_id: result.requestId || null,
    remote_asset_id: result.asset.id,
    provider: result.provider || null,
    model: result.model || null,
    model_revision: result.modelRevision || null,
    source: result.source || null,
    audio_sha256: result.sha256 || null,
    audio_bytes: result.blob.size,
    duration_seconds: duration,
    sample_rate: sampleRate,
    channels,
    generation_seed: result?.job?.proof?.generation_seed ?? null,
    generation_shift: result?.job?.proof?.generation_shift ?? null,
    signal: {
      rms: round(mixSignal.rms),
      peak: round(mixSignal.peak),
      active_ratio: Number(mixSignal.activeRatio.toFixed(4)),
      clip_ratio: round(mixSignal.clipRatio),
      rms_contrast: round(mixSignal.rmsContrast),
    },
    vocal_audit: {
      stem_job_id: stemJob.id,
      vocal_asset_id: vocalAsset.id,
      vocal_sha256: vocalDownload.sha256,
      code: vocalPresence.code,
      checks: vocalPresence.checks,
      metrics: vocalPresence.metrics,
      thresholds: vocalPresence.thresholds,
      engine: stemJob.proof?.engine || stemJob.engine || 'Demucs',
      model: stemJob.proof?.model || vocalAsset.metadata?.model || 'htdemucs',
    },
    ai_direction: {
      chars: String(result.aiDirection.text).length,
      provider: result.aiDirection.provider || null,
      model: result.aiDirection.model || null,
    },
    director: result.director,
    progress,
  };
  fs.writeFileSync(`${outDir}/evidence.json`, JSON.stringify(evidence, null, 2));
  fs.writeFileSync(`${outDir}/probe.json`, JSON.stringify(probe, null, 2));
  console.log('PV_REAL_COMPOSITION_OK', JSON.stringify(evidence));
} catch (error) {
  fs.writeFileSync(`${outDir}/failure.json`, JSON.stringify({
    verdict: 'REAL_COMPOSITION_FAILED',
    github_sha: process.env.GITHUB_SHA,
    local_project_id: localProject?.id || null,
    remote_project_id: linked?.project?.id || null,
    error: String(error?.message || error),
    stack: String(error?.stack || '').slice(0, 6000),
    progress,
    vocal_progress: vocalProgress,
  }, null, 2));
  throw error;
}
