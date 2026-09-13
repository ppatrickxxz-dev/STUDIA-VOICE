import { createClient } from 'npm:@supabase/supabase-js@2.112.2'

const cors={
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'authorization, x-client-info, apikey, content-type, x-pv-dispatch-token',
  'access-control-allow-methods':'GET, POST, OPTIONS'
}
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
const isUuid=(v:any)=>/^[0-9a-f-]{36}$/i.test(String(v||''))
const ACE_REPO='https://github.com/ace-step/ACE-Step-1.5.git'
const ACE_REVISION='ca1e85fe9430179831e6bc6be790c332190a3866'
const ACE_MODEL='acestep-v15-turbo'
const WORKER_SLUG='kaggle-worker-source-v58'
const COMPLETE_SLUG='complete-kaggle-pipeline-job-v58'
const B09_PROJECT_ID='d64e4de9-791e-41bc-9307-7957389b2499'
const LEASE_TTL_SECONDS=1800
const QUEUE_RETRY_SECONDS=30

function b64(v:string){return btoa(unescape(encodeURIComponent(v)))}
function randomToken(bytes=32){const buf=new Uint8Array(bytes);crypto.getRandomValues(buf);return btoa(String.fromCharCode(...buf)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'')}
function randomGenerationSeed(){const buf=new Uint32Array(1);crypto.getRandomValues(buf);return (Number(buf[0])%2147483646)+1}
async function sha256Text(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('')}
function clamp(n:number,min:number,max:number){return Math.max(min,Math.min(max,n))}
function clean(value:any,max:number){return String(value||'').trim().replace(/\s+/g,' ').slice(0,max)}
function normalizeLanguage(value:any){const raw=clean(value,16).toLowerCase();if(!raw)return'pt';if(raw.startsWith('pt'))return'pt';if(raw.startsWith('en'))return'en';if(raw.startsWith('es'))return'es';if(raw.startsWith('fr'))return'fr';if(raw.startsWith('de'))return'de';if(raw.startsWith('it'))return'it';return raw.split(/[-_]/)[0].slice(0,8)||'pt'}
function isCapacityError(value:any){return /maximum batch gpu session count|gpu session count|capacity|too many.*gpu|concurrent.*gpu/i.test(String(value||''))}
function sectionTag(id:string){
  const v=String(id||'').toLowerCase()
  if(v.includes('refr')||v.includes('chorus'))return 'Chorus'
  if(v.includes('pre'))return 'Pre-Chorus'
  if(v.includes('ponte')||v.includes('bridge'))return 'Bridge'
  if(v.includes('intro'))return 'Intro'
  if(v.includes('outro'))return 'Outro'
  return 'Verse'
}
function buildLyrics(plan:any,instrumental:boolean){
  if(instrumental)return '[Instrumental]'
  const lines=Array.isArray(plan?.guideLines)?plan.guideLines:[]
  const usable=lines.map((line:any)=>({text:clean(line?.text,600),sectionId:clean(line?.sectionId,80)})).filter((line:any)=>line.text)
  if(!usable.length)return '[Instrumental]'
  let current='',out:string[]=[]
  for(const line of usable){const tag=sectionTag(line.sectionId);if(tag!==current){out.push(`[${tag}]`);current=tag}out.push(line.text)}
  return out.join('\n').slice(0,4096)
}
function captionFromPlan(plan:any,negativeStyles:any[]){
  const rawBrief=String(plan?.brief||'').trim()
  const marker='PabloVoice 2.0 Song DNA:'
  const markerAt=rawBrief.indexOf(marker)
  const userBrief=clean(markerAt>=0?rawBrief.slice(0,markerAt):rawBrief,120)
  const songDna=clean(markerAt>=0?rawBrief.slice(markerAt+marker.length):'',75)
  const style=[clean(plan?.genre,24),clean(plan?.mood,28)].filter(Boolean).join(', ')
  const singer=plan?.singerProfile||{}
  const lowMidi=clamp(Math.round(Number(singer.lowMidi)||48),24,96)
  const highMidi=clamp(Math.round(Number(singer.highMidi)||67),lowMidi,108)
  const singerDirection=[
    clean(singer.voiceType,12),
    clean(singer.tone,20),
    clean(singer.delivery,24),
    `MIDI ${lowMidi}-${highMidi}`,
    singer.falsetto?'falsetto ok':'no falsetto',
  ].filter(Boolean).join(', ')
  const avoid=(Array.isArray(negativeStyles)?negativeStyles:[]).map(v=>clean(v,24)).filter(Boolean).slice(0,5).join(', ')
  const parts=[
    userBrief,
    style?`Style: ${style}`:'',
    singerDirection?`Vocal: ${singerDirection}`:'',
    avoid?`Avoid: ${avoid}`:'',
    songDna?`Direction: ${songDna}`:'',
  ].filter(Boolean)
  return parts.join('. ').slice(0,512)
}
async function kaggleRpc(token:string,method:string,payload:any){
  const r=await fetch(`https://api.kaggle.com/v1/kernels.KernelsApiService/${method}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','user-agent':'PabloVoice-Music/2.4'},body:JSON.stringify(payload)})
  const text=await r.text();let out:any={};try{out=JSON.parse(text)}catch{out={raw:text.slice(0,1600)}}
  if(!r.ok||Number(out?.code||0)>=400)throw new Error(`Kaggle ${method}: ${out?.message||text.slice(0,600)}`)
  return out
}
function envClients(){
  const url=Deno.env.get('SUPABASE_URL')||''
  const pubs=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}')
  const secs=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')
  const pub=pubs.default||Deno.env.get('SUPABASE_ANON_KEY')||''
  const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||secs.default||''
  if(!url||!pub||!secret)return null
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
  return {url,pub,secret,admin}
}
async function readComputeConnection(admin:any,userId:string){const {data,error}=await admin.rpc('admin_get_compute_connection',{p_user_id:userId,p_provider:'kaggle'});if(error)throw error;return Array.isArray(data)?data[0]:null}
async function sharedComputeConnection(admin:any,user:any){
  let conn=await readComputeConnection(admin,user.id)
  if((!conn?.secret||!conn?.handle)&&user?.app_metadata?.pablovoice_app_device===true){
    const {data:anchor,error}=await admin.from('projects').select('user_id').eq('id',B09_PROJECT_ID).maybeSingle()
    if(error)throw error
    if(anchor?.user_id)conn=await readComputeConnection(admin,String(anchor.user_id))
  }
  return conn
}
async function queuedComputeConnection(admin:any,userId:string,allowShared:boolean){
  let conn=await readComputeConnection(admin,userId)
  if((!conn?.secret||!conn?.handle)&&allowShared){
    const {data:anchor,error}=await admin.from('projects').select('user_id').eq('id',B09_PROJECT_ID).maybeSingle()
    if(error)throw error
    if(anchor?.user_id)conn=await readComputeConnection(admin,String(anchor.user_id))
  }
  return conn
}
async function acquireLease(admin:any,jobId:string){const {data,error}=await admin.rpc('acquire_music_generation_dispatch_lease',{p_job_id:jobId,p_ttl_seconds:LEASE_TTL_SECONDS});if(error)throw error;return data===true}
async function touchLease(admin:any,jobId:string){const {error}=await admin.rpc('touch_music_generation_dispatch_lease',{p_job_id:jobId,p_ttl_seconds:LEASE_TTL_SECONDS});if(error)console.error('music_lease_touch_failed',error.message)}
async function releaseLease(admin:any,jobId:string){const {error}=await admin.rpc('release_music_generation_dispatch_lease',{p_job_id:jobId});if(error)console.error('music_lease_release_failed',error.message)}
async function queuePosition(admin:any,job:any){
  const {count}=await admin.from('render_jobs').select('id',{count:'exact',head:true}).eq('job_type','music_generation').eq('status','queued').is('finished_at',null).lte('created_at',job.created_at)
  return Math.max(1,Number(count)||1)
}
async function internalDispatchAllowed(admin:any,secret:string,req:Request){
  const auth=req.headers.get('authorization')||''
  const bearer=auth.startsWith('Bearer ')?auth.slice(7):''
  if(bearer&&bearer===secret)return true
  const token=String(req.headers.get('x-pv-dispatch-token')||'')
  if(token.length<32)return false
  const {data,error}=await admin.rpc('validate_music_dispatch_token',{p_token:token})
  return !error&&data===true
}
async function dispatchQueuedJob(env:any,jobId:string){
  const {url,pub,admin}=env
  let leaseHeld=false,handedOff=false
  const {data:job,error:jobReadErr}=await admin.from('render_jobs').select('*').eq('id',jobId).maybeSingle()
  if(jobReadErr||!job)return {ok:false,error:'job_not_found',httpStatus:404}
  if(job.job_type!=='music_generation')return {ok:false,error:'job_type_mismatch',httpStatus:409}
  if(job.status!=='queued'||job.finished_at)return {ok:false,error:'job_not_queued',status:job.status,httpStatus:409}
  const retryAt=job.next_retry_at?Date.parse(String(job.next_retry_at)):0
  if(retryAt&&retryAt>Date.now())return {ok:true,queued:true,job_id:job.id,status:'queued',progress:Number(job.progress||5),retry_after_seconds:Math.max(1,Math.ceil((retryAt-Date.now())/1000)),fallback_allowed:false}
  const p=job.parameters||{}
  const q=p.queue_request||{}
  const generation=q.generation
  if(!generation||!generation.caption)return {ok:false,error:'queued_generation_missing',job_id:job.id,httpStatus:409}
  let conn:any=null
  try{conn=await queuedComputeConnection(admin,String(job.user_id),q.allow_shared_compute===true)}catch(error){return {ok:false,error:'music_compute_lookup_failed',detail:String(error instanceof Error?error.message:error).slice(0,600),job_id:job.id,httpStatus:503}}
  if(!conn?.secret||!conn?.handle){
    const now=new Date().toISOString()
    await admin.from('render_jobs').update({status:'error',progress:0,current_stage:'compute_unavailable',error_code:'music_compute_unavailable',error_message:'A GPU de criação musical não está configurada.',finished_at:now}).eq('id',job.id).eq('status','queued')
    return {ok:false,error:'music_compute_unavailable',job_id:job.id,httpStatus:409,fallback_allowed:false}
  }
  try{leaseHeld=await acquireLease(admin,job.id)}catch(error){return {ok:false,error:'music_dispatch_lease_failed',detail:String(error instanceof Error?error.message:error).slice(0,400),job_id:job.id,httpStatus:503,fallback_allowed:false}}
  if(!leaseHeld)return {ok:true,queued:true,job_id:job.id,status:'queued',progress:Number(job.progress||5),retry_after_seconds:QUEUE_RETRY_SECONDS,fallback_allowed:false}
  try{
    const now=new Date().toISOString()
    const {data:claimed}=await admin.from('render_jobs').update({status:'dispatching',progress:8,current_stage:'gpu_dispatch',heartbeat_at:now,started_at:job.started_at||now,human_message:'Abrindo uma vaga na GPU',error_code:null,error_message:null,technical_error:null,next_retry_at:null}).eq('id',job.id).eq('status','queued').select('id')
    if(!claimed?.length){await releaseLease(admin,job.id);leaseHeld=false;return {ok:false,error:'queue_claim_lost',job_id:job.id,httpStatus:409}}
    const {data:project}=await admin.from('projects').select('id,title').eq('id',job.project_id).eq('user_id',job.user_id).maybeSingle()
    if(!project)throw new Error('project_not_found')
    const expiresAt=Math.floor(Date.now()/1000)+5400
    const callbackToken=randomToken(32),callbackHash=await sha256Text(callbackToken)
    const outputPath=`${job.user_id}/${job.project_id}/music/${job.id}-full-mix.flac`
    const {data:upload,error:uploadErr}=await admin.storage.from('audio-private').createSignedUploadUrl(outputPath)
    if(uploadErr||!upload?.token)throw new Error('signed_upload_failed')
    const progressUrl=`${url}/functions/v1/progress-kaggle-pipeline-job-v58`
    const ticket={version:3,job_type:'music_generation',job_id:job.id,project_title:project.title,expires_at:expiresAt,generation,outputs:{full_mix:{bucket:'audio-private',path:outputPath,token:upload.token}},supabase_url:url,supabase_publishable_key:pub,complete_url:`${url}/functions/v1/${COMPLETE_SLUG}`,progress_url:progressUrl,callback_token:callbackToken,engine:{provider:'kaggle',name:'ACE-Step 1.5',model:ACE_MODEL,source_repo:ACE_REPO,source_revision:ACE_REVISION,download_source:'modelscope'}}
    const params={...p,kaggle_callback_hash:callbackHash,kaggle_expires_at:expiresAt,kaggle_output_path:outputPath,ace_revision:ACE_REVISION,ace_model:ACE_MODEL,dispatch_attempt:Number(p.dispatch_attempt||0)+1}
    await admin.from('render_jobs').update({parameters:params}).eq('id',job.id).eq('status','dispatching')
    const short=job.id.replace(/-/g,'').slice(0,10),owner=String(conn.handle),slug=`pablovoice-music-${short}`,full=`${owner}/${slug}`
    const workerUrl=`${url}/functions/v1/${WORKER_SLUG}`
    const bootstrap=`import requests,base64\nTICKET_B64='${b64(JSON.stringify(ticket))}'\nr=requests.get('${workerUrl}',timeout=60);r.raise_for_status()\nexec(compile(r.text,'pablovoice_music_worker.py','exec'),globals(),globals())\n`
    const payload={slug:full,newTitle:`PabloVoice Music ${short}`,text:bootstrap,language:'python',kernelType:'script',isPrivate:true,enableGpu:true,enableInternet:true,machineShape:'NvidiaTeslaT4',kernelExecutionType:'SAVE_AND_RUN_ALL',datasetDataSources:[],competitionDataSources:[],kernelDataSources:[],modelDataSources:[],sessionTimeoutSeconds:3600}
    let push:any
    try{push=await kaggleRpc(conn.secret,'SaveKernel',payload)}catch(e){
      const msg=String(e instanceof Error?e.message:e).slice(0,1200)
      if(isCapacityError(msg)){
        const retryAt=new Date(Date.now()+QUEUE_RETRY_SECONDS*1000).toISOString()
        await admin.from('render_jobs').update({status:'queued',progress:5,current_stage:'gpu_capacity',error_code:null,error_message:null,human_message:'GPU ocupada. Sua música continua na fila.',technical_error:msg,next_retry_at:retryAt,finished_at:null}).eq('id',job.id).eq('status','dispatching')
        await releaseLease(admin,job.id);leaseHeld=false
        return {ok:true,queued:true,job_id:job.id,status:'queued',progress:5,retry_after_seconds:QUEUE_RETRY_SECONDS,fallback_allowed:false}
      }
      await admin.from('render_jobs').update({status:'error',progress:0,current_stage:'dispatch_failed',error_code:'kaggle_dispatch_failed',error_message:'Falha ao iniciar a GPU para criar a música.',technical_error:msg,finished_at:new Date().toISOString()}).eq('id',job.id).eq('status','dispatching')
      await releaseLease(admin,job.id);leaseHeld=false
      return {ok:false,error:'kaggle_dispatch_failed',detail:msg,job_id:job.id,httpStatus:502,fallback_allowed:false}
    }
    const rejected=!!push?.hasError||!!push?.error||!Number(push?.kernelId)||!String(push?.ref||'')
    if(rejected){
      const msg=String(push?.error||'Kaggle recusou a criação do kernel.').slice(0,1200)
      const capacity=isCapacityError(msg)
      if(capacity){
        const retryAt=new Date(Date.now()+QUEUE_RETRY_SECONDS*1000).toISOString()
        await admin.from('render_jobs').update({status:'queued',progress:5,current_stage:'gpu_capacity',error_code:null,error_message:null,human_message:'GPU ocupada. Sua música continua na fila.',technical_error:msg,next_retry_at:retryAt,finished_at:null}).eq('id',job.id).eq('status','dispatching')
      }else{
        await admin.from('render_jobs').update({status:'error',progress:0,current_stage:'dispatch_rejected',error_code:'kaggle_dispatch_rejected',error_message:'A GPU recusou a geração musical.',technical_error:msg,finished_at:new Date().toISOString()}).eq('id',job.id).eq('status','dispatching')
      }
      await releaseLease(admin,job.id);leaseHeld=false
      if(capacity)return {ok:true,queued:true,job_id:job.id,status:'queued',progress:5,retry_after_seconds:QUEUE_RETRY_SECONDS,fallback_allowed:false}
      return {ok:false,error:'kaggle_dispatch_rejected',detail:msg,job_id:job.id,httpStatus:409,fallback_allowed:false}
    }
    const dispatchedAt=new Date().toISOString()
    await touchLease(admin,job.id)
    await admin.from('render_jobs').update({status:'waiting_kaggle',progress:15,current_stage:'gpu_queued',heartbeat_at:dispatchedAt,human_message:'Criando a música na GPU',external_job_id:String(push.kernelId),next_retry_at:null,parameters:{...params,kaggle_owner:owner,kaggle_slug:slug,kaggle_ref:push.ref,kaggle_url:push.url||null,kaggle_kernel_id:push.kernelId,kaggle_version_number:push.versionNumber,dispatcher:'compute-kaggle-v58:native-music-v2_4_queue',worker_slug:WORKER_SLUG,complete_slug:COMPLETE_SLUG,dispatched_at:dispatchedAt}}).eq('id',job.id).eq('status','dispatching')
    handedOff=true
    return {ok:true,dispatched:true,queued:false,job_id:job.id,status:'waiting_kaggle',progress:15,provider:'native_music',kernel:full,dispatcher:'compute-kaggle-v58',worker:WORKER_SLUG,generation_seed:Number(p.generation_seed)||Number(generation.seed)||null,dispatch_serialized:true,fallback_allowed:false}
  }catch(e){
    const message=String(e instanceof Error?e.message:e).slice(0,1400)
    await admin.from('render_jobs').update({status:'error',progress:0,current_stage:'dispatch_failed',error_code:'music_dispatch_failed',error_message:'Não foi possível iniciar esta criação musical.',technical_error:message,finished_at:new Date().toISOString()}).eq('id',job.id).in('status',['dispatching','queued'])
    if(leaseHeld&&!handedOff)await releaseLease(admin,job.id)
    return {ok:false,error:message,job_id:job.id,httpStatus:500,fallback_allowed:false}
  }
}
async function dispatchNextQueued(env:any){
  const {data:rows,error}=await env.admin.from('render_jobs').select('id,next_retry_at').eq('job_type','music_generation').eq('status','queued').is('finished_at',null).order('created_at',{ascending:true}).limit(12)
  if(error)return {ok:false,error:'queue_lookup_failed',detail:error.message,httpStatus:500}
  const now=Date.now()
  for(const row of rows||[]){
    const retryAt=row.next_retry_at?Date.parse(String(row.next_retry_at)):0
    if(retryAt&&retryAt>now)continue
    const result=await dispatchQueuedJob(env,String(row.id))
    if(result?.dispatched===true||result?.queued===true)return result
  }
  return {ok:true,idle:true,queued:false,status:'idle'}
}
async function readiness(){
  const env=envClients()
  if(!env)return json({ok:false,error:'server_configuration_error'},500)
  let computeReady=false
  try{
    const {data:anchor,error:anchorError}=await env.admin.from('projects').select('user_id').eq('id',B09_PROJECT_ID).maybeSingle()
    if(anchorError)throw anchorError
    const conn=anchor?.user_id?await readComputeConnection(env.admin,String(anchor.user_id)):null
    computeReady=Boolean(conn?.secret&&conn?.handle)
  }catch(error){
    return json({ok:false,error:'compute_connection_check_failed',detail:String(error instanceof Error?error.message:error).slice(0,240),configured:false,runnable:false},503)
  }
  const {data:rows,error}=await env.admin.from('render_jobs').select('finished_at,proof,engine,provider').eq('job_type','music_generation').eq('status','completed').order('finished_at',{ascending:false}).limit(1)
  if(error)return json({ok:false,error:'readiness_query_failed'},500)
  const row=rows?.[0]||null
  const proof=row?.proof&&typeof row.proof==='object'?row.proof:{}
  const canaryVerified=proof?.verified===true&&proof?.model===ACE_MODEL&&proof?.model_revision===ACE_REVISION&&Number(proof?.audio_size_bytes)>4096&&Number(proof?.duration_seconds)>1&&Number(proof?.sample_rate)>0&&Number(proof?.channels)>0&&/^[0-9a-f]{64}$/i.test(String(proof?.audio_sha256||''))
  const verified=computeReady&&canaryVerified
  return json({
    ok:true,
    service:'pablovoice-native-music',
    provider:'kaggle',
    engine:'ACE-Step 1.5',
    model:ACE_MODEL,
    model_revision:ACE_REVISION,
    worker:WORKER_SLUG,
    callback:COMPLETE_SLUG,
    access_mode:'transparent_device',
    user_login_required:false,
    credential_exposed:false,
    compute_connection_ready:computeReady,
    dispatch_serialized:true,
    persistent_queue:true,
    configured:verified,
    runnable:verified,
    physical_canary:canaryVerified?{
      verified:true,
      finished_at:row.finished_at,
      duration_seconds:Number(proof.duration_seconds),
      sample_rate:Number(proof.sample_rate),
      channels:Number(proof.channels),
      audio_size_bytes:Number(proof.audio_size_bytes),
      audio_sha256:String(proof.audio_sha256),
      generation_seed:Number.isFinite(Number(proof.generation_seed))?Number(proof.generation_seed):null,
      generation_shift:Number.isFinite(Number(proof.generation_shift))?Number(proof.generation_shift):null,
    }:{verified:false},
  })
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method==='GET')return readiness()
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405)
  try{
    const env=envClients()
    if(!env)return json({ok:false,error:'server_configuration_error'},500)
    const {url,pub,secret,admin}=env
    const body=await req.json().catch(()=>({}))
    if(body?.action==='dispatch_next'){
      if(!(await internalDispatchAllowed(admin,secret,req)))return json({ok:false,error:'internal_dispatch_unauthorized'},401)
      const result=await dispatchNextQueued(env)
      return json(result,result?.httpStatus||200)
    }
    const auth=req.headers.get('authorization')||''
    const jwt=auth.startsWith('Bearer ')?auth.slice(7):''
    if(!jwt)return json({ok:false,error:'connection_required'},401)
    const userClient=createClient(url,pub,{global:{headers:{Authorization:`Bearer ${jwt}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
    const {data:ud,error:ue}=await userClient.auth.getUser(jwt)
    const user=ud?.user
    if(ue||!user)return json({ok:false,error:'connection_invalid'},401)
    if(body?.action==='dispatch_job'){
      const jobId=String(body?.job_id||'')
      if(!isUuid(jobId))return json({ok:false,error:'invalid_job_id'},400)
      const {data:owned}=await admin.from('render_jobs').select('id').eq('id',jobId).eq('user_id',user.id).eq('job_type','music_generation').maybeSingle()
      if(!owned)return json({ok:false,error:'job_not_found'},404)
      const result=await dispatchQueuedJob(env,jobId)
      return json(result,result?.queued?202:(result?.httpStatus||200))
    }

    const projectId=String(body.project_id||'')
    if(!isUuid(projectId))return json({ok:false,error:'invalid_project_id'},400)
    const plan=body.plan||{}
    if(plan?.schema!=='pablovoice_song_creation_v1'||!Array.isArray(plan?.sections)||!plan.sections.length)return json({ok:false,error:'invalid_music_plan'},400)
    const {data:project}=await admin.from('projects').select('id,title').eq('id',projectId).eq('user_id',user.id).maybeSingle()
    if(!project)return json({ok:false,error:'project_not_found'},404)
    let conn:any=null
    try{conn=await sharedComputeConnection(admin,user)}catch(error){
      const detail=String(error instanceof Error?error.message:error).slice(0,600)
      const code=/service_role_required/i.test(detail)?'music_compute_auth_role_failed':'music_compute_lookup_failed'
      return json({ok:false,error:code,detail,fallback_allowed:false},503)
    }
    if(!conn?.secret||!conn?.handle)return json({ok:false,error:'music_compute_unavailable',fallback_allowed:false},409)

    const {data:versionRows}=await admin.from('project_versions').select('id').eq('project_id',projectId).eq('user_id',user.id).order('version_number',{ascending:false}).limit(1)
    const versionId=versionRows?.[0]?.id||null
    const instrumental=Boolean(body.instrumental)
    const duration=clamp(Math.round(Number(plan.durationSeconds)||120),10,600)
    const bpm=clamp(Math.round(Number(plan.bpm)||112),30,300)
    const key=clean(plan.key,8), mode=String(plan.mode||'minor')==='major'?'Major':'Minor'
    const requestedVariation=Number(body.variation_seed)
    const generationSeed=Number.isFinite(requestedVariation)&&requestedVariation>0
      ? Math.abs(Math.trunc(requestedVariation))%2147483647||1
      : randomGenerationSeed()
    const generation={
      caption:captionFromPlan(plan,body.negative_styles),
      lyrics:buildLyrics(plan,instrumental),
      instrumental,
      bpm,
      keyscale:key?`${key} ${mode}`:'',
      timesignature:'4',
      vocal_language:normalizeLanguage(plan?.singerProfile?.language),
      duration,
      seed:generationSeed,
      inference_steps:8,
      shift:3.0,
      use_constrained_decoding:true,
    }
    if(!generation.caption)return json({ok:false,error:'music_caption_required'},400)

    const jobId=crypto.randomUUID()
    const now=new Date().toISOString()
    const params={
      client:'pablovoice_native_music_v2_4_queue',
      access_mode:'transparent_device',
      dispatch_serialized:true,
      queue_schema:'pablovoice_music_queue_v1',
      duration_seconds:duration,
      bpm,
      keyscale:generation.keyscale,
      instrumental,
      generation_seed:generationSeed,
      caption_chars:generation.caption.length,
      shift:generation.shift,
      constrained_decoding:generation.use_constrained_decoding,
      queue_request:{generation,allow_shared_compute:user?.app_metadata?.pablovoice_app_device===true}
    }
    const {error:jobErr}=await admin.from('render_jobs').insert({id:jobId,project_id:projectId,version_id:versionId,user_id:user.id,job_type:'music_generation',engine:'ace_step_1_5_turbo',status:'queued',progress:5,input_asset_ids:[],output_asset_ids:[],parameters:params,proof:{required:true},provider:'kaggle',current_stage:'gpu_queue',human_message:'Na fila para criar a música',started_at:null,heartbeat_at:null,created_at:now,updated_at:now})
    if(jobErr)return json({ok:false,error:`job_insert_failed: ${jobErr.message}`,fallback_allowed:false},500)
    const result=await dispatchQueuedJob(env,jobId)
    if(result?.queued){
      const {data:queuedJob}=await admin.from('render_jobs').select('id,created_at').eq('id',jobId).maybeSingle()
      const position=queuedJob?await queuePosition(admin,queuedJob):1
      return json({...result,queue_position:position,human_message:'Sua música está na fila e será iniciada automaticamente.'},202)
    }
    return json(result,result?.httpStatus||200)
  }catch(e){
    return json({ok:false,error:String(e instanceof Error?e.message:e).slice(0,1400),fallback_allowed:false},500)
  }
})