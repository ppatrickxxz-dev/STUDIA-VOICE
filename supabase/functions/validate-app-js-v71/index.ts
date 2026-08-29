import { createClient } from 'npm:@supabase/supabase-js@2.112.2'

const cors={
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'authorization, x-client-info, apikey, content-type, x-benchmark-token',
  'access-control-allow-methods':'GET, POST, OPTIONS',
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
const LEGACY_AGENT='https://yokmhqoncdwvxmzzybqa.supabase.co/functions/v1/validate-app-js-v62'
const SONG_COMMANDS=new Set(['generate','continue_section','rewrite','adapt_genre'])
const OPENAI_URL='https://api.openai.com/v1/responses'
const MODEL='gpt-5.4-mini'
const PROVIDER_TIMEOUT_MS=20_000

function env(){
  const url=Deno.env.get('SUPABASE_URL')||''
  const pubs=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}')
  const secs=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')
  const pub=pubs.default||Deno.env.get('SUPABASE_ANON_KEY')||''
  const secret=secs.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
  if(!url||!pub||!secret) throw new Error('server_configuration_error')
  return {url,pub,secret}
}
function bearer(req:Request){const v=req.headers.get('authorization')||'';return v.startsWith('Bearer ')?v.slice(7).trim():''}
function forwardHeaders(req:Request){const h:Record<string,string>={'content-type':'application/json'};for(const n of ['authorization','apikey','x-benchmark-token']){const v=req.headers.get(n);if(v)h[n]=v}return h}
async function proxy(req:Request,url:string,body:unknown){try{const r=await fetch(url,{method:'POST',headers:forwardHeaders(req),body:JSON.stringify(body),signal:req.signal});const t=await r.text();let d:any={};try{d=t?JSON.parse(t):{}}catch{d={ok:false,error:'invalid_upstream_response'}}return json(d,r.status>=500?200:r.status)}catch{return json({ok:false,error:'agent_router_unavailable',fallback_allowed:true})}}
function outputText(data:any){if(typeof data?.output_text==='string'&&data.output_text.trim())return data.output_text.trim();const parts:string[]=[];for(const item of data?.output||[])for(const part of item?.content||[])if(typeof part?.text==='string'&&part.text.trim())parts.push(part.text.trim());return parts.join('\n').trim()}
function requestId(){return crypto.randomUUID()}
function safeLog(fields:Record<string,unknown>){console.info(JSON.stringify({scope:'pablovoice_composer',...fields}))}
function boundedRetryAfter(value:string|null){if(!value)return 250;const seconds=Number(value);if(Number.isFinite(seconds))return Math.max(0,Math.min(1500,Math.round(seconds*1000)));const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,Math.min(1500,date-Date.now())):250}
function providerError(status:number){if(status===401||status===403)return 'provider_auth_failed';if(status===429)return 'provider_rate_limited';if(status>=500)return 'provider_unavailable';return 'remote_provider_failed'}
function providerHttpStatus(status:number){if(status===429)return 429;if(status===401||status===403||status>=500)return 502;return 502}

async function serverKey(admin:any){const {data,error}=await admin.rpc('get_pablovoice_openai_api_key');if(error||!data)throw new Error('composer_key_unavailable');return String(data)}
async function userAndProject(pubClient:any,jwt:string,projectId:string){
  const {data:ud,error:ue}=await pubClient.auth.getUser(jwt);if(ue||!ud?.user)return null
  if(!/^[0-9a-f-]{36}$/i.test(projectId))return null
  const userScoped=createClient(pubClient.supabaseUrl,pubClient.supabaseKey,{global:{headers:{Authorization:`Bearer ${jwt}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
  const {data:p,error:pe}=await userScoped.from('projects').select('id,title,bpm,musical_key').eq('id',projectId).maybeSingle();if(pe||!p)return null
  return {user:ud.user,project:p}
}

async function callComposerProvider(req:Request,key:string,instructions:string,input:string,id:string){
  const started=Date.now()
  const controller=new AbortController()
  const abortFromClient=()=>controller.abort('client_cancelled')
  if(req.signal.aborted)abortFromClient();else req.signal.addEventListener('abort',abortFromClient,{once:true})
  const timer=setTimeout(()=>controller.abort('provider_timeout'),PROVIDER_TIMEOUT_MS)
  try{
    let upstream:Response
    try{
      upstream=await fetch(OPENAI_URL,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({model:MODEL,instructions,input,max_output_tokens:1800}),signal:controller.signal})
    }catch{
      const errorType=req.signal.aborted?'request_cancelled':controller.signal.aborted?'provider_timeout':'provider_connection_failed'
      safeLog({request_id:id,provider:'openai_backend',model:MODEL,status:'error',latency_ms:Date.now()-started,error_type:errorType})
      return {ok:false,error:errorType,httpStatus:errorType==='request_cancelled'?499:502,retryAfterMs:0,latencyMs:Date.now()-started}
    }
    const latencyMs=Date.now()-started
    const raw=await upstream.text()
    let data:any={}
    try{data=raw?JSON.parse(raw):{}}catch{
      safeLog({request_id:id,provider:'openai_backend',model:MODEL,status:upstream.status,latency_ms:latencyMs,error_type:'provider_invalid_response'})
      return {ok:false,error:'provider_invalid_response',httpStatus:502,retryAfterMs:0,latencyMs}
    }
    if(!upstream.ok){
      const error=providerError(upstream.status),retryAfterMs=error==='provider_rate_limited'?boundedRetryAfter(upstream.headers.get('retry-after')):0
      safeLog({request_id:id,provider:'openai_backend',model:MODEL,status:upstream.status,latency_ms:latencyMs,error_type:error})
      return {ok:false,error,httpStatus:providerHttpStatus(upstream.status),retryAfterMs,latencyMs}
    }
    const text=outputText(data)
    if(!text){
      safeLog({request_id:id,provider:'openai_backend',model:String(data?.model||MODEL),status:upstream.status,latency_ms:latencyMs,error_type:'remote_empty_response'})
      return {ok:false,error:'remote_empty_response',httpStatus:502,retryAfterMs:0,latencyMs}
    }
    const model=String(data?.model||MODEL).slice(0,160)
    safeLog({request_id:id,provider:'openai_backend',model,status:upstream.status,latency_ms:latencyMs,error_type:null})
    return {ok:true,text,model,latencyMs}
  }finally{
    clearTimeout(timer)
    req.signal.removeEventListener?.('abort',abortFromClient)
  }
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  const id=requestId()
  try{
    const {url,pub,secret}=env(),admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),pubClient=createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
    if(req.method==='GET'){
      let ready=false;try{ready=Boolean(await serverKey(admin))}catch{}
      return json({ok:true,service:'pablovoice-agent-router',version:'2.1.0',configured:ready,credential_configured:ready,provider_verified:false,readiness_basis:'credential_presence_only',songwriting_ready:ready,composer:ready?'openai_backend':'unavailable',general_reasoning:'legacy_or_local',credential_exposed:false,auth_for_turns:'required',songwriting_commands:[...SONG_COMMANDS],provider_timeout_ms:PROVIDER_TIMEOUT_MS})
    }
    if(req.method!=='POST')return json({ok:false,error:'method_not_allowed',request_id:id},405)
    const body:any=await req.json().catch(()=>({})),command=String(body?.command||'')
    if(!SONG_COMMANDS.has(command))return proxy(req,LEGACY_AGENT,body)
    const jwt=bearer(req);if(!jwt)return json({ok:false,error:'auth_required',request_id:id},401)
    const projectId=String(body?.project_id||''),scope=await userAndProject(pubClient,jwt,projectId);if(!scope)return json({ok:false,error:'project_not_found',request_id:id},404)
    const task=String(body?.task||body?.message||'').trim().slice(0,12000);if(!task)return json({ok:false,error:'message_required',request_id:id},400)
    const key=await serverKey(admin)
    const instructions=['Você é o motor de composição do PabloVoice.','Execute somente o comando solicitado: generate, continue_section, rewrite ou adapt_genre.','Escreva em português brasileiro quando a tarefa estiver em português.','Preserve intenção, perspectiva, oralidade e voz autoral; em rewrite altere o mínimo necessário.','Rima, métrica e prosódia devem servir ao sentido e à musicalidade.','Não imite literalmente artistas, melodias ou letras existentes.','Retorne material criativo pronto para revisão, sem explicar raciocínio.'].join(' ')
    const input=JSON.stringify({command,task,project:scope.project,context_pack:body?.context_pack||null,constraints:body?.constraints||null,author_samples:body?.author_samples||null})
    const provider=await callComposerProvider(req,key,instructions,input,id)
    if(!provider.ok)return json({ok:false,error:provider.error,request_id:id,retry_after_ms:provider.retryAfterMs,latency_ms:provider.latencyMs,fallback_allowed:false},provider.httpStatus)
    return json({ok:true,service:'pablovoice-agent-router',provider:'openai_backend',model:provider.model,command,project_id:scope.project.id,reply:provider.text,text:provider.text,request_id:id,latency_ms:provider.latencyMs,fallback_allowed:false})
  }catch(e){
    const type=e instanceof Error&&e.message==='composer_key_unavailable'?'composer_key_unavailable':'agent_backend_error'
    safeLog({request_id:id,provider:'openai_backend',model:MODEL,status:'error',latency_ms:null,error_type:type})
    return json({ok:false,error:type,request_id:id,fallback_allowed:false},503)
  }
})