import { createClient } from 'npm:@supabase/supabase-js@2.112.2'

const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
const isSha=(v:any)=>/^[0-9a-f]{64}$/i.test(String(v||''))
const ACE_REVISION='ca1e85fe9430179831e6bc6be790c332190a3866'
const ACE_MODEL='acestep-v15-turbo'
async function sha256Text(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('')}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405)
  const supabaseUrl=Deno.env.get('SUPABASE_URL')||''
  const secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')
  const adminKey=secretKeys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
  if(!supabaseUrl||!adminKey)return json({ok:false,error:'server_configuration_error'},500)
  const admin=createClient(supabaseUrl,adminKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
  let claimed=false,jobId=''
  try{
    const body=await req.json().catch(()=>({}))
    jobId=String(body?.job_id||'')
    const token=String(body?.callback_token||'')
    const audioSha=String(body?.audio_sha256||'').toLowerCase()
    const audioSize=Number(body?.audio_size_bytes)
    const duration=Number(body?.duration_seconds)
    const sampleRate=Number(body?.sample_rate)
    const channels=Number(body?.channels)
    const mimeType=String(body?.mime_type||'audio/flac').slice(0,80)
    const aceRevision=String(body?.ace_revision||'')
    const aceModel=String(body?.ace_model||'')
    const seed=Number(body?.generation_seed)
    if(!/^[0-9a-f-]{36}$/i.test(jobId))return json({ok:false,error:'invalid_job_id'},400)
    if(token.length<32||token.length>512)return json({ok:false,error:'invalid_callback_token'},401)
    if(!isSha(audioSha))return json({ok:false,error:'invalid_sha256_proof'},400)
    if(!Number.isFinite(audioSize)||audioSize<=4096)return json({ok:false,error:'invalid_audio_size'},400)
    if(!Number.isFinite(duration)||duration<=1||duration>610)return json({ok:false,error:'invalid_duration'},400)
    if(!Number.isFinite(sampleRate)||sampleRate<16000||sampleRate>192000)return json({ok:false,error:'invalid_sample_rate'},400)
    if(!Number.isFinite(channels)||channels<1||channels>8)return json({ok:false,error:'invalid_channels'},400)
    if(aceRevision!==ACE_REVISION||aceModel!==ACE_MODEL)return json({ok:false,error:'engine_identity_mismatch'},409)

    const {data:job}=await admin.from('render_jobs').select('*').eq('id',jobId).maybeSingle()
    if(!job)return json({ok:false,error:'job_not_found'},404)
    if(job.job_type!=='music_generation'||job.status!=='waiting_kaggle')return json({ok:false,error:'job_not_waiting_music'},409)
    const p=job.parameters||{}
    const expiresAt=Number(p.kaggle_expires_at||0)
    if(!expiresAt||Math.floor(Date.now()/1000)>expiresAt)return json({ok:false,error:'callback_token_expired'},410)
    if((await sha256Text(token))!==String(p.kaggle_callback_hash||''))return json({ok:false,error:'invalid_callback_token'},401)
    if(String(p.ace_revision||'')!==ACE_REVISION||String(p.ace_model||'')!==ACE_MODEL)return json({ok:false,error:'job_engine_identity_mismatch'},409)
    const outputPath=String(p.kaggle_output_path||'')
    if(!outputPath)return json({ok:false,error:'output_path_missing'},409)
    const {data:exists}=await admin.storage.from('audio-private').exists(outputPath)
    if(!exists)return json({ok:false,error:'output_object_not_found'},409)

    const {data:claim}=await admin.from('render_jobs').update({status:'finalizing',progress:95,current_stage:'verifying',human_message:'Validando o áudio gerado'}).eq('id',jobId).eq('status','waiting_kaggle').select('id')
    if(!claim?.length)return json({ok:false,error:'job_already_claimed'},409)
    claimed=true
    const metadata={engine:'ACE-Step 1.5',model:ACE_MODEL,model_revision:ACE_REVISION,worker:'kaggle_ticketed',provider:'kaggle',purpose:'generated_reference_mix',generation_seed:Number.isFinite(seed)?seed:null,bpm:Number(p.bpm)||null,keyscale:String(p.keyscale||''),instrumental:Boolean(p.instrumental),proof_version:'pablovoice_native_music_v1'}
    const {data:asset,error:assetErr}=await admin.from('audio_assets').insert({project_id:job.project_id,version_id:job.version_id,user_id:job.user_id,kind:'full_mix',storage_bucket:'audio-private',storage_path:outputPath,original_name:`generated-music-${jobId.slice(0,8)}.flac`,mime_type:mimeType,size_bytes:audioSize,duration_seconds:duration,sample_rate:Math.round(sampleRate),channels:Math.round(channels),sha256:audioSha,metadata}).select('id').maybeSingle()
    if(assetErr||!asset?.id)throw new Error(`asset_insert_failed: ${assetErr?.message||'unknown'}`)
    const cleaned={...p};delete cleaned.kaggle_callback_hash
    const proof={verified:true,worker:'kaggle_ticketed',engine:'ACE-Step 1.5',model:ACE_MODEL,model_revision:ACE_REVISION,audio_sha256:audioSha,audio_size_bytes:audioSize,duration_seconds:duration,sample_rate:Math.round(sampleRate),channels:Math.round(channels),output_asset_id:asset.id,generation_seed:Number.isFinite(seed)?seed:null}
    const {error:finishErr}=await admin.from('render_jobs').update({status:'completed',progress:100,current_stage:'completed',human_message:'Música criada',engine:'ace_step_1_5_turbo',provider:'kaggle',output_asset_ids:[asset.id],proof,error_code:null,error_message:null,technical_error:null,finished_at:new Date().toISOString(),parameters:cleaned}).eq('id',jobId).eq('status','finalizing')
    if(finishErr)throw new Error(`job_finalize_failed: ${finishErr.message}`)
    return json({ok:true,job_id:jobId,asset_id:asset.id,proof})
  }catch(e){
    const message=String(e instanceof Error?e.message:e).slice(0,1200)
    if(claimed&&jobId)try{await admin.from('render_jobs').update({status:'error',progress:0,current_stage:'finalize_failed',error_code:'music_finalize_failed',error_message:'A geração terminou, mas a validação final falhou.',technical_error:message,finished_at:new Date().toISOString()}).eq('id',jobId).eq('status','finalizing')}catch{}
    return json({ok:false,error:message},500)
  }
})
