import { createClient } from 'npm:@supabase/supabase-js@2.112.2'

const APPLIO_COMMIT = '085197e738ce9dd4c0bae1e0a74df5de25b89444'
const IDENTITY_THRESHOLD = 0.8
const IDENTITY_MODEL = 'speechbrain/spkrec-ecapa-voxceleb'
const IDENTITY_MODEL_REVISION = 'b8937e0343bf9fc9741ab12b445b86a93a6e3e25'
const IDENTITY_ENGINE_VERSION = 'speechbrain-1.1.0'
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
    if (action === 'error') {
      const message = String(body.message || 'Falha no treino do modelo vocal candidato').slice(0, 1400)
      await admin.from('render_jobs').update({ status: 'error', progress: 0, current_stage: 'error', human_message: 'Falha no treino do modelo vocal candidato', error_code: 'voice_model_training_failed', error_message: message, technical_error: message, heartbeat_at: new Date().toISOString(), finished_at: new Date().toISOString() }).eq('id', jobId)
      return out({ ok: true, job_id: jobId, status: 'error' })
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

    const expectedValidation = parameters.validation || {}
    const validation = body.validation || {}
    const validationAssetId = String(validation.asset_id || '')
    const validationSha = String(validation.sha256 || '').toLowerCase()
    const validationSize = Number(validation.size_bytes || 0)
    const validationDuration = Number(validation.duration_seconds || 0)
    const expectedDuration = Number(expectedValidation.region?.duration_seconds || 0)
    if (!uuid(validationAssetId) || validationAssetId !== String(expectedValidation.output_asset_id || '')) return out({ ok: false, error: 'validation_asset_binding_mismatch' }, 409)
    if (!shaOk(validationSha) || validationSize < 4096 || Number(validation.sample_rate) !== 48000 || Number(validation.channels) !== 1) return out({ ok: false, error: 'validation_audio_contract_mismatch' }, 409)
    if (!Number.isFinite(validationDuration) || Math.abs(validationDuration - expectedDuration) > 0.6) return out({ ok: false, error: 'validation_duration_mismatch' }, 409)
    if (String(validation.storage_bucket || '') !== 'audio-private' || String(validation.storage_path || '') !== String(expectedValidation.output_path || '')) return out({ ok: false, error: 'validation_storage_binding_mismatch' }, 409)
    if (String(validation.guide_asset_id || '') !== String(expectedValidation.guide_asset_id || '') || String(validation.guide_sha256 || '').toLowerCase() !== String(expectedValidation.guide_sha256 || '').toLowerCase()) return out({ ok: false, error: 'validation_guide_binding_mismatch' }, 409)
    const validationFolder = String(expectedValidation.output_path).split('/').slice(0, -1).join('/')
    const validationName = String(expectedValidation.output_path).split('/').pop() || ''
    const { data: validationObjects, error: voe } = await admin.storage.from('audio-private').list(validationFolder, { limit: 20, search: validationName })
    if (voe) throw voe
    const validationObject = (validationObjects || []).find((entry: any) => entry.name === validationName)
    if (!validationObject || Number(validationObject.metadata?.size || 0) !== validationSize) return out({ ok: false, error: 'validation_audio_not_persisted' }, 409)

    const metadata = {
      client: 'voice-train-v1', storage_mode: 'multipart', pth_parts: parts, pth_size: pthSize, index_size: indexSize,
      source_assets: expectedSources, applio_commit: APPLIO_COMMIT, training_settings: parameters.settings, training_job_id: jobId,
      activation_policy: 'inactive_until_verified_ecapa_gte_0_8', identity_threshold: IDENTITY_THRESHOLD, candidate: true, proof: 'sha256-full-and-parts',
    }
    const { error: me } = await admin.from('voice_models').upsert({
      id: candidateModelId, user_id: job.user_id, name: String(parameters.candidate_model_name || 'PabloVoice Candidate'), engine: 'rvc',
      pth_storage_path: String(parts[0].path), index_storage_path: expectedIndexPath, pth_sha256: pthSha, index_sha256: indexSha,
      status: 'ready', is_active: false, metadata,
    }, { onConflict: 'id' })
    if (me) throw me

    let { data: candidateRef, error: cre } = await admin.from('voice_identity_references').select('id,asset_id,source_sha256,label').eq('user_id', job.user_id).eq('voice_model_id', candidateModelId).eq('is_active', true).maybeSingle()
    if (cre) throw cre
    if (!candidateRef) {
      const referenceId = String(expectedValidation.reference_id || '')
      const referenceAssetId = String(expectedValidation.reference_asset_id || '')
      const referenceSha = String(expectedValidation.reference_sha256 || '').toLowerCase()
      if (!uuid(referenceId) || !uuid(referenceAssetId) || !shaOk(referenceSha)) return out({ ok: false, error: 'identity_reference_binding_missing' }, 409)
      const { data: sourceRef, error: sre } = await admin.from('voice_identity_references').select('id,asset_id,source_sha256,label').eq('id', referenceId).eq('user_id', job.user_id).eq('is_active', true).maybeSingle()
      if (sre) throw sre
      if (!sourceRef || String(sourceRef.asset_id) !== referenceAssetId || String(sourceRef.source_sha256).toLowerCase() !== referenceSha) return out({ ok: false, error: 'identity_reference_binding_mismatch' }, 409)
      const { data: insertedRef, error: rie } = await admin.from('voice_identity_references').insert({
        id: crypto.randomUUID(), user_id: job.user_id, voice_model_id: candidateModelId, asset_id: referenceAssetId, source_sha256: referenceSha,
        label: sourceRef.label ? `${sourceRef.label} · candidate` : 'Candidate identity reference', is_active: true,
      }).select('id,asset_id,source_sha256,label').single()
      if (rie) throw rie
      candidateRef = insertedRef
    }
    if (!candidateRef || String(candidateRef.asset_id) !== String(expectedValidation.reference_asset_id) || String(candidateRef.source_sha256).toLowerCase() !== String(expectedValidation.reference_sha256).toLowerCase()) return out({ ok: false, error: 'candidate_identity_reference_mismatch' }, 409)

    const { error: vae } = await admin.from('audio_assets').upsert({
      id: validationAssetId, project_id: job.project_id, version_id: job.version_id || null, user_id: job.user_id, kind: 'pablo_voice_variant',
      storage_bucket: 'audio-private', storage_path: String(expectedValidation.output_path), original_name: 'candidate-identity-validation.flac', mime_type: 'audio/flac',
      size_bytes: validationSize, duration_seconds: validationDuration, sample_rate: 48000, channels: 1, sha256: validationSha,
      metadata: { validation_only: true, voice_model_id: candidateModelId, training_job_id: jobId, guide_asset_id: expectedValidation.guide_asset_id, guide_sha256: expectedValidation.guide_sha256, localized_region: expectedValidation.region, activation_forbidden: true },
    }, { onConflict: 'id' })
    if (vae) throw vae

    let { data: attestations, error: ae } = await admin.from('render_jobs').select('id,status,proof').eq('user_id', job.user_id).eq('job_type', 'speaker_identity_attestation').contains('parameters', { training_job_id: jobId }).order('created_at', { ascending: false }).limit(1)
    if (ae) throw ae
    let attestation = attestations?.[0] || null
    if (!attestation) {
      const attestationId = crypto.randomUUID()
      const attestationParameters = {
        candidate_asset_id: validationAssetId, candidate_sha256: validationSha,
        reference_id: candidateRef.id, reference_asset_id: candidateRef.asset_id, reference_sha256: String(candidateRef.source_sha256).toLowerCase(),
        voice_model_id: candidateModelId, threshold: IDENTITY_THRESHOLD, engine: IDENTITY_MODEL, engine_version: IDENTITY_ENGINE_VERSION,
        model_revision: IDENTITY_MODEL_REVISION, trusted_authority: 'github_repository_oidc', training_job_id: jobId, candidate_activation_policy: 'inactive_until_verified_ecapa_gte_0_8',
      }
      const { data: inserted, error: aie } = await admin.from('render_jobs').insert({
        id: attestationId, user_id: job.user_id, project_id: job.project_id, version_id: job.version_id || null, job_type: 'speaker_identity_attestation',
        provider: 'pablovoice_github_oidc', status: 'waiting_trusted_worker', progress: 5, current_stage: 'waiting_trusted_worker',
        human_message: 'Aguardando validação confiável do novo modelo vocal', parameters: attestationParameters,
        input_asset_ids: [validationAssetId, candidateRef.asset_id], output_asset_ids: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).select('id,status,proof').single()
      if (aie) throw aie
      attestation = inserted
    }

    const proof = {
      verified: true, training_job_id: jobId, candidate_model_id: candidateModelId, candidate_active: false,
      activation_forbidden_before_identity_gate: true, identity_threshold: IDENTITY_THRESHOLD, applio_commit: APPLIO_COMMIT,
      pth_sha256: pthSha, index_sha256: indexSha, pth_size_bytes: pthSize, index_size_bytes: indexSize, pth_parts: parts,
      source_assets: expectedSources, training_settings: parameters.settings, epochs_completed: Number(body.epochs_completed || parameters.settings?.total_epoch || 0),
      worker_version: String(body.worker_version || ''), validation_asset_id: validationAssetId, validation_sha256: validationSha,
      speaker_identity_attestation_job_id: attestation.id, speaker_identity_attestation_status: attestation.status,
    }
    const { error: fue } = await admin.from('render_jobs').update({
      status: 'completed', progress: 100, current_stage: 'completed', human_message: 'Modelo candidato treinado; validação de identidade confiável pendente',
      heartbeat_at: new Date().toISOString(), finished_at: new Date().toISOString(), proof, output_asset_ids: [validationAssetId], error_code: null, error_message: null, technical_error: null,
    }).eq('id', jobId)
    if (fue) throw fue
    return out({ ok: true, job_id: jobId, candidate_model_id: candidateModelId, is_active: false, validation_asset_id: validationAssetId, identity_gate_required: true, identity_threshold: IDENTITY_THRESHOLD, attestation_job_id: attestation.id, attestation_status: attestation.status, proof })
  } catch (error) {
    return out({ ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 1400) }, 500)
  }
})
