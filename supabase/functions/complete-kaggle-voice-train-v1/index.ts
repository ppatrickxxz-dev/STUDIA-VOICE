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
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return out({ ok: false, error: 'method_not_allowed' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL') || ''
    const secs = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
    const secret = secs.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!url || !secret) return out({ ok: false, error: 'server_configuration_error' }, 500)
    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
    const body = await req.json().catch(() => ({}))
    const jobId = String(body.job_id || '')
    const callbackToken = String(body.callback_token || '')
    if (!uuid(jobId) || callbackToken.length < 32) return out({ ok: false, error: 'invalid_callback' }, 400)
    const { data: job, error: je } = await admin.from('render_jobs').select('*').eq('id', jobId).eq('job_type', 'voice_model_training').maybeSingle()
    if (je) throw je
    if (!job) return out({ ok: false, error: 'job_not_found' }, 404)
    const parameters = job.parameters || {}
    const callbackHash = await sha256(callbackToken)
    if (callbackHash !== String(parameters.callback_hash || '')) return out({ ok: false, error: 'callback_token_mismatch' }, 403)
    if (Number(parameters.callback_expires_at || 0) < Math.floor(Date.now() / 1000)) return out({ ok: false, error: 'callback_expired' }, 410)

    const action = String(body.action || 'complete')
    if (action === 'progress') {
      if (job.status === 'completed') return out({ ok: true, already_completed: true })
      const stage = String(body.stage || 'training').slice(0, 80)
      const progress = Math.max(10, Math.min(95, Number(body.progress || 10)))
      await admin.from('render_jobs').update({ status: stage === 'uploading' ? 'uploading' : 'training', progress, current_stage: stage, human_message: String(body.message || 'Treinando modelo vocal candidato').slice(0, 300), heartbeat_at: new Date().toISOString() }).eq('id', jobId)
      return out({ ok: true })
    }
    if (action !== 'complete') return out({ ok: false, error: 'unsupported_action' }, 400)
    if (job.status === 'completed') return out({ ok: true, already_completed: true, proof: job.proof })

    const candidateModelId = String(body.candidate_model_id || '')
    if (!uuid(candidateModelId) || candidateModelId !== String(parameters.candidate_model_id || '')) return out({ ok: false, error: 'candidate_model_binding_mismatch' }, 409)
    if (String(body.applio_commit || '') !== APPLIO_COMMIT || String(parameters.applio_commit || '') !== APPLIO_COMMIT) return out({ ok: false, error: 'applio_commit_mismatch' }, 409)
    const sourceProof = Array.isArray(body.sources) ? body.sources : []
    const expectedSources = Array.isArray(parameters.source_assets) ? parameters.source_assets : []
    if (sourceProof.length !== expectedSources.length || sourceProof.length < 2) return out({ ok: false, error: 'source_proof_mismatch' }, 409)
    for (const expected of expectedSources) {
      const actual = sourceProof.find((source: any) => String(source.id) === String(expected.id))
      if (!actual || String(actual.sha256 || '').toLowerCase() !== String(expected.sha256 || '').toLowerCase()) return out({ ok: false, error: 'source_hash_mismatch', asset_id: expected.id }, 409)
    }

    const pthSha = String(body.pth_sha256 || '').toLowerCase()
    const indexSha = String(body.index_sha256 || '').toLowerCase()
    const pthSize = Number(body.pth_size_bytes || 0)
    const indexSize = Number(body.index_size_bytes || 0)
    if (!shaOk(pthSha) || !shaOk(indexSha) || pthSize < 1_000_000 || indexSize < 1_000) return out({ ok: false, error: 'model_artifact_invalid' }, 409)
    const parts = Array.isArray(body.pth_parts) ? body.pth_parts : []
    if (parts.length < 1 || parts.length > 4) return out({ ok: false, error: 'invalid_model_part_count' }, 409)
    const outputBase = String(parameters.output_base || '')
    let sum = 0
    for (let order = 0; order < parts.length; order++) {
      const part = parts[order]
      const expectedPath = `${outputBase}/parts/PabloVoice.part${String(order).padStart(3, '0')}`
      if (Number(part.order) !== order || String(part.path || '') !== expectedPath || !shaOk(part.sha256) || Number(part.size_bytes || 0) < 1 || Number(part.size_bytes || 0) > 25 * 1024 * 1024) return out({ ok: false, error: 'model_part_contract_mismatch', order }, 409)
      sum += Number(part.size_bytes)
    }
    if (sum !== pthSize) return out({ ok: false, error: 'model_part_size_sum_mismatch' }, 409)
    const expectedIndexPath = `${outputBase}/PabloVoice.index`
    if (String(body.index_path || '') !== expectedIndexPath) return out({ ok: false, error: 'index_path_mismatch' }, 409)

    const { data: partObjects, error: pe } = await admin.storage.from('voice-models-private').list(`${outputBase}/parts`, { limit: 10 })
    if (pe) throw pe
    for (const part of parts) {
      const name = String(part.path).split('/').pop()
      const object = (partObjects || []).find((entry: any) => entry.name === name)
      if (!object || Number(object.metadata?.size || 0) !== Number(part.size_bytes)) return out({ ok: false, error: 'model_part_not_persisted', path: part.path }, 409)
    }
    const { data: rootObjects, error: re } = await admin.storage.from('voice-models-private').list(outputBase, { limit: 20 })
    if (re) throw re
    const indexObject = (rootObjects || []).find((entry: any) => entry.name === 'PabloVoice.index')
    if (!indexObject || Number(indexObject.metadata?.size || 0) !== indexSize) return out({ ok: false, error: 'index_not_persisted' }, 409)

    const metadata = {
      client: 'voice-train-v1',
      storage_mode: 'multipart',
      pth_parts: parts,
      pth_size: pthSize,
      index_size: indexSize,
      source_assets: expectedSources,
      applio_commit: APPLIO_COMMIT,
      training_settings: parameters.settings,
      training_job_id: jobId,
      activation_policy: 'inactive_until_verified_ecapa_gte_0_8',
      identity_threshold: IDENTITY_THRESHOLD,
      candidate: true,
      proof: 'sha256-full-and-parts',
    }
    const { error: me } = await admin.from('voice_models').upsert({
      id: candidateModelId,
      user_id: job.user_id,
      name: String(parameters.candidate_model_name || 'PabloVoice Candidate'),
      engine: 'rvc',
      pth_storage_path: String(parts[0].path),
      index_storage_path: expectedIndexPath,
      pth_sha256: pthSha,
      index_sha256: indexSha,
      status: 'ready',
      is_active: false,
      metadata,
    }, { onConflict: 'id' })
    if (me) throw me

    const { data: existingRef, error: ere } = await admin.from('voice_identity_references').select('id').eq('user_id', job.user_id).eq('voice_model_id', candidateModelId).eq('is_active', true).maybeSingle()
    if (ere) throw ere
    if (!existingRef) {
      const { data: activeRefs, error: are } = await admin.from('voice_identity_references').select('asset_id,source_sha256,label').eq('user_id', job.user_id).eq('is_active', true).neq('voice_model_id', candidateModelId).order('updated_at', { ascending: false }).limit(1)
      if (are) throw are
      const reference = activeRefs?.[0]
      if (!reference || !uuid(reference.asset_id) || !shaOk(reference.source_sha256)) return out({ ok: false, error: 'identity_reference_required_before_candidate_registration' }, 409)
      const { error: rie } = await admin.from('voice_identity_references').insert({
        id: crypto.randomUUID(),
        user_id: job.user_id,
        voice_model_id: candidateModelId,
        asset_id: reference.asset_id,
        source_sha256: String(reference.source_sha256).toLowerCase(),
        label: reference.label ? `${reference.label} · candidate` : 'Candidate identity reference',
        is_active: true,
      })
      if (rie) throw rie
    }

    const proof = {
      verified: true,
      training_job_id: jobId,
      candidate_model_id: candidateModelId,
      candidate_active: false,
      activation_forbidden_before_identity_gate: true,
      identity_threshold: IDENTITY_THRESHOLD,
      applio_commit: APPLIO_COMMIT,
      pth_sha256: pthSha,
      index_sha256: indexSha,
      pth_size_bytes: pthSize,
      index_size_bytes: indexSize,
      pth_parts: parts,
      source_assets: expectedSources,
      training_settings: parameters.settings,
      epochs_completed: Number(body.epochs_completed || parameters.settings?.total_epoch || 0),
      worker_version: String(body.worker_version || ''),
    }
    const { error: fue } = await admin.from('render_jobs').update({ status: 'completed', progress: 100, current_stage: 'completed', human_message: 'Modelo vocal candidato treinado; aguardando gate de identidade', heartbeat_at: new Date().toISOString(), finished_at: new Date().toISOString(), proof, error_code: null, error_message: null, technical_error: null }).eq('id', jobId)
    if (fue) throw fue
    return out({ ok: true, job_id: jobId, candidate_model_id: candidateModelId, is_active: false, identity_gate_required: true, identity_threshold: IDENTITY_THRESHOLD, proof })
  } catch (error) {
    return out({ ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 1400) }, 500)
  }
})
