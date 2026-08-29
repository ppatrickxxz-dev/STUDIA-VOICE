import { RemoteAuthAdapter } from './remote-auth.mjs';
import { getAudioAsset, listProjects } from './storage.mjs';
import { encodeWav } from './audio/src/presets.mjs';
import { importStandaloneStems, waitForStandaloneStems } from './stems-result-runtime.mjs';

const PROJECT_URL='https://yokmhqoncdwvxmzzybqa.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const DISPATCHER='compute-kaggle-v54';
const ACTIVE_PROJECT_KEY='pablovoice.stems.canary.activeProjectId';
const auth=new RemoteAuthAdapter();
let running=false;

auth.consumeBootstrapFragment();

document.addEventListener('click',(event)=>{
  const target=event.target.closest('[data-action="open-project"][data-id]');
  if(target?.dataset.id)localStorage.setItem(ACTIVE_PROJECT_KEY,target.dataset.id);
},{capture:true});

function headers(token='',json=true){const h={apikey:PUBLISHABLE_KEY};if(token)h.authorization=`Bearer ${token}`;if(json)h['content-type']='application/json';return h}
async function api(slug,token,body){const r=await fetch(`${PROJECT_URL}/functions/v1/${slug}`,{method:'POST',headers:headers(token),body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok||j?.ok!==true)throw Error(j?.error||`${slug}_${r.status}`);return j}
async function sha256(blob){const d=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());return[...new Uint8Array(d)].map(v=>v.toString(16).padStart(2,'0')).join('')}
async function wavFromBlob(blob){const C=globalThis.AudioContext||globalThis.webkitAudioContext;if(!C)throw Error('Web Audio indisponível.');const ctx=new C();try{const buffer=await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));return{blob:new Blob([encodeWav(buffer)],{type:'audio/wav'}),duration:buffer.duration,sampleRate:buffer.sampleRate,channels:Math.min(2,buffer.numberOfChannels)}}finally{await ctx.close().catch(()=>{})}}

async function resolveVisibleProject(){
  const visibleName=document.querySelector('.pv-hero.compact .pv-title')?.textContent?.trim()||'';
  const visibleTrack=document.querySelector('.pv-hero.compact .pv-lead')?.textContent?.trim()||'';
  if(!visibleName)throw Error('Abra o Studio de um projeto antes do canário.');
  const projects=await listProjects();
  const candidates=projects.filter((project)=>project?.name===visibleName && (visibleTrack ? project?.tracks?.some((track)=>track.name===visibleTrack) : true));
  const remembered=localStorage.getItem(ACTIVE_PROJECT_KEY);
  if(remembered){const rememberedVisible=candidates.find((project)=>project.id===remembered);if(rememberedVisible)return rememberedVisible;localStorage.removeItem(ACTIVE_PROJECT_KEY)}
  if(candidates.length===1)return candidates[0];
  if(candidates.length>1)throw Error('Há mais de um projeto compatível com a tela atual. Reabra o projeto antes do canário para evitar enviar o áudio errado.');
  throw Error('Não foi possível identificar com segurança o projeto aberto. Reabra-o em Meus projetos e tente novamente.');
}

async function uploadSource({token,projectId,track,asset}){
  status('Preparando uma cópia WAV verificada…','warn');
  const wav=await wavFromBlob(asset.blob);if(wav.blob.size>96*1024*1024)throw Error('Esta faixa excede o limite de 96 MB do canário remoto.');
  const hash=await sha256(wav.blob);
  const ticket=await api('recording-ticket-v63',token,{project_id:projectId,mime_type:'audio/wav',size_bytes:wav.blob.size,timeline_start:0,original_name:`Canary-${String(asset.name||track.name||'source').replace(/[^\p{L}\p{N}._-]+/gu,'_')}.wav`,recorder:'PabloVoice Stems Canary',source_type:'source_import',track_name:`Canário stems · ${track.name||'faixa'}`});
  const fd=new FormData();fd.append('cacheControl','3600');fd.append('',wav.blob,'source.wav');
  status('Enviando a fonte para o Storage privado…','warn');
  const up=await fetch(ticket.signed_url,{method:'PUT',headers:{apikey:PUBLISHABLE_KEY,authorization:`Bearer ${token}`,'x-upsert':'false'},body:fd});if(!up.ok)throw Error(`Falha no upload remoto (${up.status}).`);
  status('Validando SHA-256 da fonte…','warn');
  const fin=await api('recording-finalize-v63',token,{upload_id:ticket.upload_id,sha256:hash,duration_seconds:wav.duration,sample_rate:wav.sampleRate,channels:wav.channels});
  if(!fin.asset_id)throw Error('O source remoto não retornou asset_id.');
  return{assetId:fin.asset_id,sha256:hash,duration:wav.duration};
}

async function dispatchStems({token,projectId,sourceAssetId}){status('Enviando para Demucs htdemucs…','warn');const out=await api(DISPATCHER,token,{project_id:projectId,source_asset_id:sourceAssetId});if(!out.job_id)throw Error('O dispatcher não retornou job_id.');return out}

async function runCanary(){
  if(running)return;running=true;buttonDisabled(true);
  try{
    const session=await auth.ensureSession();if(!session?.accessToken)throw Error('Sessão remota necessária. Abra o PabloVoice autenticado neste aparelho.');
    const project=await resolveVisibleProject();if(!project?.tracks?.length)throw Error('Crie ou abra um projeto com áudio antes do canário.');
    localStorage.setItem(ACTIVE_PROJECT_KEY,project.id);
    const track=project.tracks.find(t=>t.id===project.activeTrackId)||project.tracks[0];const asset=await getAudioAsset(track.assetId);if(!asset?.blob)throw Error('A faixa ativa não possui áudio local disponível.');
    status('Ligando o projeto local ao backend…','warn');
    const remote=await auth.ensureRemoteProject(project);if(!remote?.ok||!remote.project?.id)throw Error('Não foi possível ligar este projeto ao backend.');
    const source=await uploadSource({token:session.accessToken,projectId:remote.project.id,track,asset});
    const job=await dispatchStems({token:session.accessToken,projectId:remote.project.id,sourceAssetId:source.assetId});
    const evidence={jobId:job.job_id,localProjectId:project.id,remoteProjectId:remote.project.id,sourceAssetId:source.assetId,sourceSha256:source.sha256,startedAt:new Date().toISOString(),dispatcher:DISPATCHER};
    localStorage.setItem('pablovoice.stems.canary.last',JSON.stringify(evidence));
    const completed=await waitForStandaloneStems({token:session.accessToken,jobId:job.job_id,onProgress:(current)=>status(`Separação ${Math.max(0,Number(current.progress||0))}% · ${current.status}`,'warn')});
    const consumed=await importStandaloneStems({token:session.accessToken,job:completed,project});
    const retained={...evidence,finishedAt:completed.finished_at||new Date().toISOString(),status:completed.status,provider:completed.provider||'kaggle',engine:completed.proof?.engine||completed.engine||'Demucs',model:completed.proof?.model||'htdemucs',externalJobId:completed.external_job_id||null,outputAssetIds:completed.output_asset_ids,proof:completed.proof,stems:consumed.imported};
    localStorage.setItem('pablovoice.stems.canary.last',JSON.stringify(retained));
    const associated=completed.output_asset_ids.every((id)=>project.tracks.some((item)=>item.renderJobId===completed.id&&item.remoteAssetId===id));
    if(!associated)throw Error('Os stems concluíram, mas não foram associados ao projeto local.');
    status(`Stems verificados e adicionados ao projeto · job ${String(job.job_id).slice(0,8)}…`,'ok');
  }catch(e){console.error('PabloVoice stems canary',e);status(e?.message||'Canário de stems falhou.','error')}
  finally{running=false;buttonDisabled(false)}
}

function status(text,kind=''){const el=document.querySelector('#pv-stems-canary-status');if(el){el.textContent=text;el.dataset.kind=kind}}
function buttonDisabled(value){const b=document.querySelector('#pv-stems-canary-run');if(b)b.disabled=value}
function ensureUi(){const studio=document.querySelector('.pv-studio-actions');if(!studio||document.querySelector('#pv-stems-canary'))return;const wrap=document.createElement('div');wrap.id='pv-stems-canary';wrap.className='pv-studio-actions';wrap.setAttribute('data-candidate','stems');wrap.innerHTML='<button id="pv-stems-canary-run" class="pv-btn" type="button">Separar voz + instrumental · candidate</button><span id="pv-stems-canary-status" class="pv-health">Demucs validado; rota standalone em canário.</span>';studio.insertAdjacentElement('afterend',wrap);document.querySelector('#pv-stems-canary-run')?.addEventListener('click',runCanary)}
new MutationObserver(ensureUi).observe(document.documentElement,{subtree:true,childList:true});ensureUi();
export const STANDALONE_STEMS_CANARY=Object.freeze({dispatcher:DISPATCHER,engine:'Demucs',model:'htdemucs',routeValidated:false});
