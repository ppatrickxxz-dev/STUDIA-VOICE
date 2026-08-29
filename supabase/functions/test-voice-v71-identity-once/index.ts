import { createClient } from 'npm:@supabase/supabase-js@2.112.2'

const THRESHOLD = 0.8
const MODEL = 'speechbrain/spkrec-ecapa-voxceleb'
const MODEL_REVISION = 'b8937e0343bf9fc9741ab12b445b86a93a6e3e25'
const ENGINE_VERSION = 'speechbrain-1.1.0'
const OIDC_ISSUER = 'https://token.actions.githubusercontent.com'
const OIDC_AUDIENCE = 'pablovoice-signing'
const OIDC_REPOSITORY = 'ppatrickxxz-dev/STUDIA-VOICE'
const OIDC_REF = 'refs/heads/main'
const OIDC_ENVIRONMENT = 'pablovoice-production'
const OIDC_JWKS = 'https://token.actions.githubusercontent.com/.well-known/jwks'
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})
const uuid = (v: unknown) => /^[0-9a-f-]{36}$/i.test(String(v || ''))
const shaOk = (v: unknown) => /^[0-9a-f]{64}$/i.test(String(v || ''))
function b64url(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=')
  return Uint8Array.from(atob(normalized), c => c.charCodeAt(0))
}
function jwtJson(input: string) {
  return JSON.parse(new TextDecoder().decode(b64url(input)))
}
async function verifyGithubOidc(token: string) {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('oidc_shape')
  const [h, p, s] = parts
  const header = jwtJson(h)
  const payload = jwtJson(p)
  if (header.alg !== 'RS256' || !header.kid) throw new Error('oidc_header')
  const now = Math.floor(Date.now() / 1000)
  if (payload.iss !== OIDC_ISSUER) throw new Error('oidc_issuer')
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!aud.includes(OIDC_AUDIENCE)) throw new Error('oidc_audience')
  if (!Number(payload.exp) || Number(payload.exp) < now - 30) throw new Error('oidc_expired')
  if (payload.nbf && Number(payload.nbf) > now + 30) throw new Error('oidc_nbf')
  if (payload.repository !== OIDC_REPOSITORY) throw new Error('oidc_repository')
  if (payload.ref !== OIDC_REF) throw new Error('oidc_ref')
  if (payload.environment !== OIDC_ENVIRONMENT) throw new Error('oidc_environment')
  if (!['push', 'workflow_dispatch', 'schedule'].includes(String(payload.event_name || ''))) throw new Error('oidc_event')
  const jwks = await fetch(OIDC_JWKS, { headers: { accept: 'application/json' } }).then(async r => {
    if (!r.ok) throw new Error('oidc_jwks')
    return await r.json()
  })
  const jwk = Array.isArray(jwks.keys) ? jwks.keys.find((k: any) => k.kid === header.kid && k.kty === 'RSA') : null
  if (!jwk) throw new Error('oidc_key')
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`))
  if (!ok) throw new Error('oidc_signature')
  return payload
}
function env() {
  const url = Deno.env.get('SUPABASE_URL') || ''
  const pubs = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}')
  const secs = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
  const pub = pubs.default || Deno.env.get('SUPABASE_ANON_KEY') || ''
  const secret = secs.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !pub || !secret) throw new Error('server_configuration_error')
  return { url, pub, secret }
}
async function signed(admin: any, asset: any, ttl = 1800) {
  const { data, error } = await admin.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, ttl)
  if (error || !data?.signedUrl) throw error || new Error('signed_download_failed')
  return data.signedUrl
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return out({ ok: false, error: 'method_not_allowed' }, 405)
  try {
    const { url, pub, secret } = env()
    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || 'status')
    const auth = req.headers.get('authorization') || ''
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''

    if (action === 'worker_claim') {
      if (!bearer) return out({ ok: false, error: 'oidc_required' }, 401)
      const claims = await verifyGithubOidc(bearer)
      const runId = String(claims.run_id || '')
      if (!runId) return out({ ok: false, error: 'oidc_run_id_missing' }, 403)
      const { data: jobs, error: je } = await admin.from('render_jobs')
        .select('*')
        .eq('job_type', 'speaker_identity_attestation')
        .eq('status', 'waiting_trusted_worker')
        .order('created_at', { ascending: true })
        .limit(1)
      if (je) throw je
      const job = jobs?.[0]
      if (!job) return out({ ok: true, job: null })
      const p = job.parameters || {}
      if (!uuid(p.candidate_asset_id) || !uuid(p.reference_asset_id) || !shaOk(p.candidate_sha256) || !shaOk(p.reference_sha256)) {
        return out({ ok: false, error: 'job_binding_invalid' }, 409)
      }
      if (String(p.candidate_asset_id) === String(p.reference_asset_id) || String(p.candidate_sha256).toLowerCase() === String(p.reference_sha256).toLowerCase()) {
        await admin.from('render_jobs').update({ status: 'error', progress: 0, current_stage: 'error', error_code: 'identity_self_reference_rejected', error_message: 'Candidate and reference must be distinct artifacts', finished_at: new Date().toISOString() }).eq('id', job.id)
        return out({ ok: false, error: 'identity_self_reference_rejected' }, 409)
      }
      const { data: assets, error: ae } = await admin.from('audio_assets').select('*').in('id', [p.candidate_asset_id, p.reference_asset_id])
      if (ae) throw ae
      const candidate = assets?.find((a: any) => a.id === p.candidate_asset_id)
      const reference = assets?.find((a: any) => a.id === p.reference_asset_id)
      if (!candidate || !reference) return out({ ok: false, error: 'identity_assets_missing' }, 409)
      const { data: claimed, error: ce } = await admin.from('render_jobs').update({
        status: 'processing',
        progress: 15,
        current_stage: 'trusted_worker_claimed',
        human_message: 'Validando identidade vocal em runner confiável',
        heartbeat_at: new Date().toISOString(),
        parameters: { ...p, trusted_run_id: runId, trusted_run_attempt: String(claims.run_attempt || ''), trusted_repository: OIDC_REPOSITORY },
      }).eq('id', job.id).eq('status', 'waiting_trusted_worker').select('id').maybeSingle()
      if (ce) throw ce
      if (!claimed) return out({ ok: true, job: null, raced: true })
      return out({
        ok: true,
        job: {
          id: job.id,
          project_id: job.project_id,
          candidate_asset_id: p.candidate_asset_id,
          candidate_sha256: String(p.candidate_sha256).toLowerCase(),
          candidate_url: await signed(admin, candidate),
          reference_id: p.reference_id,
          reference_asset_id: p.reference_asset_id,
          reference_sha256: String(p.reference_sha256).toLowerCase(),
          reference_url: await signed(admin, reference),
          voice_model_id: p.voice_model_id,
          threshold: THRESHOLD,
          engine: MODEL,
          engine_version: ENGINE_VERSION,
          model_revision: MODEL_REVISION,
          trusted_run_id: runId,
        },
      })
    }

    if (action === 'complete') {
      if (!bearer) return out({ ok: false, error: 'oidc_required' }, 401)
      const claims = await verifyGithubOidc(bearer)
      const runId = String(claims.run_id || '')
      const id = String(body.job_id || '')
      if (!uuid(id)) return out({ ok: false, error: 'invalid_job_id' }, 400)
      const { data: job, error: je } = await admin.from('render_jobs').select('*').eq('id', id).eq('job_type', 'speaker_identity_attestation').maybeSingle()
      if (je) throw je
      if (!job) return out({ ok: false, error: 'job_not_found' }, 404)
      if (job.status === 'completed') return out({ ok: true, already_completed: true, proof: job.proof })
      const p = job.parameters || {}
      if (String(p.trusted_run_id || '') !== runId) return out({ ok: false, error: 'trusted_run_binding_mismatch' }, 403)
      const csha = String(body.candidate_sha256 || '').toLowerCase()
      const rsha = String(body.reference_sha256 || '').toLowerCase()
      if (csha !== String(p.candidate_sha256 || '').toLowerCase() || rsha !== String(p.reference_sha256 || '').toLowerCase()) return out({ ok: false, error: 'artifact_hash_mismatch' }, 409)
      if (csha === rsha || String(p.candidate_asset_id) === String(p.reference_asset_id)) return out({ ok: false, error: 'identity_self_reference_rejected' }, 409)
      if (String(body.reference_id || '') !== String(p.reference_id || '') || String(body.voice_model_id || '') !== String(p.voice_model_id || '')) return out({ ok: false, error: 'identity_binding_mismatch' }, 409)
      if (String(body.engine || '') !== MODEL || String(body.engine_version || '') !== ENGINE_VERSION || String(body.model_revision || '') !== MODEL_REVISION) return out({ ok: false, error: 'engine_contract_mismatch' }, 409)
      const score = Number(body.score)
      const passed = body.passed === true
      if (!Number.isFinite(score) || score < -1 || score > 1 || passed !== (score >= THRESHOLD)) return out({ ok: false, error: 'score_contract_mismatch' }, 409)
      const proof = {
        schema_version: 2,
        verified: true,
        issuer: 'pablovoice-github-oidc-speaker-identity-v2',
        authority: 'github_repository_oidc',
        trusted_run_id: runId,
        trusted_repository: OIDC_REPOSITORY,
        candidate_asset_id: p.candidate_asset_id,
        candidate_sha256: csha,
        reference_id: p.reference_id,
        reference_asset_id: p.reference_asset_id,
        reference_sha256: rsha,
        voice_model_id: p.voice_model_id,
        engine: MODEL,
        engine_version: ENGINE_VERSION,
        model_revision: MODEL_REVISION,
        score,
        threshold: THRESHOLD,
        passed,
        device: String(body.device || 'cpu'),
        raw_embedding_exposed: false,
      }
      const { error: ae } = await admin.from('analyses').insert({ id: crypto.randomUUID(), project_id: job.project_id, asset_id: p.candidate_asset_id, user_id: job.user_id, analysis_type: 'speaker_identity_attestation_v1', engine: MODEL, engine_version: ENGINE_VERSION, result: proof })
      if (ae) throw ae
      const { error: ue } = await admin.from('render_jobs').update({ status: 'completed', progress: 100, current_stage: 'completed', human_message: passed ? 'Identidade vocal preservada' : 'Identidade vocal não comprovada', heartbeat_at: new Date().toISOString(), finished_at: new Date().toISOString(), proof, error_message: null, error_code: null, technical_error: null }).eq('id', id)
      if (ue) return out({ ok: false, error: 'job_finalization_failed' }, 500)
      return out({ ok: true, job_id: id, proof: { ...proof, score: Number(score.toFixed(6)) } })
    }

    if (!bearer) return out({ ok: false, error: 'auth_required' }, 401)
    const userClient = createClient(url, pub, { global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false, autoRefreshToken: false } })
    const { data: ud, error: ue } = await userClient.auth.getUser(bearer)
    const user = ud?.user
    if (ue || !user) return out({ ok: false, error: 'invalid_session' }, 401)

    const projectId = String(body.project_id || '')
    if (action === 'status' || action === 'sync') {
      if (!uuid(projectId)) return out({ ok: false, error: 'invalid_project_id' }, 400)
      const { data: jobs, error: je } = await admin.from('render_jobs').select('*').eq('user_id', user.id).eq('project_id', projectId).eq('job_type', 'speaker_identity_attestation').order('created_at', { ascending: false }).limit(1)
      if (je) throw je
      const job = jobs?.[0] || null
      if (!job) return out({ ok: true, job: null, attestation: null })
      const { data: analyses, error: ae } = await admin.from('analyses').select('result,created_at').eq('user_id', user.id).eq('project_id', projectId).eq('analysis_type', 'speaker_identity_attestation_v1').order('created_at', { ascending: false }).limit(1)
      if (ae) throw ae
      return out({ ok: true, job, attestation: analyses?.[0]?.result || null })
    }

    if (action !== 'dispatch') return out({ ok: false, error: 'unsupported_action' }, 400)
    const candidateId = String(body.candidate_asset_id || '')
    if (!uuid(candidateId)) return out({ ok: false, error: 'invalid_candidate_asset_id' }, 400)
    const { data: candidate } = await admin.from('audio_assets').select('*').eq('id', candidateId).eq('user_id', user.id).maybeSingle()
    if (!candidate || !uuid(candidate.project_id) || !shaOk(candidate.sha256)) return out({ ok: false, error: 'candidate_asset_missing_or_unverified' }, 409)
    const { data: models } = await admin.from('voice_models').select('*').eq('user_id', user.id).eq('is_active', true).eq('status', 'ready').order('updated_at', { ascending: false }).limit(1)
    const model = models?.[0]
    if (!model) return out({ ok: false, error: 'active_voice_model_required' }, 409)
    const { data: ref } = await admin.from('voice_identity_references').select('*').eq('user_id', user.id).eq('voice_model_id', model.id).eq('is_active', true).maybeSingle()
    if (!ref || !shaOk(ref.source_sha256)) return out({ ok: false, error: 'active_identity_reference_required' }, 409)
    if (String(ref.asset_id) === candidate.id || String(ref.source_sha256).toLowerCase() === String(candidate.sha256).toLowerCase()) return out({ ok: false, error: 'identity_self_reference_rejected' }, 409)
    const { data: project } = await admin.from('projects').select('id').eq('id', candidate.project_id).eq('user_id', user.id).maybeSingle()
    if (!project) return out({ ok: false, error: 'project_access_denied' }, 403)
    const now = new Date().toISOString()
    const parameters = {
      candidate_asset_id: candidate.id,
      candidate_sha256: String(candidate.sha256).toLowerCase(),
      reference_id: ref.id,
      reference_asset_id: ref.asset_id,
      reference_sha256: String(ref.source_sha256).toLowerCase(),
      voice_model_id: model.id,
      threshold: THRESHOLD,
      engine: MODEL,
      engine_version: ENGINE_VERSION,
      model_revision: MODEL_REVISION,
      trusted_authority: 'github_repository_oidc',
    }
    const { data: job, error: je } = await admin.from('render_jobs').insert({
      id: crypto.randomUUID(), user_id: user.id, project_id: candidate.project_id, job_type: 'speaker_identity_attestation', provider: 'pablovoice_github_oidc', status: 'waiting_trusted_worker', progress: 5, current_stage: 'waiting_trusted_worker', human_message: 'Aguardando validação confiável de identidade vocal', parameters, input_asset_ids: [candidate.id, ref.asset_id], output_asset_ids: [], created_at: now, updated_at: now,
    }).select('*').single()
    if (je) throw je
    return out({ ok: true, status: 'waiting_trusted_worker', job_id: job.id, trusted_authority: 'github_repository_oidc', candidate_sha256: parameters.candidate_sha256, reference_sha256: parameters.reference_sha256, threshold: THRESHOLD, model_revision: MODEL_REVISION })
  } catch (error) {
    return out({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
