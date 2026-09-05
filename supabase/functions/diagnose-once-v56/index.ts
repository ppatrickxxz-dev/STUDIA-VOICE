import { createClient } from 'npm:@supabase/supabase-js@2.112.2'

// Legacy deployment slot retained because the free-tier project is at the Edge Function count cap.
// Canonical responsibility from this version onward: Release Evidence Ingest v1.
// This endpoint is not a diagnostic API. It is a fail-closed GitHub OIDC worker used only to
// materialize release-frozen binary evidence already staged in the private transport tables.

const OIDC_ISSUER = 'https://token.actions.githubusercontent.com'
const OIDC_AUDIENCE = 'pablovoice-signing'
const OIDC_REPOSITORY = 'ppatrickxxz-dev/STUDIA-VOICE'
const OIDC_REF = 'refs/heads/main'
const OIDC_WORKFLOW_REF = 'ppatrickxxz-dev/STUDIA-VOICE/.github/workflows/materialize-frozen-release-evidence.yml@refs/heads/main'
const OIDC_JWKS = 'https://token.actions.githubusercontent.com/.well-known/jwks'

const USER_ID = 'e13fb3c9-0967-423f-b295-011ca63305dd'
const PROJECT_ID = 'd64e4de9-791e-41bc-9307-7957389b2499'
const STORAGE_BUCKET = 'audio-private'

const SPECS: Record<string, {
  original_name: string
  expected_size: number
  sample_rate: number
  duration_seconds: number
  role: 'canonical_source' | 'frozen_provider_input'
  storage_path: string
}> = {
  '852890854c128a4ee222505a910c3dc01465579d34ed6b49b5019aec8f16ad83': {
    original_name: 'voz.wav',
    expected_size: 13_909_412,
    sample_rate: 40_000,
    duration_seconds: 173.866675,
    role: 'canonical_source',
    storage_path: `${USER_ID}/${PROJECT_ID}/benchmarks/frozen/voz.wav`,
  },
  '85b6341bac253f85a48506400baed3dd2bbf212ac172af6d0fa8e47d35642b95': {
    original_name: 'vocal_provider_input.wav',
    expected_size: 15_335_120,
    sample_rate: 44_100,
    duration_seconds: 173.866689,
    role: 'frozen_provider_input',
    storage_path: `${USER_ID}/${PROJECT_ID}/benchmarks/frozen/vocal_provider_input.wav`,
  },
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
})

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(atob(normalized), (c) => c.charCodeAt(0))
}

function decodeJwtJson(value: string) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)))
}

async function verifyGithubOidc(token: string) {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('oidc_shape')
  const [headerPart, payloadPart, signaturePart] = parts
  const header = decodeJwtJson(headerPart)
  const payload = decodeJwtJson(payloadPart)

  if (header.alg !== 'RS256' || !header.kid) throw new Error('oidc_header')
  const now = Math.floor(Date.now() / 1000)
  if (payload.iss !== OIDC_ISSUER) throw new Error('oidc_issuer')
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!audiences.includes(OIDC_AUDIENCE)) throw new Error('oidc_audience')
  if (!Number(payload.exp) || Number(payload.exp) < now - 30) throw new Error('oidc_expired')
  if (payload.nbf && Number(payload.nbf) > now + 30) throw new Error('oidc_nbf')
  if (payload.repository !== OIDC_REPOSITORY) throw new Error('oidc_repository')
  if (payload.ref !== OIDC_REF) throw new Error('oidc_ref')
  if (payload.workflow_ref !== OIDC_WORKFLOW_REF) throw new Error('oidc_workflow_ref')
  if (!['workflow_dispatch', 'push'].includes(String(payload.event_name || ''))) throw new Error('oidc_event')

  const jwks = await fetch(OIDC_JWKS, { headers: { accept: 'application/json' } }).then(async (response) => {
    if (!response.ok) throw new Error('oidc_jwks')
    return await response.json()
  })
  const jwk = Array.isArray(jwks.keys) ? jwks.keys.find((key: any) => key.kid === header.kid && key.kty === 'RSA') : null
  if (!jwk) throw new Error('oidc_key')
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    decodeBase64Url(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  )
  if (!verified) throw new Error('oidc_signature')
  return payload
}

function sha256Hex(bytes: Uint8Array) {
  return crypto.subtle.digest('SHA-256', bytes).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  )
}

function decodeChunk(base64: string) {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  try {
    const authorization = request.headers.get('authorization') || ''
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
    if (!bearer) return json({ ok: false, error: 'oidc_required' }, 401)
    const claims = await verifyGithubOidc(bearer)

    const body = await request.json().catch(() => ({}))
    if (body.action !== 'materialize') return json({ ok: false, error: 'unsupported_action' }, 400)
    const expectedSha256 = String(body.expected_sha256 || '').toLowerCase()
    const spec = SPECS[expectedSha256]
    if (!spec) return json({ ok: false, error: 'sha256_not_release_frozen' }, 409)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
    const serviceRole = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!supabaseUrl || !serviceRole) throw new Error('server_configuration_error')
    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: existingAssets, error: existingError } = await admin
      .from('audio_assets')
      .select('id,sha256,size_bytes,storage_bucket,storage_path,metadata')
      .eq('user_id', USER_ID)
      .eq('project_id', PROJECT_ID)
      .eq('sha256', expectedSha256)
      .limit(1)
    if (existingError) throw existingError
    if (existingAssets?.[0]) {
      const asset = existingAssets[0]
      if (Number(asset.size_bytes) !== spec.expected_size) return json({ ok: false, error: 'existing_asset_size_mismatch' }, 409)
      if (asset.storage_bucket !== STORAGE_BUCKET || asset.storage_path !== spec.storage_path) {
        return json({ ok: false, error: 'existing_asset_storage_mismatch' }, 409)
      }
      const metadata = asset.metadata && typeof asset.metadata === 'object' ? asset.metadata as Record<string, unknown> : {}
      if (
        metadata.runtime_addressable !== true ||
        metadata.verified_sha256 !== true ||
        metadata.benchmark_role !== spec.role ||
        metadata.ingested_by !== 'release_evidence_ingest_v1'
      ) return json({ ok: false, error: 'existing_asset_provenance_untrusted' }, 409)

      const { data: storedObject, error: downloadError } = await admin.storage
        .from(STORAGE_BUCKET)
        .download(spec.storage_path)
      if (downloadError || !storedObject) return json({ ok: false, error: 'existing_asset_object_unavailable' }, 409)
      const storedBytes = new Uint8Array(await storedObject.arrayBuffer())
      if (storedBytes.byteLength !== spec.expected_size) {
        return json({ ok: false, error: 'existing_asset_object_size_mismatch' }, 409)
      }
      const storedSha256 = await sha256Hex(storedBytes)
      if (storedSha256 !== expectedSha256) {
        return json({ ok: false, error: 'existing_asset_object_sha256_mismatch' }, 409)
      }
      return json({ ok: true, idempotent: true, asset })
    }

    const { data: sessions, error: sessionError } = await admin
      .from('benchmark_binary_transport_sessions')
      .select('*')
      .eq('project_id', PROJECT_ID)
      .eq('expected_sha256', expectedSha256)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(1)
    if (sessionError) throw sessionError
    const session = sessions?.[0]
    if (!session) return json({ ok: false, error: 'transport_session_missing_or_expired' }, 409)
    if (
      Number(session.expected_size) !== spec.expected_size ||
      String(session.original_name) !== spec.original_name ||
      String(session.mime_type) !== 'audio/wav' ||
      !Number.isInteger(Number(session.chunk_count)) || Number(session.chunk_count) < 1
    ) return json({ ok: false, error: 'transport_session_contract_mismatch' }, 409)

    const { data: chunks, error: chunkError } = await admin
      .from('benchmark_binary_transport_chunks')
      .select('chunk_index,chunk_b64')
      .eq('session_id', session.id)
      .order('chunk_index', { ascending: true })
    if (chunkError) throw chunkError
    if (!chunks || chunks.length !== Number(session.chunk_count)) {
      return json({ ok: false, error: 'transport_chunk_count_mismatch', expected: session.chunk_count, actual: chunks?.length || 0 }, 409)
    }
    for (let index = 0; index < chunks.length; index += 1) {
      if (Number(chunks[index].chunk_index) !== index) return json({ ok: false, error: 'transport_chunk_index_gap', index }, 409)
    }

    const decoded = chunks.map((chunk: any) => decodeChunk(String(chunk.chunk_b64 || '')))
    const totalSize = decoded.reduce((total: number, bytes: Uint8Array) => total + bytes.byteLength, 0)
    if (totalSize !== spec.expected_size) return json({ ok: false, error: 'materialized_size_mismatch', expected: spec.expected_size, actual: totalSize }, 409)
    const bytes = new Uint8Array(totalSize)
    let offset = 0
    for (const part of decoded) {
      bytes.set(part, offset)
      offset += part.byteLength
    }
    const actualSha256 = await sha256Hex(bytes)
    if (actualSha256 !== expectedSha256) return json({ ok: false, error: 'materialized_sha256_mismatch', expected: expectedSha256, actual: actualSha256 }, 409)

    const { error: uploadError } = await admin.storage.from(STORAGE_BUCKET).upload(spec.storage_path, bytes, {
      contentType: 'audio/wav',
      cacheControl: '31536000',
      upsert: false,
    })
    if (uploadError) throw new Error(`storage_upload_failed:${uploadError.message}`)

    const assetId = crypto.randomUUID()
    const metadata: Record<string, unknown> = {
      frozen_benchmark: true,
      benchmark_role: spec.role,
      runtime_addressable: true,
      verified_sha256: true,
      binary_transport_session_id: session.id,
      ingested_by: 'release_evidence_ingest_v1',
      trusted_run_id: String(claims.run_id || ''),
      trusted_run_attempt: String(claims.run_attempt || ''),
      source_commit_sha: String(claims.sha || ''),
    }
    if (spec.role === 'frozen_provider_input') {
      metadata.canonical_source_sha256 = '852890854c128a4ee222505a910c3dc01465579d34ed6b49b5019aec8f16ad83'
      metadata.derivation = 'ffmpeg -hide_banner -loglevel error -i voz.wav -vn -ac 1 -ar 44100 -c:a pcm_s16le'
    }

    const { error: insertError } = await admin.from('audio_assets').insert({
      id: assetId,
      user_id: USER_ID,
      project_id: PROJECT_ID,
      kind: 'source',
      storage_bucket: STORAGE_BUCKET,
      storage_path: spec.storage_path,
      original_name: spec.original_name,
      mime_type: 'audio/wav',
      size_bytes: spec.expected_size,
      duration_seconds: spec.duration_seconds,
      sample_rate: spec.sample_rate,
      channels: 1,
      bit_depth: 16,
      sha256: expectedSha256,
      metadata,
    })
    if (insertError) {
      await admin.storage.from(STORAGE_BUCKET).remove([spec.storage_path])
      throw new Error(`asset_insert_failed:${insertError.message}`)
    }

    const consumedAt = new Date().toISOString()
    const { error: consumeError } = await admin
      .from('benchmark_binary_transport_sessions')
      .update({ consumed_at: consumedAt })
      .eq('id', session.id)
      .is('consumed_at', null)
    if (consumeError) throw consumeError

    const { error: cleanupError } = await admin.from('benchmark_binary_transport_chunks').delete().eq('session_id', session.id)
    if (cleanupError) throw cleanupError

    return json({
      ok: true,
      idempotent: false,
      asset: {
        id: assetId,
        sha256: expectedSha256,
        size_bytes: spec.expected_size,
        storage_bucket: STORAGE_BUCKET,
        storage_path: spec.storage_path,
        benchmark_role: spec.role,
      },
      evidence: {
        trusted_run_id: String(claims.run_id || ''),
        source_commit_sha: String(claims.sha || ''),
        transport_session_id: session.id,
        consumed_at: consumedAt,
      },
    })
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
