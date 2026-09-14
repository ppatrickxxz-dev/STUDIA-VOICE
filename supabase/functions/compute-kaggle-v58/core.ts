import { createClient } from 'npm:@supabase/supabase-js@2.112.2'

const cors={
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'authorization, x-client-info, apikey, content-type',
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
function sanitizeQueuedGeneration(raw:any){
  const source=raw&&typeof raw==='object'?raw:{}
  const instrumental=Boolean(source.instrumental)
  const requestedSeed=Number(source.seed)
  const seed=Number.isFinite(requestedSeed)&&requestedSeed>0?Math.abs(Math.trunc(requestedSeed))%2147483647||1:randomGenerationSeed()
  const generation={
    caption:clean(source.caption,512),
    lyrics:String(source.lyrics||'').replace(/\r/g,'').slice(0,4096),
    instrumental,
    bpm:clamp(Math.round(Number(source.bpm)||112),30,300),
    keyscale:clean(source.keyscale,24),
    timesignature:'4',
    vocal_language:normalizeLanguage(source.vocal_language),
    duration:clamp(Math.round(Number(source.duration)||120),10,600),
    seed,
    inference_steps:8,
    shift:3.0,
    use_constrained_decoding:true,
  }
  if(instrumental&&!generation.lyrics)generation.lyrics='[Instrumental]'
  return generation
}
async function kaggleRpc(token:string,method:string,payload:any){
  const r=await fetch(`https://api.kaggle.com/v1/kernels.KernelsApiService/${method}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','user-agent':'PabloVoice-Music/2.3'},body:JSON.stringify(payload)})
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
async function claimCapacity(admin:any,jobId:string){const {data,error}=await admin.rpc('claim_music_generation_capacity_job',{p_job_id:jobId,p_ttl_seconds:LEASE_TTL_SECONDS});if(error)throw error;return data===true}
async function touchLease(admin:any,jobId:string){const {error}=await admin.rpc('touch_music_generation_dispatch_lease',{p_job_id:jobId,p_ttl_seconds:LEASE_TTL_SECONDS});if(error)console.error('music_lease_touch_failed',error.message)}
async function releaseLease(admin:any,jobId:string){const {error}=await admin.rpc('release_music_generation_dispatch_lease',{p_job_id:jobId});if(error)console.error('music_lease_release_failed',error.message)}
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
    durable_capacity_queue:true,
    server_handoff:true,
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

export {createClient,cors,json,isUuid,ACE_REPO,ACE_REVISION,ACE_MODEL,WORKER_SLUG,COMPLETE_SLUG,QUEUE_RETRY_SECONDS,b64,randomToken,randomGenerationSeed,sha256Text,clamp,clean,normalizeLanguage,isCapacityError,buildLyrics,captionFromPlan,sanitizeQueuedGeneration,kaggleRpc,envClients,sharedComputeConnection,claimCapacity,touchLease,releaseLease,readiness}
