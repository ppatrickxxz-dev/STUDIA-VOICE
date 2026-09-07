import { createClient } from 'npm:@supabase/supabase-js@2.112.2'

const cors={
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods':'POST, OPTIONS'
}
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
const isUuid=(v:any)=>/^[0-9a-f-]{36}$/i.test(String(v||''))
const ACE_REPO='https://github.com/ace-step/ACE-Step-1.5.git'
const ACE_REVISION='ca1e85fe9430179831e6bc6be790c332190a3866'
const ACE_MODEL='acestep-v15-turbo'

function b64(v:string){return btoa(unescape(encodeURIComponent(v)))}
function randomToken(bytes=32){const buf=new Uint8Array(bytes);crypto.getRandomValues(buf);return btoa(String.fromCharCode(...buf)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'')}
async function sha256Text(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('')}
function clamp(n:number,min:number,max:number){return Math.max(min,Math.min(max,n))}
function clean(value:any,max:number){return String(value||'').trim().slice(0,max)}
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
  const parts=[clean(plan?.brief,1200),clean(plan?.genre,80),clean(plan?.mood,160)].filter(Boolean)
  const avoid=(Array.isArray(negativeStyles)?negativeStyles:[]).map(v=>clean(v,120)).filter(Boolean).slice(0,12)
  if(avoid.length)parts.push(`Avoid: ${avoid.join(', ')}`)
  return parts.join('. ').slice(0,500)
}
async function kaggleRpc(token:string,method:string,payload:any){
  const r=await fetch(`https://api.kaggle.com/v1/kernels.KernelsApiService/${method}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','user-agent':'PabloVoice-Music/1.0'},body:JSON.stringify(payload)})
  const text=await r.text();let out:any={};try{out=JSON.parse(text)}catch{out={raw:text.slice(0,1600)}}
  if(!r.ok||Number(out?.code||0)>=400)throw new Error(`Kaggle ${method}: ${out?.message||text.slice(0,600)}`)
  return out
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405)
  let jobId=''
  try{
    const url=Deno.env.get('SUPABASE_URL')||''
    const pubs=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}')
    const secs=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')
    const pub=pubs.default||Deno.env.get('SUPABASE_ANON_KEY')||''
    const secret=secs.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    if(!url||!pub||!secret)return json({ok:false,error:'server_configuration_error'},500)

    const auth=req.headers.get('authorization')||''
    const jwt=auth.startsWith('Bearer ')?auth.slice(7):''
    if(!jwt)return json({ok:false,error:'auth_required'},401)
    const userClient=createClient(url,pub,{global:{headers:{Authorization:`Bearer ${jwt}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
    const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
    const {data:ud,error:ue}=await userClient.auth.getUser(jwt)
    const user=ud?.user
    if(ue||!user)return json({ok:false,error:'invalid_session'},401)

    const body=await req.json().catch(()=>({}))
    const projectId=String(body.project_id||'')
    if(!isUuid(projectId))return json({ok:false,error:'invalid_project_id'},400)
    const plan=body.plan||{}
    if(plan?.schema!=='pablovoice_song_creation_v1'||!Array.isArray(plan?.sections)||!plan.sections.length)return json({ok:false,error:'invalid_music_plan'},400)
    const {data:project}=await admin.from('projects').select('id,title').eq('id',projectId).eq('user_id',user.id).maybeSingle()
    if(!project)return json({ok:false,error:'project_not_found'},404)
    const {data:connRows,error:connErr}=await admin.rpc('admin_get_compute_connection',{p_user_id:user.id,p_provider:'kaggle'})
    if(connErr)throw connErr
    const conn=Array.isArray(connRows)?connRows[0]:null
    if(!conn?.secret||!conn?.handle)return json({ok:false,error:'kaggle_not_connected',fallback_allowed:false},409)

    const {data:versionRows}=await admin.from('project_versions').select('id').eq('project_id',projectId).eq('user_id',user.id).order('version_number',{ascending:false}).limit(1)
    const versionId=versionRows?.[0]?.id||null
    const instrumental=Boolean(body.instrumental)
    const duration=clamp(Math.round(Number(plan.durationSeconds)||120),10,600)
    const bpm=clamp(Math.round(Number(plan.bpm)||112),30,300)
    const key=clean(plan.key,8), mode=String(plan.mode||'minor')==='major'?'Major':'Minor'
    const generation={
      caption:captionFromPlan(plan,body.negative_styles),lyrics:buildLyrics(plan,instrumental),instrumental,
      bpm,keyscale:key?`${key} ${mode}`:'',timesignature:'4',vocal_language:'unknown',duration,
      seed:Number.isFinite(Number(plan.seed))?Math.abs(Math.trunc(Number(plan.seed)))%2147483647:42,
      inference_steps:8
    }
    if(!generation.caption)return json({ok:false,error:'music_caption_required'},400)

    jobId=crypto.randomUUID()
    const ttlSeconds=5400,expiresAt=Math.floor(Date.now()/1000)+ttlSeconds
    const callbackToken=randomToken(32),callbackHash=await sha256Text(callbackToken)
    const outputPath=`${user.id}/${projectId}/music/${jobId}-full-mix.flac`
    const {data:upload,error:uploadErr}=await admin.storage.from('audio-private').createSignedUploadUrl(outputPath)
    if(uploadErr||!upload?.token)throw new Error('signed_upload_failed')
    const ticket={
      version:1,job_type:'music_generation',job_id:jobId,project_title:project.title,expires_at:expiresAt,generation,
      outputs:{full_mix:{bucket:'audio-private',path:outputPath,token:upload.token}},
      supabase_url:url,supabase_publishable_key:pub,complete_url:`${url}/functions/v1/complete-kaggle-music-job`,callback_token:callbackToken,
      engine:{provider:'kaggle',name:'ACE-Step 1.5',model:ACE_MODEL,source_repo:ACE_REPO,source_revision:ACE_REVISION,download_source:'modelscope'}
    }
    const params={client:'pablovoice_native_music_v1',kaggle_callback_hash:callbackHash,kaggle_expires_at:expiresAt,kaggle_output_path:outputPath,ace_revision:ACE_REVISION,ace_model:ACE_MODEL,duration_seconds:duration,bpm,keyscale:generation.keyscale,instrumental}
    const {error:jobErr}=await admin.from('render_jobs').insert({id:jobId,project_id:projectId,version_id:versionId,user_id:user.id,job_type:'music_generation',engine:'ace_step_1_5_turbo',status:'waiting_kaggle',progress:10,input_asset_ids:[],output_asset_ids:[],parameters:params,proof:{required:true},provider:'kaggle',current_stage:'dispatch',human_message:'Preparando a geração musical',started_at:new Date().toISOString()})
    if(jobErr)throw new Error(`job_insert_failed: ${jobErr.message}`)

    const short=jobId.replace(/-/g,'').slice(0,10),owner=String(conn.handle),slug=`pablovoice-music-${short}`,full=`${owner}/${slug}`
    const workerUrl=`${url}/functions/v1/kaggle-music-worker`
    const bootstrap=`import requests,base64\nTICKET_B64='${b64(JSON.stringify(ticket))}'\nr=requests.get('${workerUrl}',timeout=60);r.raise_for_status()\nexec(compile(r.text,'pablovoice_music_worker.py','exec'),globals(),globals())\n`
    const payload={slug:full,newTitle:`PabloVoice Music ${short}`,text:bootstrap,language:'python',kernelType:'script',isPrivate:true,enableGpu:true,enableInternet:true,machineShape:'NvidiaTeslaT4',kernelExecutionType:'SAVE_AND_RUN_ALL',datasetDataSources:[],competitionDataSources:[],kernelDataSources:[],modelDataSources:[],sessionTimeoutSeconds:3600}
    let push:any
    try{push=await kaggleRpc(conn.secret,'SaveKernel',payload)}catch(e){
      const msg=String(e instanceof Error?e.message:e).slice(0,1200)
      await admin.from('render_jobs').update({status:'error',progress:0,current_stage:'dispatch_failed',error_code:'kaggle_dispatch_failed',error_message:'Falha ao iniciar a GPU para criar a música.',technical_error:msg,finished_at:new Date().toISOString()}).eq('id',jobId).eq('user_id',user.id)
      return json({ok:false,error:'kaggle_dispatch_failed',detail:msg,job_id:jobId,fallback_allowed:false},502)
    }
    const rejected=!!push?.hasError||!!push?.error||!Number(push?.kernelId)||!String(push?.ref||'')
    if(rejected){
      const msg=String(push?.error||'Kaggle recusou a criação do kernel.').slice(0,1200)
      await admin.from('render_jobs').update({status:'error',progress:0,current_stage:'dispatch_rejected',error_code:'kaggle_dispatch_rejected',error_message:'A GPU recusou a geração musical.',technical_error:msg,finished_at:new Date().toISOString()}).eq('id',jobId).eq('user_id',user.id)
      return json({ok:false,error:'kaggle_dispatch_rejected',detail:msg,job_id:jobId,fallback_allowed:false},409)
    }
    const now=new Date().toISOString()
    await admin.from('render_jobs').update({status:'waiting_kaggle',progress:15,current_stage:'gpu_queued',human_message:'Criando a música na GPU',external_job_id:String(push.kernelId),parameters:{...params,kaggle_owner:owner,kaggle_slug:slug,kaggle_ref:push.ref,kaggle_url:push.url||null,kaggle_kernel_id:push.kernelId,kaggle_version_number:push.versionNumber,dispatcher:'compute-kaggle-music-v1',dispatched_at:now}}).eq('id',jobId).eq('user_id',user.id)
    return json({ok:true,job_id:jobId,status:'waiting_kaggle',progress:15,provider:'native_music',kernel:full,fallback_allowed:false})
  }catch(e){
    return json({ok:false,error:String(e instanceof Error?e.message:e).slice(0,1400),job_id:jobId||null,fallback_allowed:false},500)
  }
})
