import { createClient } from 'npm:@supabase/supabase-js@2.112.2'

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})
const isSha = (v) => /^[0-9a-f]{64}$/i.test(String(v || ''))
const REQUIRED_INSTRUMENTAL_METHOD = 'mixture_residual_source_minus_vocals_v1'
async function sha256Text(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok:false, error:'method_not_allowed' }, 405)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
  const adminKey = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !adminKey) return json({ok:false,error:'server_configuration_error'},500)
  const admin = createClient(supabaseUrl, adminKey, { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} })
  let claimed = false, jobId = ''
  try {
    const body = await req.json()
    jobId = String(body?.job_id || '')
    const token = String(body?.callback_token || '')
    const sourceSha = String(body?.source_sha256 || '').toLowerCase()
    const vocalSha = String(body?.vocal_sha256 || '').toLowerCase()
    const instrumentalSha = String(body?.instrumental_sha256 || '').toLowerCase()
    const vocalSize = Number.isFinite(Number(body?.vocal_size_bytes)) ? Number(body.vocal_size_bytes) : null
    const instrumentalSize = Number.isFinite(Number(body?.instrumental_size_bytes)) ? Number(body.instrumental_size_bytes) : null
    const demucsVersion = String(body?.demucs_version || '').slice(0,80)
    const instrumentalMethod = String(body?.instrumental_method || '').slice(0,120)
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json({ok:false,error:'invalid_job_id'},400)
    if (token.length < 32 || token.length > 512) return json({ok:false,error:'invalid_callback_token'},401)
    if (![sourceSha,vocalSha,instrumentalSha].every(isSha)) return json({ok:false,error:'invalid_sha256_proof'},400)
    if (vocalSha === sourceSha || instrumentalSha === sourceSha || vocalSha === instrumentalSha) return json({ok:false,error:'proof_gate_failed'},400)
    if (instrumentalMethod !== REQUIRED_INSTRUMENTAL_METHOD) return json({ok:false,error:'instrumental_method_mismatch'},400)

    const { data:job } = await admin.from('render_jobs').select('*').eq('id',jobId).maybeSingle()
    if (!job) return json({ok:false,error:'job_not_found'},404)
    if (job.job_type !== 'stems' || job.status !== 'waiting_kaggle') return json({ok:false,error:'job_not_waiting_stems'},409)
    const p = job.parameters || {}
    const expiresAt = Number(p.kaggle_expires_at || 0)
    if (!expiresAt || Math.floor(Date.now()/1000) > expiresAt) return json({ok:false,error:'callback_token_expired'},410)
    if ((await sha256Text(token)) !== String(p.kaggle_callback_hash || '')) return json({ok:false,error:'invalid_callback_token'},401)
    const { data:source } = await admin.from('audio_assets').select('*').eq('id',String(p.kaggle_source_asset_id||'')).eq('user_id',job.user_id).maybeSingle()
    if (!source) return json({ok:false,error:'source_asset_not_found'},404)
    if (source.sha256 && String(source.sha256).toLowerCase() !== sourceSha) return json({ok:false,error:'source_hash_mismatch'},409)
    const vocalPath = String(p.kaggle_vocal_output_path || ''), instrumentalPath = String(p.kaggle_instrumental_output_path || '')
    if (!vocalPath || !instrumentalPath) return json({ok:false,error:'output_paths_missing'},409)
    const [{data:vocalExists},{data:instExists}] = await Promise.all([
      admin.storage.from('audio-private').exists(vocalPath),
      admin.storage.from('audio-private').exists(instrumentalPath),
    ])
    if (!vocalExists || !instExists) return json({ok:false,error:'output_object_not_found'},409)
    const { data:claim } = await admin.from('render_jobs').update({status:'finalizing',progress:95}).eq('id',jobId).eq('status','waiting_kaggle').select('id')
    if (!claim?.length) return json({ok:false,error:'job_already_claimed'},409)
    claimed = true
    const { data:assets, error:assetErr } = await admin.from('audio_assets').insert([
      {project_id:job.project_id,version_id:job.version_id,user_id:job.user_id,kind:'guide_vocal',storage_bucket:'audio-private',storage_path:vocalPath,original_name:`guide-vocal-${jobId.slice(0,8)}.wav`,mime_type:'audio/wav',size_bytes:vocalSize,sha256:vocalSha,metadata:{engine:'Demucs',model:'htdemucs',worker:'kaggle_ticketed',source_asset_id:source.id,demucs_version:demucsVersion}},
      {project_id:job.project_id,version_id:job.version_id,user_id:job.user_id,kind:'instrumental',storage_bucket:'audio-private',storage_path:instrumentalPath,original_name:`instrumental-${jobId.slice(0,8)}.wav`,mime_type:'audio/wav',size_bytes:instrumentalSize,sha256:instrumentalSha,metadata:{engine:'Demucs',model:'htdemucs',worker:'kaggle_ticketed',source_asset_id:source.id,demucs_version:demucsVersion,instrumental_method:instrumentalMethod}},
    ]).select('id,kind')
    if (assetErr || !assets?.length) throw new Error(`asset_insert_failed: ${assetErr?.message || 'unknown'}`)
    const vocalId = assets.find(a=>a.kind==='guide_vocal')?.id, instrumentalId = assets.find(a=>a.kind==='instrumental')?.id
    if (!vocalId || !instrumentalId) throw new Error('asset_ids_missing')
    const cleaned={...p}; delete cleaned.kaggle_callback_hash
    const proof={verified:true,worker:'kaggle_ticketed',engine:'Demucs',model:'htdemucs',source_sha256:sourceSha,vocal_sha256:vocalSha,instrumental_sha256:instrumentalSha,source_asset_id:source.id,vocal_asset_id:vocalId,instrumental_asset_id:instrumentalId,demucs_version:demucsVersion,instrumental_method:instrumentalMethod}
    const { error:finishErr } = await admin.from('render_jobs').update({status:'completed',progress:100,engine:'kaggle_ticketed',output_asset_ids:[vocalId,instrumentalId],proof,error_message:null,finished_at:new Date().toISOString(),parameters:cleaned}).eq('id',jobId).eq('status','finalizing')
    if (finishErr) throw new Error(`job_finalize_failed: ${finishErr.message}`)
    return json({ok:true,job_id:jobId,vocal_asset_id:vocalId,instrumental_asset_id:instrumentalId,proof})
  } catch (e) {
    const message=String(e instanceof Error?e.message:e).slice(0,1200)
    if (claimed && jobId) try{await admin.from('render_jobs').update({status:'error',error_message:message,finished_at:new Date().toISOString()}).eq('id',jobId).eq('status','finalizing')}catch{}
    return json({ok:false,error:message},500)
  }
})
