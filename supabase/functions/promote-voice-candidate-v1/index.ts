import { createClient } from 'npm:@supabase/supabase-js@2.112.2'

const OIDC_ISSUER = 'https://token.actions.githubusercontent.com'
const OIDC_AUDIENCE = 'pablovoice-signing'
const OIDC_REPOSITORY = 'ppatrickxxz-dev/STUDIA-VOICE'
const OIDC_REF = 'refs/heads/main'
const OIDC_ENVIRONMENT = 'pablovoice-production'
const OIDC_JWKS = 'https://token.actions.githubusercontent.com/.well-known/jwks'
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
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!audience.includes(OIDC_AUDIENCE)) throw new Error('oidc_audience')
  if (!Number(payload.exp) || Number(payload.exp) < now - 30) throw new Error('oidc_expired')
  if (payload.nbf && Number(payload.nbf) > now + 30) throw new Error('oidc_nbf')
  if (payload.repository !== OIDC_REPOSITORY) throw new Error('oidc_repository')
  if (payload.ref !== OIDC_REF) throw new Error('oidc_ref')
  if (payload.environment !== OIDC_ENVIRONMENT) throw new Error('oidc_environment')
  if (!['push', 'workflow_dispatch', 'schedule'].includes(String(payload.event_name || ''))) throw new Error('oidc_event')
  const jwks = await fetch(OIDC_JWKS, { headers: { accept: 'application/json' } }).then(async response => {
    if (!response.ok) throw new Error('oidc_jwks')
    return await response.json()
  })
  const jwk = Array.isArray(jwks.keys) ? jwks.keys.find((key: any) => key.kid === header.kid && key.kty === 'RSA') : null
  if (!jwk) throw new Error('oidc_key')
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`))
  if (!verified) throw new Error('oidc_signature')
  return payload
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return out({ ok: false, error: 'method_not_allowed' }, 405)
  try {
    const auth = req.headers.get('authorization') || ''
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!bearer) return out({ ok: false, error: 'oidc_required' }, 401)
    const claims = await verifyGithubOidc(bearer)
    const runId = String(claims.run_id || '')
    if (!runId) return out({ ok: false, error: 'oidc_run_id_missing' }, 403)

    const url = Deno.env.get('SUPABASE_URL') || ''
    const secs = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
    const secret = secs.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!url || !secret) return out({ ok: false, error: 'server_configuration_error' }, 500)
    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || 'status')
    const trainingJobId = String(body.training_job_id || '')
    if (!uuid(trainingJobId)) return out({ ok: false, error: 'invalid_training_job_id' }, 400)

    const { data: training, error: te } = await admin.from('render_jobs').select('*').eq('id', trainingJobId).eq('job_type', 'voice_model_training').maybeSingle()
    if (te) throw te
    if (!training) return out({ ok: false, error: 'training_job_not_found' }, 404)
    const candidateModelId = String(training.proof?.candidate_model_id || training.parameters?.candidate_model_id || '')
    const attestationJobId = String(training.proof?.speaker_identity_attestation_job_id || '')
    let attestation: any = null
    if (uuid(attestationJobId)) {
      const { data, error } = await admin.from('render_jobs').select('*').eq('id', attestationJobId).eq('job_type', 'speaker_identity_attestation').maybeSingle()
      if (error) throw error
      attestation = data
    }
    let model: any = null
    if (uuid(candidateModelId)) {
      const { data, error } = await admin.from('voice_models').select('id,name,status,is_active,pth_sha256,index_sha256,metadata,updated_at').eq('id', candidateModelId).maybeSingle()
      if (error) throw error
      model = data
    }

    if (action === 'status') {
      return out({
        ok: true,
        trusted_run_id: runId,
        training: { id: training.id, status: training.status, progress: training.progress, current_stage: training.current_stage, proof: training.proof },
        attestation: attestation ? { id: attestation.id, status: attestation.status, progress: attestation.progress, current_stage: attestation.current_stage, proof: attestation.proof } : null,
        candidate_model: model,
      })
    }
    if (action !== 'promote') return out({ ok: false, error: 'unsupported_action' }, 400)
    if (!uuid(attestationJobId)) return out({ ok: false, error: 'attestation_not_ready' }, 409)

    const { data: promoted, error: pe } = await admin.rpc('promote_verified_voice_model_candidate', {
      p_training_job_id: trainingJobId,
      p_attestation_job_id: attestationJobId,
    })
    if (pe) return out({ ok: false, error: 'promotion_rejected', detail: pe.message }, 409)
    return out({ ok: true, trusted_run_id: runId, promotion: promoted })
  } catch (error) {
    return out({ ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 1400) }, 500)
  }
})
