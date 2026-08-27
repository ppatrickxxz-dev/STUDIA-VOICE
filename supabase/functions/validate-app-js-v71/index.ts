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
async function proxy(req:Request,url:string,body:unknown){try{const r=await fetch(url,{method:'POST',headers:forwardHeaders(req),body:JSON.stringify(body)});const t=await r.text();let d:any={};try{d=t?JSON.parse(t):{}}catch{d={ok:false,error:'invalid_upstream_response'}}return json(d,r.status>=500?200:r.status)}catch{return json({ok:false,error:'agent_router_unavailable',fallback_allowed:true})}}
function outputText(data:any){if(typeof data?.output_text==='string'&&data.output_text.trim())return data.output_text.trim();const parts:string[]=[];for(const item of data?.output||[])for(const part of item?.content||[])if(typeof part?.text==='string'&&part.text.trim())parts.push(part.text.trim());return parts.join('\n').trim()}

async function serverKey(admin:any){const {data,error}=await admin.rpc('get_pablovoice_openai_api_key');if(error||!data)throw new Error('composer_key_unavailable');return String(data)}
async function userAndProject(pubClient:any,jwt:string,projectId:string){
  const {data:ud,error:ue}=await pubClient.auth.getUser(jwt);if(ue||!ud?.user)return null
  if(!/^[0-9a-f-]{36}$/i.test(projectId))return null
  const userScoped=createClient(pubClient.supabaseUrl,pubClient.supabaseKey,{global:{headers:{Authorization:`Bearer ${jwt}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
  const {data:p,error:pe}=await userScoped.from('projects').select('id,title,bpm,musical_key').eq('id',projectId).maybeSingle();if(pe||!p)return null
  return {user:ud.user,project:p}
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  try{
    const {url,pub,secret}=env(),admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),pubClient=createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
    if(req.method==='GET'){
      let ready=false;try{ready=Boolean(await serverKey(admin))}catch{}
      return json({ok:true,service:'pablovoice-agent-router',version:'2.0.0',configured:ready,songwriting_ready:ready,composer:ready?'openai_backend':'unavailable',general_reasoning:'legacy_or_local',credential_exposed:false,auth_for_turns:'required',songwriting_commands:[...SONG_COMMANDS]})
    }
    if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405)
    const body:any=await req.json().catch(()=>({})),command=String(body?.command||'')
    if(!SONG_COMMANDS.has(command))return proxy(req,LEGACY_AGENT,body)
    const jwt=bearer(req);if(!jwt)return json({ok:false,error:'auth_required'},401)
    const projectId=String(body?.project_id||''),scope=await userAndProject(pubClient,jwt,projectId);if(!scope)return json({ok:false,error:'project_not_found'},404)
    const task=String(body?.task||body?.message||'').trim().slice(0,12000);if(!task)return json({ok:false,error:'message_required'},400)
    const key=await serverKey(admin)
    const instructions=['Você é o motor de composição do PabloVoice.','Execute somente o comando solicitado: generate, continue_section, rewrite ou adapt_genre.','Escreva em português brasileiro quando a tarefa estiver em português.','Preserve intenção, perspectiva, oralidade e voz autoral; em rewrite altere o mínimo necessário.','Rima, métrica e prosódia devem servir ao sentido e à musicalidade.','Não imite literalmente artistas, melodias ou letras existentes.','Retorne material criativo pronto para revisão, sem explicar raciocínio.'].join(' ')
    const input=JSON.stringify({command,task,project:scope.project,context_pack:body?.context_pack||null,constraints:body?.constraints||null,author_samples:body?.author_samples||null})
    const upstream=await fetch(OPENAI_URL,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({model:MODEL,instructions,input,max_output_tokens:1800})})
    const raw=await upstream.text();let data:any={};try{data=raw?JSON.parse(raw):{}}catch{}
    if(!upstream.ok)return json({ok:false,error:'remote_provider_failed',status:upstream.status,fallback_allowed:true})
    const text=outputText(data);if(!text)return json({ok:false,error:'remote_empty_response',fallback_allowed:true})
    return json({ok:true,service:'pablovoice-agent-router',provider:'openai_backend',model:String(data?.model||MODEL),command,project_id:scope.project.id,reply:text,text})
  }catch(e){console.error('validate-app-js-v71',e);return json({ok:false,error:'agent_backend_error',fallback_allowed:true})}
})
