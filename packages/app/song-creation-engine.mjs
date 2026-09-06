import { encodePcmWav, midiToHz, renderInstrumentPcm } from './instrument-engine.mjs';

export const SONG_CREATION_SCHEMA = 'pablovoice_song_creation_v1';
const SAMPLE_RATE = 24000;
const BEATS_PER_BAR = 4;
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const KEY_ROOTS = Object.freeze({ C: 48, Db: 49, D: 50, Eb: 51, E: 52, F: 53, Gb: 54, G: 55, Ab: 56, A: 57, Bb: 58, B: 59 });
const GENRE_DEFAULTS = Object.freeze({
  pop: { bpm: 112, mode: 'minor', progression: [1, 6, 3, 7], groove: 'pop' },
  rnb: { bpm: 96, mode: 'minor', progression: [1, 7, 6, 7], groove: 'rnb' },
  funk: { bpm: 128, mode: 'minor', progression: [1, 6, 7, 6], groove: 'funk' },
  mpb: { bpm: 92, mode: 'major', progression: [1, 6, 4, 5], groove: 'soft' },
  rap: { bpm: 88, mode: 'minor', progression: [1, 6, 4, 5], groove: 'half' },
  dance: { bpm: 122, mode: 'minor', progression: [1, 6, 3, 7], groove: 'dance' },
});

export function createSongCreationPlan(input = {}) {
  const genre = normalizeGenre(input.genre || 'pop');
  const defaults = GENRE_DEFAULTS[genre];
  const bpm = clamp(Math.round(Number(input.bpm) || defaults.bpm), 60, 180);
  const durationSeconds = clamp(Math.round(Number(input.durationSeconds) || 120), 30, 210);
  const seedText = `${input.brief || ''}|${input.lyrics || ''}|${genre}`;
  const seed = hashString(seedText);
  const mode = String(input.mode || defaults.mode) === 'major' ? 'major' : 'minor';
  const keyName = KEY_ROOTS[input.key] != null ? input.key : Object.keys(KEY_ROOTS)[seed % Object.keys(KEY_ROOTS).length];
  const rootMidi = KEY_ROOTS[keyName];
  const totalBeats = Math.max(16, Math.floor(durationSeconds * bpm / 60 / BEATS_PER_BAR) * BEATS_PER_BAR);
  const totalBars = Math.max(4, Math.floor(totalBeats / BEATS_PER_BAR));
  const structure = structureForGenre(genre, totalBars);
  const sections = allocateSections(structure, totalBars, bpm);
  const progression = defaults.progression;
  const scale = mode === 'major' ? MAJOR : MINOR;
  const harmonic = buildHarmonicNotes({ sections, progression, scale, rootMidi, seed });
  const guide = buildGuideNotes({ lyrics: input.lyrics, sections, scale, rootMidi, seed, genre });
  const drums = buildDrumEvents({ sections, bpm, genre, groove: defaults.groove, seed });
  return Object.freeze({
    schema: SONG_CREATION_SCHEMA,
    brief: String(input.brief || '').trim().slice(0, 1200),
    genre,
    mood: String(input.mood || '').trim().slice(0, 120),
    bpm,
    durationSeconds: totalBars * BEATS_PER_BAR * 60 / bpm,
    key: keyName,
    mode,
    totalBars,
    totalBeats: totalBars * BEATS_PER_BAR,
    sections,
    progression,
    padNotes: harmonic.padNotes,
    bassNotes: harmonic.bassNotes,
    accentNotes: harmonic.accentNotes,
    guideNotes: guide.notes,
    guideLines: guide.lines,
    drumEvents: drums,
    seed,
    createdAt: Date.now(),
  });
}

export function renderSongCreation(plan, { sampleRate = SAMPLE_RATE } = {}) {
  if (!plan || plan.schema !== SONG_CREATION_SCHEMA) throw new TypeError('Plano musical inválido.');
  sampleRate = clamp(Math.round(Number(sampleRate) || SAMPLE_RATE), 22050, 32000);
  const targetFrames = Math.ceil(plan.durationSeconds * sampleRate);
  const instrumental = new Float32Array(targetFrames);
  addInstrumentLayer(instrumental, plan.padNotes, plan.bpm, 'soft_pad', sampleRate, 0.72);
  addInstrumentLayer(instrumental, plan.bassNotes, plan.bpm, 'bass', sampleRate, 0.74);
  addInstrumentLayer(instrumental, plan.accentNotes, plan.bpm, 'warm_keys', sampleRate, 0.42);
  renderDrums(instrumental, plan.drumEvents, sampleRate, plan.bpm, plan.seed);
  masterInPlace(instrumental, 0.92);

  const guide = new Float32Array(targetFrames);
  addInstrumentLayer(guide, plan.guideNotes, plan.bpm, 'warm_keys', sampleRate, 0.9);
  masterInPlace(guide, 0.78);

  const instrumentalRendered = { channels: [instrumental], sampleRate, frameCount: targetFrames, duration: plan.durationSeconds };
  const guideRendered = { channels: [guide], sampleRate, frameCount: targetFrames, duration: plan.durationSeconds };
  return Object.freeze({
    sampleRate,
    duration: plan.durationSeconds,
    instrumental: Object.freeze({ rendered: instrumentalRendered, blob: encodePcmWav(instrumentalRendered) }),
    guide: Object.freeze({ rendered: guideRendered, blob: encodePcmWav(guideRendered) }),
  });
}

export function describeSongPlan(plan) {
  const mode = plan.mode === 'major' ? 'maior' : 'menor';
  const labels = plan.sections.map((section) => section.label).join(' → ');
  return `${plan.genre.toUpperCase()} · ${plan.bpm} BPM · ${plan.key} ${mode} · ${labels}`;
}

function addInstrumentLayer(target, notes, bpm, preset, sampleRate, gain) {
  if (!notes.length) return;
  const rendered = renderInstrumentPcm({ preset, bpm, notes }, { sampleRate, channels: 1 });
  const source = rendered.channels[0];
  const count = Math.min(target.length, source.length);
  for (let index = 0; index < count; index += 1) target[index] += source[index] * gain;
}

function buildHarmonicNotes({ sections, progression, scale, rootMidi, seed }) {
  const padNotes = [];
  const bassNotes = [];
  const accentNotes = [];
  let chordCursor = 0;
  for (const section of sections) {
    for (let bar = section.startBar; bar < section.endBar; bar += 1) {
      const degree = progression[chordCursor % progression.length];
      chordCursor += 1;
      const chord = triadForDegree(degree, scale, rootMidi + 12);
      const start = bar * BEATS_PER_BAR;
      const energy = sectionEnergy(section.id);
      for (const midi of chord) padNotes.push(note(midi, 74 + Math.round(energy * 18), start, BEATS_PER_BAR * 0.94));
      const bassRoot = rootForDegree(degree, scale, rootMidi - 12);
      bassNotes.push(note(bassRoot, 92 + Math.round(energy * 20), start, 1.65));
      if (energy > 0.45) bassNotes.push(note(bassRoot + (bar % 2 ? 7 : 0), 76, start + 2, 1.25));
      if (energy > 0.56) {
        const accentMidi = chord[(bar + seed) % chord.length] + 12;
        accentNotes.push(note(accentMidi, 72 + Math.round(energy * 20), start + 1.5, 0.28));
        accentNotes.push(note(chord[(bar + 1 + seed) % chord.length] + 12, 68 + Math.round(energy * 18), start + 3.5, 0.22));
      }
    }
  }
  return { padNotes, bassNotes, accentNotes };
}

function buildGuideNotes({ lyrics, sections, scale, rootMidi, seed, genre }) {
  const lyricLines = String(lyrics || '').split(/\r?\n/).map((text) => text.trim()).filter((text) => text && !/^\[.*\]$/.test(text) && !/^(verso|refr[aã]o|ponte|bridge|chorus|pre)/i.test(text));
  const contentSections = sections.filter((section) => !['intro', 'outro'].includes(section.id));
  const startBeat = contentSections[0]?.startBeat ?? 0;
  const endBeat = contentSections.at(-1)?.endBeat ?? sections.at(-1)?.endBeat ?? 16;
  const lines = lyricLines.length ? lyricLines.slice(0, 96) : ['guia', 'melódica', 'para', 'cantar'];
  const slot = Math.max(2, (endBeat - startBeat) / lines.length);
  const notes = [];
  const mapped = [];
  for (let index = 0; index < lines.length; index += 1) {
    const lineStart = startBeat + index * slot;
    if (lineStart >= endBeat) break;
    const lineEnd = Math.min(endBeat, lineStart + slot * 0.88);
    const section = sectionAtBeat(sections, lineStart);
    const words = lines[index].split(/\s+/).filter(Boolean).length;
    const count = clamp(words, 3, genre === 'rap' ? 10 : 7);
    const phraseStep = (lineEnd - lineStart) / count;
    const phraseNotes = [];
    const lift = /refr|chorus/.test(section?.id || '') ? 5 : /pre/.test(section?.id || '') ? 3 : 0;
    for (let n = 0; n < count; n += 1) {
      const contour = melodicDegree(index, n, seed, count);
      const midi = rootMidi + 24 + scale[contour % 7] + lift + (contour >= 7 ? 12 : 0);
      const start = lineStart + n * phraseStep;
      const duration = Math.max(0.18, phraseStep * 0.74);
      notes.push(note(clamp(midi, 55, 84), 88 + ((index + n + seed) % 18), start, duration));
      phraseNotes.push({ midi: clamp(midi, 55, 84), startBeat: start, durationBeats: duration });
    }
    mapped.push(Object.freeze({ index, text: lines[index], startBeat: lineStart, endBeat: lineEnd, sectionId: section?.id || null, notes: phraseNotes }));
  }
  return { notes, lines: mapped };
}

function buildDrumEvents({ sections, genre, groove, seed }) {
  const events = [];
  for (const section of sections) {
    const energy = sectionEnergy(section.id);
    for (let bar = section.startBar; bar < section.endBar; bar += 1) {
      const start = bar * BEATS_PER_BAR;
      if (energy < 0.18) continue;
      if (groove === 'half') {
        events.push(drum('kick', start, 0.95), drum('snare', start + 2, 0.78));
      } else if (groove === 'funk') {
        events.push(drum('kick', start, 0.98), drum('kick', start + 1.5, 0.72), drum('snare', start + 1, 0.82), drum('snare', start + 3, 0.88));
      } else {
        events.push(drum('kick', start, 0.95), drum('kick', start + 2 + ((bar + seed) % 2 ? 0.5 : 0), 0.72), drum('snare', start + 1, 0.82), drum('snare', start + 3, 0.86));
      }
      if (energy > 0.34) {
        const hatStep = genre === 'rnb' ? 0.5 : 0.5;
        for (let beat = 0; beat < BEATS_PER_BAR; beat += hatStep) events.push(drum('hat', start + beat, 0.32 + energy * 0.2 + ((Math.round(beat * 2) + seed) % 3 === 0 ? 0.08 : 0)));
      }
      if (energy > 0.75 && bar === section.endBar - 1) {
        events.push(drum('snare', start + 3.25, 0.58), drum('snare', start + 3.5, 0.7), drum('snare', start + 3.75, 0.86));
      }
    }
  }
  return events;
}

function renderDrums(target, events, sampleRate, bpm, seed) {
  const secondsPerBeat = 60 / bpm;
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    const startFrame = Math.floor(event.beat * secondsPerBeat * sampleRate);
    if (event.kind === 'kick') synthKick(target, startFrame, sampleRate, event.velocity);
    else if (event.kind === 'snare') synthNoiseDrum(target, startFrame, sampleRate, event.velocity, 0.14, seed + eventIndex * 13, 'snare');
    else synthNoiseDrum(target, startFrame, sampleRate, event.velocity, 0.055, seed + eventIndex * 19, 'hat');
  }
}

function synthKick(target, startFrame, sampleRate, velocity) {
  const frames = Math.min(target.length - startFrame, Math.floor(sampleRate * 0.28));
  let phase = 0;
  for (let i = 0; i < frames; i += 1) {
    const t = i / sampleRate;
    const frequency = 47 + 78 * Math.exp(-t * 28);
    phase += 2 * Math.PI * frequency / sampleRate;
    const envelope = Math.exp(-t * 15);
    target[startFrame + i] += Math.sin(phase) * envelope * velocity * 0.56;
  }
}

function synthNoiseDrum(target, startFrame, sampleRate, velocity, lengthSeconds, seed, kind) {
  const frames = Math.min(target.length - startFrame, Math.floor(sampleRate * lengthSeconds));
  let random = (seed >>> 0) || 1;
  let previous = 0;
  for (let i = 0; i < frames; i += 1) {
    random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
    const noise = ((random >>> 0) / 0xffffffff) * 2 - 1;
    const t = i / sampleRate;
    const envelope = Math.exp(-t * (kind === 'hat' ? 58 : 24));
    const shaped = kind === 'hat' ? noise - previous * 0.88 : noise * 0.78 + Math.sin(2 * Math.PI * 190 * t) * 0.22;
    previous = noise;
    target[startFrame + i] += shaped * envelope * velocity * (kind === 'hat' ? 0.18 : 0.28);
  }
}

function masterInPlace(samples, targetPeak) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.tanh(samples[i] * 1.08);
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  const scale = peak > 0 ? Math.min(1.25, targetPeak / peak) : 1;
  for (let i = 0; i < samples.length; i += 1) samples[i] *= scale;
}

function structureForGenre(genre, totalBars) {
  const full = genre === 'rap'
    ? ['intro', 'verso_1', 'refrão', 'verso_2', 'refrão', 'ponte_rap', 'refrão_final', 'outro']
    : ['intro', 'verso_1', 'pre_refrão', 'refrão', 'verso_2', 'pre_refrão_2', 'refrão_2', 'ponte', 'refrão_final', 'outro'];
  if (totalBars < 20) return ['intro', 'verso_1', 'refrão', 'verso_2', 'refrão_final', 'outro'];
  if (totalBars < 32) return full.filter((id) => !['pre_refrão_2', 'refrão_2'].includes(id));
  return full;
}

function allocateSections(structure, totalBars, bpm) {
  const weights = structure.map((id) => sectionWeight(id));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  let allocations = weights.map((weight) => Math.max(1, Math.floor(totalBars * weight / weightTotal)));
  let used = allocations.reduce((sum, value) => sum + value, 0);
  let index = 0;
  while (used < totalBars) { allocations[index % allocations.length] += 1; used += 1; index += 1; }
  while (used > totalBars) {
    const target = allocations.findIndex((value, idx) => value > 1 && !['intro', 'outro'].includes(structure[idx]));
    if (target < 0) break;
    allocations[target] -= 1; used -= 1;
  }
  let barCursor = 0;
  return structure.map((id, idx) => {
    const startBar = barCursor;
    const endBar = startBar + allocations[idx];
    barCursor = endBar;
    return Object.freeze({ id, label: sectionLabel(id), startBar, endBar, startBeat: startBar * BEATS_PER_BAR, endBeat: endBar * BEATS_PER_BAR, startSeconds: startBar * BEATS_PER_BAR * 60 / bpm, endSeconds: endBar * BEATS_PER_BAR * 60 / bpm, energy: sectionEnergy(id) });
  });
}

function sectionWeight(id) { if (id === 'intro' || id === 'outro') return 0.5; if (/refr/.test(id)) return 1.25; if (/pre/.test(id)) return 0.75; if (/ponte/.test(id)) return 0.8; return 1.15; }
function sectionEnergy(id) { if (id === 'intro') return 0.28; if (id === 'outro') return 0.38; if (/refr[aã]o_final/.test(id)) return 1; if (/refr/.test(id)) return 0.9; if (/pre/.test(id)) return 0.66; if (/ponte/.test(id)) return 0.58; return 0.52; }
function sectionLabel(id) { return id.replace(/_/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase()); }
function sectionAtBeat(sections, beat) { return sections.find((section) => beat >= section.startBeat && beat < section.endBeat) || sections.at(-1); }
function melodicDegree(lineIndex, noteIndex, seed, count) { const shapes = [[0,2,4,3,2,1,0],[0,1,2,4,5,4,2],[2,4,5,4,2,1,0],[0,2,3,5,4,2,1]]; const shape = shapes[(lineIndex + seed) % shapes.length]; const value = shape[noteIndex % Math.min(shape.length, count)] ?? 0; return value + (((lineIndex + seed) % 5 === 0 && noteIndex === count - 2) ? 2 : 0); }
function triadForDegree(degree, scale, root) { const index = ((degree - 1) % 7 + 7) % 7; return [0,2,4].map((step) => { const scaleIndex = index + step; return root + scale[scaleIndex % 7] + (scaleIndex >= 7 ? 12 : 0); }); }
function rootForDegree(degree, scale, root) { const index = ((degree - 1) % 7 + 7) % 7; return root + scale[index]; }
function note(midi, velocity, start_beat, duration_beats) { return { midi: clamp(Math.round(midi), 0, 127), velocity: clamp(Math.round(velocity), 1, 127), start_beat: Math.max(0, start_beat), duration_beats: Math.max(0.05, duration_beats) }; }
function drum(kind, beat, velocity) { return { kind, beat, velocity: clamp(velocity, 0, 1) }; }
function normalizeGenre(value) { const text = String(value || '').toLowerCase(); if (/r&b|rnb/.test(text)) return 'rnb'; if (/funk/.test(text)) return 'funk'; if (/mpb|bossa/.test(text)) return 'mpb'; if (/rap|hip/.test(text)) return 'rap'; if (/dance|edm|eletr/.test(text)) return 'dance'; return 'pop'; }
function hashString(value) { let hash = 2166136261; for (const char of String(value || '')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
