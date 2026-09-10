import { encodePcmWav, renderInstrumentPcm } from './instrument-engine.mjs';
import { normalizeSingerProfile } from './singer-profile.mjs';

export const SONG_CREATION_SCHEMA = 'pablovoice_song_creation_v1';
const SAMPLE_RATE = 24000;
const BEATS_PER_BAR = 4;
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const KEY_ROOTS = Object.freeze({ C: 48, Db: 49, D: 50, Eb: 51, E: 52, F: 53, Gb: 54, G: 55, Ab: 56, A: 57, Bb: 58, B: 59 });
const GENRE_DEFAULTS = Object.freeze({
  pop: {
    bpm: 112, mode: 'minor',
    progressions: [[1,6,3,7], [6,4,1,5], [1,5,6,4], [4,1,5,6]],
    grooves: ['pop', 'pop_sync', 'half'],
    palettes: [
      { pad: 'soft_pad', bass: 'synth_bass', accent: 'glass_pluck', guide: 'synth_lead' },
      { pad: 'analog_pad', bass: 'sub_bass', accent: 'velvet_ep', guide: 'warm_keys' },
    ],
  },
  rnb: {
    bpm: 96, mode: 'minor',
    progressions: [[1,7,6,7], [6,4,1,5], [2,5,1,6], [1,3,6,4], [6,2,5,1]],
    grooves: ['rnb', 'rnb_sync', 'half'],
    palettes: [
      { pad: 'soft_pad', bass: 'sub_bass', accent: 'velvet_ep', guide: 'synth_lead' },
      { pad: 'analog_pad', bass: 'synth_bass', accent: 'glass_pluck', guide: 'velvet_ep' },
      { pad: 'soft_pad', bass: 'synth_bass', accent: 'glass_pluck', guide: 'warm_keys' },
    ],
  },
  funk: {
    bpm: 128, mode: 'minor',
    progressions: [[1,6,7,6], [1,4,6,5], [6,7,1,4], [1,7,4,6]],
    grooves: ['funk', 'funk_bounce', 'rnb_sync'],
    palettes: [
      { pad: 'analog_pad', bass: 'synth_bass', accent: 'glass_pluck', guide: 'synth_lead' },
      { pad: 'soft_pad', bass: 'sub_bass', accent: 'warm_keys', guide: 'velvet_ep' },
    ],
  },
  mpb: {
    bpm: 92, mode: 'major',
    progressions: [[1,6,4,5], [1,3,4,2,5], [6,2,5,1], [1,4,3,6,2,5]],
    grooves: ['soft', 'rnb', 'pop_sync'],
    palettes: [
      { pad: 'soft_pad', bass: 'synth_bass', accent: 'velvet_ep', guide: 'warm_keys' },
      { pad: 'analog_pad', bass: 'sub_bass', accent: 'glass_pluck', guide: 'velvet_ep' },
    ],
  },
  rap: {
    bpm: 88, mode: 'minor',
    progressions: [[1,6,4,5], [1,7,6,4], [6,4,1,5], [1,3,7,6]],
    grooves: ['half', 'rnb_sync', 'funk_bounce'],
    palettes: [
      { pad: 'analog_pad', bass: 'sub_bass', accent: 'glass_pluck', guide: 'synth_lead' },
      { pad: 'soft_pad', bass: 'synth_bass', accent: 'velvet_ep', guide: 'warm_keys' },
    ],
  },
  dance: {
    bpm: 122, mode: 'minor',
    progressions: [[1,6,3,7], [6,4,1,5], [1,5,3,6], [4,6,1,5]],
    grooves: ['dance', 'pop_sync', 'pop'],
    palettes: [
      { pad: 'analog_pad', bass: 'synth_bass', accent: 'glass_pluck', guide: 'synth_lead' },
      { pad: 'soft_pad', bass: 'sub_bass', accent: 'synth_lead', guide: 'velvet_ep' },
    ],
  },
});

export function createSongCreationPlan(input = {}) {
  const genre = normalizeGenre(input.genre || 'pop');
  const defaults = GENRE_DEFAULTS[genre];
  const explicitSeed = Number.isFinite(Number(input.seed ?? input.variationSeed));
  const seed = explicitSeed ? (Number(input.seed ?? input.variationSeed) >>> 0) : randomSeed();
  const bpm = clamp(Math.round(Number(input.bpm) || defaults.bpm), 60, 180);
  const durationSeconds = clamp(Math.round(Number(input.durationSeconds) || 120), 30, 210);
  const mode = String(input.mode || defaults.mode) === 'major' ? 'major' : 'minor';
  const keyNames = Object.keys(KEY_ROOTS);
  const keyName = KEY_ROOTS[input.key] != null ? input.key : keyNames[seed % keyNames.length];
  const rootMidi = KEY_ROOTS[keyName];
  const totalBeats = Math.max(16, Math.floor(durationSeconds * bpm / 60 / BEATS_PER_BAR) * BEATS_PER_BAR);
  const totalBars = Math.max(4, Math.floor(totalBeats / BEATS_PER_BAR));
  const creativeProfile = buildCreativeProfile(defaults, seed);
  const structure = structureForGenre(genre, totalBars, seed);
  const sections = allocateSections(structure, totalBars, bpm);
  const progression = creativeProfile.progression;
  const scale = mode === 'major' ? MAJOR : MINOR;
  const harmonic = buildHarmonicNotes({ sections, progression, scale, rootMidi, seed, creativeProfile });
  const singerProfile = normalizeSingerProfile(input.singerProfile);
  const guide = buildGuideNotes({ lyrics: input.lyrics, sections, scale, rootMidi, seed, genre, singerProfile, motif: creativeProfile.motif });
  const drums = buildDrumEvents({ sections, bpm, genre, groove: creativeProfile.groove, seed, density: creativeProfile.density });
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
    singerProfile,
    drumEvents: drums,
    seed,
    variationId: `v${seed.toString(16).padStart(8, '0')}`,
    creativeProfile,
    createdAt: Date.now(),
  });
}

export function renderSongCreation(plan, { sampleRate = SAMPLE_RATE } = {}) {
  if (!plan || plan.schema !== SONG_CREATION_SCHEMA) throw new TypeError('Plano musical inválido.');
  sampleRate = clamp(Math.round(Number(sampleRate) || SAMPLE_RATE), 22050, 32000);
  const targetFrames = Math.ceil(plan.durationSeconds * sampleRate);
  const instrumental = new Float32Array(targetFrames);
  const palette = plan.creativeProfile?.palette || { pad: 'soft_pad', bass: 'synth_bass', accent: 'warm_keys', guide: 'warm_keys' };
  addInstrumentLayer(instrumental, plan.padNotes, plan.bpm, palette.pad, sampleRate, 0.68);
  addInstrumentLayer(instrumental, plan.bassNotes, plan.bpm, palette.bass, sampleRate, 0.76);
  addInstrumentLayer(instrumental, plan.accentNotes, plan.bpm, palette.accent, sampleRate, 0.4);
  renderDrums(instrumental, plan.drumEvents, sampleRate, plan.bpm, plan.seed);
  masterInPlace(instrumental, 0.92);

  const guide = new Float32Array(targetFrames);
  addInstrumentLayer(guide, plan.guideNotes, plan.bpm, palette.guide, sampleRate, 0.84);
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
  const variation = plan.variationId ? ` · ${plan.variationId}` : '';
  return `${plan.genre.toUpperCase()} · ${plan.bpm} BPM · ${plan.key} ${mode}${variation} · ${labels}`;
}

function buildCreativeProfile(defaults, seed) {
  const rand = seededRandom(seed || 1);
  const progression = defaults.progressions[Math.floor(rand() * defaults.progressions.length)] || defaults.progressions[0];
  const groove = defaults.grooves[Math.floor(rand() * defaults.grooves.length)] || defaults.grooves[0];
  const palette = defaults.palettes[Math.floor(rand() * defaults.palettes.length)] || defaults.palettes[0];
  const voicings = ['close', 'open', 'seventh'];
  const bassPatterns = ['root-fifth', 'syncopated', 'octave-walk'];
  const accentPatterns = ['offbeat', 'answer', 'sparse', 'hook'];
  const motifs = ['rise', 'fall', 'wave', 'hook'];
  const density = 0.38 + rand() * 0.48;
  return Object.freeze({
    progression: Object.freeze([...progression]),
    groove,
    palette: Object.freeze({ ...palette }),
    voicing: voicings[Math.floor(rand() * voicings.length)],
    bassPattern: bassPatterns[Math.floor(rand() * bassPatterns.length)],
    accentPattern: accentPatterns[Math.floor(rand() * accentPatterns.length)],
    motif: motifs[Math.floor(rand() * motifs.length)],
    density: Number(density.toFixed(3)),
  });
}

function addInstrumentLayer(target, notes, bpm, preset, sampleRate, gain) {
  if (!notes.length) return;
  const rendered = renderInstrumentPcm({ preset, bpm, notes }, { sampleRate, channels: 1 });
  const source = rendered.channels[0];
  const count = Math.min(target.length, source.length);
  for (let index = 0; index < count; index += 1) target[index] += source[index] * gain;
}

function buildHarmonicNotes({ sections, progression, scale, rootMidi, seed, creativeProfile }) {
  const padNotes = [];
  const bassNotes = [];
  const accentNotes = [];
  let chordCursor = 0;
  for (const section of sections) {
    for (let bar = section.startBar; bar < section.endBar; bar += 1) {
      const degree = progression[chordCursor % progression.length];
      chordCursor += 1;
      const chord = chordForDegree(degree, scale, rootMidi + 12, creativeProfile.voicing, (bar + seed) % 3);
      const start = bar * BEATS_PER_BAR;
      const energy = sectionEnergy(section.id);
      for (const midi of chord) padNotes.push(note(midi, 70 + Math.round(energy * 20), start, BEATS_PER_BAR * (creativeProfile.voicing === 'open' ? 0.88 : 0.94)));
      const bassRoot = rootForDegree(degree, scale, rootMidi - 12);
      addBassPattern(bassNotes, bassRoot, start, bar, energy, creativeProfile.bassPattern, seed);
      addAccentPattern(accentNotes, chord, start, bar, energy, creativeProfile.accentPattern, seed);
    }
  }
  return { padNotes, bassNotes, accentNotes };
}

function addBassPattern(target, root, start, bar, energy, pattern, seed) {
  const velocity = 90 + Math.round(energy * 22);
  if (pattern === 'syncopated') {
    target.push(note(root, velocity, start, 0.9), note(root + 7, 78, start + 1.5, 0.55), note(root + ((bar + seed) % 2 ? 12 : 0), 84, start + 2.75, 0.7));
    return;
  }
  if (pattern === 'octave-walk') {
    target.push(note(root, velocity, start, 1.1), note(root + 12, 80, start + 1.75, 0.65), note(root + 7, 76, start + 3, 0.6));
    return;
  }
  target.push(note(root, velocity, start, 1.5));
  if (energy > 0.42) target.push(note(root + 7, 78, start + 2, 1.05));
}

function addAccentPattern(target, chord, start, bar, energy, pattern, seed) {
  if (energy < 0.44) return;
  const pick = (offset = 0) => chord[(bar + seed + offset) % chord.length] + 12;
  if (pattern === 'sparse') {
    if ((bar + seed) % 2 === 0) target.push(note(pick(), 72, start + 2.5, 0.34));
    return;
  }
  if (pattern === 'answer') {
    target.push(note(pick(), 74, start + 2.75, 0.26), note(pick(1), 68, start + 3.35, 0.22));
    return;
  }
  if (pattern === 'hook') {
    target.push(note(pick(), 78, start + 0.75, 0.24), note(pick(1), 74, start + 1.5, 0.24), note(pick(), 72, start + 3.25, 0.3));
    return;
  }
  target.push(note(pick(), 72, start + 1.5, 0.28), note(pick(1), 70, start + 3.5, 0.22));
}

function buildGuideNotes({ lyrics, sections, scale, rootMidi, seed, genre, singerProfile, motif }) {
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
      const contour = melodicDegree(index, n, seed, count, motif);
      const midi = rootMidi + 24 + scale[contour % 7] + lift + (contour >= 7 ? 12 : 0);
      const rhythmicNudge = ((seed >>> ((n % 4) * 4)) & 1) && n > 0 ? phraseStep * 0.08 : 0;
      const start = lineStart + n * phraseStep + rhythmicNudge;
      const duration = Math.max(0.18, phraseStep * (0.65 + ((seed + n) % 3) * 0.07));
      const singerMidi = clamp(midi, singerProfile.lowMidi, singerProfile.highMidi);
      notes.push(note(singerMidi, 86 + ((index + n + seed) % 20), start, duration));
      phraseNotes.push({ midi: singerMidi, startBeat: start, durationBeats: duration });
    }
    mapped.push(Object.freeze({ index, text: lines[index], startBeat: lineStart, endBeat: lineEnd, sectionId: section?.id || null, notes: phraseNotes }));
  }
  return { notes, lines: mapped };
}

function buildDrumEvents({ sections, genre, groove, seed, density }) {
  const events = [];
  for (const section of sections) {
    const energy = sectionEnergy(section.id);
    for (let bar = section.startBar; bar < section.endBar; bar += 1) {
      const start = bar * BEATS_PER_BAR;
      if (energy < 0.18) continue;
      if (groove === 'half') {
        events.push(drum('kick', start, 0.95), drum('snare', start + 2, 0.8));
        if ((bar + seed) % 2) events.push(drum('kick', start + 3.25, 0.62));
      } else if (groove === 'funk' || groove === 'funk_bounce') {
        const secondKick = groove === 'funk_bounce' ? 1.75 : 1.5;
        events.push(drum('kick', start, 0.98), drum('kick', start + secondKick, 0.72), drum('snare', start + 1, 0.82), drum('snare', start + 3, 0.88));
        if (groove === 'funk_bounce' && energy > 0.5) events.push(drum('kick', start + 2.5, 0.64));
      } else if (groove === 'rnb_sync') {
        events.push(drum('kick', start, 0.9), drum('kick', start + 1.75, 0.66), drum('snare', start + 1, 0.78), drum('snare', start + 3, 0.84));
        if ((bar + seed) % 3 === 0) events.push(drum('kick', start + 3.5, 0.58));
      } else if (groove === 'dance') {
        events.push(drum('kick', start, 0.9), drum('kick', start + 1, 0.86), drum('kick', start + 2, 0.9), drum('kick', start + 3, 0.86), drum('snare', start + 1, 0.62), drum('snare', start + 3, 0.68));
      } else {
        const offset = groove === 'pop_sync' && (bar + seed) % 2 ? 0.5 : 0;
        events.push(drum('kick', start, 0.95), drum('kick', start + 2 + offset, 0.72), drum('snare', start + 1, 0.82), drum('snare', start + 3, 0.86));
      }
      if (energy > 0.34) {
        const hatStep = density > 0.66 || genre === 'rnb' ? 0.5 : 1;
        for (let beat = 0; beat < BEATS_PER_BAR; beat += hatStep) {
          const skip = density < 0.52 && ((Math.round(beat * 2) + bar + seed) % 4 === 1);
          if (!skip) events.push(drum('hat', start + beat, 0.28 + energy * 0.22 + ((Math.round(beat * 2) + seed) % 3 === 0 ? 0.08 : 0)));
        }
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

function structureForGenre(genre, totalBars, seed = 0) {
  const standard = genre === 'rap'
    ? ['intro', 'verso_1', 'refrão', 'verso_2', 'refrão', 'ponte_rap', 'refrão_final', 'outro']
    : ['intro', 'verso_1', 'pre_refrão', 'refrão', 'verso_2', 'pre_refrão_2', 'refrão_2', 'ponte', 'refrão_final', 'outro'];
  const alternate = genre === 'rap'
    ? ['intro', 'refrão', 'verso_1', 'refrão', 'verso_2', 'ponte_rap', 'refrão_final', 'outro']
    : ['intro', 'refrão', 'verso_1', 'pre_refrão', 'refrão_2', 'verso_2', 'ponte', 'refrão_final', 'outro'];
  const full = seed % 4 === 3 ? alternate : standard;
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
function melodicDegree(lineIndex, noteIndex, seed, count, motif = 'wave') {
  const shapes = {
    rise: [0,1,2,4,5,6,4],
    fall: [5,4,3,2,1,0,2],
    wave: [0,2,4,3,2,1,0],
    hook: [0,2,3,5,3,2,3],
  };
  const shape = shapes[motif] || shapes.wave;
  const value = shape[(noteIndex + lineIndex + (seed % 3)) % Math.min(shape.length, count)] ?? 0;
  return value + (((lineIndex + seed) % 5 === 0 && noteIndex === count - 2) ? 2 : 0);
}
function chordForDegree(degree, scale, root, voicing = 'close', inversion = 0) {
  const index = ((degree - 1) % 7 + 7) % 7;
  const steps = voicing === 'seventh' ? [0,2,4,6] : [0,2,4];
  const notes = steps.map((step) => { const scaleIndex = index + step; return root + scale[scaleIndex % 7] + (scaleIndex >= 7 ? 12 : 0); });
  if (voicing === 'open' && notes.length >= 3) notes[1] += 12;
  for (let i = 0; i < inversion && i < notes.length - 1; i += 1) notes[i] += 12;
  return notes.sort((a, b) => a - b);
}
function rootForDegree(degree, scale, root) { const index = ((degree - 1) % 7 + 7) % 7; return root + scale[index]; }
function note(midi, velocity, start_beat, duration_beats) { return { midi: clamp(Math.round(midi), 0, 127), velocity: clamp(Math.round(velocity), 1, 127), start_beat: Math.max(0, start_beat), duration_beats: Math.max(0.05, duration_beats) }; }
function drum(kind, beat, velocity) { return { kind, beat, velocity: clamp(velocity, 0, 1) }; }
function normalizeGenre(value) { const text = String(value || '').toLowerCase(); if (/r&b|rnb/.test(text)) return 'rnb'; if (/funk/.test(text)) return 'funk'; if (/mpb|bossa/.test(text)) return 'mpb'; if (/rap|hip/.test(text)) return 'rap'; if (/dance|edm|eletr/.test(text)) return 'dance'; return 'pop'; }
function randomSeed() {
  try {
    const values = new Uint32Array(1);
    globalThis.crypto?.getRandomValues?.(values);
    if (values[0]) return values[0] >>> 0;
  } catch { /* deterministic regeneration still uses explicit seed */ }
  return ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1;
}
function seededRandom(seed) {
  let value = (seed >>> 0) || 1;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
