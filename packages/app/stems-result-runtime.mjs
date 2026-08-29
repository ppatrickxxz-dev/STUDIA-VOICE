import { createTrack } from '../core/src/project.mjs';
import { saveAudioAsset, saveProject } from './storage.mjs';

const PROJECT_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const TERMINAL = new Set(['completed', 'error', 'failed', 'cancelled']);
const EXPECTED_KINDS = new Set(['guide_vocal', 'instrumental']);

function authHeaders(token = '') {
  const headers = { apikey: PUBLISHABLE_KEY };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function encodedStoragePath(path = '') {
  return String(path).split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function readJson(response, label) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label}_${response.status}`);
  return data;
}

export async function getStandaloneStemsJob({ token, jobId, fetchImpl = globalThis.fetch }) {
  if (!token) throw new Error('auth_required');
  if (!jobId) throw new Error('job_id_required');
  const select = 'id,project_id,job_type,status,progress,engine,provider,external_job_id,input_asset_ids,output_asset_ids,parameters,proof,error_message,created_at,started_at,finished_at';
  const url = `${PROJECT_URL}/rest/v1/render_jobs?select=${encodeURIComponent(select)}&id=eq.${encodeURIComponent(jobId)}&limit=1`;
  const rows = await readJson(await fetchImpl(url, { headers: authHeaders(token) }), 'job_lookup');
  const job = Array.isArray(rows) ? rows[0] : null;
  if (!job) throw new Error('job_not_found');
  if (job.job_type !== 'stems') throw new Error('job_type_mismatch');
  return job;
}

export async function waitForStandaloneStems({ token, jobId, fetchImpl = globalThis.fetch, pollIntervalMs = 5000, maxWaitMs = 30 * 60 * 1000, onProgress = () => {} }) {
  const started = Date.now();
  for (;;) {
    const job = await getStandaloneStemsJob({ token, jobId, fetchImpl });
    onProgress(job);
    if (TERMINAL.has(String(job.status))) {
      if (job.status !== 'completed') throw new Error(job.error_message || `stems_job_${job.status}`);
      if (!Array.isArray(job.output_asset_ids) || job.output_asset_ids.length !== 2) throw new Error('stems_outputs_incomplete');
      return job;
    }
    if (Date.now() - started >= maxWaitMs) throw new Error('stems_job_timeout');
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export async function getStandaloneStemsAssets({ token, job, fetchImpl = globalThis.fetch }) {
  const ids = Array.isArray(job?.output_asset_ids) ? job.output_asset_ids.map(String).filter(Boolean) : [];
  if (ids.length !== 2) throw new Error('stems_outputs_incomplete');
  const idList = ids.join(',');
  const select = 'id,project_id,kind,storage_bucket,storage_path,original_name,mime_type,size_bytes,duration_seconds,sample_rate,channels,bit_depth,sha256,metadata,created_at';
  const url = `${PROJECT_URL}/rest/v1/audio_assets?select=${encodeURIComponent(select)}&id=in.(${encodeURIComponent(idList)})`;
  const rows = await readJson(await fetchImpl(url, { headers: authHeaders(token) }), 'asset_lookup');
  if (!Array.isArray(rows) || rows.length !== 2) throw new Error('stems_asset_rows_incomplete');
  const byId = new Map(rows.map((asset) => [String(asset.id), asset]));
  const ordered = ids.map((id) => byId.get(id));
  if (ordered.some((asset) => !asset)) throw new Error('stems_asset_association_mismatch');
  for (const asset of ordered) {
    if (String(asset.project_id) !== String(job.project_id)) throw new Error('stems_asset_project_mismatch');
    if (!EXPECTED_KINDS.has(String(asset.kind))) throw new Error('unexpected_stem_kind');
    if (asset.storage_bucket !== 'audio-private') throw new Error('unexpected_stem_bucket');
    if (!/^[0-9a-f]{64}$/i.test(String(asset.sha256 || ''))) throw new Error('stem_sha256_missing');
  }
  if (new Set(ordered.map((asset) => asset.kind)).size !== 2) throw new Error('duplicate_stem_kind');
  return ordered;
}

export async function downloadPrivateStem({ token, asset, fetchImpl = globalThis.fetch }) {
  const url = `${PROJECT_URL}/storage/v1/object/authenticated/${encodeURIComponent(asset.storage_bucket)}/${encodedStoragePath(asset.storage_path)}`;
  const response = await fetchImpl(url, { headers: authHeaders(token) });
  if (!response.ok) throw new Error(`stem_download_${response.status}`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('stem_download_empty');
  if (Number.isFinite(Number(asset.size_bytes)) && Number(asset.size_bytes) > 0 && blob.size !== Number(asset.size_bytes)) throw new Error('stem_size_mismatch');
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  if (hash.toLowerCase() !== String(asset.sha256).toLowerCase()) throw new Error('stem_sha256_mismatch');
  return { blob, sha256: hash };
}

export async function inspectAudioBlob(blob) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) throw new Error('web_audio_unavailable');
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData((await blob.arrayBuffer()).slice(0));
    return { duration: decoded.duration, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels };
  } finally {
    await context.close().catch(() => {});
  }
}

export async function importStandaloneStems({ token, job, project, fetchImpl = globalThis.fetch, inspectImpl = inspectAudioBlob }) {
  if (!project?.id) throw new Error('local_project_required');
  const assets = await getStandaloneStemsAssets({ token, job, fetchImpl });
  const existing = new Set((project.tracks || []).map((track) => `${track.renderJobId || ''}:${track.remoteAssetId || ''}`));
  const imported = [];
  const nextTracks = [...(project.tracks || [])];

  for (const remoteAsset of assets) {
    const association = `${job.id}:${remoteAsset.id}`;
    if (existing.has(association)) continue;
    const downloaded = await downloadPrivateStem({ token, asset: remoteAsset, fetchImpl });
    const measured = await inspectImpl(downloaded.blob);
    const localAssetId = `remote_${remoteAsset.id}`;
    const displayName = remoteAsset.kind === 'guide_vocal' ? 'Stem · Vocal' : 'Stem · Instrumental';
    await saveAudioAsset({ id: localAssetId, blob: downloaded.blob, name: remoteAsset.original_name || `${displayName}.wav`, type: remoteAsset.mime_type || 'audio/wav', createdAt: Date.now() });
    const track = {
      ...createTrack({ name: displayName, assetId: localAssetId, type: remoteAsset.mime_type || 'audio/wav', duration: measured.duration, sampleRate: measured.sampleRate, channels: measured.channels }),
      stemType: remoteAsset.kind === 'guide_vocal' ? 'vocal' : 'instrumental', renderJobId: job.id, remoteAssetId: remoteAsset.id, remoteProjectId: job.project_id,
      remoteSha256: downloaded.sha256, remoteCreatedAt: remoteAsset.created_at, provider: job.provider || 'kaggle',
      engine: job.proof?.engine || job.engine || 'Demucs', model: job.proof?.model || remoteAsset.metadata?.model || 'htdemucs',
    };
    nextTracks.push(track);
    imported.push({ trackId: track.id, localAssetId, remoteAssetId: remoteAsset.id, kind: remoteAsset.kind, name: remoteAsset.original_name, format: remoteAsset.mime_type || 'audio/wav', duration: measured.duration, sampleRate: measured.sampleRate, channels: measured.channels, sizeBytes: downloaded.blob.size, sha256: downloaded.sha256, jobId: job.id, provider: track.provider, engine: track.engine, model: track.model, createdAt: remoteAsset.created_at });
  }

  if (imported.length) {
    project.tracks = nextTracks;
    project.activeTrackId = imported[0].trackId;
    project.updatedAt = Date.now();
    await saveProject(project);
  }
  return { project, imported, assets };
}

export const STANDALONE_STEMS_RESULT_RUNTIME = Object.freeze({ expectedKinds: ['guide_vocal', 'instrumental'], bucket: 'audio-private', terminalStates: [...TERMINAL] });
