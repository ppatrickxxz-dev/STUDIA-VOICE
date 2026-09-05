import { createClient } from 'npm:@supabase/supabase-js@2.112.2'
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization, x-client-info, apikey, content-type','access-control-allow-methods':'POST, OPTIONS'}
const out=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return out({ok:false,error:'method_not_allowed'},405)
 try{
  const url=Deno.env.get('SUPABASE_URL')||'',pubs=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}'),secs=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}'),pub=pubs.default||Deno.env.get('SUPABASE_ANON_KEY')||'',secret=secs.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',auth=req.headers.get('authorization')||'',jwt=auth.startsWith('Bearer ')?auth.slice(7):''
  if(!jwt)return out({ok:false,error:'auth_required'},401)
  const uc=createClient(url,pub,{global:{headers:{Authorization:`Bearer ${jwt}`}},auth:{persistSession:false,autoRefreshToken:false}}),admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}}),{data:ud}=await uc.auth.getUser(jwt),user=ud?.user
  if(!user)return out({ok:false,error:'invalid_session'},401)
  const b=await req.json().catch(()=>({})),action=String(b.action||''),projectId=String(b.project_id||'');if(!['undo','redo'].includes(action)||!/^[0-9a-f-]{36}$/i.test(projectId))return out({ok:false,error:'invalid_request'},400)
  const want=action==='undo'?'applied':'undone',asc=action==='redo';const {data:a}=await admin.from('studio_actions').select('*').eq('project_id',projectId).eq('user_id',user.id).eq('status',want).order('created_at',{ascending:asc}).limit(1).maybeSingle();if(!a)return out({ok:true,changed:false})
  const before=a.before_state||{},after=a.after_state||{}
  if(a.action_type==='track_effect_set'){
   if(action==='undo'){if(before?.id){const {error}=await admin.from('track_effects').upsert(before);if(error)throw error}else if(after?.id)await admin.from('track_effects').delete().eq('id',after.id).eq('user_id',user.id)}else{const {error}=await admin.from('track_effects').upsert(after);if(error)throw error}
   await admin.from('studio_actions').update({status:action==='undo'?'undone':'applied',undone_at:action==='undo'?new Date().toISOString():null}).eq('id',a.id);return out({ok:true,changed:true,mode:action,action_type:a.action_type})
  }
  if(a.action_type==='record_take'){
   const track=after.track||{},clip=after.clip||{},take=after.take||{};if(!track.id||!clip.id||!take.id)return out({ok:false,error:'record_take_history_incomplete'},409)
   if(action==='undo'){await admin.from('clips').delete().eq('id',clip.id).eq('user_id',user.id);await admin.from('tracks').delete().eq('id',track.id).eq('user_id',user.id);await admin.from('takes').update({track_id:null,selected:false}).eq('id',take.id).eq('user_id',user.id);await admin.from('studio_actions').update({status:'undone',undone_at:new Date().toISOString()}).eq('id',a.id);return out({ok:true,changed:true,mode:'undo',preserved_take_id:take.id,preserved_asset_id:take.asset_id||after.asset?.id||null})}
   const {error:te}=await admin.from('tracks').upsert(track);if(te)throw te;await admin.from('takes').update({track_id:track.id,selected:true}).eq('id',take.id).eq('user_id',user.id);const {data:existing}=await admin.from('clips').select('id').eq('id',clip.id).maybeSingle();if(!existing){const {error:ce}=await admin.from('clips').insert(clip);if(ce)throw ce}await admin.from('studio_actions').update({status:'applied',undone_at:null}).eq('id',a.id);return out({ok:true,changed:true,mode:'redo',track_id:track.id,clip_id:clip.id,take_id:take.id})
  }
  if(['render_instrument','render_video_audio'].includes(a.action_type)){
   const track=after.track||{},clip=after.clip||{},assetId=after.asset?.id||a.target_id;if(!track.id||!clip.id||!assetId)return out({ok:false,error:'render_history_incomplete'},409)
   if(action==='undo'){await admin.from('clips').delete().eq('id',clip.id).eq('user_id',user.id);await admin.from('tracks').delete().eq('id',track.id).eq('user_id',user.id);await admin.from('studio_actions').update({status:'undone',undone_at:new Date().toISOString()}).eq('id',a.id);return out({ok:true,changed:true,mode:'undo',action_type:a.action_type,preserved_asset_id:assetId})}
   const {error:te}=await admin.from('tracks').upsert(track);if(te)throw te;const {data:existing}=await admin.from('clips').select('id').eq('id',clip.id).maybeSingle();if(!existing){const {error:ce}=await admin.from('clips').insert(clip);if(ce)throw ce}await admin.from('studio_actions').update({status:'applied',undone_at:null}).eq('id',a.id);return out({ok:true,changed:true,mode:'redo',action_type:a.action_type,track_id:track.id,clip_id:clip.id,asset_id:assetId})
  }
  const r=await fetch(`${url}/functions/v1/studio-state-v61`,{method:'POST',headers:{apikey:pub,authorization:`Bearer ${jwt}`,'content-type':'application/json'},body:JSON.stringify({action,project_id:projectId})});const text=await r.text();return new Response(text,{status:r.status,headers:{...cors,'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
 }catch(e){return out({ok:false,error:String(e instanceof Error?e.message:e).slice(0,1200)},500)}
})