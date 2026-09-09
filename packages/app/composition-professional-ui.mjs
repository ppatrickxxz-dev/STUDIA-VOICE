let guarded=false;

function installGuard(){
  if(guarded)return;
  const app=document.querySelector('#app');
  const d=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
  if(!app||!d?.get||!d?.set)return;
  Object.defineProperty(app,'innerHTML',{configurable:true,get(){return d.get.call(app)},set(value){
    if(document.activeElement?.id==='lyrics')return value;
    d.set.call(app,value);return value;
  }});
  guarded=true;
}

function decorate(){
  installGuard();
  const lyrics=document.querySelector('#lyrics');
  if(!lyrics)return;
  lyrics.autocapitalize='sentences';lyrics.autocomplete='off';lyrics.spellcheck=true;lyrics.enterKeyHint='enter';
  lyrics.closest('main')?.classList.add('pv-compose-pro');
  const card=lyrics.closest('.pv-card');
  card?.classList.add('pv-lyrics-workspace');
  if(card&&!card.querySelector('.pv-lyrics-tools')){
    const tools=document.createElement('div');tools.className='pv-lyrics-tools';
    tools.innerHTML='<span>Escrita · salvamento automático</span><div><button type="button" data-pv-section="[Verso]">Verso</button><button type="button" data-pv-section="[Pré-refrão]">Pré</button><button type="button" data-pv-section="[Refrão]">Refrão</button><button type="button" data-pv-section="[Ponte]">Ponte</button></div>';
    lyrics.before(tools);
  }
  const ai=document.querySelector('#pv-ai-composer');
  if(ai&&!ai.dataset.pro){
    ai.dataset.pro='1';ai.classList.add('pv-ai-pro','is-collapsed');
    const head=ai.querySelector('.pv-card-head');
    const button=document.createElement('button');button.type='button';button.className='pv-ai-toggle';button.textContent='Abrir IA';button.dataset.pvAiToggle='1';
    head?.append(button);
  }
  document.querySelector('#pv-song-creator')?.classList.add('pv-song-creator-pro');
}

function click(event){
  const section=event.target.closest('[data-pv-section]');
  if(section){
    const lyrics=document.querySelector('#lyrics');if(!lyrics)return;
    const start=lyrics.selectionStart??lyrics.value.length,end=lyrics.selectionEnd??start;
    const before=lyrics.value.slice(0,start),prefix=!before?'':before.endsWith('\n\n')?'':before.endsWith('\n')?'\n':'\n\n';
    const text=`${prefix}${section.dataset.pvSection}\n`;
    lyrics.setRangeText(text,start,end,'end');lyrics.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));lyrics.focus({preventScroll:true});return;
  }
  const toggle=event.target.closest('[data-pv-ai-toggle]');
  if(toggle){const ai=toggle.closest('#pv-ai-composer');const open=ai?.classList.toggle('is-collapsed')===false;toggle.textContent=open?'Fechar':'Abrir IA';toggle.setAttribute('aria-expanded',String(open));}
}

function viewport(){
  const v=visualViewport;if(!v)return;
  const inset=Math.max(0,innerHeight-v.height-v.offsetTop);document.documentElement.style.setProperty('--pv-keyboard-inset',`${Math.round(inset)}px`);document.documentElement.classList.toggle('pv-keyboard-open',inset>120);
}

new MutationObserver(decorate).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('click',click,true);visualViewport?.addEventListener('resize',viewport);visualViewport?.addEventListener('scroll',viewport);decorate();viewport();
