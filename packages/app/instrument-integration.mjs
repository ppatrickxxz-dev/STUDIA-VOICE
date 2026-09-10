import { createId, createTrack, snapshotProject } from './core/src/project.mjs';
import { activeProjectSessionId, getProject, listProjects, saveAudioAsset, saveProject } from './storage.mjs';
import { InstrumentEngine, listInstrumentPresets, normalizeInstrumentState } from './instrument-engine.mjs';

const engine = new InstrumentEngine({ onChange: () => updateStatus(), onStatus: (message) => setStatus(message) });
const ui = { project: null, role: 'chords', scope: 'full', operation: 'add', replacementId: '' };
let open = false;
let statusMessage = 'Toque no teclado para ouvir. Grave quando quiser transformar a ideia em faixa.';
let mounted = false;

const ROLE_LABELS = Object.freeze({
  chords: 'Acordes',
  bass: 'Baixo',
  melody: 'Melodia',
  countermelody: 'Contramelodia',
  texture: 'Textura',
});

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
  document.addEventListener('input', onInput);
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
  if (target.dataset.instrumentClear) { engine.clear(); setStatus('Sequência limpa. O instrumento continua configurado.'); renderModal(); return; }
  if (target.dataset.instrumentMidi) { await engine.connectMidi(); renderModal(); return; }
  if (target.dataset.instrumentSave) { await persistInstrumentState(); setStatus('Ideia e direção instrumental salvas no projeto.'); return; }
  if (target.dataset.instrumentRender) { await renderToProject(target); }
}

function onChange(event) {
  if (!open) return;
  const target = event.target;
  if (target.matches('[data-instrument-preset]')) engine.setPreset(target.value);
  else if (target.matches('[data-instrument-bpm]')) engine.setBpm(target.value);
  else if (target.matches('[data-instrument-octave]')) engine.setOctave(target.value);
  else if (target.matches('[data-instrument-quantize]')) engine.setQuantize(target.value);
  else if (target.matches('[data-instrument-role]')) { ui.role = target.value in ROLE_LABELS ? target.value : 'chords'; setStatus(`Função musical: ${ROLE_LABELS[ui.role]}.`); }
  else if (target.matches('[data-instrument-scope]')) {
    ui.scope = target.value || 'full';
    if (ui.scope !== 'full' && ui.operation === 'replace') {
      ui.operation = 'add';
      setStatus('Em uma seção, o PabloVoice adiciona uma camada sem silenciar o instrumento do restante da música.');
    }
    renderModal();
    return;
  }
  else if (target.matches('[data-instrument-operation]')) {
    ui.operation = target.value === 'replace' && ui.scope === 'full' && replacementTracks().length ? 'replace' : 'add';
    renderModal();
    return;
  }
  else if (target.matches('[data-instrument-replace]')) ui.replacementId = target.value || '';
  updateStatus();
}

function onInput(event) {
  if (!open) return;
  if (event.target.matches('[data-instrument-swing]')) {
    engine.setSwing(Number(event.target.value) / 100);
    const output = document.querySelector('[data-instrument-swing-output]');
    if (output) output.textContent = `${Math.round(engine.snapshot().swing * 100)}%`;
  }
}

function onKeyDown(event) {
  const key = event.target.closest('[data-instrument-key]'); if (!open || !key) return;
  event.preventDefault(); key.classList.add('active'); key.setPointerCapture?.(event.pointerId); engine.noteOn(Number(key.dataset.instrumentKey), .82);
}
function onKeyUp(event) {
  const key = event.target.closest('[data-instrument-key]'); if (!key) return;
  event.preventDefault(); key.classList.remove('active'); engine.noteOff(Number(key.dataset.instrumentKey));
}

async function show() {
  const project = await currentProject();
  if (!project) { setExternalToast('Crie ou abra um projeto antes de usar instrumentos.', 'error'); return; }
  ui.project = project;
  const latest = latestSongTake(project);
  const saved = project.instrumentLab || normalizeInstrumentState({ bpm: latest?.bpm || 120 });
  engine.setState({ ...saved, bpm: saved.bpm || latest?.bpm || 120 });
  ui.role = saved.role in ROLE_LABELS ? saved.role : 'chords';
  ui.scope = saved.scope && availableScopes(project).some((item) => item.id === saved.scope) ? saved.scope : 'full';
  ui.operation = 'add';
  ui.replacementId = '';
  open = true;
  statusMessage = 'Escolha o papel do instrumento, toque ou grave as notas e crie uma faixa real no projeto.';
  renderModal();
}
function hide() { open = false; engine.stopAll(); ui.project = null; document.querySelector('[data-instrument-modal]')?.remove(); }

function renderModal() {
  document.querySelector('[data-instrument-modal]')?.remove();
  if (!open) return;
  const state = engine.snapshot();
  const scopes = availableScopes(ui.project);
  const replacements = replacementTracks();
  if (!scopes.some((item) => item.id === ui.scope)) ui.scope = 'full';
  if (ui.scope !== 'full' && ui.operation === 'replace') ui.operation = 'add';
  if (ui.operation === 'replace' && !replacements.some((track) => track.id === ui.replacementId)) ui.replacementId = replacements[0]?.id || '';
  const overlay = document.createElement('div'); overlay.className = 'pv-instrument-overlay'; overlay.dataset.instrumentModal = 'true';
  overlay.innerHTML = `<section class="pv-instrument-modal" role="dialog" aria-modal="true" aria-label="Instrument Lab">
    <header><div><small>INSTRUMENT LAB · MUSIC GRAPH</small><h2>Crie uma camada musical</h2><p>Som, função e seção ficam ligados ao mesmo projeto. Nada é apagado ao criar um novo take.</p></div><button class="pv-icon-btn" data-instrument-close aria-label="Fechar">×</button></header>

    <div class="pv-instrument-direction">
      <label>Função musical<select data-instrument-role>${roleOptions(ui.role)}</select></label>
      <label>Onde entra<select data-instrument-scope>${scopeOptions(scopes, ui.scope)}</select></label>
      <label>Som<select data-instrument-preset>${presetOptions(state.preset)}</select></label>
    </div>

    <details class="pv-instrument-performance">
      <summary>Performance e groove <span>${state.bpm} BPM · ${state.quantize === 'off' ? 'livre' : state.quantize} · swing ${Math.round(state.swing * 100)}%</span></summary>
      <div class="pv-instrument-controls">
        <label>BPM<input data-instrument-bpm type="number" min="40" max="240" value="${state.bpm}" inputmode="numeric"></label>
        <label>Oitava<select data-instrument-octave>${[-2,-1,0,1,2].map((value) => `<option value="${value}" ${state.octave === value ? 'selected' : ''}>${value > 0 ? '+' : ''}${value}</option>`).join('')}</select></label>
        <label>Quantizar<select data-instrument-quantize>${quantizeOptions(state.quantize)}</select></label>
        <label class="pv-instrument-swing">Swing <output data-instrument-swing-output>${Math.round(state.swing * 100)}%</output><input data-instrument-swing type="range" min="0" max="45" step="1" value="${Math.round(state.swing * 100)}"></label>
      </div>
    </details>

    <div class="pv-instrument-keyboard-wrap"><div class="pv-instrument-keyboard" aria-label="Teclado musical">${keyboard()}</div></div>
    <div class="pv-instrument-actions"><button class="pv-btn ${engine.recording ? 'recording' : ''}" data-instrument-record>${engine.recording ? '■ Parar gravação' : '● Gravar notas'}</button><button class="pv-btn" data-instrument-play>▶ Ouvir</button><button class="pv-btn" data-instrument-midi>MIDI</button><button class="pv-btn ghost" data-instrument-clear>Limpar</button></div>

    <div class="pv-instrument-status"><div><b>${state.notes.length} nota(s)</b><span>${ROLE_LABELS[ui.role]} · ${scopeLabel(scopes, ui.scope)}</span></div><p data-instrument-status>${escapeHtml(statusMessage)}</p></div>

    <div class="pv-instrument-commit">
      <label>Ao criar a faixa<select data-instrument-operation><option value="add" ${ui.operation === 'add' ? 'selected' : ''}>Adicionar nova camada</option>${ui.scope === 'full' && replacements.length ? `<option value="replace" ${ui.operation === 'replace' ? 'selected' : ''}>Substituir instrumento sem apagar o anterior</option>` : ''}</select></label>
      ${ui.operation === 'replace' ? `<label>Instrumento anterior<select data-instrument-replace>${replacements.map((track) => `<option value="${escapeHtml(track.id)}" ${track.id === ui.replacementId ? 'selected' : ''}>${escapeHtml(track.name)}</option>`).join('')}</select></label>` : '<p>Um novo take entra como faixa separada. Você pode comparar, mutar ou voltar depois.</p>'}
    </div>

    <div class="pv-instrument-footer"><button class="pv-btn" data-instrument-save>Salvar ideia</button><button class="pv-btn primary" data-instrument-render ${state.notes.length ? '' : 'disabled'}>Criar faixa</button></div>
  </section>`;
  document.body.appendChild(overlay);
}

function presetOptions(selected) {
  const groups = new Map();
  for (const item of listInstrumentPresets()) {
    if (!groups.has(item.family)) groups.set(item.family, []);
    groups.get(item.family).push(item);
  }
  return [...groups.entries()].map(([family, items]) => `<optgroup label="${escapeHtml(family)}">${items.map((item) => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</optgroup>`).join('');
}

function roleOptions(selected) {
  return Object.entries(ROLE_LABELS).map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function quantizeOptions(selected) {
  const values = [['off','Livre'],['1/4','1/4'],['1/8','1/8'],['1/16','1/16']];
  return values.map(([value,label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function scopeOptions(scopes, selected) {
  return scopes.map((scope) => `<option value="${escapeHtml(scope.id)}" ${scope.id === selected ? 'selected' : ''}>${escapeHtml(scope.label)}</option>`).join('');
}

function keyboard() {
  const black = new Set([1,3,6,8,10]);
  const names = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  const notes = Array.from({ length: 25 }, (_, index) => 48 + index);
  return notes.map((midi) => {
    const semitone = midi % 12; const octave = Math.floor(midi / 12) - 1;
    return `<button class="pv-instrument-key ${black.has(semitone) ? 'sharp' : ''}" data-instrument-key="${midi}" aria-label="${names[semitone]}${octave}"><span>${names[semitone]}${black.has(semitone) ? '' : octave}</span></button>`;
  }).join('');
}

async function persistInstrumentState() {
  const project = await currentProject(); if (!project) throw new Error('Projeto não encontrado.');
  project.instrumentLab = { ...engine.snapshot(), role: ui.role, scope: ui.scope, savedAt: Date.now() };
  project.updatedAt = Date.now();
  ui.project = await saveProject(project);
}

async function renderToProject(button) {
  if (button.disabled) return;
  button.disabled = true; button.classList.add('busy');
  try {
    const project = await currentProject(); if (!project) throw new Error('Projeto não encontrado.');
    const rendered = engine.renderWav({ sampleRate: 48000, channels: 2 });
    const state = engine.snapshot();
    const preset = listInstrumentPresets().find((item) => item.id === rendered.preset);
    const scopes = availableScopes(project);
    const section = scopes.find((item) => item.id === ui.scope && item.id !== 'full') || null;
    const assetId = createId('asset');
    const roleLabel = ROLE_LABELS[ui.role] || 'Instrumento';
    const scopeSuffix = section ? ` · ${section.label}` : '';
    const name = `${roleLabel} · ${preset?.label || rendered.preset}${scopeSuffix}`;
    await saveAudioAsset({ id: assetId, blob: rendered.blob, name: `${name}.wav`, type: 'audio/wav' });
    const track = createTrack({ name, assetId, type: 'audio/wav', duration: rendered.duration, sampleRate: rendered.sampleRate, channels: rendered.channels.length, kind: 'instrument' });
    track.offset = section?.startSeconds || 0;
    track.trimEnd = section?.endSeconds > section?.startSeconds ? Math.min(rendered.duration, section.endSeconds - section.startSeconds) : rendered.duration;
    track.role = ui.role;
    track.source = 'instrument-lab';
    track.engine = 'pablovoice-local-synth-v2';
    track.instrumentPreset = rendered.preset;
    track.instrumentScope = section?.id || 'full';
    track.instrumentLab = {
      schema: 'pablovoice_instrument_track_v2', role: ui.role, scope: section?.id || 'full', preset: rendered.preset,
      bpm: state.bpm, octave: state.octave, quantize: state.quantize, swing: state.swing, noteCount: state.notes.length,
      operation: ui.operation, createdAt: Date.now(),
    };

    let replaced = null;
    if (ui.operation === 'replace' && !section) {
      replaced = project.tracks.find((candidate) => candidate.id === ui.replacementId && candidate.kind === 'instrument') || null;
      if (replaced) {
        replaced.muted = true;
        replaced.replacedByTrackId = track.id;
        track.replacesTrackId = replaced.id;
        track.instrumentLab.replacesTrackId = replaced.id;
      }
    }

    project.tracks.push(track); project.activeTrackId = track.id;
    project.instrumentLab = { ...state, role: ui.role, scope: section?.id || 'full', lastTrackId: track.id, savedAt: Date.now() };
    const label = replaced ? `Instrumento substituído · ${replaced.name} → ${name}` : section ? `Instrumento criado · ${section.label}` : 'Instrumento criado';
    const saved = await saveProject(snapshotProject(project, label));
    try { sessionStorage.setItem('pablovoice.activeProjectId', saved.id); } catch {}
    setStatus(replaced ? `Nova faixa criada. “${replaced.name}” foi apenas mutada e continua preservada para A/B.` : `Faixa criada: ${name}.`);
    setExternalToast(replaced ? 'Novo instrumento criado; versão anterior preservada.' : 'Instrumento criado como faixa real no projeto.', 'ok');
    setTimeout(() => location.reload(), 350);
  } catch (error) {
    console.error('INSTRUMENT_RENDER_FAILED', error); setStatus(error.message || 'Não foi possível criar a faixa.'); setExternalToast(error.message || 'Falha ao criar instrumento.', 'error');
    button.disabled = false; button.classList.remove('busy');
  }
}

function availableScopes(project) {
  const scopes = [{ id: 'full', label: 'Música inteira', startSeconds: 0, endSeconds: null }];
  const seen = new Set(['full']);
  const arrangement = Array.isArray(project?.arrangementMap?.sections) ? project.arrangementMap.sections : [];
  const latest = latestSongTake(project);
  const generated = Array.isArray(latest?.sections) ? latest.sections : [];
  for (const item of [...arrangement, ...generated]) {
    const id = String(item?.id || '').trim();
    const startSeconds = finite(item?.startSeconds ?? item?.start_seconds ?? item?.start);
    const endSeconds = finite(item?.endSeconds ?? item?.end_seconds ?? item?.end);
    if (!id || seen.has(id) || startSeconds == null || startSeconds < 0) continue;
    seen.add(id);
    scopes.push({ id, label: String(item?.label || item?.kind || id), startSeconds, endSeconds });
  }
  return scopes;
}

function latestSongTake(project) {
  const takes = Array.isArray(project?.songCreation?.takes) ? project.songCreation.takes : [];
  const id = project?.songCreation?.latestTakeId;
  return takes.find((take) => take.id === id) || takes.at(-1) || null;
}

function replacementTracks() {
  return (ui.project?.tracks || []).filter((track) => track?.kind === 'instrument' && !track.muted);
}

function scopeLabel(scopes, id) { return scopes.find((item) => item.id === id)?.label || 'Música inteira'; }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }

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
