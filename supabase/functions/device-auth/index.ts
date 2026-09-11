import { createClient } from 'npm:@supabase/supabase-js@2.112.2'

const STUDIO='https://studia-voice.ppatrickxxz.workers.dev'
const PROJECT='https://yokmhqoncdwvxmzzybqa.supabase.co'
const ANDROID_APP_ORIGIN='https://appassets.androidplatform.net'
const CLOUDFLARE_ORIGIN=/^https:\/\/(?:[a-z0-9-]+-)?studia-voice\.ppatrickxxz\.workers\.dev$/i
const LOCAL_WEB_ORIGIN=/^https?:\/\/(?:127\.0\.0\.1|localhost):4173$/i
const OIDC_ISSUER='https://token.actions.githubusercontent.com'
const OIDC_AUDIENCE='pablovoice-signing'
const OIDC_REPOSITORY='ppatrickxxz-dev/STUDIA-VOICE'
const OIDC_REF='refs/heads/main'
const OIDC_ENVIRONMENT='pablovoice-production'
const OIDC_JWKS='https://token.actions.githubusercontent.com/.well-known/jwks'
const B09_PROJECT_ID='d64e4de9-791e-41bc-9307-7957389b2499'
const AUTO_PROVISION_DAILY_LIMIT=4

function appOriginAllowed(origin=''){return origin===ANDROID_APP_ORIGIN||origin===STUDIO||CLOUDFLARE_ORIGIN.test(origin)||LOCAL_WEB_ORIGIN.test(origin)}
function cors(origin=''){
 const allowed=origin===PROJECT||appOriginAllowed(origin)
 return{'access-control-allow-origin':allowed?origin:STUDIO,'access-control-allow-headers':'authorization, apikey, content-type','access-control-allow-methods':'GET, POST, OPTIONS','vary':'Origin'}
}
const noStore={'cache-control':'no-store, private, max-age=0','pragma':'no-cache','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow, noarchive'}
const json=(origin:string,body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors(origin),...noStore,'content-type':'application/json; charset=utf-8'}})
function env(){const url=Deno.env.get('SUPABASE_URL')||'',pubs=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}'),secs=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}'),pub=pubs.default||Deno.env.get('SUPABASE_ANON_KEY')||'',secret=secs.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';if(!url||!pub||!secret)throw new Error('server_configuration_error');return{url,pub,secret}}
function randomToken(bytes=32){const b=new Uint8Array(bytes);crypto.getRandomValues(b);return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'')}
async function sha256(v:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function hmac256(secret:string,value:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const d=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,'0')).join('')}
function edgeNetworkIdentity(req:Request){const cf=String(req.headers.get('cf-connecting-ip')||'').trim();if(cf)return cf;const chain=String(req.headers.get('x-forwarded-for')||'').split(',').map(x=>x.trim()).filter(Boolean);return chain.length?chain[chain.length-1]:''}
async function admissionNetworkHash(secret:string,req:Request){const network=edgeNetworkIdentity(req);return network?await hmac256(secret,`pv-transparent-device-v1:${network}`):''}
function b64url(input:string){const normalized=input.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(input.length/4)*4,'=');return Uint8Array.from(atob(normalized),c=>c.charCodeAt(0))}
function jwtJson(input:string){return JSON.parse(new TextDecoder().decode(b64url(input)))}
async function verifyGithubOidc(token:string){
 const parts=token.split('.');if(parts.length!==3)throw new Error('oidc_shape');const[h,p,s]=parts,header=jwtJson(h),payload=jwtJson(p);if(header.alg!=='RS256'||!header.kid)throw new Error('oidc_header');
 const now=Math.floor(Date.now()/1000);if(payload.iss!==OIDC_ISSUER)throw new Error('oidc_issuer');const aud=Array.isArray(payload.aud)?payload.aud:[payload.aud];if(!aud.includes(OIDC_AUDIENCE))throw new Error('oidc_audience');if(!Number(payload.exp)||Number(payload.exp)<now-30)throw new Error('oidc_expired');if(payload.nbf&&Number(payload.nbf)>now+30)throw new Error('oidc_nbf');
 if(payload.repository!==OIDC_REPOSITORY)throw new Error('oidc_repository');if(payload.ref!==OIDC_REF)throw new Error('oidc_ref');if(payload.environment!==OIDC_ENVIRONMENT)throw new Error('oidc_environment');if(payload.event_name!=='push'&&payload.event_name!=='workflow_dispatch')throw new Error('oidc_event');
 const jwks=await fetch(OIDC_JWKS,{headers:{accept:'application/json'}}).then(r=>{if(!r.ok)throw new Error('oidc_jwks');return r.json()});const jwk=Array.isArray(jwks.keys)?jwks.keys.find((k:any)=>k.kid===header.kid&&k.kty==='RSA'):null;if(!jwk)throw new Error('oidc_key');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);const ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64url(s),new TextEncoder().encode(`${h}.${p}`));if(!ok)throw new Error('oidc_signature');return payload
}

async function sessionForUser(admin:any,pubClient:any,userId:string){const {data:ud,error:ue}=await admin.auth.admin.getUserById(userId);if(ue)throw ue;const email=ud?.user?.email;if(!email)throw new Error('account_identity_missing');const {data:g,error:ge}=await admin.auth.admin.generateLink({type:'magiclink',email});if(ge)throw ge;const h=g?.properties?.hashed_token;if(!h)throw new Error('internal_token_missing');const {data:v,error:ve}=await pubClient.auth.verifyOtp({token_hash:h,type:'email'});if(ve)throw ve;const s=v?.session;if(!s?.access_token||!s?.refresh_token)throw new Error('session_not_created');return s}
async function registerDevice(admin:any,userId:string,label='Este aparelho'){const token=randomToken(),hash=await sha256(token),exp=new Date(Date.now()+180*24*60*60*1000).toISOString();const {data:active}=await admin.from('trusted_devices').select('id,created_at').eq('user_id',userId).is('revoked_at',null).gt('expires_at',new Date().toISOString()).order('created_at',{ascending:true});if((active||[]).length>=5){const old=(active||[]).slice(0,(active||[]).length-4).map((x:any)=>x.id);if(old.length)await admin.from('trusted_devices').update({revoked_at:new Date().toISOString()}).in('id',old)}const {data:r,error}=await admin.from('trusted_devices').insert({user_id:userId,token_hash:hash,device_label:label.slice(0,120),expires_at:exp,last_used_at:new Date().toISOString()}).select('id').single();if(error)throw error;return{device_id:r.id,device_token:token,device_expires_at:exp}}
async function bootstrapWithCode(admin:any,pubClient:any,body:any){const code=String(body?.code||'').trim().replace(/\s+/g,'');if(code.length<6||code.length>64)return{status:401,body:{ok:false,error:'bootstrap_invalid',human_message:'Código inválido, expirado ou já usado.'}};const hash=await sha256(code),now=new Date().toISOString();const {data:row,error:readErr}=await admin.from('bootstrap_login_codes').select('id,user_id').eq('code_hash',hash).is('used_at',null).gt('expires_at',now).maybeSingle();if(readErr)throw readErr;if(!row)return{status:401,body:{ok:false,error:'bootstrap_invalid',human_message:'Código inválido, expirado ou já usado.'}};const {data:claimed,error:claimErr}=await admin.from('bootstrap_login_codes').update({used_at:now}).eq('id',row.id).is('used_at',null).select('id,user_id').maybeSingle();if(claimErr)throw claimErr;if(!claimed)return{status:409,body:{ok:false,error:'bootstrap_used',human_message:'Esse código já foi usado. Gere um novo código.'}};const s=await sessionForUser(admin,pubClient,claimed.user_id),dev=await registerDevice(admin,claimed.user_id,String(body?.label||'PabloVoice Android'));return{status:200,body:{ok:true,session:{access_token:s.access_token,refresh_token:s.refresh_token,expires_in:s.expires_in,token_type:s.token_type},device_token:dev.device_token,device_expires_at:dev.device_expires_at}}}
async function automaticDevice(admin:any,pubClient:any,origin:string,label:string,req:Request,secret:string){
 if(!appOriginAllowed(origin))return{status:403,body:{ok:false,error:'origin_not_allowed'}}
 const networkHash=await admissionNetworkHash(secret,req)
 if(!networkHash)return{status:403,body:{ok:false,error:'device_admission_unavailable'}}
 const {data:allowed,error:quotaError}=await admin.rpc('consume_transparent_device_quota',{p_network_hash:networkHash,p_limit:AUTO_PROVISION_DAILY_LIMIT})
 if(quotaError)throw quotaError
 if(allowed!==true)return{status:429,body:{ok:false,error:'device_provision_rate_limited',retry_after_seconds:3600}}
 const id=crypto.randomUUID(),email=`device-${id}@example.invalid`,password=randomToken(48)
 const {data:created,error:createError}=await admin.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{pablovoice_app_device:true,access_profile:'unified_online',admission:'edge_network_hmac_daily_quota_v1'}})
 if(createError||!created?.user?.id)throw createError||new Error('device_account_create_failed')
 const {data:login,error:loginError}=await pubClient.auth.signInWithPassword({email,password})
 if(loginError||!login?.session?.access_token||!login?.session?.refresh_token)throw loginError||new Error('device_session_create_failed')
 const dev=await registerDevice(admin,created.user.id,label||'PabloVoice')
 const s=login.session
 return{status:200,body:{ok:true,mode:'transparent_device',session:{access_token:s.access_token,refresh_token:s.refresh_token,expires_in:s.expires_in,token_type:s.token_type},device_token:dev.device_token,device_expires_at:dev.device_expires_at}}
}

Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';if(req.method==='OPTIONS')return new Response('ok',{headers:cors(origin)})
 try{
  const {url,pub,secret}=env(),admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),pubClient=createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
  if(req.method==='GET'){
   const u=new URL(req.url)
   if(u.searchParams.get('health')==='1')return json(origin,{ok:true,service:'device-auth',version:'9.1-unified-online',candidate:STUDIO,ui_transport:'cloudflare-workers-static-assets',edge_html:false,vercel_dependency:false,preview_slot_dependency:false,bootstrap_pairing:true,transparent_device_access:true,user_login_ui:false,password_prompt:false,offline_mode:false,auto_provisioning_admission:'edge_network_hmac_daily_quota_v1',auto_provision_daily_limit:AUTO_PROVISION_DAILY_LIMIT,oidc_signing:true,oidc_b09:true,origins:[STUDIO,ANDROID_APP_ORIGIN,PROJECT]})
   const key=u.searchParams.get('k')||'';if(key.length<32)return json(origin,{ok:false,error:'access_invalid'},403)
   const ua=(req.headers.get('user-agent')||'').toLowerCase(),dest=(req.headers.get('sec-fetch-dest')||'').toLowerCase(),mode=(req.headers.get('sec-fetch-mode')||'').toLowerCase(),bot=/bot|crawler|spider|preview|unfurl|slack|discord|whatsapp|telegram|facebookexternalhit|twitterbot|linkedinbot/.test(ua);if(bot||(dest&&dest!=='document')||(mode&&mode!=='navigate'))return new Response('',{status:204,headers:noStore})
   const tokenHash=await sha256(key),{data:userId,error:consumeErr}=await admin.rpc('consume_internal_login',{p_token_hash:tokenHash});if(consumeErr)throw consumeErr;if(!userId)return json(origin,{ok:false,error:'access_used_or_expired'},410)
   const s=await sessionForUser(admin,pubClient,userId),dev=await registerDevice(admin,userId,'Android functional gate Cloudflare')
   const fragment=new URLSearchParams({access_token:s.access_token,refresh_token:s.refresh_token,expires_in:String(s.expires_in||3600),token_type:s.token_type||'bearer',device_token:dev.device_token}).toString()
   return new Response(null,{status:302,headers:{...noStore,location:`${STUDIO}/#${fragment}`}})
  }
  if(req.method!=='POST')return json(origin,{ok:false,error:'method_not_allowed'},405)
  const body=await req.json().catch(()=>({})),action=String(body?.action||'')
  if(action==='signing_bundle'){
   try{const auth=req.headers.get('authorization')||'',token=auth.startsWith('Bearer ')?auth.slice(7).trim():'';if(!token)throw new Error('oidc_required');const claims=await verifyGithubOidc(token);const {data,error}=await admin.rpc('get_pablovoice_android_signing_bundle');if(error||!data?.keystore_b64||!data?.store_password||!data?.key_alias||!data?.key_password)throw new Error('signing_bundle_unavailable');return json(origin,{ok:true,bundle:data,run_id:claims.run_id||null})}catch(e){console.error('signing_bundle_denied',e);return json(origin,{ok:false,error:'forbidden'},403)}
  }
  if(action==='b09_session'){
   try{const auth=req.headers.get('authorization')||'',token=auth.startsWith('Bearer ')?auth.slice(7).trim():'';if(!token)throw new Error('oidc_required');const claims=await verifyGithubOidc(token);const {data:project,error:pe}=await admin.from('projects').select('id,user_id').eq('id',B09_PROJECT_ID).single();if(pe||!project?.user_id)throw pe||new Error('b09_project_missing');const s=await sessionForUser(admin,pubClient,project.user_id);return json(origin,{ok:true,project_id:B09_PROJECT_ID,session:{access_token:s.access_token,expires_in:s.expires_in,token_type:s.token_type||'bearer'},run_id:claims.run_id||null})}catch(e){console.error('b09_session_denied',e);return json(origin,{ok:false,error:'forbidden'},403)}
  }
  if(action==='auto'){const out=await automaticDevice(admin,pubClient,origin,String(body?.label||'PabloVoice'),req,secret);return json(origin,out.body,out.status)}
  if(action==='bootstrap'){const out=await bootstrapWithCode(admin,pubClient,body);return json(origin,out.body,out.status)}
  if(action==='login'){const token=String(body?.device_token||'');if(token.length<40||token.length>200)return json(origin,{ok:false,error:'device_access_invalid'},401);const hash=await sha256(token),{data:row}=await admin.from('trusted_devices').select('*').eq('token_hash',hash).is('revoked_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();if(!row)return json(origin,{ok:false,error:'device_access_invalid'},401);const s=await sessionForUser(admin,pubClient,row.user_id),next=randomToken(),nextHash=await sha256(next),nextExp=new Date(Date.now()+180*24*60*60*1000).toISOString(),{error:re}=await admin.from('trusted_devices').update({token_hash:nextHash,last_used_at:new Date().toISOString(),expires_at:nextExp}).eq('id',row.id).eq('token_hash',hash);if(re)throw re;return json(origin,{ok:true,session:{access_token:s.access_token,refresh_token:s.refresh_token,expires_in:s.expires_in,token_type:s.token_type},device_token:next,device_expires_at:nextExp})}
  const auth=req.headers.get('authorization')||'',jwt=auth.startsWith('Bearer ')?auth.slice(7):'';if(!jwt)return json(origin,{ok:false,error:'auth_required'},401);const userClient=createClient(url,pub,{global:{headers:{Authorization:`Bearer ${jwt}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),{data:ud,error:ue}=await userClient.auth.getUser(jwt),user=ud?.user;if(ue||!user)return json(origin,{ok:false,error:'invalid_session'},401)
  if(action==='register'){const d=await registerDevice(admin,user.id,String(body?.label||'Este aparelho'));return json(origin,{ok:true,...d})}
  if(action==='revoke_all'){const {error}=await admin.from('trusted_devices').update({revoked_at:new Date().toISOString()}).eq('user_id',user.id).is('revoked_at',null);if(error)throw error;return json(origin,{ok:true})}
  if(action==='status'){const {data}=await admin.from('trusted_devices').select('id,device_label,created_at,last_used_at,expires_at').eq('user_id',user.id).is('revoked_at',null).gt('expires_at',new Date().toISOString()).order('last_used_at',{ascending:false});return json(origin,{ok:true,devices:data||[]})}
  return json(origin,{ok:false,error:'unsupported_action'},400)
 }catch(e){console.error('device-auth',e);return json(origin,{ok:false,error:String(e instanceof Error?e.message:e).slice(0,500)},500)}
})
