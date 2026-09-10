export const PABLOVOICE_SONG_DIRECTOR_SCHEMA='pablovoice_song_director_v2';

const PALETTES=Object.freeze([
  ['silk_pulse','syncopated pocket','extended R&B voicings','silky pads, rhythmic plucks, rounded synth bass','strip verses, widen choruses'],
  ['chrome_bounce','tight swung pocket','minor seventh color with suspended turns','glossy synths, dry drums, elastic bass','percussive pre-chorus, open hook'],
  ['midnight_glow','laid-back pocket with offbeat accents','warm modal color','dark pads, sparse keys, sub bass, short synth motif','intimate verse, luminous chorus'],
  ['y2k_motion','2000s R&B pocket with restrained funk motion','smooth diatonic extensions','digital keys, synth bass, filtered layers, crisp percussion','lean verse, rising pre, stacked chorus'],
  ['velvet_funk','soft funk syncopation without four-on-the-floor','seventh and ninth chord movement','muted synth stabs, warm bass, glassy lead accents','rhythmic verse, breathing pre, hook-forward chorus'],
].map(([id,groove,harmony,texture,contrast])=>Object.freeze({id,groove,harmony,texture,contrast})));
const ENERGY=Object.freeze({intro:.24,verse:.42,pre:.62,prechorus:.62,chorus:.88,post:.78,bridge:.52,breakdown:.34,outro:.30});

export function directSongCandidates(plan,{variation=.68,candidateCount=3,recentFingerprints=[],locks={},entropy=null}={}){
  validate(plan);const amount=clamp(Number(variation)||0,0,1),count=clamp(Math.round(Number(candidateCount)||3),2,5),base=seed(entropy??fresh()),recent=new Set((Array.isArray(recentFingerprints)?recentFingerprints:[]).map(String)),candidates=[];
  for(let index=0;index<count;index++){let salt=index,candidate;do{candidate=build(plan,{amount,seed:mix(base,salt+1,Number(plan.seed)||1),index,locks});salt+=count}while(recent.has(candidate.fingerprint)&&salt<count*12);candidates.push(candidate)}
  const ranked=candidates.map(candidate=>Object.freeze({...candidate,score:score(candidate,plan)})).sort((a,b)=>b.score.total-a.score.total||a.fingerprint.localeCompare(b.fingerprint));
  return Object.freeze({schema:PABLOVOICE_SONG_DIRECTOR_SCHEMA,variation:amount,locks:Object.freeze(lockset(locks)),selected:ranked[0],candidates:Object.freeze(ranked)});
}

export function applyDirectedCandidate(plan,candidate){
  validate(plan);if(!candidate||candidate.schema!==PABLOVOICE_SONG_DIRECTOR_SCHEMA)throw new TypeError('song_director_candidate_required');
  return Object.freeze({...plan,brief:`${String(plan.brief||'').trim()}\n\nPabloVoice 2.0 Song DNA: ${candidate.providerDirection}`.trim().slice(0,1200),seed:candidate.seed,pabloVoice2:Object.freeze({schema:PABLOVOICE_SONG_DIRECTOR_SCHEMA,fingerprint:candidate.fingerprint,palette:candidate.palette,variation:candidate.variation,energyCurve:candidate.energyCurve,directorScore:candidate.score||null})});
}
export function fingerprintSongDirection(value={}){return`pv2_${hash(stable(value)).toString(16).padStart(8,'0')}`}

function build(plan,{amount,seed,index,locks}){
  const kept=lockset(locks),palette=PALETTES[(seed+index)%PALETTES.length],energyCurve=curve(plan.sections,amount,seed),harmonicColor=kept.harmony?'preserve current harmony':palette.harmony,groove=kept.groove?'preserve current groove':palette.groove,texture=kept.instrumentation?'preserve current instrumentation':palette.texture,motif=kept.motif?'preserve established motif':motifFor(seed,amount),variationMode=amount<.34?'subtle':amount<.72?'balanced':'bold';
  const providerDirection=[`variation ${variationMode}`,`groove: ${groove}`,`harmony: ${harmonicColor}`,`arrangement: ${texture}`,`contrast: ${palette.contrast}`,`motif: ${motif}`,`energy: ${energyCurve.map(x=>`${x.section}:${x.energy.toFixed(2)}`).join(', ')}`,'make verse, pre-chorus, chorus and bridge audibly distinct while preserving song identity','avoid loop-like repetition; create transitions, fills and evolving density between sections'].join('; ');
  const fingerprint=fingerprintSongDirection({palette:palette.id,sectionEnergy:energyCurve,groove,harmonicColor,texture,motif,seed});
  return Object.freeze({schema:PABLOVOICE_SONG_DIRECTOR_SCHEMA,index,seed,variation:amount,variationMode,palette:palette.id,groove,harmonicColor,texture,motif,energyCurve:Object.freeze(energyCurve),providerDirection,fingerprint});
}
function curve(sections,variation,seed){return sections.map((section,index)=>{const id=sectionId(section.id||section.kind||section.label||'verse'),base=ENERGY[id]??.48,jitter=((seed>>>(index%16)&7)-3)/100*variation;let energy=clamp(base+jitter,.12,.96);if(id==='chorus')energy=Math.max(.78,energy);if(id==='bridge')energy=Math.min(.66,energy);return Object.freeze({section:id,energy:Number(energy.toFixed(3))})})}
function score(candidate,plan){const c=candidate.energyCurve||[],chorus=avg(c.filter(x=>x.section==='chorus').map(x=>x.energy),.8),verse=avg(c.filter(x=>x.section==='verse').map(x=>x.energy),.45),bridges=c.filter(x=>x.section==='bridge').map(x=>x.energy),bridge=avg(bridges,.52),contrast=clamp((chorus-verse)/.5,0,1),bridgeContrast=bridges.length?clamp(Math.abs(chorus-bridge)/.45,0,1):.7,promptCoverage=Math.min(1,String(plan.brief||'').trim().length/80+.35),evolution=candidate.providerDirection.includes('avoid loop-like repetition')?1:0,total=Number((contrast*32+bridgeContrast*18+promptCoverage*20+evolution*20+10).toFixed(2));return Object.freeze({total,sectionContrast:Number(contrast.toFixed(3)),bridgeContrast:Number(bridgeContrast.toFixed(3)),promptCoverage:Number(promptCoverage.toFixed(3)),evolution})}
function motifFor(seed,variation){const shapes=['three-note rising answer after the hook','short descending synth answer between vocal phrases','syncopated two-plus-one note signature','restrained call-and-response motif that returns only at payoffs'],shape=shapes[seed%shapes.length];return variation<.35?`subtle ${shape}`:shape}
function lockset(v={}){return{bpm:v.bpm===true,key:v.key===true,lyrics:v.lyrics===true,structure:v.structure===true,motif:v.motif===true,harmony:v.harmony===true,groove:v.groove===true,instrumentation:v.instrumentation===true}}
function validate(plan){if(!plan||typeof plan!=='object'||!Array.isArray(plan.sections)||!plan.sections.length)throw new TypeError('song_plan_required')}
function sectionId(value){const text=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,'');if(text.includes('pre'))return'pre';if(text.includes('chorus')||text.includes('refrao'))return'chorus';if(text.includes('verse')||text.includes('verso'))return'verse';if(text.includes('bridge')||text.includes('ponte'))return'bridge';if(text.includes('post'))return'post';if(text.includes('break'))return'breakdown';if(text.includes('intro'))return'intro';if(text.includes('outro'))return'outro';return text||'verse'}
function fresh(){const v=new Uint32Array(1);globalThis.crypto?.getRandomValues?.(v);return Number(v[0]||Date.now())>>>0}
function seed(v){const n=Number(v);return(Number.isFinite(n)?Math.abs(Math.floor(n)):hash(String(v)))>>>0||1}
function mix(a,b,c){let v=(a^Math.imul(b,0x9e3779b1)^Math.imul(c,0x85ebca6b))>>>0;v^=v>>>16;v=Math.imul(v,0x7feb352d);v^=v>>>15;v=Math.imul(v,0x846ca68b);v^=v>>>16;return(v>>>0)&0x7fffffff||1}
function avg(v,fallback){return v.length?v.reduce((sum,x)=>sum+x,0)/v.length:fallback}
function stable(v){if(Array.isArray(v))return`[${v.map(stable).join(',')}]`;if(v&&typeof v==='object')return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;return JSON.stringify(v)}
function hash(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
