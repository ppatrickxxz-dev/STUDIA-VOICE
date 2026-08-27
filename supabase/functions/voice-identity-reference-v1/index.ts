import { createClient } from 'npm:@supabase/supabase-js@2.112.2'

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
const sha256 = (value: unknown) => /^[0-9a-f]{64}$/i.test(String(value || ''))

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return out({ ok: false, error: 'method_not_allowed' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL') || ''
    const pubs = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}')
    const secs = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
    const publishable = pubs.default || Deno.env.get('SUPABASE_ANON_KEY') || ''
    const service = secs.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const auth = req.headers.get('authorization') || ''
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!jwt) return out({ ok: false, error: 'auth_required' }, 401)

    const userClient = createClient(url, publishable, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: userData } = await userClient.auth.getUser(jwt)
    const user = userData?.user
    if (!user) return out({ ok: false, error: 'invalid_session' }, 401)

    const body = await req.json().catch(() => ({}))
    const action = String(body.action || 'list')
    const requestedModelId = String(body.voice_model_id || '')

    const { data: models, error: modelError } = await admin
      .from('voice_models')
      .select('id,name,engine,status,is_active,updated_at')
      .eq('user_id', user.id)
      .eq('status', 'ready')
      .order('is_active', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(20)
    if (modelError) throw modelError

    const activeModel = requestedModelId
      ? (models || []).find((model: any) => model.id === requestedModelId)
      : (models || []).find((model: any) => model.is_active) || (models || [])[0] || null

    if (requestedModelId && !uuid(requestedModelId)) return out({ ok: false, error: 'invalid_voice_model_id' }, 400)
    if (requestedModelId && !activeModel) return out({ ok: false, error: 'voice_model_not_owned_or_ready' }, 404)

    async function currentReference(modelId: string | null) {
      if (!modelId) return null
      const { data, error } = await admin
        .from('voice_identity_references')
        .select('id,voice_model_id,asset_id,source_sha256,label,is_active,created_at,updated_at')
        .eq('user_id', user.id)
        .eq('voice_model_id', modelId)
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data || null
    }

    async function candidates() {
      const { data, error } = await admin
        .from('audio_assets')
        .select('id,kind,original_name,mime_type,size_bytes,duration_seconds,sample_rate,channels,sha256,created_at,metadata')
        .eq('user_id', user.id)
        .in('kind', ['take', 'source'])
        .not('sha256', 'is', null)
        .order('created_at', { ascending: false })
        .limit(40)
      if (error) throw error
      return (data || []).filter((asset: any) => sha256(asset.sha256)).map((asset: any) => ({
        id: asset.id,
        kind: asset.kind,
        name: asset.original_name,
        mime_type: asset.mime_type,
        size_bytes: asset.size_bytes,
        duration_seconds: asset.duration_seconds,
        sample_rate: asset.sample_rate,
        channels: asset.channels,
        sha256: String(asset.sha256).toLowerCase(),
        created_at: asset.created_at,
        source: asset.metadata?.source || asset.metadata?.client || null,
      }))
    }

    if (action === 'list') {
      return out({
        ok: true,
        version: 1,
        voice_model: activeModel,
        reference: await currentReference(activeModel?.id || null),
        candidates: await candidates(),
        policy: { allowed_asset_kinds: ['take', 'source'], automatic_selection: false },
      })
    }

    if (action === 'set') {
      if (!activeModel) return out({ ok: false, error: 'voice_model_required' }, 409)
      const assetId = String(body.asset_id || '')
      if (!uuid(assetId)) return out({ ok: false, error: 'invalid_asset_id' }, 400)

      const { data: asset, error: assetError } = await admin
        .from('audio_assets')
        .select('id,user_id,kind,sha256,original_name')
        .eq('id', assetId)
        .eq('user_id', user.id)
        .in('kind', ['take', 'source'])
        .maybeSingle()
      if (assetError) throw assetError
      if (!asset || !sha256(asset.sha256)) return out({ ok: false, error: 'identity_reference_requires_verified_source_or_take' }, 409)

      const label = String(body.label || asset.original_name || 'Referência de identidade').trim().slice(0, 160)
      await admin
        .from('voice_identity_references')
        .update({ is_active: false })
        .eq('user_id', user.id)
        .eq('voice_model_id', activeModel.id)
        .eq('is_active', true)

      const { data: reference, error: insertError } = await admin
        .from('voice_identity_references')
        .insert({
          user_id: user.id,
          voice_model_id: activeModel.id,
          asset_id: asset.id,
          source_sha256: String(asset.sha256).toLowerCase(),
          label,
          is_active: true,
        })
        .select('id,voice_model_id,asset_id,source_sha256,label,is_active,created_at,updated_at')
        .maybeSingle()
      if (insertError) throw insertError

      return out({ ok: true, version: 1, reference })
    }

    if (action === 'clear') {
      if (!activeModel) return out({ ok: true, version: 1, cleared: false })
      const { error } = await admin
        .from('voice_identity_references')
        .update({ is_active: false })
        .eq('user_id', user.id)
        .eq('voice_model_id', activeModel.id)
        .eq('is_active', true)
      if (error) throw error
      return out({ ok: true, version: 1, cleared: true })
    }

    return out({ ok: false, error: 'unsupported_action' }, 400)
  } catch (error) {
    return out({ ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 1200) }, 500)
  }
})
