import { createClient } from 'npm:@supabase/supabase-js@2.112.2'
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization, x-client-info, apikey, content-type','access-control-allow-methods':'POST, OPTIONS'}
const out=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
const ext=(m:string)=>m.includes('webm')?'webm':m.includes('ogg')?'ogg':m.includes('wav')?'wav':m.includes('mp4')||m.includes('m4a')?'m4a':'bin'
const sourceFolder=(s:string)=>s==='instrument_render'?'instrument-renders':s==='video_audio_render'?'video-audio-renders':s==='source_import'?'source-imports':'recordings'
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return out({ok:false,error:'method_not_allowed'},405)
 try{
  const url=Deno.env.get('SUPABASE_URL')||'',pubs=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}'),secs=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}'),pub=pubs.default||Deno.env.get('SUPABASE_ANON_KEY')||'',secret=secs.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',auth=req.headers.get('authorization')||'',jwt=auth.startsWith('Bearer ')?auth.slice(7):''
  if(!jwt)return out({ok:false,error:'auth_required'},401)
  const uc=createClient(url,pub,{global:{headers:{Authorization:`Bearer ${jwt}`}},auth:{persistSession:false,autoRefreshToken:false}}),admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}}),{data:ud}=await uc.auth.getUser(jwt),user=ud?.user
  if(!user)return out({ok:false,error:'invalid_session'},401)
  const b=await req.json().catch(()=>({})),projectId=String(b.project_id||''),mime=String(b.mime_type||'').split(';')[0].toLowerCase(),size=Number(b.size_bytes||0),timeline=Math.max(0,Number(b.timeline_start||0)),sourceType=String(b.source_type||'recording')
  if(!/^[0-9a-f-]{36}$/i.test(projectId))return out({ok:false,error:'invalid_project_id'},400)
  if(!['recording','instrument_render','video_audio_render','source_import'].includes(sourceType))return out({ok:false,error:'invalid_source_type'},400)
  if(!['audio/webm','audio/ogg','audio/wav','audio/x-wav','audio/mp4','audio/m4a'].includes(mime))return out({ok:false,error:'unsupported_recording_format'},415)
  if(sourceType==='instrument_render'&&!['audio/wav','audio/x-wav'].includes(mime))return out({ok:false,error:'instrument_render_requires_wav'},415)
  if(!Number.isFinite(size)||size<1||size>96*1024*1024)return out({ok:false,error:'recording_size_not_allowed'},413)
  const {data:p}=await admin.from('projects').select('id,title').eq('id',projectId).eq('user_id',user.id).maybeSingle();if(!p)return out({ok:false,error:'project_not_found'},404)
  const {data:v}=await admin.from('project_versions').select('id').eq('project_id',projectId).eq('user_id',user.id).order('version_number',{ascending:false}).limit(1).maybeSingle()
  const uploadId=crypto.randomUUID(),assetId=crypto.randomUUID(),takeId=crypto.randomUUID(),fallback=sourceType==='instrument_render'?`Instrument-${new Date().toISOString().replace(/[:.]/g,'-')}.wav`:sourceType==='video_audio_render'?`Video-Audio-${new Date().toISOString().replace(/[:.]/g,'-')}.${ext(mime)}`:sourceType==='source_import'?`Source-${new Date().toISOString().replace(/[:.]/g,'-')}.${ext(mime)}`:`Take-${new Date().toISOString().replace(/[:.]/g,'-')}.${ext(mime)}`,name=String(b.original_name||fallback).slice(0,180),path=`${user.id}/${projectId}/${sourceFolder(sourceType)}/${uploadId}.${ext(mime)}`
  const {data:s,error:se}=await admin.storage.from('audio-private').createSignedUploadUrl(path);if(se||!s?.signedUrl||!s?.token)throw new Error('signed_upload_failed')
  const metadata:any={declared_size:size,recorder:String(b.recorder||'MediaRecorder').slice(0,80),source_type:sourceType,track_name:String(b.track_name||'').slice(0,120)||null,preset:String(b.preset||'').slice(0,80)||null,bpm:Number.isFinite(Number(b.bpm))?Number(b.bpm):null}
  if(sourceType==='video_audio_render')Object.assign(metadata,{profile:String(b.profile||'voice_clear').slice(0,80),source_video_name:String(b.source_video_name||'').slice(0,180)||null,source_video_type:String(b.source_video_type||'').slice(0,120)||null,source_video_size:Number.isFinite(Number(b.source_video_size))?Number(b.source_video_size):null})
  const {error:ie}=await admin.from('recording_uploads').insert({id:uploadId,user_id:user.id,project_id:projectId,version_id:v?.id||null,asset_id:assetId,take_id:takeId,storage_bucket:'audio-private',storage_path:path,mime_type:mime,original_name:name,timeline_start:timeline,metadata});if(ie)throw ie
  return out({ok:true,upload_id:uploadId,asset_id:assetId,take_id:takeId,bucket:'audio-private',path,token:s.token,signed_url:s.signedUrl,mime_type:mime,source_type:sourceType,expires_in:7200})
 }catch(e){return out({ok:false,error:String(e instanceof Error?e.message:e).slice(0,1000)},500)}
})