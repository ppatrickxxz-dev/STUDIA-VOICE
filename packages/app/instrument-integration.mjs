import { createId, createTrack, snapshotProject } from './core/src/project.mjs';
import { activeProjectSessionId, getProject, listProjects, saveAudioAsset, saveProject } from './storage.mjs';
import { InstrumentEngine, normalizeInstrumentState } from './instrument-engine.mjs';

const engine = new InstrumentEngine({ onChange: () => updateStatus(), onStatus: (message) => setStatus(message) });
let open = false;
let statusMessage = 'Toque no teclado para ouvir. Grave quando quiser transformar a ideia em faixa.';
let mounted = false;

export function installInstrumentLab() {
  if (mounted) return;
  mounted = true;
  ensureStylesheet();
  const observer = new MutationObserver(() => mountEntryPoint());
  observer.observe(document.documentElement, { subtree: true, childList: true });
  document.addEventListener('click', onClick);
  document.addEventListener('pointerdown', onKeyDown);
  document.addEventListener('pointerup', onKeyUp);
  document.addEventListener('pointercancel', onKeyUp);
  document.addEventListener('change', onChange);
  mountEntryPoint();
}

function ensureStylesheet() {
  if (document.querySelector('link[data-instrument-lab-style]')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = './instrument.css'; link.dataset.instrumentLabStyle = 'true';
  document.head.appendChild(link);
}

function mountEntryPoint() {
  const studioActions = document.querySelector('.pv-studio-actions');
  if (!studioActions || studioActions.querySelector('[data-instrument-open]')) return;
  const button = document.createElement('button');
  button.className = 'pv-btn'; button.dataset.instrumentOpen = 'true'; button.textContent = '♬ Instrumento';
  studioActions.insertBefore(button, studioActions.lastElementChild || null);
}

async function onClick(event) {
  const target = event.target.closest('button'); if (!target) return;
  if (target.dataset.instrumentOpen) { await show(); return; }
  if (target.dataset.instrumentClose) { hide(); return; }
  if (!open) return;
  if (target.dataset.instrumentRecord) { engine.toggleRecord(); renderModal(); return; }
  if (target.dataset.instrumentPlay) { engine.playSequence(); return; }
  if (target.dataset.instrumentClear) { engine.clear(); setStatus('Sequência limpa.'); renderModal(); return; }
  if (target.dataset.instrumentMidi) { await engine.connectMidi(); renderModal(); return; }
  if (target.dataset.instrumentSave) { await persistInstrumentState(); setStatus('Instrumento salvo no projeto.'); return; }
  if (target.dataset.instrumentRender) { await renderToProject(target); }
}

function onChange(event) {
  if (!open) return;
  if (event.target.matches('[data-instrument-preset]')) engine.setPreset(event.target.value);
  if (event.target.matches('[data-instrument-bpm]')) engine.setBpm(event.target.value);
  updateStatus();
}

function onKeyDown(event) {
  const key = event.target.closest('[data-instrument-key]'); if (!open || !key) return;
  event.preventDefault(); key.classList.add('active'); key.setPointerCapture?.(event.pointerId); engine.noteOn(Number(key.dataset.instrumentKey), 0.82);
}
function onKeyUp(event) {
  const key = event.target.closest('[data-instrument-key]'); if (!key) return;
  event.preventDefault(); key.classList.remove('active'); engine.noteOff(Number(key.dataset.instrumentKey));
}

async function show() {
  const project = await currentProject();
  if (!project) { setExternalToast('Crie ou abra um projeto antes de usar instrumentos.', 'error'); return; }
  engine.setState(project.instrumentLab || normalizeInstrumentState());
  open = true; renderModal();
}
function hide() { open = false; engine.stopAll(); document.querySelector('[data-instrument-modal]')?.remove(); }

function renderModal() {
  document.querySelector('[data-instrument-modal]')?.remove();
  if (!open) return;
  const state = engine.snapshot();
  const overlay = document.createElement('div'); overlay.className = 'pv-instrument-overlay'; overlay.dataset.instrumentModal = 'true';
  overlay.innerHTML = `<section class="pv-instrument-modal" role="dialog" aria-modal="true" aria-label="Instrument Lab">
    <header><div><small>INSTRUMENT LAB · LOCAL</small><h2>Transforme uma ideia em faixa</h2><p>Toque, grave as notas e mande o resultado direto para o Studio.</p></div><button class="pv-icon-btn" data-instrument-close aria-label="Fechar">×</button></header>
    <div class="pv-instrument-controls"><label>Som<select data-instrument-preset><option value="warm_keys" ${state.preset === 'warm_keys' ? 'selected' : ''}>Warm Keys</option><option value="soft_pad" ${state.preset === 'soft_pad' ? 'selected' : ''}>Soft Pad</option><option value="bass" ${state.preset === 'bass' ? 'selected' : ''}>Bass</option></select></label><label>BPM<input data-instrument-bpm type="number" min="40" max="240" value="${state.bpm}"></label></div>
    <div class="pv-instrument-keyboard" aria-label="Teclado musical">${keyboard()}</div>
    <div class="pv-instrument-actions"><button class="pv-btn ${engine.recording ? 'recording' : ''}" data-instrument-record>${engine.recording ? '■ Parar gravação' : '● Gravar notas'}</button><button class="pv-btn" data-instrument-play>▶ Ouvir</button><button class="pv-btn" data-instrument-midi>MIDI</button><button class="pv-btn" data-instrument-clear>Limpar</button></div>
    <div class="pv-instrument-status"><b>${state.notes.length} nota(s)</b><span data-instrument-status>${escapeHtml(statusMessage)}</span></div>
    <div class="pv-instrument-footer"><button class="pv-btn" data-instrument-save>Salvar ideia</button><button class="pv-btn primary" data-instrument-render ${state.notes.length ? '' : 'disabled'}>Criar faixa no Studio</button></div>
  </section>`;
  document.body.appendChild(overlay);
}

function keyboard() {
  const notes = [60,61,62,63,64,65,66,67,68,69,70,71,72];
  const names = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B','C'];
  return notes.map((midi, index) => `<button class="pv-instrument-key ${[1,3,6,8,10].includes(index) ? 'sharp' : ''}" data-instrument-key="${midi}" aria-label="${names[index]}"><span>${names[index]}</span></button>`).join('');
}

async function persistInstrumentState() {
  const project = await currentProject(); if (!project) throw new Error('Projeto não encontrado.');
  project.instrumentLab = engine.snapshot(); project.updatedAt = Date.now(); await saveProject(project);
}

async function renderToProject(button) {
  if (button.disabled) return;
  button.disabled = true; button.classList.add('busy');
  try {
    const project = await currentProject(); if (!project) throw new Error('Projeto não encontrado.');
    const rendered = engine.renderWav({ sampleRate: 48000, channels: 2 });
    const assetId = createId('asset');
    const labels = { warm_keys: 'Warm Keys', soft_pad: 'Soft Pad', bass: 'Bass' };
    const name = `Instrumento · ${labels[rendered.preset] || rendered.preset}`;
    await saveAudioAsset({ id: assetId, blob: rendered.blob, name: `${name}.wav`, type: 'audio/wav' });
    const track = createTrack({ name, assetId, type: 'audio/wav', duration: rendered.duration, sampleRate: rendered.sampleRate, channels: rendered.channels.length, kind: 'instrument' });
    track.trimEnd = rendered.duration; track.offset = 0;
    project.tracks.push(track); project.activeTrackId = track.id; project.instrumentLab = engine.snapshot();
    const saved = await saveProject(snapshotProject(project, 'Instrumento criado'));
    try { sessionStorage.setItem('pablovoice.activeProjectId', saved.id); } catch {}
    setStatus(`Faixa criada: ${name}. Reabrindo o Studio…`); setExternalToast('Instrumento criado como faixa real no projeto.', 'ok');
    setTimeout(() => location.reload(), 350);
  } catch (error) {
    console.error('INSTRUMENT_RENDER_FAILED', error); setStatus(error.message || 'Não foi possível criar a faixa.'); setExternalToast(error.message || 'Falha ao criar instrumento.', 'error');
    button.disabled = false; button.classList.remove('busy');
  }
}

async function currentProject() {
  const activeId = activeProjectSessionId();
  if (activeId) { const active = await getProject(activeId); if (active) return active; }
  return (await listProjects())[0] || null;
}

function updateStatus() {
  const status = document.querySelector('[data-instrument-status]'); if (status) status.textContent = statusMessage;
}
function setStatus(message) { statusMessage = String(message || ''); updateStatus(); }
function setExternalToast(message, kind = '') {
  const wrap = document.querySelector('[data-toasts]'); if (!wrap) return;
  const item = document.createElement('div'); item.className = `pv-toast ${kind}`; item.textContent = message; wrap.appendChild(item); setTimeout(() => item.remove(), 3000);
}
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[char]); }
