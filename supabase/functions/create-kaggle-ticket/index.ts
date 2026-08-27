import { createClient } from 'npm:@supabase/supabase-js@2.112.2'
import { corsHeaders } from 'jsr:@supabase/supabase-js@2/cors'

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})
function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes); crypto.getRandomValues(buf)
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
async function sha256Text(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}
const isUuid = v => /^[0-9a-f-]{36}$/i.test(String(v || ''))
const isSha = v => /^[0-9a-f]{64}$/i.test(String(v || ''))

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok:false, error:'method_not_allowed' }, 405)
  try {
    const authHeader = req.headers.get('authorization') || ''
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!accessToken) return json({ ok:false, error:'auth_required' }, 401)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}')
    const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
    const publishableKey = publishableKeys.default || Deno.env.get('SUPABASE_ANON_KEY')
    const adminKey = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !publishableKey || !adminKey) return json({ ok:false, error:'server_configuration_error' }, 500)
    const userClient = createClient(supabaseUrl, publishableKey, { global:{ headers:{ Authorization:`Bearer ${accessToken}` } }, auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} })
    const admin = createClient(supabaseUrl, adminKey, { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} })
    const { data:userData, error:userErr } = await userClient.auth.getUser(accessToken)
    const user = userData?.user
    if (userErr || !user) return json({ ok:false, error:'invalid_session' }, 401)

    const body = await req.json().catch(() => ({}))
    const projectId = String(body.project_id || '')
    const jobType = String(body.job_type || 'rvc')
    const requestedSourceId = body.source_asset_id ? String(body.source_asset_id) : ''
    if (!isUuid(projectId)) return json({ ok:false, error:'invalid_project_id' }, 400)
    if (!['stems','rvc','mix_master'].includes(jobType)) return json({ ok:false, error:'unsupported_job_type' }, 400)
    const { data:project } = await admin.from('projects').select('id,title').eq('id',projectId).eq('user_id',user.id).maybeSingle()
    if (!project) return json({ ok:false, error:'project_not_found' }, 404)
    const { data:versionRows } = await admin.from('project_versions').select('id').eq('project_id',projectId).eq('user_id',user.id).order('version_number',{ascending:false}).limit(1)
    const versionId = versionRows?.[0]?.id || null
    const ttlSeconds = 5400, expiresAt = Math.floor(Date.now()/1000)+ttlSeconds
    const callbackToken = randomToken(32), callbackHash = await sha256Text(callbackToken), jobId = crypto.randomUUID()
    const signedDownload = async asset => {
      const { data,error } = await admin.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, ttlSeconds)
      if (error || !data?.signedUrl) throw new Error('signed_download_failed')
      return data.signedUrl
    }
    const signedModelDownload = async path => {
      const { data,error } = await admin.storage.from('voice-models-private').createSignedUrl(path, ttlSeconds)
      if (error || !data?.signedUrl) throw new Error('signed_model_download_failed')
      return data.signedUrl
    }
    const signedUpload = async path => {
      const { data,error } = await admin.storage.from('audio-private').createSignedUploadUrl(path)
      if (error || !data?.token) throw new Error('signed_upload_failed')
      return { bucket:'audio-private', path, token:data.token }
    }
    const latestAsset = async kinds => {
      let q = admin.from('audio_assets').select('*').eq('project_id',projectId).eq('user_id',user.id)
      if (kinds.length === 1) q = q.eq('kind',kinds[0]); else q = q.in('kind',kinds)
      const { data,error } = await q.order('created_at',{ascending:false}).limit(1)
      if (error) throw error
      return data?.[0] || null
    }
    let ticket, params, inputIds=[]

    if (jobType === 'stems') {
      let source = null
      if (requestedSourceId) {
        const { data } = await admin.from('audio_assets').select('*').eq('id',requestedSourceId).eq('project_id',projectId).eq('user_id',user.id).maybeSingle(); source=data
      } else source = await latestAsset(['full_mix','source','reference'])
      if (!source) return json({ok:false,error:'source_asset_not_found'},404)
      if (!isSha(source.sha256)) return json({ok:false,error:'source_asset_missing_sha256'},409)
      const vocalOut = await signedUpload(`${user.id}/${projectId}/stems/${jobId}-guide-vocal.wav`)
      const instOut = await signedUpload(`${user.id}/${projectId}/stems/${jobId}-instrumental.wav`)
      params={client:'v3.6',profile:'htdemucs',kaggle_callback_hash:callbackHash,kaggle_expires_at:expiresAt,kaggle_source_asset_id:source.id,kaggle_vocal_output_path:vocalOut.path,kaggle_instrumental_output_path:instOut.path}
      inputIds=[source.id]
      ticket={version:4,job_type:'stems',job_id:jobId,project_title:project.title,expires_at:expiresAt,source_url:await signedDownload(source),source_sha256:String(source.sha256).toLowerCase(),outputs:{vocal:vocalOut,instrumental:instOut},supabase_url:supabaseUrl,supabase_publishable_key:publishableKey,complete_url:`${supabaseUrl}/functions/v1/complete-kaggle-stems-job`,callback_token:callbackToken,profile:{name:'htdemucs',two_stems:'vocals'}}
    }

    if (jobType === 'rvc') {
      let source = null
      if (requestedSourceId) {
        const { data } = await admin.from('audio_assets').select('*').eq('id',requestedSourceId).eq('project_id',projectId).eq('user_id',user.id).maybeSingle(); source=data
      } else source = await latestAsset(['guide_vocal','vocal','guide'])
      if (!source) return json({ok:false,error:'guide_vocal_not_found_run_stems_first'},409)
      if (!isSha(source.sha256)) return json({ok:false,error:'source_asset_missing_sha256'},409)
      const { data:modelRows } = await admin.from('voice_models').select('*').eq('user_id',user.id).eq('is_active',true).eq('status','ready').order('updated_at',{ascending:false}).limit(1)
      const model=modelRows?.[0]
      if (!model) return json({ok:false,error:'active_voice_model_not_found'},409)
      if (!isSha(model.pth_sha256)||!isSha(model.index_sha256)) return json({ok:false,error:'voice_model_missing_sha256'},409)
      const out=await signedUpload(`${user.id}/${projectId}/renders/${jobId}-pablo-voice.wav`)
      params={client:'v3.6',profile:'Natural',kaggle_callback_hash:callbackHash,kaggle_expires_at:expiresAt,kaggle_output_path:out.path,kaggle_source_asset_id:source.id,kaggle_voice_model_id:model.id}
      inputIds=[source.id]
      ticket={version:4,job_type:'rvc',job_id:jobId,project_title:project.title,expires_at:expiresAt,source_url:await signedDownload(source),source_sha256:String(source.sha256).toLowerCase(),pth_url:await signedModelDownload(model.pth_storage_path),pth_sha256:String(model.pth_sha256).toLowerCase(),index_url:await signedModelDownload(model.index_storage_path),index_sha256:String(model.index_sha256).toLowerCase(),outputs:{voice:out},supabase_url:supabaseUrl,supabase_publishable_key:publishableKey,complete_url:`${supabaseUrl}/functions/v1/complete-kaggle-job`,callback_token:callbackToken,profile:{name:'Natural',pitch:0,index_rate:0.62,protect:0.45,f0_method:'rmvpe',f0_autotune:false,clean_audio:false,formant_shifting:false,embedder_model:'contentvec'}}
    }

    if (jobType === 'mix_master') {
      const vocal=await latestAsset(['pablo_voice']), instrumental=await latestAsset(['instrumental'])
      if (!vocal) return json({ok:false,error:'pablo_voice_asset_not_found'},409)
      if (!instrumental) return json({ok:false,error:'instrumental_asset_not_found'},409)
      if (!isSha(vocal.sha256)||!isSha(instrumental.sha256)) return json({ok:false,error:'mix_inputs_missing_sha256'},409)
      const wav=await signedUpload(`${user.id}/${projectId}/masters/${jobId}-master.wav`)
      const m4a=await signedUpload(`${user.id}/${projectId}/masters/${jobId}-master.m4a`)
      params={client:'v3.6',profile:'mix_v2_2',kaggle_callback_hash:callbackHash,kaggle_expires_at:expiresAt,kaggle_vocal_asset_id:vocal.id,kaggle_instrumental_asset_id:instrumental.id,kaggle_master_wav_path:wav.path,kaggle_master_m4a_path:m4a.path,target_lufs:-12,true_peak:-1,sample_rate:48000}
      inputIds=[vocal.id,instrumental.id]
      ticket={version:4,job_type:'mix_master',job_id:jobId,project_title:project.title,expires_at:expiresAt,vocal_url:await signedDownload(vocal),vocal_sha256:String(vocal.sha256).toLowerCase(),instrumental_url:await signedDownload(instrumental),instrumental_sha256:String(instrumental.sha256).toLowerCase(),outputs:{master_wav:wav,master_m4a:m4a},supabase_url:supabaseUrl,supabase_publishable_key:publishableKey,complete_url:`${supabaseUrl}/functions/v1/complete-kaggle-mix-job`,callback_token:callbackToken,profile:{name:'PabloVoice Mix V2.2',vocal_db:0,instrumental_db:-2,target_lufs:-12,true_peak:-1,lra:9,sample_rate:48000,channels:2,bit_depth:24,reverb:0.05}}
    }

    const { error:jobErr } = await admin.from('render_jobs').insert({id:jobId,project_id:projectId,version_id:versionId,user_id:user.id,job_type:jobType,engine:'kaggle_ticketed',status:'waiting_kaggle',progress:10,input_asset_ids:inputIds,output_asset_ids:[],parameters:params,proof:{required:true},started_at:new Date().toISOString()})
    if (jobErr) return json({ok:false,error:`job_insert_failed: ${jobErr.message}`},500)
    return json({ok:true,job_id:jobId,job_type:jobType,expires_at:expiresAt,ticket})
  } catch (error) {
    return json({ok:false,error:String(error?.message||error).slice(0,1200)},500)
  }
})