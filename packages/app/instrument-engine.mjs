const PRESETS = Object.freeze({
  warm_keys: { osc1: 'triangle', osc2: 'sine', ratio: 1.003, attack: 0.018, release: 0.18, gain: 0.22 },
  soft_pad: { osc1: 'sine', osc2: 'triangle', ratio: 1.003, attack: 0.12, release: 0.55, gain: 0.2 },
  bass: { osc1: 'sawtooth', osc2: 'square', ratio: 0.5, attack: 0.012, release: 0.16, gain: 0.2 },
});

export function midiToHz(midi) {
  return 440 * Math.pow(2, (Number(midi) - 69) / 12);
}

export function normalizeInstrumentState(value = {}) {
  return {
    version: '2.0-local',
    preset: PRESETS[value.preset] ? value.preset : 'warm_keys',
    bpm: clamp(Math.round(Number(value.bpm) || 120), 40, 240),
    notes: Array.isArray(value.notes) ? value.notes.slice(0, 4096).map(cleanNote).filter(Boolean) : [],
  };
}

export function renderInstrumentPcm(value, { sampleRate = 48000, channels = 2 } = {}) {
  const state = normalizeInstrumentState(value);
  if (!state.notes.length) throw new Error('Grave algumas notas antes de renderizar.');
  sampleRate = clamp(Math.round(Number(sampleRate) || 48000), 22050, 48000);
  channels = clamp(Math.round(Number(channels) || 2), 1, 2);
  const preset = PRESETS[state.preset];
  const secondsPerBeat = 60 / state.bpm;
  const endBeat = Math.max(...state.notes.map((note) => note.start_beat + note.duration_beats));
  const duration = Math.max(0.25, endBeat * secondsPerBeat + preset.release + 0.08);
  if (duration > 240) throw new Error('A sequência ultrapassa 4 minutos; divida o arranjo antes de renderizar.');
  const frameCount = Math.ceil(duration * sampleRate);
  const mono = new Float32Array(frameCount);
  for (const note of state.notes) synthNote(mono, note, state.bpm, sampleRate, preset);
  let peak = 0;
  for (const sample of mono) peak = Math.max(peak, Math.abs(sample));
  const scale = peak > 0.94 ? 0.94 / peak : 1;
  const output = Array.from({ length: channels }, () => new Float32Array(frameCount));
  for (let index = 0; index < frameCount; index += 1) {
    const sample = mono[index] * scale;
    for (let channel = 0; channel < channels; channel += 1) output[channel][index] = sample;
  }
  return { channels: output, sampleRate, duration, frameCount, preset: state.preset, bpm: state.bpm };
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
  setPreset(value) { if (PRESETS[value]) { this.state.preset = value; this.emit(); } }
  setBpm(value) { this.state.bpm = clamp(Math.round(Number(value) || 120), 40, 240); this.emit(); }
  clear() { this.state.notes = []; this.emit(); }
  toggleRecord() {
    this.recording = !this.recording;
    if (this.recording) { this.state.notes = []; this.recordStartedAt = performance.now(); this.onStatus('Gravando notas…'); }
    else this.onStatus('Gravação de notas encerrada.');
    this.emit(); return this.recording;
  }
  noteOn(midi, velocity = 0.82) {
    midi = clamp(Math.round(Number(midi) || 60), 0, 127);
    if (this.active.has(midi)) return;
    const voice = this.makeVoice(midi, velocity);
    const record = this.recording ? { midi, velocity, startBeat: this.beatNow() } : null;
    this.active.set(midi, { voice, record });
  }
  noteOff(midi) {
    midi = Math.round(Number(midi) || 60);
    const active = this.active.get(midi); if (!active) return;
    active.voice.stop();
    if (active.record) {
      const endBeat = Math.max(active.record.startBeat + 0.08, this.beatNow());
      this.state.notes.push(cleanNote({ midi, velocity: Math.round(active.record.velocity * 127), start_beat: active.record.startBeat, duration_beats: endBeat - active.record.startBeat }));
      this.emit();
    }
    this.active.delete(midi);
  }
  playSequence() {
    if (!this.state.notes.length) { this.onStatus('Grave algumas notas antes de ouvir.'); return false; }
    const secondsPerBeat = 60 / this.state.bpm;
    for (const note of this.state.notes) {
      setTimeout(() => {
        const voice = this.makeVoice(note.midi, note.velocity / 127);
        setTimeout(() => voice.stop(), Math.max(50, note.duration_beats * secondsPerBeat * 1000));
      }, Math.max(0, note.start_beat * secondsPerBeat * 1000));
    }
    this.onStatus('Reproduzindo sequência.'); return true;
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
      this.onStatus('Controlador MIDI conectado.'); return true;
    } catch (error) { this.onStatus(`Não foi possível conectar MIDI: ${error.message}`); return false; }
  }
  stopAll() { for (const active of this.active.values()) active.voice.stop(); this.active.clear(); }
  beatNow() { return ((performance.now() - this.recordStartedAt) / 1000) * (this.state.bpm / 60); }
  audioContext() {
    if (!this.context) {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContext) throw new Error('Web Audio indisponível neste aparelho.');
      this.context = new AudioContext(); this.master = this.context.createGain(); this.master.gain.value = 0.3; this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    return this.context;
  }
  makeVoice(midi, velocity) {
    const context = this.audioContext(); const preset = PRESETS[this.state.preset]; const now = context.currentTime;
    const gain = context.createGain(); const a = context.createOscillator(); const b = context.createOscillator();
    a.type = preset.osc1; b.type = preset.osc2; a.frequency.value = midiToHz(midi); b.frequency.value = midiToHz(midi) * preset.ratio;
    const peak = Math.max(0.015, clamp(Number(velocity) || 0.82, 0.05, 1) * preset.gain);
    gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(peak, now + preset.attack);
    a.connect(gain); b.connect(gain); gain.connect(this.master); a.start(); b.start(); let stopped = false;
    return { stop: () => { if (stopped) return; stopped = true; const time = context.currentTime; gain.gain.cancelScheduledValues(time); gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), time); gain.gain.exponentialRampToValueAtTime(0.0001, time + preset.release); a.stop(time + preset.release + 0.03); b.stop(time + preset.release + 0.03); } };
  }
  emit() { this.onChange(this.snapshot()); }
}

function synthNote(target, note, bpm, sampleRate, preset) {
  const start = Math.max(0, note.start_beat) * 60 / bpm;
  const noteDuration = Math.max(0.05, note.duration_beats * 60 / bpm);
  const end = start + noteDuration + preset.release;
  const startFrame = Math.floor(start * sampleRate); const endFrame = Math.min(target.length, Math.ceil(end * sampleRate));
  const frequency = midiToHz(note.midi); const velocity = note.velocity / 127;
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const time = frame / sampleRate - start;
    const envelope = env(time, noteDuration, preset.attack, preset.release);
    const phase = 2 * Math.PI * frequency * time;
    const sample = (wave(preset.osc1, phase) + wave(preset.osc2, phase * preset.ratio)) * 0.5 * velocity * preset.gain * envelope;
    target[frame] += sample;
  }
}
function env(time, noteDuration, attack, release) { if (time < 0) return 0; if (time < attack) return Math.max(0.001, time / Math.max(0.001, attack)); if (time <= noteDuration) return 1; return Math.max(0, 1 - (time - noteDuration) / Math.max(0.001, release)); }
function wave(type, phase) { if (type === 'sine') return Math.sin(phase); if (type === 'square') return Math.sin(phase) >= 0 ? 1 : -1; if (type === 'sawtooth') return 2 * ((phase / (2 * Math.PI)) - Math.floor(phase / (2 * Math.PI) + 0.5)); return 2 / Math.PI * Math.asin(Math.sin(phase)); }
function cleanNote(note) { if (!Number.isFinite(Number(note?.midi))) return null; return { midi: clamp(Math.round(Number(note.midi)), 0, 127), velocity: clamp(Math.round(Number(note.velocity) || 96), 1, 127), start_beat: Math.max(0, Number(note.start_beat) || 0), duration_beats: Math.max(0.05, Number(note.duration_beats) || 0.25) }; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function writeText(view, offset, text) { for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index)); }
