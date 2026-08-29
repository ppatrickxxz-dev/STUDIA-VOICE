import { createClient } from 'npm:@supabase/supabase-js@2.112.2'
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization, x-client-info, apikey, content-type','access-control-allow-methods':'GET, POST, OPTIONS'}
const out=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
const uuid=(v:any)=>/^[0-9a-f-]{36}$/i.test(String(v||'')),shaOk=(v:any)=>/^[0-9a-f]{64}$/i.test(String(v||''))
const THRESHOLD=.8, MODEL='speechbrain/spkrec-ecapa-voxceleb', ENGINE_VERSION='speechbrain-1.0.3'
function token(){const a=new Uint8Array(32);crypto.getRandomValues(a);return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function b64(v:string){return btoa(unescape(encodeURIComponent(v)))}
async function sha(v:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return[...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function kaggleRpc(secret:string,method:string,payload:any){const r=await fetch(`https://api.kaggle.com/v1/kernels.KernelsApiService/${method}`,{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json','user-agent':'PabloVoice-Studio/speaker-id-v1'},body:JSON.stringify(payload)}),text=await r.text();let j:any={};try{j=JSON.parse(text)}catch{j={raw:text.slice(0,1200)}};if(!r.ok||j?.hasError===true||j?.error)throw new Error(`Kaggle ${method}: ${j?.error?.message||j?.error||j?.message||text.slice(0,600)}`);return j}
const worker=String.raw`import os,sys,subprocess,json,hashlib,tempfile,shutil,base64,requests,traceback
from pathlib import Path
T=json.loads(base64.b64decode(TICKET_B64).decode('utf-8'))
def sh(cmd):
 p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);print(p.stdout[-8000:]);
 if p.returncode: raise RuntimeError('command failed: '+p.stdout[-1500:])
def dl(url,path):
 with requests.get(url,stream=True,timeout=300) as r:
  r.raise_for_status()
  with open(path,'wb') as f:
   for c in r.iter_content(1024*1024):
    if c:f.write(c)
def sha(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for c in iter(lambda:f.read(1024*1024),b''):h.update(c)
 return h.hexdigest()
w=Path(tempfile.mkdtemp(prefix='pv-speaker-id-'))
try:
 c0=w/'candidate.bin';r0=w/'reference.bin';c=w/'candidate.wav';r=w/'reference.wav'
 dl(T['candidate_url'],c0);dl(T['reference_url'],r0)
 if sha(c0).lower()!=T['candidate_sha256'].lower():raise RuntimeError('candidate sha256 mismatch')
 if sha(r0).lower()!=T['reference_sha256'].lower():raise RuntimeError('reference sha256 mismatch')
 sh(['ffmpeg','-y','-i',str(c0),'-ar','16000','-ac','1','-c:a','pcm_s16le',str(c)])
 sh(['ffmpeg','-y','-i',str(r0),'-ar','16000','-ac','1','-c:a','pcm_s16le',str(r)])
 sh([sys.executable,'-m','pip','install','-q','speechbrain==1.0.3'])
 import torch,torchaudio
 from speechbrain.inference.speaker import EncoderClassifier
 device='cuda' if torch.cuda.is_available() else 'cpu'
 model=EncoderClassifier.from_hparams(source=T['engine'],savedir=str(w/'ecapa'),run_opts={'device':device})
 cs,_=torchaudio.load(str(c));rs,_=torchaudio.load(str(r));cs=cs.to(device);rs=rs.to(device)
 with torch.no_grad(): ce=model.encode_batch(cs).reshape(-1);re=model.encode_batch(rs).reshape(-1);score=float(torch.nn.functional.cosine_similarity(ce.unsqueeze(0),re.unsqueeze(0)).item())
 score=max(-1.0,min(1.0,score));passed=bool(score>=float(T['threshold']))
 payload={'action':'complete','job_id':T['job_id'],'callback_token':T['callback_token'],'candidate_sha256':T['candidate_sha256'],'reference_sha256':T['reference_sha256'],'reference_id':T['reference_id'],'voice_model_id':T['voice_model_id'],'engine':T['engine'],'engine_version':T['engine_version'],'score':score,'passed':passed,'device':device}
 rr=requests.post(T['runtime_url'],headers={'content-type':'application/json','apikey':T['supabase_publishable_key']},json=payload,timeout=120);print(rr.status_code,rr.text[:1500]);rr.raise_for_status()
finally:
 shutil.rmtree(w,ignore_errors=True)
`
Deno.serve(async(req:Request)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:cors});const u=new URL(req.url);if(req.method==='GET'&&u.searchParams.get('worker')==='1')return new Response(worker,{headers:{...cors,'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});if(req.method!=='POST')return out({ok:false,error:'method_not_allowed'},405);try{
 const url=Deno.env.get('SUPABASE_URL')||'',pubs=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}'),secs=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}'),pub=pubs.default||Deno.env.get('SUPABASE_ANON_KEY')||'',secret=secs.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}}),b=await req.json().catch(()=>({})),action=String(b.action||'status')
 if(action==='complete'){
  const id=String(b.job_id||''),cb=String(b.callback_token||'');if(!uuid(id)||cb.length<32)return out({ok:false,error:'invalid_callback'},400)
  const {data:j}=await admin.from('render_jobs').select('*').eq('id',id).eq('job_type','speaker_identity_attestation').maybeSingle();if(!j)return out({ok:false,error:'job_not_found'},404);if(j.status==='completed')return out({ok:true,already_completed:true,proof:j.proof})
  const p=j.parameters||{},exp=Number(p.callback_expires_at||0);if(exp&&Math.floor(Date.now()/1000)>exp)return out({ok:false,error:'callback_expired'},410);if(await sha(cb)!==String(p.callback_hash||''))return out({ok:false,error:'invalid_callback'},401)
  const csha=String(b.candidate_sha256||'').toLowerCase(),rsha=String(b.reference_sha256||'').toLowerCase(),score=Number(b.score),passed=b.passed===true
  if(csha!==String(p.candidate_sha256||'').toLowerCase()||rsha!==String(p.reference_sha256||'').toLowerCase())return out({ok:false,error:'artifact_hash_mismatch'},409)
  if(String(b.reference_id||'')!==String(p.reference_id||'')||String(b.voice_model_id||'')!==String(p.voice_model_id||''))return out({ok:false,error:'identity_binding_mismatch'},409)
  if(String(b.engine||'')!==MODEL||String(b.engine_version||'')!==ENGINE_VERSION)return out({ok:false,error:'engine_contract_mismatch'},409)
  if(!Number.isFinite(score)||score<-1||score>1||passed!==(score>=THRESHOLD))return out({ok:false,error:'score_contract_mismatch'},409)
  const proof={schema_version:1,verified:true,issuer:'pablovoice-speaker-identity-runtime-v1',candidate_asset_id:p.candidate_asset_id,candidate_sha256:csha,reference_id:p.reference_id,reference_asset_id:p.reference_asset_id,reference_sha256:rsha,voice_model_id:p.voice_model_id,engine:MODEL,engine_version:ENGINE_VERSION,score,threshold:THRESHOLD,passed,device:String(b.device||'unknown'),raw_embedding_exposed:false}
  const {error:ae}=await admin.from('analyses').insert({id:crypto.randomUUID(),project_id:j.project_id,asset_id:p.candidate_asset_id,user_id:j.user_id,analysis_type:'speaker_identity_attestation_v1',engine:MODEL,engine_version:ENGINE_VERSION,result:proof});if(ae)throw ae
  await admin.from('render_jobs').update({status:'completed',progress:100,current_stage:'completed',human_message:passed?'Identidade vocal preservada':'Identidade vocal não comprovada',heartbeat_at:new Date().toISOString(),finished_at:new Date().toISOString(),proof,error_message:null,error_code:null,technical_error:null}).eq('id',id)
  return out({ok:true,job_id:id,proof:{...proof,score:Number(score.toFixed(6))}})
 }
 const auth=req.headers.get('authorization')||'',jwt=auth.startsWith('Bearer ')?auth.slice(7):'';if(!jwt)return out({ok:false,error:'auth_required'},401)
 const uc=createClient(url,pub,{global:{headers:{Authorization:`Bearer ${jwt}`}},auth:{persistSession:false,autoRefreshToken:false}}),{data:ud}=await uc.auth.getUser(jwt),user=ud?.user;if(!user)return out({ok:false,error:'invalid_session'},401)
 const candidateId=String(b.candidate_asset_id||''),projectId=String(b.project_id||'')
 if(action==='status'||action==='sync'){
  if(!uuid(projectId))return out({ok:false,error:'invalid_project_id'},400);const {data:jobs}=await admin.from('render_jobs').select('*').eq('user_id',user.id).eq('project_id',projectId).eq('job_type','speaker_identity_attestation').order('created_at',{ascending:false}).limit(1),j=jobs?.[0]||null;if(!j)return out({ok:true,job:null,attestation:null});if(action==='sync'&&j.external_job_id&&j.status!=='completed'&&j.status!=='error'){const p=j.parameters||{},owner=String(p.kaggle_owner||''),slug=String(p.kaggle_slug||'');if(owner&&slug){const {data:cr}=await admin.rpc('admin_get_compute_connection',{p_user_id:user.id,p_provider:'kaggle'}),conn=Array.isArray(cr)?cr[0]:null;if(conn?.secret){try{const st=await kaggleRpc(conn.secret,'GetKernelSessionStatus',{userName:owner,kernelSlug:slug}),ks=String(st.status||'').toUpperCase();if(['ERROR','CANCEL_ACKNOWLEDGED'].includes(ks))await admin.from('render_jobs').update({status:'error',progress:0,current_stage:'error',error_code:'kaggle_runtime_error',error_message:String(st.failureMessage||'Kaggle speaker verification failed'),finished_at:new Date().toISOString()}).eq('id',j.id)}catch{}}}}
  const {data:a}=await admin.from('analyses').select('result,created_at').eq('user_id',user.id).eq('project_id',projectId).eq('analysis_type','speaker_identity_attestation_v1').order('created_at',{ascending:false}).limit(1);return out({ok:true,job:j,attestation:a?.[0]?.result||null})
 }
 if(action!=='dispatch')return out({ok:false,error:'unsupported_action'},400);if(!uuid(candidateId))return out({ok:false,error:'invalid_candidate_asset_id'},400)
 const {data:c}=await admin.from('audio_assets').select('*').eq('id',candidateId).eq('user_id',user.id).maybeSingle();if(!c||!uuid(c.project_id)||!shaOk(c.sha256))return out({ok:false,error:'candidate_asset_missing_or_unverified'},409)
 const {data:models}=await admin.from('voice_models').select('*').eq('user_id',user.id).eq('is_active',true).eq('status','ready').order('updated_at',{ascending:false}).limit(1),model=models?.[0];if(!model)return out({ok:false,error:'active_voice_model_required'},409)
 const {data:ref}=await admin.from('voice_identity_references').select('*').eq('user_id',user.id).eq('voice_model_id',model.id).eq('is_active',true).maybeSingle();if(!ref||!shaOk(ref.source_sha256))return out({ok:false,error:'active_identity_reference_required'},409)
 const {data:r}=await admin.from('audio_assets').select('*').eq('id',ref.asset_id).eq('user_id',user.id).maybeSingle();if(!r||!['take','source'].includes(String(r.kind||''))||String(r.sha256||'').toLowerCase()!==String(ref.source_sha256).toLowerCase())return out({ok:false,error:'identity_reference_asset_invalid'},409)
 const {data:cr,error:ce}=await admin.rpc('admin_get_compute_connection',{p_user_id:user.id,p_provider:'kaggle'});if(ce)throw ce;const conn=Array.isArray(cr)?cr[0]:null;if(!conn?.secret||!conn?.handle)return out({ok:false,error:'kaggle_not_connected'},409)
 const ttl=3600,exp=Math.floor(Date.now()/1000)+ttl,cb=token(),jobId=crypto.randomUUID();async function signed(a:any){const {data,error}=await admin.storage.from(a.storage_bucket).createSignedUrl(a.storage_path,ttl);if(error||!data?.signedUrl)throw new Error('signed_download_failed');return data.signedUrl}
 const parameters:any={candidate_asset_id:c.id,candidate_sha256:String(c.sha256).toLowerCase(),reference_id:ref.id,reference_asset_id:r.id,reference_sha256:String(r.sha256).toLowerCase(),voice_model_id:model.id,threshold:THRESHOLD,engine:MODEL,engine_version:ENGINE_VERSION,callback_hash:await sha(cb),callback_expires_at:exp}
 const {error:je}=await admin.from('render_jobs').insert({id:jobId,project_id:c.project_id,version_id:c.version_id||null,user_id:user.id,job_type:'speaker_identity_attestation',engine:'kaggle_speaker_identity_v1',status:'created',progress:5,input_asset_ids:[c.id,r.id],output_asset_ids:[],parameters,proof:{required:true,threshold:THRESHOLD,engine:MODEL,engine_version:ENGINE_VERSION,raw_embedding_exposed:false},current_stage:'created',human_message:'Preparando prova de identidade vocal',started_at:new Date().toISOString(),attempt_number:1,max_attempts:1});if(je)throw je
 const ticket={version:1,job_id:jobId,candidate_url:await signed(c),candidate_sha256:parameters.candidate_sha256,reference_url:await signed(r),reference_sha256:parameters.reference_sha256,reference_id:ref.id,voice_model_id:model.id,threshold:THRESHOLD,engine:MODEL,engine_version:ENGINE_VERSION,runtime_url:`${url}/functions/v1/test-voice-v71-identity-once`,callback_token:cb,supabase_publishable_key:pub}
 const owner=String(conn.handle),slug=`pablovoice-speaker-${jobId.replace(/-/g,'').slice(0,10)}`,full=`${owner}/${slug}`,bootstrap=`import requests,base64\nTICKET_B64='${b64(JSON.stringify(ticket))}'\nr=requests.get('${url}/functions/v1/test-voice-v71-identity-once?worker=1',timeout=60);r.raise_for_status()\nexec(compile(r.text,'pablovoice_speaker_identity_v1.py','exec'),globals(),globals())\n`,payload={slug:full,newTitle:`PabloVoice Speaker ID ${jobId.slice(0,8)}`,text:bootstrap,language:'python',kernelType:'script',isPrivate:true,enableGpu:true,enableInternet:true,machineShape:'NvidiaTeslaT4',kernelExecutionType:'SAVE_AND_RUN_ALL',datasetDataSources:[],competitionDataSources:[],kernelDataSources:[],modelDataSources:[],sessionTimeoutSeconds:3600}
 let push:any;try{push=await kaggleRpc(conn.secret,'SaveKernel',payload)}catch(e){const msg=String(e).slice(0,1000);await admin.from('render_jobs').update({status:'error',progress:0,current_stage:'error',error_code:'dispatch_failed',error_message:msg,finished_at:new Date().toISOString()}).eq('id',jobId);return out({ok:false,error:'kaggle_dispatch_failed',detail:msg,job_id:jobId},502)}
 parameters.kaggle_owner=owner;parameters.kaggle_slug=slug;parameters.kaggle_kernel_id=String(push.kernelId||'');await admin.from('render_jobs').update({status:'waiting_gpu',progress:8,current_stage:'waiting_gpu',human_message:'Aguardando GPU para validar identidade',external_job_id:String(push.kernelId||''),parameters}).eq('id',jobId)
 return out({ok:true,job_id:jobId,status:'waiting_gpu',threshold:THRESHOLD,engine:MODEL,engine_version:ENGINE_VERSION})
}catch(e){return out({ok:false,error:String(e instanceof Error?e.message:e).slice(0,1600)},500)}})
