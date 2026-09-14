import {createClient,cors,json,isUuid,ACE_REPO,ACE_REVISION,ACE_MODEL,WORKER_SLUG,COMPLETE_SLUG,QUEUE_RETRY_SECONDS,b64,randomToken,randomGenerationSeed,sha256Text,clamp,clean,normalizeLanguage,isCapacityError,buildLyrics,captionFromPlan,sanitizeQueuedGeneration,kaggleRpc,envClients,sharedComputeConnection,claimCapacity,touchLease,releaseLease,readiness} from './core.ts'

export async function handleRequest(req:Request){
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method==='GET')return readiness()
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405)
  let jobId='',leaseHeld=false,handedOff=false,jobPersisted=false,currentUserId=''
  let admin:any=null
  try{
    const env=envClients()
    if(!env)return json({ok:false,error:'server_configuration_error'},500)
    const {url,pub,secret}=env;admin=env.admin
    const body=await req.json().catch(()=>({}))
    const internalHandoff=body?.resume_next===true&&(req.headers.get('apikey')||'')===secret
    let user:any=null
    let resumeJobId=String(body.resume_job_id||'')

    if(internalHandoff){
      const {data:next,error:nextErr}=await admin.from('render_jobs').select('id,user_id').eq('job_type','music_generation').eq('status','queued_capacity').is('finished_at',null).order('created_at',{ascending:true}).order('id',{ascending:true}).limit(1).maybeSingle()
      if(nextErr)return json({ok:false,error:'music_queue_next_lookup_failed',detail:nextErr.message,fallback_allowed:false},500)
      if(!next)return json({ok:true,status:'queue_empty',server_handoff:true,fallback_allowed:false})
      resumeJobId=String(next.id)
      const {data:adminUser,error:adminUserErr}=await admin.auth.admin.getUserById(String(next.user_id))
      user=adminUser?.user||null
      if(adminUserErr||!user)return json({ok:false,error:'music_queue_user_not_found',job_id:resumeJobId,fallback_allowed:false},409)
    }else{
      const auth=req.headers.get('authorization')||''
      const jwt=auth.startsWith('Bearer ')?auth.slice(7):''
      if(!jwt)return json({ok:false,error:'connection_required'},401)
      const userClient=createClient(url,pub,{global:{headers:{Authorization:`Bearer ${jwt}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
      const {data:ud,error:ue}=await userClient.auth.getUser(jwt)
      user=ud?.user||null
      if(ue||!user)return json({ok:false,error:'connection_invalid'},401)
    }
    currentUserId=String(user.id)

    const resuming=Boolean(resumeJobId)
    let projectId='',versionId:any=null,project:any=null,generation:any=null,generationSeed=0,params:any={}

    if(resuming){
      if(!isUuid(resumeJobId))return json({ok:false,error:'invalid_resume_job_id'},400)
      const {data:queued,error:queuedErr}=await admin.from('render_jobs').select('id,project_id,version_id,status,progress,parameters,finished_at').eq('id',resumeJobId).eq('user_id',user.id).eq('job_type','music_generation').maybeSingle()
      if(queuedErr)return json({ok:false,error:'music_queue_lookup_failed',detail:queuedErr.message,fallback_allowed:false},500)
      if(!queued)return json({ok:false,error:'music_job_not_found',fallback_allowed:false},404)
      jobId=String(queued.id);jobPersisted=true
      if(queued.finished_at){
        if(queued.status==='completed')return json({ok:true,job_id:jobId,status:'completed',progress:100,provider:'native_music',fallback_allowed:false})
        return json({ok:false,error:'music_job_terminal',job_id:jobId,status:queued.status,fallback_allowed:false},409)
      }
      if(queued.status!=='queued_capacity')return json({ok:true,job_id:jobId,status:queued.status,progress:Number(queued.progress)||12,provider:'native_music',fallback_allowed:false})
      projectId=String(queued.project_id||'')
      versionId=queued.version_id||null
      params=queued.parameters&&typeof queued.parameters==='object'?queued.parameters:{}
      generation=sanitizeQueuedGeneration(params.queued_generation)
      if(!generation.caption||(!generation.instrumental&&!generation.lyrics))return json({ok:false,error:'queued_generation_invalid',job_id:jobId,fallback_allowed:false},409)
      generationSeed=Number(generation.seed)
    }else{
      projectId=String(body.project_id||'')
      if(!isUuid(projectId))return json({ok:false,error:'invalid_project_id'},400)
      const plan=body.plan||{}
      if(plan?.schema!=='pablovoice_song_creation_v1'||!Array.isArray(plan?.sections)||!plan.sections.length)return json({ok:false,error:'invalid_music_plan'},400)
      const instrumental=Boolean(body.instrumental)
      const duration=clamp(Math.round(Number(plan.durationSeconds)||120),10,600)
      const bpm=clamp(Math.round(Number(plan.bpm)||112),30,300)
      const key=clean(plan.key,8),mode=String(plan.mode||'minor')==='major'?'Major':'Minor'
      const requestedVariation=Number(body.variation_seed)
      generationSeed=Number.isFinite(requestedVariation)&&requestedVariation>0
        ? Math.abs(Math.trunc(requestedVariation))%2147483647||1
        : randomGenerationSeed()
      generation={
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
    }

    if(!isUuid(projectId))return json({ok:false,error:'invalid_project_id'},400)
    const projectResult=await admin.from('projects').select('id,title').eq('id',projectId).eq('user_id',user.id).maybeSingle()
    project=projectResult.data
    if(!project)return json({ok:false,error:'project_not_found'},404)

    let conn:any=null
    try{conn=await sharedComputeConnection(admin,user)}catch(error){
      const detail=String(error instanceof Error?error.message:error).slice(0,600)
      const code=/service_role_required/i.test(detail)?'music_compute_auth_role_failed':'music_compute_lookup_failed'
      return json({ok:false,error:code,detail,job_id:jobId||null,fallback_allowed:false},503)
    }
    if(!conn?.secret||!conn?.handle)return json({ok:false,error:'music_compute_unavailable',job_id:jobId||null,fallback_allowed:false},409)

    if(!resuming){
      const {data:versionRows}=await admin.from('project_versions').select('id').eq('project_id',projectId).eq('user_id',user.id).order('version_number',{ascending:false}).limit(1)
      versionId=versionRows?.[0]?.id||null
      jobId=crypto.randomUUID()
      const now=new Date().toISOString()
      params={
        client:'pablovoice_native_music_v2_3',
        access_mode:'transparent_device',
        dispatch_serialized:true,
        queue_schema:'pablovoice_music_capacity_queue_v1',
        queued_generation:generation,
        ace_revision:ACE_REVISION,
        ace_model:ACE_MODEL,
        duration_seconds:generation.duration,
        bpm:generation.bpm,
        keyscale:generation.keyscale,
        instrumental:generation.instrumental,
        generation_seed:generationSeed,
        caption_chars:generation.caption.length,
        shift:generation.shift,
        constrained_decoding:generation.use_constrained_decoding,
        queued_at:now,
      }
      const {error:jobErr}=await admin.from('render_jobs').insert({
        id:jobId,project_id:projectId,version_id:versionId,user_id:user.id,job_type:'music_generation',engine:'ace_step_1_5_turbo',
        status:'queued_capacity',progress:11,input_asset_ids:[],output_asset_ids:[],parameters:params,proof:{required:true},provider:'kaggle',
        current_stage:'gpu_capacity',human_message:'Criação salva. Aguardando a próxima vaga da GPU.',started_at:now,heartbeat_at:now,next_retry_at:now,
      })
      if(jobErr)throw new Error(`job_insert_failed: ${jobErr.message}`)
      jobPersisted=true
    }

    try{leaseHeld=await claimCapacity(admin,jobId)}catch(error){return json({ok:false,error:'music_dispatch_lease_failed',detail:String(error instanceof Error?error.message:error).slice(0,400),job_id:jobId,fallback_allowed:false},503)}
    if(!leaseHeld){
      const retryAt=new Date(Date.now()+QUEUE_RETRY_SECONDS*1000).toISOString()
      await admin.from('render_jobs').update({next_retry_at:retryAt,heartbeat_at:new Date().toISOString(),human_message:'Criação salva na fila. A GPU está concluindo outra música.'}).eq('id',jobId).eq('user_id',user.id).eq('status','queued_capacity')
      const {data:current}=await admin.from('render_jobs').select('status,progress').eq('id',jobId).eq('user_id',user.id).maybeSingle()
      if(current&&current.status!=='queued_capacity')return json({ok:true,job_id:jobId,status:current.status,progress:Number(current.progress)||12,provider:'native_music',accepted:true,dispatch_serialized:true,fallback_allowed:false})
      return json({ok:true,job_id:jobId,status:'queued_capacity',progress:11,provider:'native_music',accepted:true,retry_after_seconds:QUEUE_RETRY_SECONDS,dispatch_serialized:true,server_handoff:internalHandoff,fallback_allowed:false},202)
    }

    const expiresAt=Math.floor(Date.now()/1000)+5400
    const callbackToken=randomToken(32),callbackHash=await sha256Text(callbackToken)
    const outputPath=`${user.id}/${projectId}/music/${jobId}-full-mix.flac`
    const {data:upload,error:uploadErr}=await admin.storage.from('audio-private').createSignedUploadUrl(outputPath)
    if(uploadErr||!upload?.token)throw new Error('signed_upload_failed')
    const progressUrl=`${url}/functions/v1/progress-kaggle-pipeline-job-v58`
    const ticket={version:3,job_type:'music_generation',job_id:jobId,project_title:project.title,expires_at:expiresAt,generation,outputs:{full_mix:{bucket:'audio-private',path:outputPath,token:upload.token}},supabase_url:url,supabase_publishable_key:pub,complete_url:`${url}/functions/v1/${COMPLETE_SLUG}`,progress_url:progressUrl,callback_token:callbackToken,engine:{provider:'kaggle',name:'ACE-Step 1.5',model:ACE_MODEL,source_repo:ACE_REPO,source_revision:ACE_REVISION,download_source:'modelscope'}}
    params={...params,kaggle_callback_hash:callbackHash,kaggle_expires_at:expiresAt,kaggle_output_path:outputPath}
    await admin.from('render_jobs').update({parameters:params,heartbeat_at:new Date().toISOString(),human_message:'Vaga da GPU reservada. Iniciando a geração musical.'}).eq('id',jobId).eq('user_id',user.id).eq('status','dispatched')

    const short=jobId.replace(/-/g,'').slice(0,10),owner=String(conn.handle),slug=`pablovoice-music-${short}`,full=`${owner}/${slug}`
    const workerUrl=`${url}/functions/v1/${WORKER_SLUG}`
    const bootstrap=`import requests,base64\nTICKET_B64='${b64(JSON.stringify(ticket))}'\nr=requests.get('${workerUrl}',timeout=60);r.raise_for_status()\nexec(compile(r.text,'pablovoice_music_worker.py','exec'),globals(),globals())\n`
    const payload={slug:full,newTitle:`PabloVoice Music ${short}`,text:bootstrap,language:'python',kernelType:'script',isPrivate:true,enableGpu:true,enableInternet:true,machineShape:'NvidiaTeslaT4',kernelExecutionType:'SAVE_AND_RUN_ALL',datasetDataSources:[],competitionDataSources:[],kernelDataSources:[],modelDataSources:[],sessionTimeoutSeconds:3600}

    const requeueCapacity=async(msg:string)=>{
      const now=new Date().toISOString(),retryAt=new Date(Date.now()+QUEUE_RETRY_SECONDS*1000).toISOString()
      await admin.from('render_jobs').update({status:'queued_capacity',progress:11,current_stage:'gpu_capacity',error_code:'kaggle_capacity_busy',error_message:'A GPU compartilhada está ocupada; sua criação continua salva na fila.',technical_error:msg,finished_at:null,heartbeat_at:now,next_retry_at:retryAt,human_message:'Criação salva na fila. Aguardando a próxima vaga da GPU.'}).eq('id',jobId).eq('user_id',user.id)
      await releaseLease(admin,jobId);leaseHeld=false
      return json({ok:true,job_id:jobId,status:'queued_capacity',progress:11,provider:'native_music',accepted:true,retry_after_seconds:QUEUE_RETRY_SECONDS,dispatch_serialized:true,server_handoff:internalHandoff,fallback_allowed:false},202)
    }

    let push:any
    try{push=await kaggleRpc(conn.secret,'SaveKernel',payload)}catch(e){
      const msg=String(e instanceof Error?e.message:e).slice(0,1200)
      if(isCapacityError(msg))return await requeueCapacity(msg)
      await admin.from('render_jobs').update({status:'error',progress:0,current_stage:'dispatch_failed',error_code:'kaggle_dispatch_failed',error_message:'Falha ao iniciar a GPU para criar a música.',technical_error:msg,finished_at:new Date().toISOString()}).eq('id',jobId).eq('user_id',user.id)
      await releaseLease(admin,jobId);leaseHeld=false
      return json({ok:false,error:'kaggle_dispatch_failed',detail:msg,job_id:jobId,fallback_allowed:false},502)
    }
    const rejected=!!push?.hasError||!!push?.error||!Number(push?.kernelId)||!String(push?.ref||'')
    if(rejected){
      const msg=String(push?.error||'Kaggle recusou a criação do kernel.').slice(0,1200)
      if(isCapacityError(msg))return await requeueCapacity(msg)
      await admin.from('render_jobs').update({status:'error',progress:0,current_stage:'dispatch_rejected',error_code:'kaggle_dispatch_rejected',error_message:'A GPU recusou a geração musical.',technical_error:msg,finished_at:new Date().toISOString()}).eq('id',jobId).eq('user_id',user.id)
      await releaseLease(admin,jobId);leaseHeld=false
      return json({ok:false,error:'kaggle_dispatch_rejected',detail:msg,job_id:jobId,fallback_allowed:false},409)
    }
    const now=new Date().toISOString()
    await touchLease(admin,jobId)
    await admin.from('render_jobs').update({status:'waiting_kaggle',progress:15,current_stage:'gpu_queued',heartbeat_at:now,next_retry_at:null,error_code:null,error_message:null,technical_error:null,human_message:'Criando a música na GPU',external_job_id:String(push.kernelId),parameters:{...params,kaggle_owner:owner,kaggle_slug:slug,kaggle_ref:push.ref,kaggle_url:push.url||null,kaggle_kernel_id:push.kernelId,kaggle_version_number:push.versionNumber,dispatcher:'compute-kaggle-v58:native-music-v2_3',worker_slug:WORKER_SLUG,complete_slug:COMPLETE_SLUG,dispatched_at:now}}).eq('id',jobId).eq('user_id',user.id)
    handedOff=true
    return json({ok:true,job_id:jobId,status:'waiting_kaggle',progress:15,provider:'native_music',kernel:full,dispatcher:'compute-kaggle-v58',worker:WORKER_SLUG,generation_seed:generationSeed,dispatch_serialized:true,durable_capacity_queue:true,server_handoff:internalHandoff,fallback_allowed:false})
  }catch(e){
    const message=String(e instanceof Error?e.message:e).slice(0,1400)
    if(admin&&jobPersisted&&jobId&&currentUserId){
      await admin.from('render_jobs').update({status:'error',progress:0,current_stage:'dispatch_failed',error_code:'music_dispatch_internal_error',error_message:'Falha interna ao preparar a geração musical.',technical_error:message,finished_at:new Date().toISOString()}).eq('id',jobId).eq('user_id',currentUserId).eq('status','dispatched')
    }
    if(admin&&leaseHeld&&!handedOff&&jobId)await releaseLease(admin,jobId)
    return json({ok:false,error:message,job_id:jobId||null,fallback_allowed:false},500)
  }
}
