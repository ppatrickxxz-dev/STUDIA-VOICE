const PRESETS = Object.freeze({
  warm_keys: preset('Warm Keys', 'Keys', [layer('triangle', 1, .7), layer('sine', 1.003, .45)], { attack: .016, decay: .14, sustain: .78, release: .22, gain: .22, filterHz: 7200 }),
  velvet_ep: preset('Velvet EP', 'Keys', [layer('sine', 1, .8), layer('triangle', 2.002, .22), layer('sine', .5, .15)], { attack: .012, decay: .34, sustain: .58, release: .34, gain: .24, filterHz: 6400 }),
  glass_pluck: preset('Glass Pluck', 'Pluck', [layer('triangle', 1, .72), layer('sine', 2.006, .38)], { attack: .004, decay: .19, sustain: .28, release: .2, gain: .24, filterHz: 9800 }),
  soft_pad: preset('Soft Pad', 'Pads', [layer('sine', 1, .72), layer('triangle', 1.003, .48), layer('sine', .5, .16)], { attack: .18, decay: .42, sustain: .84, release: .9, gain: .19, filterHz: 5600 }),
  analog_pad: preset('Analog Pad', 'Pads', [layer('sawtooth', 1, .42, -7), layer('sawtooth', 1, .42, 7), layer('sine', .5, .22)], { attack: .12, decay: .32, sustain: .74, release: .75, gain: .17, filterHz: 3400 }),
  synth_bass: preset('Round Synth Bass', 'Bass', [layer('sawtooth', 1, .38), layer('sine', .5, .82)], { attack: .008, decay: .12, sustain: .82, release: .16, gain: .24, filterHz: 2100 }),
  sub_bass: preset('Sub Bass', 'Bass', [layer('sine', .5, 1), layer('triangle', 1, .18)], { attack: .018, decay: .12, sustain: .92, release: .2, gain: .27, filterHz: 1200 }),
  synth_lead: preset('Silk Synth Lead', 'Lead', [layer('sawtooth', 1, .43, -5), layer('triangle', 1, .58, 5)], { attack: .012, decay: .2, sustain: .7, release: .25, gain: .2, filterHz: 5200 }),
});

const PRESET_ALIASES = Object.freeze({ bass: 'synth_bass' });
const QUANTIZE_VALUES = new Set(['off', '1/4', '1/8', '1/16']);

function layer(type, ratio = 1, gain = 1, detune = 0) { return Object.freeze({ type, ratio, gain, detune }); }
function preset(label, family, layers, envelope) { return Object.freeze({ label, family, layers: Object.freeze(layers), ...envelope }); }

export function listInstrumentPresets() {
  return Object.freeze(Object.entries(PRESETS).map(([id, value]) => Object.freeze({ id, label: value.label, family: value.family })));
}

export function midiToHz(midi) {
  return 440 * Math.pow(2, (Number(midi) - 69) / 12);
}

export function normalizeInstrumentState(value = {}) {
  const presetId = PRESET_ALIASES[value.preset] || value.preset;
  return {
    version: '2.0-local',
    preset: PRESETS[presetId] ? presetId : 'warm_keys',
    bpm: clamp(Math.round(Number(value.bpm) || 120), 40, 240),
    octave: clamp(Math.round(Number(value.octave) || 0), -2, 2),
    quantize: QUANTIZE_VALUES.has(String(value.quantize)) ? String(value.quantize) : '1/8',
    swing: clamp(Number(value.swing) || 0, 0, .45),
    notes: Array.isArray(value.notes) ? value.notes.slice(0, 4096).map(cleanNote).filter(Boolean) : [],
  };
}

export function applyInstrumentTiming(value = {}) {
  const state = normalizeInstrumentState(value);
  const step = quantizeStep(state.quantize);
  return state.notes.map((note) => {
    let start = note.start_beat;
    let duration = note.duration_beats;
    if (step) {
      start = Math.round(start / step) * step;
      duration = Math.max(step, Math.round(duration / step) * step || step);
    }
    if (state.swing > 0) {
      const eighthIndex = Math.round(start * 2);
      if (eighthIndex % 2 === 1) start += state.swing * .5;
    }
    return { ...note, start_beat: Math.max(0, start), duration_beats: Math.max(.05, duration) };
  });
}

export function renderInstrumentPcm(value, { sampleRate = 48000, channels = 2 } = {}) {
  const state = normalizeInstrumentState(value);
  const notes = applyInstrumentTiming(state);
  if (!notes.length) throw new Error('Grave algumas notas antes de renderizar.');
  sampleRate = clamp(Math.round(Number(sampleRate) || 48000), 22050, 48000);
  channels = clamp(Math.round(Number(channels) || 2), 1, 2);
  const sound = PRESETS[state.preset];
  const secondsPerBeat = 60 / state.bpm;
  const endBeat = Math.max(...notes.map((note) => note.start_beat + note.duration_beats));
  const duration = Math.max(.25, endBeat * secondsPerBeat + sound.release + .08);
  if (duration > 240) throw new Error('A sequência ultrapassa 4 minutos; divida o arranjo antes de renderizar.');
  const frameCount = Math.ceil(duration * sampleRate);
  const mono = new Float32Array(frameCount);
  for (const note of notes) synthNote(mono, note, state.bpm, sampleRate, sound);
  applyOnePoleLowPass(mono, sampleRate, sound.filterHz);
  let peak = 0;
  for (let index = 0; index < mono.length; index += 1) {
    mono[index] = softClip(mono[index]);
    peak = Math.max(peak, Math.abs(mono[index]));
  }
  const scale = peak > .94 ? .94 / peak : 1;
  const output = Array.from({ length: channels }, () => new Float32Array(frameCount));
  for (let index = 0; index < frameCount; index += 1) {
    const sample = mono[index] * scale;
    for (let channel = 0; channel < channels; channel += 1) output[channel][index] = sample;
  }
  return { channels: output, sampleRate, duration, frameCount, preset: state.preset, bpm: state.bpm, quantize: state.quantize, swing: state.swing };
}

export function encodePcmWav(rendered) {
  const channels = rendered.channels.length;
  const sampleRate = rendered.sampleRate;
  const length = rendered.frameCount;
  const blockAlign = channels * 2;
  const dataBytes = length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeText(view, 0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); writeText(view, 8, 'WAVE');
  writeText(view, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true); writeText(view, 36, 'data'); view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let index = 0; index < length; index += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = clamp(rendered.channels[channel][index], -1, 1);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export class InstrumentEngine {
  constructor({ onChange = () => {}, onStatus = () => {} } = {}) {
    this.onChange = onChange;
    this.onStatus = onStatus;
    this.state = normalizeInstrumentState();
    this.context = null;
    this.master = null;
    this.active = new Map();
    this.recording = false;
    this.recordStartedAt = 0;
    this.midiAccess = null;
  }
  setState(value) { this.stopAll(); this.state = normalizeInstrumentState(value); this.emit(); return this.snapshot(); }
  snapshot() { return structuredClone(this.state); }
  setPreset(value) { const id = PRESET_ALIASES[value] || value; if (PRESETS[id]) { this.state.preset = id; this.emit(); } }
  setBpm(value) { this.state.bpm = clamp(Math.round(Number(value) || 120), 40, 240); this.emit(); }
  setOctave(value) { this.stopAll(); this.state.octave = clamp(Math.round(Number(value) || 0), -2, 2); this.emit(); }
  setQuantize(value) { this.state.quantize = QUANTIZE_VALUES.has(String(value)) ? String(value) : 'off'; this.emit(); }
  setSwing(value) { this.state.swing = clamp(Number(value) || 0, 0, .45); this.emit(); }
  clear() { this.state.notes = []; this.emit(); }
  toggleRecord() {
    this.recording = !this.recording;
    if (this.recording) { this.state.notes = []; this.recordStartedAt = performance.now(); this.onStatus('Gravando notas… toque no tempo e finalize quando terminar.'); }
    else this.onStatus('Gravação de notas encerrada. Você pode ouvir, ajustar o groove ou criar a faixa.');
    this.emit(); return this.recording;
  }
  noteOn(inputMidi, velocity = .82) {
    const key = clamp(Math.round(Number(inputMidi) || 60), 0, 127);
    if (this.active.has(key)) return;
    const midi = clamp(key + this.state.octave * 12, 0, 127);
    const voice = this.makeVoice(midi, velocity);
    const record = this.recording ? { midi, velocity, startBeat: this.beatNow() } : null;
    this.active.set(key, { voice, record });
  }
  noteOff(inputMidi) {
    const key = Math.round(Number(inputMidi) || 60);
    const active = this.active.get(key); if (!active) return;
    active.voice.stop();
    if (active.record) {
      const endBeat = Math.max(active.record.startBeat + .08, this.beatNow());
      this.state.notes.push(cleanNote({ midi: active.record.midi, velocity: Math.round(active.record.velocity * 127), start_beat: active.record.startBeat, duration_beats: endBeat - active.record.startBeat }));
      this.emit();
    }
    this.active.delete(key);
  }
  playSequence() {
    const notes = applyInstrumentTiming(this.state);
    if (!notes.length) { this.onStatus('Grave algumas notas antes de ouvir.'); return false; }
    const secondsPerBeat = 60 / this.state.bpm;
    for (const note of notes) {
      setTimeout(() => {
        const voice = this.makeVoice(note.midi, note.velocity / 127);
        setTimeout(() => voice.stop(), Math.max(50, note.duration_beats * secondsPerBeat * 1000));
      }, Math.max(0, note.start_beat * secondsPerBeat * 1000));
    }
    this.onStatus(`Reproduzindo com ${quantizeLabel(this.state.quantize)}${this.state.swing ? ` · swing ${Math.round(this.state.swing * 100)}%` : ''}.`); return true;
  }
  renderWav(options = {}) { const rendered = renderInstrumentPcm(this.state, options); return { ...rendered, blob: encodePcmWav(rendered) }; }
  async connectMidi() {
    if (!globalThis.navigator?.requestMIDIAccess) { this.onStatus('MIDI externo não está disponível aqui. O teclado touch continua funcionando.'); return false; }
    try {
      this.midiAccess = await navigator.requestMIDIAccess();
      for (const input of this.midiAccess.inputs.values()) input.onmidimessage = (event) => {
        const [status, note, velocity] = event.data || []; const type = status & 0xf0;
        if (type === 0x90 && velocity > 0) this.noteOn(note, velocity / 127);
        else if (type === 0x80 || (type === 0x90 && velocity === 0)) this.noteOff(note);
      };
      this.onStatus('Controlador MIDI conectado. A oitava e o groove do Instrument Lab continuam ativos.'); return true;
    } catch (error) { this.onStatus(`Não foi possível conectar MIDI: ${error.message}`); return false; }
  }
  stopAll() { for (const active of this.active.values()) active.voice.stop(); this.active.clear(); }
  beatNow() { return ((performance.now() - this.recordStartedAt) / 1000) * (this.state.bpm / 60); }
  audioContext() {
    if (!this.context) {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContext) throw new Error('Web Audio indisponível neste aparelho.');
      this.context = new AudioContext(); this.master = this.context.createGain(); this.master.gain.value = .34; this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    return this.context;
  }
  makeVoice(midi, velocity) {
    const context = this.audioContext(); const sound = PRESETS[this.state.preset]; const now = context.currentTime;
    const amp = context.createGain();
    const filter = typeof context.createBiquadFilter === 'function' ? context.createBiquadFilter() : null;
    if (filter) { filter.type = 'lowpass'; filter.frequency.value = sound.filterHz; filter.Q.value = .45; filter.connect(amp); }
    const destination = filter || amp;
    const oscillators = sound.layers.map((item) => {
      const osc = context.createOscillator(); const mix = context.createGain();
      osc.type = item.type; osc.frequency.value = midiToHz(midi) * item.ratio; osc.detune.value = item.detune; mix.gain.value = item.gain;
      osc.connect(mix); mix.connect(destination); osc.start(now); return osc;
    });
    amp.connect(this.master);
    const peak = Math.max(.012, clamp(Number(velocity) || .82, .05, 1) * sound.gain);
    const sustain = Math.max(.0001, peak * sound.sustain);
    amp.gain.setValueAtTime(.0001, now);
    amp.gain.exponentialRampToValueAtTime(peak, now + sound.attack);
    amp.gain.exponentialRampToValueAtTime(sustain, now + sound.attack + sound.decay);
    let stopped = false;
    return { stop: () => {
      if (stopped) return; stopped = true; const time = context.currentTime;
      amp.gain.cancelScheduledValues(time); amp.gain.setValueAtTime(Math.max(.0001, amp.gain.value), time); amp.gain.exponentialRampToValueAtTime(.0001, time + sound.release);
      for (const osc of oscillators) osc.stop(time + sound.release + .03);
    } };
  }
  emit() { this.onChange(this.snapshot()); }
}

function synthNote(target, note, bpm, sampleRate, sound) {
  const start = Math.max(0, note.start_beat) * 60 / bpm;
  const noteDuration = Math.max(.05, note.duration_beats * 60 / bpm);
  const end = start + noteDuration + sound.release;
  const startFrame = Math.floor(start * sampleRate); const endFrame = Math.min(target.length, Math.ceil(end * sampleRate));
  const frequency = midiToHz(note.midi); const velocity = note.velocity / 127;
  const layerTotal = Math.max(.001, sound.layers.reduce((sum, item) => sum + item.gain, 0));
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const time = frame / sampleRate - start;
    const envelope = env(time, noteDuration, sound);
    let mixed = 0;
    for (const item of sound.layers) {
      const detuneRatio = Math.pow(2, item.detune / 1200);
      const phase = 2 * Math.PI * frequency * item.ratio * detuneRatio * time;
      mixed += wave(item.type, phase) * item.gain;
    }
    target[frame] += (mixed / layerTotal) * velocity * sound.gain * envelope;
  }
}

function env(time, noteDuration, sound) {
  if (time < 0) return 0;
  if (time < sound.attack) return Math.max(.001, time / Math.max(.001, sound.attack));
  const decayEnd = sound.attack + sound.decay;
  if (time < decayEnd) {
    const phase = (time - sound.attack) / Math.max(.001, sound.decay);
    return 1 - (1 - sound.sustain) * phase;
  }
  if (time <= noteDuration) return sound.sustain;
  const releasePhase = (time - noteDuration) / Math.max(.001, sound.release);
  return Math.max(0, sound.sustain * (1 - releasePhase));
}

function applyOnePoleLowPass(samples, sampleRate, cutoff) {
  const safeCutoff = clamp(Number(cutoff) || sampleRate / 2, 100, sampleRate * .45);
  const dt = 1 / sampleRate; const rc = 1 / (2 * Math.PI * safeCutoff); const alpha = dt / (rc + dt);
  let previous = 0;
  for (let index = 0; index < samples.length; index += 1) { previous += alpha * (samples[index] - previous); samples[index] = previous; }
}

function quantizeStep(value) { if (value === '1/4') return 1; if (value === '1/8') return .5; if (value === '1/16') return .25; return 0; }
function quantizeLabel(value) { return value === 'off' ? 'tempo livre' : `quantização ${value}`; }
function softClip(value) { return Math.tanh(value * 1.08) / Math.tanh(1.08); }
function wave(type, phase) { if (type === 'sine') return Math.sin(phase); if (type === 'square') return Math.sin(phase) >= 0 ? 1 : -1; if (type === 'sawtooth') return 2 * ((phase / (2 * Math.PI)) - Math.floor(phase / (2 * Math.PI) + .5)); return 2 / Math.PI * Math.asin(Math.sin(phase)); }
function cleanNote(note) { if (!Number.isFinite(Number(note?.midi))) return null; return { midi: clamp(Math.round(Number(note.midi)), 0, 127), velocity: clamp(Math.round(Number(note.velocity) || 96), 1, 127), start_beat: Math.max(0, Number(note.start_beat) || 0), duration_beats: Math.max(.05, Number(note.duration_beats) || .25) }; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function writeText(view, offset, text) { for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index)); }
