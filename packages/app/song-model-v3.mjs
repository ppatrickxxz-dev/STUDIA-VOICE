export const PABLOVOICE_SONG_MODEL_SCHEMA='pablovoice_song_model_v3';
export const PABLOVOICE_VOCAL_PERFORMANCE_SCHEMA='pablovoice_vocal_performance_v1';
export const PABLOVOICE_VOICE_RENDER_SCHEMA='pablovoice_voice_render_v1';
export const PABLOVOICE_MIX_SCHEMA='pablovoice_mix_v1';
const immutable=['lyrics','phonemes','vocalMelody','notes','pitchContour','timing','durations','phrasing','dynamics','breathPlacement','vibratoIntent','harmonies','adlibs','songStructure','bpm','key','instrumental','arrangement','songDuration'];
const mutable=['voiceIdentity','timbre','resonance','formants','vocalTexture','breathCharacter','registerCharacter'];
export const VOICE_REPLACEMENT_LOCK=Object.freeze({schema:'pablovoice_voice_replacement_lock_v1',mode:'identity_only',immutable:Object.freeze(immutable),mutable:Object.freeze(mutable),onViolation:'reject_render'});

export function ensureSongModelV3(project){
  if(!project||typeof project!=='object')return project;
  const take=latestTake(project),old=project.songModel?.schema===PABLOVOICE_SONG_MODEL_SCHEMA?project.songModel:{},vp=old.vocalPerformance||{},voice=old.voice||{},mix=old.mix||{},comp=old.composition||{};
  const instrumental=Boolean(take&&(take.instrumentalOnly===true||take.mode==='instrumental'||take.creationMode==='instrumental_first'));
  const native=take?.vocalPerformance?.status==='ready'||take?.vocalPerformance?.schema===PABLOVOICE_VOCAL_PERFORMANCE_SCHEMA?take.vocalPerformance:vp.status==='ready'&&vp.authority==='master_vocal_performance'?vp:null;
  const sourceTakeId=take?.id||old.sourceTakeId||null,masterTrackId=take?.referenceTrackId||take?.instrumentalTrackId||mix.masterTrackId||project.activeTrackId||null,guideTrackId=take?.guideTrackId||vp.guideTrackId||null;
  const lyrics=String(project.lyrics??take?.lyricsSnapshot??comp.lyrics??''),sections=copy(take?.sections??comp.sections),{updatedAt:oldUpdatedAt,...stableOld}=old;
  const next={...stableOld,schema:PABLOVOICE_SONG_MODEL_SCHEMA,sourceTakeId,
    composition:{...comp,schema:'pablovoice_composition_v1',sourceTakeId,lyrics,bpm:num(take?.bpm??comp.bpm),key:take?.key??comp.key??null,genre:take?.genre??comp.genre??null,mood:take?.mood??comp.mood??null,durationSeconds:num(take?.durationSeconds??comp.durationSeconds),sections,arrangementMap:project.arrangementMap||comp.arrangementMap||null,status:take?'ready':comp.status||'draft'},
    vocalPerformance:{...vp,schema:PABLOVOICE_VOCAL_PERFORMANCE_SCHEMA,sourceTakeId,guideTrackId,status:instrumental?'not_required':native?'ready':take?'capture_required':'not_created',authority:instrumental?'instrumental_only':native?'master_vocal_performance':'legacy_guide_not_authoritative',source:native?.source||(take?.guideType==='synth_melody'?'legacy_synth_guide':vp.source||null),performance:native?.performance||vp.performance||null,preservationRequired:!instrumental},
    voice:{...voice,schema:PABLOVOICE_VOICE_RENDER_SCHEMA,activeProfileId:voice.activeProfileId||'guide',guideProfile:{id:'guide',label:'Voz guia',authorized:true,kind:'guide',...(voice.guideProfile||{})},personalProfile:voice.personalProfile||null,replacementLock:VOICE_REPLACEMENT_LOCK,replacementStatus:instrumental?'not_applicable':native?(voice.personalProfile?'ready':'needs_personal_voice'):'needs_master_vocal_performance'},
    mix:{...mix,schema:PABLOVOICE_MIX_SCHEMA,masterTrackId,trackIds:(project.tracks||[]).map(t=>t.id).filter(Boolean),stemTrackIds:(project.tracks||[]).filter(t=>String(t.role||'').includes('stem')||/stem|generated_instrumental|guide_vocal|vocal/.test(String(t.kind||''))).map(t=>t.id),status:masterTrackId?'ready':mix.status||'draft',sourceTakeId}};
  project.songModel={...next,updatedAt:oldUpdatedAt&&JSON.stringify(stableOld)===JSON.stringify(next)?oldUpdatedAt:Date.now()};
  return project;
}

export function songModelReadiness(project){
  const m=ensureSongModelV3(project)?.songModel;
  if(!m)return {compositionReady:false,vocalPerformanceReady:false,voiceReplacementReady:false,mixReady:false,firstSongReady:false};
  const instrumental=m.vocalPerformance?.status==='not_required',compositionReady=m.composition?.status==='ready',vocalPerformanceReady=instrumental||m.vocalPerformance?.status==='ready',voiceReplacementReady=!instrumental&&m.vocalPerformance?.status==='ready'&&Boolean(m.voice?.personalProfile?.authorized),mixReady=m.mix?.status==='ready'&&Boolean(m.mix?.masterTrackId);
  return {compositionReady,vocalPerformanceReady,voiceReplacementReady,mixReady,firstSongReady:compositionReady&&mixReady};
}

export function attachMasterVocalPerformance(project,{sourceTakeId=null,guideTrackId=null,source='native_sung_performance',performance=null}={}){
  ensureSongModelV3(project);const m=project.songModel,v=m.vocalPerformance;
  m.vocalPerformance={...v,schema:PABLOVOICE_VOCAL_PERFORMANCE_SCHEMA,sourceTakeId:sourceTakeId||m.sourceTakeId||null,guideTrackId:guideTrackId||v.guideTrackId||null,status:'ready',authority:'master_vocal_performance',source,performance:performance||v.performance||{},preservationRequired:true};
  m.voice={...m.voice,replacementLock:VOICE_REPLACEMENT_LOCK,replacementStatus:m.voice?.personalProfile?'ready':'needs_personal_voice'};return project;
}

export function attachAuthorizedPersonalVoice(project,profile){
  if(!profile?.id)throw new TypeError('Perfil de voz sem id.');ensureSongModelV3(project);const m=project.songModel;
  m.voice={...m.voice,personalProfile:{...profile,authorized:profile.authorized===true,kind:'personal'}};
  m.voice.replacementStatus=m.vocalPerformance?.status==='ready'?(profile.authorized===true?'ready':'needs_voice_authorization'):'needs_master_vocal_performance';return project;
}

export function validateVoiceReplacementDelta(delta={}){const changed=new Set(Object.keys(delta).filter(k=>delta[k]!==undefined)),violations=immutable.filter(k=>changed.has(k));return {ok:!violations.length,violations,allowed:mutable.filter(k=>changed.has(k)),action:violations.length?'reject_render':'allow_voice_render'};}
function latestTake(project){const takes=Array.isArray(project.songCreation?.takes)?project.songCreation.takes:[];return takes.find(t=>t?.id===project.songCreation?.latestTakeId)||takes.at(-1)||null;}
function num(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function copy(value){return Array.isArray(value)?value.map(x=>x&&typeof x==='object'?{...x}:x):[];}
