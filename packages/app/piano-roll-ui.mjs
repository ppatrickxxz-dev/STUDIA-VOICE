import { activeProjectSessionId, getProject, listProjects, saveProject } from './storage.mjs';
import { normalizeInstrumentState } from './instrument-engine.mjs';
import { deleteNote, noteRange, normalizeGrid, quantizeNotes, transposeNotes, updateNote } from './piano-roll.mjs';

let mounted = false;
let open = false;
let selected = 0;
let grid = 0.25;
let project = null;

export function installPianoRoll() {
  if (mounted) return;
  mounted = true;
  ensureStyle();
  const observer = new MutationObserver(mountEntryPoint);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  mountEntryPoint();
}

function ensureStyle() {
  if (document.querySelector('link[data-piano-roll-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = './piano-roll.css'; link.dataset.pianoRollStyle = 'true';
  document.head.appendChild(link);
}

function mountEntryPoint() {
  const actions = document.querySelector('.pv-studio-actions');
  if (!actions || actions.querySelector('[data-piano-roll-open]')) return;
  const button = document.createElement('button');
  button.className = 'pv-btn'; button.dataset.pianoRollOpen = 'true'; button.textContent = '▦ Piano Roll';
  actions.insertBefore(button, actions.lastElementChild || null);
}

async function currentProject() {
  const id = activeProjectSessionId();
  if (id) { const value = await getProject(id); if (value) return value; }
  return (await listProjects())[0] || null;
}

async function show() {
  project = await currentProject();
  if (!project) return toast('Crie ou abra um projeto antes de editar notas.', 'error');
  project.instrumentLab = normalizeInstrumentState(project.instrumentLab || {});
  selected = Math.min(selected, Math.max(0, project.instrumentLab.notes.length - 1));
  open = true; render();
}

function hide() { open = false; document.querySelector('[data-piano-roll-modal]')?.remove(); }

function render() {
  document.querySelector('[data-piano-roll-modal]')?.remove();
  if (!open || !project) return;
  const notes = project.instrumentLab.notes;
  const range = noteRange(notes);
  const rows = Math.max(1, range.maxMidi - range.minMidi + 1);
  const columns = Math.ceil(range.endBeat / grid);
  const overlay = document.createElement('div');
  overlay.className = 'pv-piano-overlay'; overlay.dataset.pianoRollModal = 'true';
  overlay.innerHTML = `<section class="pv-piano-modal" role="dialog" aria-modal="true" aria-label="Piano Roll">
    <header><div><small>PIANO ROLL · MESMA SEQUÊNCIA DO INSTRUMENT LAB</small><h2>Edite as notas da sua ideia</h2><p>Mova, afine, ajuste duração e intensidade sem criar uma cópia separada.</p></div><button class="pv-icon-btn" data-piano-close aria-label="Fechar">×</button></header>
    <div class="pv-piano-toolbar"><label>Grade<select data-piano-grid><option value="0.125" ${grid===0.125?'selected':''}>1/32</option><option value="0.25" ${grid===0.25?'selected':''}>1/16</option><option value="0.5" ${grid===0.5?'selected':''}>1/8</option><option value="1" ${grid===1?'selected':''}>1/4</option></select></label><button class="pv-btn" data-piano-quantize>Quantizar</button><button class="pv-btn" data-piano-transpose="-1">−1 semitom</button><button class="pv-btn" data-piano-transpose="1">+1 semitom</button></div>
    <div class="pv-piano-scroll"><div class="pv-piano-grid" style="--rows:${rows};--cols:${columns};--row-h:26px;--col-w:38px;min-width:${Math.max(420, columns*38)}px;height:${rows*26}px">${notes.map((note,index)=>noteMarkup(note,index,range)).join('')}</div></div>
    ${notes.length ? editorMarkup(notes[selected], selected) : '<div class="pv-piano-empty">Ainda não há notas. Grave no Instrument Lab e volte aqui.</div>'}
    <footer><span>${notes.length} nota(s) · ${project.instrumentLab.bpm} BPM</span><div><button class="pv-btn" data-piano-close>Cancelar</button><button class="pv-btn primary" data-piano-save>Salvar no projeto</button></div></footer>
  </section>`;
  document.body.appendChild(overlay);
}

function noteMarkup(note,index,range) {
  const row = range.maxMidi - note.midi;
  const left = (note.start_beat / grid) * 38;
  const width = Math.max(12, (note.duration_beats / grid) * 38 - 2);
  const top = row * 26 + 2;
  return `<button class="pv-piano-note ${index===selected?'selected':''}" data-piano-note="${index}" style="left:${left}px;top:${top}px;width:${width}px;height:22px" title="MIDI ${note.midi}">${midiName(note.midi)}</button>`;
}

function editorMarkup(note,index) {
  if (!note) return '';
  return `<div class="pv-piano-editor"><b>${midiName(note.midi)}</b><label>Nota<input type="number" min="0" max="127" value="${note.midi}" data-piano-field="midi" data-index="${index}"></label><label>Início<input type="number" min="0" step="0.125" value="${round(note.start_beat)}" data-piano-field="start_beat" data-index="${index}"></label><label>Duração<input type="number" min="0.05" step="0.125" value="${round(note.duration_beats)}" data-piano-field="duration_beats" data-index="${index}"></label><label>Força<input type="range" min="1" max="127" value="${note.velocity}" data-piano-field="velocity" data-index="${index}"><span>${note.velocity}</span></label><button class="pv-btn" data-piano-delete="${index}">Excluir nota</button></div>`;
}

async function persist() {
  if (!project) return;
  project.updatedAt = Date.now();
  await saveProject(project);
  toast('Piano Roll salvo. O Instrument Lab já usa essas notas.', 'ok');
  hide();
}

function onClick(event) {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.pianoRollOpen) return void show();
  if (!open) return;
  if (button.dataset.pianoClose !== undefined) return hide();
  if (button.dataset.pianoNote !== undefined) { selected = Number(button.dataset.pianoNote); return render(); }
  if (button.dataset.pianoQuantize !== undefined) { project.instrumentLab.notes = quantizeNotes(project.instrumentLab.notes, grid); return render(); }
  if (button.dataset.pianoTranspose !== undefined) { project.instrumentLab.notes = transposeNotes(project.instrumentLab.notes, Number(button.dataset.pianoTranspose)); return render(); }
  if (button.dataset.pianoDelete !== undefined) { project.instrumentLab.notes = deleteNote(project.instrumentLab.notes, Number(button.dataset.pianoDelete)); selected = Math.max(0, Math.min(selected, project.instrumentLab.notes.length - 1)); return render(); }
  if (button.dataset.pianoSave !== undefined) return void persist();
}

function onChange(event) {
  if (!open) return;
  if (event.target.matches('[data-piano-grid]')) { grid = normalizeGrid(event.target.value); render(); }
}

function onInput(event) {
  if (!open || !event.target.matches('[data-piano-field]')) return;
  const index = Number(event.target.dataset.index); const field = event.target.dataset.pianoField;
  project.instrumentLab.notes = updateNote(project.instrumentLab.notes, index, { [field]: Number(event.target.value) });
  const valueLabel = event.target.parentElement?.querySelector('span'); if (valueLabel) valueLabel.textContent = event.target.value;
  if (field !== 'velocity') render();
}

function midiName(midi) { const names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B']; const n=Math.round(Number(midi)||60); return `${names[(n%12+12)%12]}${Math.floor(n/12)-1}`; }
function round(value) { return Math.round(Number(value)*1000)/1000; }
function toast(message,kind='') { const wrap=document.querySelector('[data-toasts]'); if(!wrap)return; const item=document.createElement('div'); item.className=`pv-toast ${kind}`; item.textContent=message; wrap.appendChild(item); setTimeout(()=>item.remove(),3000); }
