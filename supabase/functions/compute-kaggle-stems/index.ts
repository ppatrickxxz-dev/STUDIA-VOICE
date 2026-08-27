import { createClient } from 'npm:@supabase/supabase-js@2.112.2'

const cors={
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods':'POST, OPTIONS'
}
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
const isUuid=(v:any)=>/^[0-9a-f-]{36}$/i.test(String(v||''))
function b64(v:string){return btoa(unescape(encodeURIComponent(v)))}

async function kaggleRpc(token:string,method:string,payload:any){
  const r=await fetch(`https://api.kaggle.com/v1/kernels.KernelsApiService/${method}`,{
    method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','user-agent':'PabloVoice-Stems/1.0'},body:JSON.stringify(payload)
  })
  const text=await r.text(); let out:any={}
  try{out=JSON.parse(text)}catch{out={raw:text.slice(0,1600)}}
  if(!r.ok||Number(out?.code||0)>=400)throw new Error(`Kaggle ${method}: ${out?.message||text.slice(0,600)}`)
  return out
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405)
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
    const sourceAssetId=body.source_asset_id?String(body.source_asset_id):''
    if(!isUuid(projectId))return json({ok:false,error:'invalid_project_id'},400)
    if(sourceAssetId&&!isUuid(sourceAssetId))return json({ok:false,error:'invalid_source_asset_id'},400)

    const {data:connRows,error:connErr}=await admin.rpc('admin_get_compute_connection',{p_user_id:user.id,p_provider:'kaggle'})
    if(connErr)throw connErr
    const conn=Array.isArray(connRows)?connRows[0]:null
    if(!conn?.secret||!conn?.handle)return json({ok:false,error:'kaggle_not_connected'},409)

    const ticketRes=await fetch(`${url}/functions/v1/create-kaggle-ticket`,{
      method:'POST',headers:{apikey:pub,authorization:`Bearer ${jwt}`,'content-type':'application/json'},
      body:JSON.stringify({project_id:projectId,job_type:'stems',source_asset_id:sourceAssetId||undefined})
    })
    const tj=await ticketRes.json().catch(()=>({}))
    if(!ticketRes.ok||!tj?.ok||tj?.ticket?.job_type!=='stems')return json({ok:false,error:tj?.error||'ticket_generation_failed'},ticketRes.status||500)

    const ticket=tj.ticket, jobId=String(tj.job_id)
    const short=jobId.replace(/-/g,'').slice(0,10), owner=String(conn.handle), slug=`pablovoice-stems-${short}`, full=`${owner}/${slug}`
    const workerUrl=`${url}/functions/v1/kaggle-stems-worker`
    const bootstrap=`import requests,base64\nTICKET_B64='${b64(JSON.stringify(ticket))}'\nr=requests.get('${workerUrl}',timeout=60);r.raise_for_status()\nexec(compile(r.text,'pablovoice_stems_worker.py','exec'),globals(),globals())\n`
    const payload={slug:full,newTitle:`PabloVoice Stems ${short}`,text:bootstrap,language:'python',kernelType:'script',isPrivate:true,enableGpu:true,enableInternet:true,machineShape:'NvidiaTeslaT4',kernelExecutionType:'SAVE_AND_RUN_ALL',datasetDataSources:[],competitionDataSources:[],kernelDataSources:[],modelDataSources:[],sessionTimeoutSeconds:3600}

    let push:any
    try{push=await kaggleRpc(conn.secret,'SaveKernel',payload)}catch(e){
      const msg=String(e instanceof Error?e.message:e).slice(0,1200)
      await admin.from('render_jobs').update({status:'error',error_message:'Falha ao iniciar a GPU para separar a voz.',technical_error:msg,finished_at:new Date().toISOString()}).eq('id',jobId).eq('user_id',user.id)
      return json({ok:false,error:'kaggle_dispatch_failed',detail:msg,job_id:jobId},502)
    }

    const rejected=!!push?.hasError||!!push?.error||!Number(push?.kernelId)||!String(push?.ref||'')
    if(rejected){
      const msg=String(push?.error||'Kaggle recusou a criação do kernel.').slice(0,1200)
      await admin.from('render_jobs').update({status:'error',error_message:'A GPU recusou o processamento.',technical_error:msg,finished_at:new Date().toISOString()}).eq('id',jobId).eq('user_id',user.id)
      return json({ok:false,error:'kaggle_dispatch_rejected',detail:msg,job_id:jobId},409)
    }

    const now=new Date().toISOString()
    const {data:jr}=await admin.from('render_jobs').select('parameters').eq('id',jobId).maybeSingle(); const p=jr?.parameters||{}
    await admin.from('render_jobs').update({status:'waiting_kaggle',progress:15,engine:'kaggle_stems_v1',provider:'kaggle',human_message:'Separando voz e instrumental',external_job_id:String(push.kernelId),parameters:{...p,kaggle_owner:owner,kaggle_slug:slug,kaggle_ref:push.ref,kaggle_url:push.url||null,kaggle_kernel_id:push.kernelId,kaggle_version_number:push.versionNumber,dispatcher:'compute-kaggle-stems-v1',dispatched_at:now}}).eq('id',jobId).eq('user_id',user.id)
    return json({ok:true,job_id:jobId,status:'waiting_kaggle',progress:15,kernel:full})
  }catch(e){return json({ok:false,error:String(e instanceof Error?e.message:e).slice(0,1400)},500)}
})
