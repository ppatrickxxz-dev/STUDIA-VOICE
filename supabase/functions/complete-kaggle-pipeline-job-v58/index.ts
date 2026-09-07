import { createClient } from 'npm:@supabase/supabase-js@2.112.2'

const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
const isSha=(v:any)=>/^[0-9a-f]{64}$/i.test(String(v||''))
const ACE_REVISION='ca1e85fe9430179831e6bc6be790c332190a3866'
const ACE_MODEL='acestep-v15-turbo'
const MUSIC_JOB_TYPES=new Set(['music_generation','music_repaint'])
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
    const jobType=String(job.job_type||'')
    if(!MUSIC_JOB_TYPES.has(jobType)||job.status!=='waiting_kaggle')return json({ok:false,error:'job_not_waiting_music'},409)
    const p=job.parameters||{}
    const expiresAt=Number(p.kaggle_expires_at||0)
    if(!expiresAt||Math.floor(Date.now()/1000)>expiresAt)return json({ok:false,error:'callback_token_expired'},410)
    if((await sha256Text(token))!==String(p.kaggle_callback_hash||''))return json({ok:false,error:'invalid_callback_token'},401)
    if(String(p.ace_revision||'')!==ACE_REVISION||String(p.ace_model||'')!==ACE_MODEL)return json({ok:false,error:'job_engine_identity_mismatch'},409)
    const outputPath=String(p.kaggle_output_path||'')
    if(!outputPath)return json({ok:false,error:'output_path_missing'},409)
    const {data:exists}=await admin.storage.from('audio-private').exists(outputPath)
    if(!exists)return json({ok:false,error:'output_object_not_found'},409)

    let repaintProof:any=null
    if(jobType==='music_repaint'){
      const sourceAssetId=String(p.source_asset_id||'')
      const sourceSha=String(body?.source_audio_sha256||'').toLowerCase()
      const sourceDuration=Number(body?.source_duration_seconds)
      const start=Number(body?.repaint_start_seconds),end=Number(body?.repaint_end_seconds)
      const outside=body?.outside_preservation&&typeof body.outside_preservation==='object'?body.outside_preservation:null
      if(!sourceAssetId||!Array.isArray(job.input_asset_ids)||!job.input_asset_ids.map(String).includes(sourceAssetId))return json({ok:false,error:'repaint_source_job_mismatch'},409)
      if(!isSha(sourceSha)||sourceSha!==String(p.source_audio_sha256||'').toLowerCase())return json({ok:false,error:'repaint_source_sha_mismatch'},409)
      if(!Number.isFinite(sourceDuration)||Math.abs(sourceDuration-Number(p.source_duration_seconds))>0.25||Math.abs(duration-sourceDuration)>0.25)return json({ok:false,error:'repaint_duration_mismatch'},409)
      if(!Number.isFinite(start)||!Number.isFinite(end)||Math.abs(start-Number(p.repaint_start_seconds))>0.001||Math.abs(end-Number(p.repaint_end_seconds))>0.001)return json({ok:false,error:'repaint_range_mismatch'},409)
      const windows=['before','after'].map(k=>outside?.[k]).filter(Boolean)
      const windowsVerified=windows.length>0&&windows.every((w:any)=>w?.verified===true&&isSha(w?.source_pcm_sha256)&&w.source_pcm_sha256===w.output_pcm_sha256)
      if(body?.preserved_outside_verified!==true||outside?.verified!==true||!windowsVerified)return json({ok:false,error:'repaint_outside_preservation_failed'},409)
      repaintProof={source_asset_id:sourceAssetId,source_audio_sha256:sourceSha,source_duration_seconds:sourceDuration,repaint_start_seconds:start,repaint_end_seconds:end,preserved_outside_verified:true,outside_preservation:outside,repaint_mode:String(p.repaint_mode||'balanced'),repaint_strength:Number(p.repaint_strength)}
    }

    const {data:claim}=await admin.from('render_jobs').update({status:'finalizing',progress:95,current_stage:'verifying',human_message:jobType==='music_repaint'?'Validando a seção e o restante da música':'Validando o áudio gerado'}).eq('id',jobId).eq('status','waiting_kaggle').select('id')
    if(!claim?.length)return json({ok:false,error:'job_already_claimed'},409)
    claimed=true
    const purpose=jobType==='music_repaint'?'section_repaint_reference_mix':'generated_reference_mix'
    const metadata:any={engine:'ACE-Step 1.5',model:ACE_MODEL,model_revision:ACE_REVISION,worker:'kaggle_ticketed',provider:'kaggle',purpose,generation_seed:Number.isFinite(seed)?seed:null,bpm:Number(p.bpm)||null,keyscale:String(p.keyscale||''),instrumental:Boolean(p.instrumental),proof_version:jobType==='music_repaint'?'pablovoice_native_repaint_v1':'pablovoice_native_music_v1'}
    if(repaintProof)Object.assign(metadata,{source_asset_id:repaintProof.source_asset_id,repaint_start_seconds:repaintProof.repaint_start_seconds,repaint_end_seconds:repaintProof.repaint_end_seconds,preserved_outside_verified:true})
    const originalName=jobType==='music_repaint'?`repainted-section-${jobId.slice(0,8)}.flac`:`generated-music-${jobId.slice(0,8)}.flac`
    const {data:asset,error:assetErr}=await admin.from('audio_assets').insert({project_id:job.project_id,version_id:job.version_id,user_id:job.user_id,kind:'full_mix',storage_bucket:'audio-private',storage_path:outputPath,original_name:originalName,mime_type:mimeType,size_bytes:audioSize,duration_seconds:duration,sample_rate:Math.round(sampleRate),channels:Math.round(channels),sha256:audioSha,metadata}).select('id').maybeSingle()
    if(assetErr||!asset?.id)throw new Error(`asset_insert_failed: ${assetErr?.message||'unknown'}`)
    const cleaned={...p};delete cleaned.kaggle_callback_hash
    const proof:any={verified:true,worker:'kaggle_ticketed',engine:'ACE-Step 1.5',model:ACE_MODEL,model_revision:ACE_REVISION,audio_sha256:audioSha,audio_size_bytes:audioSize,duration_seconds:duration,sample_rate:Math.round(sampleRate),channels:Math.round(channels),output_asset_id:asset.id,generation_seed:Number.isFinite(seed)?seed:null}
    if(repaintProof)Object.assign(proof,repaintProof)
    const {error:finishErr}=await admin.from('render_jobs').update({status:'completed',progress:100,current_stage:'completed',human_message:jobType==='music_repaint'?'Nova versão da seção criada':'Música criada',engine:'ace_step_1_5_turbo',provider:'kaggle',output_asset_ids:[asset.id],proof,error_code:null,error_message:null,technical_error:null,finished_at:new Date().toISOString(),parameters:cleaned}).eq('id',jobId).eq('status','finalizing')
    if(finishErr)throw new Error(`job_finalize_failed: ${finishErr.message}`)
    return json({ok:true,job_id:jobId,job_type:jobType,asset_id:asset.id,proof})
  }catch(e){
    const message=String(e instanceof Error?e.message:e).slice(0,1200)
    if(claimed&&jobId)try{await admin.from('render_jobs').update({status:'error',progress:0,current_stage:'finalize_failed',error_code:'music_finalize_failed',error_message:'O processamento terminou, mas a validação final falhou.',technical_error:message,finished_at:new Date().toISOString()}).eq('id',jobId).eq('status','finalizing')}catch{}
    return json({ok:false,error:message},500)
  }
})