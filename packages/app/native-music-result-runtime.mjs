const PROJECT_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const TERMINAL = new Set(['completed', 'error', 'failed', 'cancelled']);
const MUSIC_JOB_TYPES = new Set(['music_generation', 'music_repaint']);

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
  if (!response.ok) throw new Error(data?.error || `${label}_${response.status}`);
  return data;
}
async function sha256Blob(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function getNativeMusicJob({ token, jobId, expectedJobType = null, fetchImpl = globalThis.fetch }) {
  if (!token) throw new Error('auth_required');
  if (!jobId) throw new Error('job_id_required');
  const select = 'id,project_id,job_type,status,progress,engine,provider,external_job_id,output_asset_ids,parameters,proof,error_code,error_message,human_message,current_stage,created_at,started_at,finished_at';
  const url = `${PROJECT_URL}/rest/v1/render_jobs?select=${encodeURIComponent(select)}&id=eq.${encodeURIComponent(jobId)}&limit=1`;
  const rows = await readJson(await fetchImpl(url, { headers: authHeaders(token) }), 'job_lookup');
  const job = Array.isArray(rows) ? rows[0] : null;
  if (!job) throw new Error('job_not_found');
  if (!MUSIC_JOB_TYPES.has(String(job.job_type))) throw new Error('job_type_mismatch');
  if (expectedJobType && String(job.job_type) !== String(expectedJobType)) throw new Error('job_type_mismatch');
  return job;
}

export async function waitForNativeMusic({ token, jobId, expectedJobType = null, fetchImpl = globalThis.fetch, pollIntervalMs = 5000, maxWaitMs = 45 * 60 * 1000, onProgress = () => {} }) {
  const started = Date.now();
  for (;;) {
    const job = await getNativeMusicJob({ token, jobId, expectedJobType, fetchImpl });
    onProgress(job);
    if (TERMINAL.has(String(job.status))) {
      if (job.status !== 'completed') throw new Error(job.error_message || job.error_code || `music_job_${job.status}`);
      if (!Array.isArray(job.output_asset_ids) || job.output_asset_ids.length !== 1) throw new Error('music_output_incomplete');
      if (job.proof?.verified !== true) throw new Error('music_proof_missing');
      if (job.job_type === 'music_repaint' && job.proof?.task_type !== 'repaint') throw new Error('music_repaint_proof_missing');
      return job;
    }
    if (Date.now() - started >= maxWaitMs) throw new Error('music_job_timeout');
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export async function getNativeMusicAsset({ token, job, fetchImpl = globalThis.fetch }) {
  const id = String(job?.output_asset_ids?.[0] || '');
  if (!id) throw new Error('music_output_incomplete');
  const select = 'id,project_id,kind,storage_bucket,storage_path,original_name,mime_type,size_bytes,duration_seconds,sample_rate,channels,sha256,metadata,created_at';
  const url = `${PROJECT_URL}/rest/v1/audio_assets?select=${encodeURIComponent(select)}&id=eq.${encodeURIComponent(id)}&limit=1`;
  const rows = await readJson(await fetchImpl(url, { headers: authHeaders(token) }), 'asset_lookup');
  const asset = Array.isArray(rows) ? rows[0] : null;
  if (!asset) throw new Error('music_asset_missing');
  if (String(asset.project_id) !== String(job.project_id)) throw new Error('music_asset_project_mismatch');
  if (asset.kind !== 'full_mix') throw new Error('music_asset_kind_mismatch');
  if (asset.storage_bucket !== 'audio-private') throw new Error('music_asset_bucket_mismatch');
  if (!/^[0-9a-f]{64}$/i.test(String(asset.sha256 || ''))) throw new Error('music_asset_sha256_missing');
  return asset;
}

export async function downloadNativeMusic({ token, asset, fetchImpl = globalThis.fetch }) {
  const url = `${PROJECT_URL}/storage/v1/object/authenticated/${encodeURIComponent(asset.storage_bucket)}/${encodedStoragePath(asset.storage_path)}`;
  const response = await fetchImpl(url, { headers: authHeaders(token) });
  if (!response.ok) throw new Error(`music_download_${response.status}`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('music_download_empty');
  if (Number(asset.size_bytes) > 0 && blob.size !== Number(asset.size_bytes)) throw new Error('music_size_mismatch');
  const sha256 = await sha256Blob(blob);
  if (sha256.toLowerCase() !== String(asset.sha256).toLowerCase()) throw new Error('music_sha256_mismatch');
  return { blob, sha256 };
}

export async function resolveNativeMusicResult({ token, job, fetchImpl = globalThis.fetch }) {
  const asset = await getNativeMusicAsset({ token, job, fetchImpl });
  const downloaded = await downloadNativeMusic({ token, asset, fetchImpl });
  return {
    blob: downloaded.blob,
    type: asset.mime_type || downloaded.blob.type || 'audio/flac',
    sha256: downloaded.sha256,
    asset,
    job,
    provider: job.provider || 'kaggle',
    model: job.proof?.model || asset.metadata?.model || 'acestep-v15-turbo',
    modelRevision: job.proof?.model_revision || asset.metadata?.model_revision || null,
    requestId: job.id,
    remoteProjectId: job.project_id,
    source: job.job_type === 'music_repaint' ? 'pablovoice_native_music_repaint_v1' : 'pablovoice_native_music_v1',
  };
}

export const NATIVE_MUSIC_RESULT_RUNTIME = Object.freeze({
  schema: 'pablovoice_native_music_result_v2',
  jobTypes: [...MUSIC_JOB_TYPES],
  outputKind: 'full_mix',
  bucket: 'audio-private',
  terminalStates: [...TERMINAL],
});
