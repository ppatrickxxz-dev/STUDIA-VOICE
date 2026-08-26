import { EXPORT_PRESETS, normalizationFactor, peakOf } from './audio/src/presets.mjs';

export class PabloAudioEngine {
  constructor() {
    this.context = null;
    this.buffers = new Map();
    this.sources = [];
    this.playing = false;
    this.startedAt = 0;
    this.startPosition = 0;
    this.endPosition = 0;
    this.frame = 0;
    this.generation = 0;
  }

  async audioContext({ resume = true } = {}) {
    if (!this.context) this.context = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    if (resume && this.context.state === 'suspended') await this.context.resume();
    return this.context;
  }

  async decode(trackId, blob) {
    // Decoding does not require an audible/resumed AudioContext. Keeping the
    // context suspended here is essential for project restoration on reload,
    // where browser autoplay policy provides no user gesture to unlock audio.
    const context = await this.audioContext({ resume: false });
    const started = performance.now();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    this.buffers.set(trackId, buffer);
    return { buffer, decodeMs: performance.now() - started };
  }

  setBuffer(trackId, buffer) { this.buffers.set(trackId, buffer); }
  getBuffer(trackId) { return this.buffers.get(trackId) || null; }
  removeBuffer(trackId) { this.buffers.delete(trackId); }

  duration(project) {
    return Math.max(0, ...(project?.tracks || []).map((track) => {
      const rate = pitchRate(track.effects?.pitchSemitones || 0);
      return Number(track.offset || 0) + Math.max(0, Number(track.trimEnd || track.duration) - Number(track.trimStart || 0)) / rate;
    }));
  }

  position() {
    if (!this.playing || !this.context) return this.startPosition;
    return Math.min(this.endPosition, this.startPosition + Math.max(0, this.context.currentTime - this.startedAt));
  }

  async play(project, { position = 0, mode = 'processed', onTime = () => {}, onEnded = () => {} } = {}) {
    const context = await this.audioContext();
    this.stop(false);
    const end = this.duration(project);
    const start = Math.max(0, Math.min(Number(position) || 0, Math.max(0, end - 0.01)));
    const tracks = audibleTracks(project).filter((track) => this.buffers.has(track.id));
    if (!tracks.length) throw new Error('Nenhuma faixa audível foi carregada.');
    const master = createMaster(context, context.destination);
    const when = context.currentTime + 0.025;
    for (const track of tracks) {
      const sources = createTrackSources(context, this.buffers.get(track.id), track, mode, start, when, master);
      this.sources.push(...sources);
    }
    if (!this.sources.length) throw new Error('O cursor está depois do fim das faixas.');
    this.playing = true;
    this.startedAt = when;
    this.startPosition = start;
    this.endPosition = end;
    const generation = ++this.generation;
    const tick = () => {
      if (!this.playing || generation !== this.generation) return;
      const current = this.position();
      onTime(current);
      if (current >= end - 0.015) {
        this.stop(false);
        this.startPosition = 0;
        onTime(0);
        onEnded();
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
    return start;
  }

  stop(keepPosition = true) {
    const position = this.position();
    this.generation += 1;
    cancelAnimationFrame(this.frame);
    for (const source of this.sources) {
      try { source.stop(); } catch { /* source already ended */ }
      try { source.disconnect(); } catch { /* disconnected */ }
    }
    this.sources = [];
    this.playing = false;
    this.startPosition = keepPosition ? position : 0;
    return this.startPosition;
  }

  async render(project, presetName = 'demo') {
    const tracks = audibleTracks(project).filter((track) => this.buffers.has(track.id));
    if (!tracks.length) throw new Error('Nenhuma faixa disponível para exportação.');
    const preset = EXPORT_PRESETS[presetName] || EXPORT_PRESETS.demo;
    const duration = Math.max(0.02, this.duration(project));
    const channels = Math.max(1, Math.min(2, ...tracks.map((track) => this.buffers.get(track.id).numberOfChannels)));
    const frames = Math.ceil(duration * preset.sampleRate);
    const offline = new OfflineAudioContext(channels, frames, preset.sampleRate);
    const master = createMaster(offline, offline.destination);
    for (const track of tracks) createTrackSources(offline, this.buffers.get(track.id), track, 'processed', 0, 0, master);
    const rendered = await offline.startRendering();
    normalizeInPlace(rendered, preset.peak);
    return rendered;
  }
}

function audibleTracks(project) {
  const tracks = project?.tracks || [];
  const hasSolo = tracks.some((track) => track.solo && !track.muted);
  return tracks.filter((track) => !track.muted && (!hasSolo || track.solo));
}

function createMaster(context, destination) {
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -3;
  compressor.knee.value = 2;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.08;
  compressor.connect(destination);
  return compressor;
}

function createTrackSources(context, buffer, track, mode, cursor, baseWhen, destination) {
  const effects = track.effects || {};
  const semitones = mode === 'processed' ? Number(effects.pitchSemitones || 0) : 0;
  const rate = pitchRate(semitones);
  const timelineStart = Number(track.offset || 0);
  const trimStart = Math.max(0, Number(track.trimStart || 0));
  const trimEnd = Math.min(buffer.duration, Number(track.trimEnd || track.duration || buffer.duration));
  const timelineDuration = Math.max(0, trimEnd - trimStart) / rate;
  const localCursor = Math.max(0, cursor - timelineStart);
  if (cursor >= timelineStart + timelineDuration || trimEnd <= trimStart) return [];
  const delay = Math.max(0, timelineStart - cursor);
  const mediaOffset = trimStart + localCursor * rate;
  const mediaDuration = Math.max(0.01, trimEnd - mediaOffset);
  const when = baseWhen + delay;
  const input = context.createGain();
  const output = connectTreatment(context, input, buffer, track, mode, when, localCursor, timelineDuration);
  output.connect(destination);
  const main = context.createBufferSource();
  main.buffer = buffer;
  if ('detune' in main) main.detune.value = semitones * 100;
  main.connect(input);
  main.start(when, mediaOffset, mediaDuration);
  const sources = [main];
  if (mode === 'processed' && effects.double) {
    const double = context.createBufferSource();
    const doubleGain = context.createGain();
    double.buffer = buffer;
    if ('detune' in double) double.detune.value = semitones * 100 + 11;
    doubleGain.gain.value = 0.23;
    double.connect(doubleGain);
    doubleGain.connect(input);
    double.start(when + 0.022, mediaOffset, mediaDuration);
    sources.push(double);
  }
  return sources;
}

function connectTreatment(context, input, buffer, track, mode, when, localCursor, duration) {
  const effects = track.effects || {};
  let node = input;
  if (mode === 'processed') {
    if (effects.clean) {
      node = filter(context, node, 'highpass', 95, 0, 0.72);
      node = filter(context, node, 'peaking', 285, -3.5, 1.05);
      if (effects.compressor !== false) node = compressor(context, node, -30, 4.5, 0.005, 0.16);
      node = filter(context, node, 'highshelf', 6200, 2.4);
    } else if (effects.compressor) node = compressor(context, node, -24, 3.2, 0.008, 0.18);
    if (effects.warm) {
      node = filter(context, node, 'lowshelf', 190, 5.8);
      node = filter(context, node, 'peaking', 470, 1.7, 0.9);
    }
    if (effects.presence) {
      node = filter(context, node, 'peaking', 3500, 6.8, 0.82);
      node = filter(context, node, 'highshelf', 8500, 2.3);
    }
    if (Number(effects.lowEq)) node = filter(context, node, 'lowshelf', 160, Number(effects.lowEq));
    if (Number(effects.midEq)) node = filter(context, node, 'peaking', 1250, Number(effects.midEq), 0.85);
    if (Number(effects.highEq)) node = filter(context, node, 'highshelf', 7000, Number(effects.highEq));
    if (effects.deEsser) node = filter(context, node, 'highshelf', 6400, -3.8);
    if (Number(effects.saturation) > 0) {
      const shaper = context.createWaveShaper();
      shaper.curve = saturationCurve(Number(effects.saturation));
      shaper.oversample = '2x';
      node.connect(shaper);
      node = shaper;
    }
  }
  const gain = context.createGain();
  const normalize = mode === 'processed' && effects.normalize ? normalizationFactor(buffer) : 1;
  const level = Math.max(0, Number(track.gain ?? 1) * normalize);
  automateGain(gain.gain, level, mode === 'processed' ? effects : {}, when, localCursor, duration);
  node.connect(gain);
  node = gain;
  if (context.createStereoPanner) {
    const pan = context.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, Number(track.pan || 0)));
    node.connect(pan);
    node = pan;
  }
  return node;
}

function filter(context, input, type, frequency, gain = 0, q = 1) {
  const value = context.createBiquadFilter();
  value.type = type;
  value.frequency.value = frequency;
  value.gain.value = gain;
  value.Q.value = q;
  input.connect(value);
  return value;
}

function compressor(context, input, threshold, ratio, attack, release) {
  const value = context.createDynamicsCompressor();
  value.threshold.value = threshold;
  value.knee.value = 12;
  value.ratio.value = ratio;
  value.attack.value = attack;
  value.release.value = release;
  input.connect(value);
  return value;
}

function saturationCurve(amount) {
  const samples = 2048;
  const curve = new Float32Array(samples);
  const drive = 1 + Math.max(0, Math.min(1, amount)) * 22;
  for (let index = 0; index < samples; index += 1) {
    const x = (index * 2) / (samples - 1) - 1;
    curve[index] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}

function automateGain(param, level, effects, when, cursor, duration) {
  const fadeIn = Math.max(0, Math.min(duration / 2, Number(effects.fadeIn || 0)));
  const fadeOut = Math.max(0, Math.min(duration / 2, Number(effects.fadeOut || 0)));
  const initial = fadeIn && cursor < fadeIn ? level * (cursor / fadeIn) : level;
  param.setValueAtTime(initial, when);
  if (fadeIn && cursor < fadeIn) param.linearRampToValueAtTime(level, when + fadeIn - cursor);
  if (fadeOut) {
    const fadeStart = duration - fadeOut;
    if (cursor < fadeStart) {
      param.setValueAtTime(level, when + fadeStart - cursor);
      param.linearRampToValueAtTime(0, when + duration - cursor);
    } else {
      param.setValueAtTime(level * Math.max(0, (duration - cursor) / fadeOut), when);
      param.linearRampToValueAtTime(0, when + Math.max(0.001, duration - cursor));
    }
  }
}

function normalizeInPlace(buffer, target) {
  const peak = peakOf(buffer);
  if (peak < 0.00001) return buffer;
  const factor = Math.max(0.25, Math.min(2, target / peak));
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) data[index] *= factor;
  }
  return buffer;
}

function pitchRate(semitones) {
  return 2 ** (Number(semitones || 0) / 12);
}
