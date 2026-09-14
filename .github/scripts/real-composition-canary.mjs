import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { RemoteAuthAdapter } from '../../packages/app/remote-auth.mjs';
import { NativeMusicGenerationClient } from '../../packages/app/native-music-generation-client.mjs';
import { createSongCreationPlan } from '../../packages/app/song-creation-engine.mjs';

const ORIGIN = process.env.PV_STUDIO_ORIGIN || 'https://studia-voice.ppatrickxxz.workers.dev';
const outDir = 'test-results/real-composition';
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

function decodePcm(filePath) {
  const run = spawnSync('ffmpeg', ['-v', 'error', '-i', filePath, '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'], {
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(run.status, 0, String(run.stderr || 'ffmpeg decode failed'));
  return run.stdout;
}

function round(value) {
  return Number((Number(value) || 0).toFixed(6));
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function evaluateVocalPresence({ vocal, mix } = {}) {
  const vocalRms = Number(vocal?.rms || 0);
  const mixRms = Number(mix?.rms || 0);
  const ratio = mixRms > 0 ? vocalRms / mixRms : 0;
  const activeRatio = Number(vocal?.activeRatio || 0);
  const peak = Number(vocal?.peak || 0);
  const duration = Number(vocal?.duration || 0);
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
  return Object.freeze({
    ok: Object.values(checks).every(Boolean),
    code: Object.values(checks).every(Boolean) ? 'vocal_presence_verified' : 'vocal_presence_not_verified',
    checks,
    metrics,
    thresholds: VOCAL_THRESHOLDS,
  });
}

function separateWithDemucs(audioPath) {
  const demucsRoot = path.join(outDir, 'demucs');
  vocalProgress.push({ stage: 'demucs_start', engine: 'Demucs', model: 'htdemucs' });
  console.log('PV_VOCAL_AUDIT_PROGRESS', JSON.stringify(vocalProgress.at(-1)));
  const run = spawnSync('python', [
    '-m', 'demucs',
    '--device', 'cpu',
    '--two-stems', 'vocals',
    '-n', 'htdemucs',
    '-o', demucsRoot,
    audioPath,
  ], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`demucs_failed: ${String(run.stderr || run.stdout || '').slice(-4000)}`);
  }
  const songDir = path.join(demucsRoot, 'htdemucs', 'composition');
  const vocalSource = path.join(songDir, 'vocals.wav');
  const instrumentalSource = path.join(songDir, 'no_vocals.wav');
  assert.ok(fs.existsSync(vocalSource), 'Demucs vocal stem missing');
  assert.ok(fs.existsSync(instrumentalSource), 'Demucs instrumental stem missing');
  const vocalPath = path.join(outDir, 'vocal-stem.wav');
  const instrumentalPath = path.join(outDir, 'instrumental-stem.wav');
  fs.copyFileSync(vocalSource, vocalPath);
  fs.copyFileSync(instrumentalSource, instrumentalPath);
  vocalProgress.push({ stage: 'demucs_complete', engine: 'Demucs', model: 'htdemucs' });
  console.log('PV_VOCAL_AUDIT_PROGRESS', JSON.stringify(vocalProgress.at(-1)));
  return { vocalPath, instrumentalPath };
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

  const separated = separateWithDemucs(audioPath);
  const vocalSignal = measurePcm(decodePcm(separated.vocalPath), { activeThreshold: 0.004, frameSeconds: 0.05 });
  const vocalPresence = evaluateVocalPresence({ vocal: vocalSignal, mix: mixSignal });
  const vocalSha256 = sha256File(separated.vocalPath);
  const instrumentalSha256 = sha256File(separated.instrumentalPath);
  fs.writeFileSync(`${outDir}/vocal-audit.json`, JSON.stringify({
    ...vocalPresence,
    engine: 'Demucs',
    model: 'htdemucs',
    execution: 'github_runner_cpu',
    source_audio_sha256: result.sha256 || sha256File(audioPath),
    vocal_sha256: vocalSha256,
    instrumental_sha256: instrumentalSha256,
    lyric_adherence: 'pending_transcription',
    progress: vocalProgress,
  }, null, 2));
  assert.equal(vocalPresence.ok, true, `generated song has no verified acoustic vocal: ${vocalPresence.code}`);

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
    audio_sha256: result.sha256 || sha256File(audioPath),
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
      code: vocalPresence.code,
      checks: vocalPresence.checks,
      metrics: vocalPresence.metrics,
      thresholds: vocalPresence.thresholds,
      engine: 'Demucs',
      model: 'htdemucs',
      execution: 'github_runner_cpu',
      vocal_sha256: vocalSha256,
      instrumental_sha256: instrumentalSha256,
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
