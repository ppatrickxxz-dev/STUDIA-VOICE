import { waitForStandaloneStems, getStandaloneStemsAssets, downloadPrivateStem } from './stems-result-runtime.mjs';

const PROJECT_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const DISPATCHER = 'compute-kaggle-v54';

function headers(token = '') {
  return { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function dispatchVocalSeparation({ token, projectId, sourceAssetId, fetchImpl }) {
  const response = await fetchImpl(`${PROJECT_URL}/functions/v1/${DISPATCHER}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ project_id: projectId, source_asset_id: sourceAssetId }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true || !body?.job_id) {
    throw new Error(body?.error || `vocal_audit_dispatch_${response.status}`);
  }
  return body;
}

export async function auditGeneratedVocal({
  token,
  remoteProjectId,
  sourceAssetId,
  fullMixBlob,
  fetchImpl = globalThis.fetch,
  onProgress = () => {},
} = {}) {
  if (!token) return fail('auth_required', 'Não foi possível autenticar a auditoria vocal.');
  if (!remoteProjectId || !sourceAssetId) return fail('remote_asset_required', 'O áudio gerado não possui referência remota para auditar o vocal.');
  if (!fullMixBlob?.size) return fail('full_mix_required', 'O mix gerado não está disponível para comparação vocal.');

  try {
    onProgress({ stage: 'dispatch', message: 'Separando a voz para confirmar que a versão realmente canta…' });
    const dispatched = await dispatchVocalSeparation({ token, projectId: remoteProjectId, sourceAssetId, fetchImpl });
    const job = await waitForStandaloneStems({
      token,
      jobId: dispatched.job_id,
      fetchImpl,
      onProgress: (current) => onProgress({
        stage: 'separating',
        progress: Number(current?.progress || 0),
        message: `Confirmando vocal · ${Math.max(0, Math.round(Number(current?.progress || 0)))}%`,
      }),
    });
    const assets = await getStandaloneStemsAssets({ token, job, fetchImpl });
    const vocalAsset = assets.find((asset) => asset.kind === 'guide_vocal');
    if (!vocalAsset) return fail('vocal_stem_missing', 'A separação não encontrou um stem vocal verificável.');

    const downloaded = await downloadPrivateStem({ token, asset: vocalAsset, fetchImpl });
    const [vocal, mix] = await Promise.all([
      measureAudioBlob(downloaded.blob),
      measureAudioBlob(fullMixBlob),
    ]);
    const proof = evaluateVocalPresence({ vocal, mix, vocalAsset, job });
    if (!proof.ok) return proof;

    return Object.freeze({
      ...proof,
      dispatcher: DISPATCHER,
      stemJobId: job.id,
      vocalAssetId: vocalAsset.id,
      vocalSha256: downloaded.sha256,
      engine: job.proof?.engine || job.engine || 'Demucs',
      model: job.proof?.model || vocalAsset.metadata?.model || 'htdemucs',
      lyricAdherence: 'not_yet_transcribed',
    });
  } catch (error) {
    return fail('vocal_audit_failed', error?.message || 'A auditoria vocal falhou.');
  }
}

export function evaluateVocalPresence({ vocal, mix, vocalAsset = {}, job = {} } = {}) {
  const vocalRms = Number(vocal?.rms || 0);
  const mixRms = Number(mix?.rms || 0);
  const ratio = mixRms > 0 ? vocalRms / mixRms : 0;
  const activeRatio = Number(vocal?.activeRatio || 0);
  const peak = Number(vocal?.peak || 0);
  const duration = Number(vocal?.duration || vocalAsset?.duration_seconds || 0);

  const thresholds = Object.freeze({
    minRms: 0.0015,
    minPeak: 0.015,
    minActiveRatio: 0.02,
    minRmsVsMix: 0.04,
    minDurationSeconds: 8,
  });
  const checks = Object.freeze({
    rms: vocalRms >= thresholds.minRms,
    peak: peak >= thresholds.minPeak,
    activity: activeRatio >= thresholds.minActiveRatio,
    relativeLevel: ratio >= thresholds.minRmsVsMix,
    duration: duration >= thresholds.minDurationSeconds,
  });
  const passed = Object.values(checks).every(Boolean);
  const metrics = Object.freeze({
    vocalRms: round(vocalRms),
    mixRms: round(mixRms),
    vocalToMixRms: round(ratio),
    vocalPeak: round(peak),
    vocalActiveRatio: round(activeRatio),
    vocalDurationSeconds: round(duration),
  });

  if (!passed) {
    return Object.freeze({
      ok: false,
      code: 'vocal_presence_not_verified',
      message: 'A versão voltou sem presença vocal suficiente para ser aceita como música cantada.',
      checks,
      metrics,
      thresholds,
      stemJobId: job?.id || null,
    });
  }
  return Object.freeze({
    ok: true,
    code: 'vocal_presence_verified',
    message: 'Vocal acústico confirmado.',
    checks,
    metrics,
    thresholds,
  });
}

export async function measureAudioBlob(blob) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) throw new Error('web_audio_unavailable');
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData((await blob.arrayBuffer()).slice(0));
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    return measurePcmChannels(channels, decoded.sampleRate);
  } finally {
    await context.close().catch(() => {});
  }
}

export function measurePcmChannels(channels, sampleRate = 48000) {
  const valid = (Array.isArray(channels) ? channels : []).filter((channel) => channel?.length);
  if (!valid.length) return Object.freeze({ rms: 0, peak: 0, activeRatio: 0, duration: 0, sampleRate: Number(sampleRate) || 0 });
  const length = Math.min(...valid.map((channel) => channel.length));
  const stride = Math.max(1, Math.floor(length / 1_500_000));
  const frameSize = Math.max(256, Math.round((Number(sampleRate) || 48000) * 0.05));
  let sumSquares = 0;
  let samples = 0;
  let peak = 0;
  let activeFrames = 0;
  let frames = 0;

  for (let frameStart = 0; frameStart < length; frameStart += frameSize) {
    const frameEnd = Math.min(length, frameStart + frameSize);
    let frameSquares = 0;
    let frameSamples = 0;
    for (let index = frameStart; index < frameEnd; index += stride) {
      let mono = 0;
      for (const channel of valid) mono += Number(channel[index] || 0);
      mono /= valid.length;
      const abs = Math.abs(mono);
      if (abs > peak) peak = abs;
      const square = mono * mono;
      frameSquares += square;
      frameSamples += 1;
      sumSquares += square;
      samples += 1;
    }
    const frameRms = frameSamples ? Math.sqrt(frameSquares / frameSamples) : 0;
    if (frameRms >= 0.004) activeFrames += 1;
    frames += 1;
  }

  return Object.freeze({
    rms: samples ? Math.sqrt(sumSquares / samples) : 0,
    peak,
    activeRatio: frames ? activeFrames / frames : 0,
    duration: length / (Number(sampleRate) || 48000),
    sampleRate: Number(sampleRate) || 0,
  });
}

function fail(code, message) {
  return Object.freeze({ ok: false, code, message });
}

function round(value) {
  return Number((Number(value) || 0).toFixed(6));
}

export const GENERATED_VOCAL_AUDIT_POLICY = Object.freeze({
  schema: 'pablovoice_generated_vocal_audit_v1',
  separationEngine: 'Demucs/htdemucs',
  blocksInstrumentalMasqueradingAsVocalSong: true,
  lyricAdherenceRequiresTranscription: true,
});
