import { createClient } from 'npm:@supabase/supabase-js@2.112.2'

const APPLIO_COMMIT = '085197e738ce9dd4c0bae1e0a74df5de25b89444'
const IDENTITY_THRESHOLD = 0.8
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})
const uuid = (value: unknown) => /^[0-9a-f-]{36}$/i.test(String(value || ''))
const shaOk = (value: unknown) => /^[0-9a-f]{64}$/i.test(String(value || ''))
function token() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('')
}
function b64(value: string) { return btoa(unescape(encodeURIComponent(value))) }
function sameIds(left: unknown, right: unknown) {
  const normalize = (value: unknown) => Array.isArray(value)
    ? value.map((item: any) => String(item?.id ?? item)).filter(Boolean).sort()
    : []
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}
async function kaggleRpc(secret: string, method: string, payload: unknown) {
  const response = await fetch(`https://api.kaggle.com/v1/kernels.KernelsApiService/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', 'user-agent': 'PabloVoice-Studio/voice-train-v1' },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  let json: any = {}
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 2000) } }
  if (!response.ok || json?.hasError === true || json?.error || Number(json?.code || 0) >= 400) {
    throw new Error(`Kaggle ${method}: ${json?.error?.message || json?.error || json?.message || text.slice(0, 700)}`)
  }
  return json
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return out({ ok: false, error: 'method_not_allowed' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL') || ''
    const pubs = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}')
    const secs = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
    const pub = pubs.default || Deno.env.get('SUPABASE_ANON_KEY') || ''
    const secret = secs.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!url || !pub || !secret) return out({ ok: false, error: 'server_configuration_error' }, 500)

    const auth = req.headers.get('authorization') || ''
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!jwt) return out({ ok: false, error: 'auth_required' }, 401)
    const userClient = createClient(url, pub, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } })
    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: ud, error: ue } = await userClient.auth.getUser(jwt)
    const user = ud?.user
    if (ue || !user) return out({ ok: false, error: 'invalid_session' }, 401)

    const body = await req.json().catch(() => ({}))
    const action = String(body.action || 'status')
    const projectId = String(body.project_id || '')
    if (!uuid(projectId)) return out({ ok: false, error: 'invalid_project_id' }, 400)
    const { data: project } = await admin.from('projects').select('id,title').eq('id', projectId).eq('user_id', user.id).maybeSingle()
    if (!project) return out({ ok: false, error: 'project_access_denied' }, 403)

    const activeStates = ['created','waiting_gpu','waiting_kaggle','queued','dispatched','provisioning','training','uploading','finalizing','retrying','stalled']
    const active = async () => {
      const { data } = await admin.from('render_jobs').select('*').eq('user_id', user.id).eq('job_type', 'voice_model_training').in('status', activeStates).order('created_at', { ascending: false }).limit(1)
      return data?.[0] || null
    }
    if (action === 'status') {
      const { data: jobs } = await admin.from('render_jobs').select('*').eq('user_id', user.id).eq('job_type', 'voice_model_training').order('created_at', { ascending: false }).limit(1)
      const { data: models } = await admin.from('voice_models').select('id,name,status,is_active,pth_sha256,index_sha256,metadata,created_at,updated_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(12)
      return out({ ok: true, active_job: await active(), latest_job: jobs?.[0] || null, models: models || [] })
    }
    if (action !== 'dispatch') return out({ ok: false, error: 'unsupported_action' }, 400)

    const sourceIds = Array.isArray(body.source_asset_ids) ? [...new Set(body.source_asset_ids.map(String))] : []
    if (sourceIds.length < 2 || sourceIds.length > 4 || sourceIds.some((id: string) => !uuid(id))) return out({ ok: false, error: 'two_to_four_source_assets_required' }, 400)
    const guideId = String(body.validation_guide_asset_id || '')
    if (!uuid(guideId) || sourceIds.includes(guideId)) return out({ ok: false, error: 'separate_validation_guide_required' }, 400)
    const regionStart = Number(body.validation_region_start_seconds ?? 64)
    const regionEnd = Number(body.validation_region_end_seconds ?? 72)
    if (!Number.isFinite(regionStart) || !Number.isFinite(regionEnd) || regionStart < 0 || regionEnd <= regionStart || regionEnd - regionStart < 4 || regionEnd - regionStart > 20) return out({ ok: false, error: 'invalid_validation_region' }, 400)

    const existing = await active()
    if (existing) {
      const existingValidation = existing.parameters?.validation || {}
      const identicalBinding = String(existing.project_id || '') === projectId
        && sameIds(existing.parameters?.source_assets, sourceIds)
        && String(existingValidation.guide_asset_id || '') === guideId
        && Number(existingValidation.region?.start_seconds) === regionStart
        && Number(existingValidation.region?.end_seconds) === regionEnd
      if (identicalBinding) return out({ ok: true, deduplicated: true, job_id: existing.id, status: existing.status })
      return out({ ok: false, error: 'voice_training_conflict', active_job_id: existing.id, active_project_id: existing.project_id }, 409)
    }

    const { data: sources, error: se } = await admin.from('audio_assets').select('*').in('id', sourceIds).eq('user_id', user.id)
    if (se) throw se
    if ((sources || []).length !== sourceIds.length) return out({ ok: false, error: 'source_asset_missing_or_not_owned' }, 409)
    const ordered = sourceIds.map((id: string) => sources!.find((a: any) => a.id === id))
    for (const source of ordered) {
      if (!source || !['take','recording','source'].includes(String(source.kind || '')) || !shaOk(source.sha256) || Number(source.duration_seconds || 0) < 20) {
        return out({ ok: false, error: 'source_asset_not_training_eligible', asset_id: source?.id || null }, 409)
      }
    }
    const uniqueHashes = new Set(ordered.map((a: any) => String(a.sha256).toLowerCase()))
    if (uniqueHashes.size !== ordered.length) return out({ ok: false, error: 'duplicate_training_source_rejected' }, 409)

    const { data: guide } = await admin.from('audio_assets').select('*').eq('id', guideId).eq('user_id', user.id).eq('project_id', projectId).eq('kind', 'guide_vocal').maybeSingle()
    if (!guide || !shaOk(guide.sha256)) return out({ ok: false, error: 'validation_guide_missing_or_unverified' }, 409)

    const { data: activeModels, error: ame } = await admin.from('voice_models').select('id').eq('user_id', user.id).eq('is_active', true).eq('status', 'ready').order('updated_at', { ascending: false }).limit(2)
    if (ame) throw ame
    if ((activeModels || []).length !== 1 || !uuid(activeModels?.[0]?.id)) return out({ ok: false, error: 'single_active_voice_model_required' }, 409)
    const activeModel = activeModels![0]
    const { data: refs, error: re } = await admin.from('voice_identity_references').select('id,asset_id,source_sha256,label,voice_model_id').eq('user_id', user.id).eq('voice_model_id', activeModel.id).eq('is_active', true).order('updated_at', { ascending: false }).limit(2)
    if (re) throw re
    if ((refs || []).length !== 1) return out({ ok: false, error: 'single_active_identity_reference_required' }, 409)
    const reference = refs![0]
    if (!uuid(reference.id) || !uuid(reference.asset_id) || !shaOk(reference.source_sha256)) return out({ ok: false, error: 'active_identity_reference_required' }, 409)
    const { data: referenceAsset } = await admin.from('audio_assets').select('id,sha256').eq('id', reference.asset_id).eq('user_id', user.id).maybeSingle()
    if (!referenceAsset || String(referenceAsset.sha256 || '').toLowerCase() !== String(reference.source_sha256).toLowerCase()) return out({ ok: false, error: 'identity_reference_asset_mismatch' }, 409)

    const { data: connRows, error: ce } = await admin.rpc('admin_get_compute_connection', { p_user_id: user.id, p_provider: 'kaggle' })
    if (ce) throw ce
    const conn = Array.isArray(connRows) ? connRows[0] : null
    if (!conn?.secret || !conn?.handle) return out({ ok: false, error: 'kaggle_not_connected' }, 409)

    const ttl = 10800
    async function signedDownload(asset: any) {
      const { data, error } = await admin.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, ttl)
      if (error || !data?.signedUrl) throw error || new Error('signed_download_failed')
      return data.signedUrl
    }
    const jobId = crypto.randomUUID()
    const modelId = crypto.randomUUID()
    const validationAssetId = crypto.randomUUID()
    const callback = token()
    const callbackHash = await sha256(callback)
    const expiresAt = Math.floor(Date.now() / 1000) + ttl
    const modelName = `PabloVoice Candidate ${jobId.replace(/-/g, '').slice(0, 8)}`
    const storageBase = `${user.id}/${modelId}`
    const partUploads: any[] = []
    for (let order = 0; order < 4; order++) {
      const path = `${storageBase}/parts/PabloVoice.part${String(order).padStart(3, '0')}`
      const { data, error } = await admin.storage.from('voice-models-private').createSignedUploadUrl(path)
      if (error || !data?.token) throw error || new Error('signed_model_part_upload_failed')
      partUploads.push({ order, path, token: data.token })
    }
    const indexPath = `${storageBase}/PabloVoice.index`
    const { data: indexUpload, error: ie } = await admin.storage.from('voice-models-private').createSignedUploadUrl(indexPath)
    if (ie || !indexUpload?.token) throw ie || new Error('signed_index_upload_failed')
    const validationPath = `${user.id}/${projectId}/renders/${jobId}-candidate-identity-validation.flac`
    const { data: validationUpload, error: ve } = await admin.storage.from('audio-private').createSignedUploadUrl(validationPath)
    if (ve || !validationUpload?.token) throw ve || new Error('signed_validation_upload_failed')

    const signedSources = []
    for (const source of ordered) signedSources.push({ id: source.id, sha256: String(source.sha256).toLowerCase(), url: await signedDownload(source), original_name: source.original_name, duration_seconds: Number(source.duration_seconds || 0) })
    const settings = {
      sample_rate: 48000,
      f0_method: 'rmvpe',
      embedder_model: 'contentvec',
      total_epoch: 200,
      batch_size: 6,
      save_every_epoch: 25,
      index_algorithm: 'Auto',
      vocoder: 'HiFi-GAN',
      pretrained: true,
      checkpointing: true,
      cut_preprocess: 'Automatic',
      chunk_len: 3.0,
      overlap_len: 0.3,
      normalization_mode: 'none',
      noise_reduction: false,
    }
    const validation = {
      guide_asset_id: guide.id,
      guide_sha256: String(guide.sha256).toLowerCase(),
      region: { start_seconds: regionStart, end_seconds: regionEnd, duration_seconds: regionEnd - regionStart },
      output_asset_id: validationAssetId,
      output_path: validationPath,
      source_voice_model_id: activeModel.id,
      reference_id: reference.id,
      reference_asset_id: reference.asset_id,
      reference_sha256: String(reference.source_sha256).toLowerCase(),
      identity_threshold: IDENTITY_THRESHOLD,
    }
    const parameters = {
      candidate_model_id: modelId,
      candidate_model_name: modelName,
      source_assets: signedSources.map(({ url: _url, ...source }) => source),
      applio_commit: APPLIO_COMMIT,
      settings,
      validation,
      callback_hash: callbackHash,
      callback_expires_at: expiresAt,
      output_base: storageBase,
      worker_version: 'voice-train-v1',
      activation_policy: 'inactive_until_verified_ecapa_gte_0_8',
    }
    const { error: je } = await admin.from('render_jobs').insert({
      id: jobId,
      project_id: projectId,
      user_id: user.id,
      job_type: 'voice_model_training',
      engine: 'kaggle_applio_rvc_train_v1',
      provider: 'kaggle',
      status: 'created',
      progress: 5,
      current_stage: 'created',
      human_message: 'Preparando modelo vocal candidato',
      input_asset_ids: [...sourceIds, guide.id, reference.asset_id],
      output_asset_ids: [],
      parameters,
      proof: { required: true, activation_forbidden_before_identity_gate: true, identity_threshold: IDENTITY_THRESHOLD },
      started_at: new Date().toISOString(),
      attempt_number: 1,
    })
    if (je) throw je

    const ticket = {
      version: 2,
      job_id: jobId,
      project_id: projectId,
      user_id: user.id,
      candidate_model_id: modelId,
      candidate_model_name: modelName,
      sources: signedSources,
      applio_commit: APPLIO_COMMIT,
      settings,
      validation: {
        guide_asset_id: guide.id,
        guide_sha256: String(guide.sha256).toLowerCase(),
        guide_url: await signedDownload(guide),
        region: validation.region,
        output: { asset_id: validationAssetId, bucket: 'audio-private', path: validationPath, token: validationUpload.token },
      },
      outputs: { bucket: 'voice-models-private', parts: partUploads, index: { path: indexPath, token: indexUpload.token } },
      supabase_url: url,
      supabase_publishable_key: pub,
      complete_url: `${url}/functions/v1/complete-kaggle-voice-train-v1`,
      callback_token: callback,
      expires_at: expiresAt,
    }
    const short = jobId.replace(/-/g, '').slice(0, 10)
    const slug = `pablovoice-train-${short}`
    const owner = String(conn.handle)
    const bootstrap = `import requests,base64\nTICKET_B64='${b64(JSON.stringify(ticket))}'\nr=requests.get('${url}/functions/v1/kaggle-voice-train-worker-v1',timeout=60);r.raise_for_status()\nexec(compile(r.text,'pablovoice_voice_train_v1.py','exec'),globals(),globals())\n`
    const payload = {
      slug: `${owner}/${slug}`,
      newTitle: `PabloVoice candidate train ${short}`,
      text: bootstrap,
      language: 'python', kernelType: 'script', isPrivate: true,
      enableGpu: true, enableInternet: true, machineShape: 'NvidiaTeslaT4', kernelExecutionType: 'SAVE_AND_RUN_ALL',
      datasetDataSources: [], competitionDataSources: [], kernelDataSources: [], modelDataSources: [],
      sessionTimeoutSeconds: ttl,
    }
    let push: any
    try { push = await kaggleRpc(conn.secret, 'SaveKernel', payload) }
    catch (error) {
      const message = String(error instanceof Error ? error.message : error).slice(0, 1000)
      await admin.from('render_jobs').update({ status: 'error', progress: 0, current_stage: 'error', error_code: 'dispatch_failed', error_message: message, technical_error: message, finished_at: new Date().toISOString() }).eq('id', jobId)
      return out({ ok: false, error: 'kaggle_dispatch_failed', detail: message, job_id: jobId }, 502)
    }
    if (!push?.kernelId || push?.hasError || push?.error) {
      const message = String(push?.error?.message || push?.error || 'Kaggle did not return kernelId')
      await admin.from('render_jobs').update({ status: 'error', progress: 0, current_stage: 'error', error_code: 'dispatch_rejected', error_message: message, finished_at: new Date().toISOString() }).eq('id', jobId)
      return out({ ok: false, error: 'kaggle_dispatch_rejected', detail: message, job_id: jobId }, 409)
    }
    await admin.from('render_jobs').update({
      status: 'waiting_gpu', progress: 8, current_stage: 'waiting_gpu', human_message: 'Aguardando GPU para treinar modelo candidato',
      external_job_id: String(push.kernelId),
      parameters: { ...parameters, kaggle_owner: owner, kaggle_slug: slug, kaggle_ref: push.ref || `/code/${owner}/${slug}`, kaggle_url: push.url || null, kaggle_kernel_id: push.kernelId, kaggle_version_number: push.versionNumber || null },
    }).eq('id', jobId)
    return out({ ok: true, job_id: jobId, status: 'waiting_gpu', candidate_model_id: modelId, candidate_model_name: modelName, validation_asset_id: validationAssetId, kernel: `${owner}/${slug}`, activation_policy: parameters.activation_policy })
  } catch (error) {
    return out({ ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 1400) }, 500)
  }
})
