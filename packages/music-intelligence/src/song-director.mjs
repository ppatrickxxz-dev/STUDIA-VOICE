export const PABLOVOICE_SONG_DIRECTOR_SCHEMA = 'pablovoice_song_director_v2';

const ARRANGEMENT_PALETTES = Object.freeze([
  Object.freeze({ id: 'silk_pulse', groove: 'syncopated pocket', harmony: 'extended R&B voicings', texture: 'silky pads, rhythmic plucks, rounded synth bass', contrast: 'strip verses, widen choruses' }),
  Object.freeze({ id: 'chrome_bounce', groove: 'tight swung pocket', harmony: 'minor seventh color with suspended turns', texture: 'glossy synths, dry drums, elastic bass', contrast: 'percussive pre-chorus, open hook' }),
  Object.freeze({ id: 'midnight_glow', groove: 'laid-back pocket with offbeat accents', harmony: 'warm modal color', texture: 'dark pads, sparse keys, sub bass, short synth motif', contrast: 'intimate verse, luminous chorus' }),
  Object.freeze({ id: 'y2k_motion', groove: '2000s R&B pocket with restrained funk motion', harmony: 'smooth diatonic extensions', texture: 'digital keys, synth bass, filtered layers, crisp percussion', contrast: 'lean verse, rising pre, stacked chorus' }),
  Object.freeze({ id: 'velvet_funk', groove: 'soft funk syncopation without four-on-the-floor', harmony: 'seventh and ninth chord movement', texture: 'muted synth stabs, warm bass, glassy lead accents', contrast: 'rhythmic verse, breathing pre, hook-forward chorus' }),
]);

const SECTION_ENERGY = Object.freeze({
  intro: 0.24,
  verse: 0.42,
  pre: 0.62,
  prechorus: 0.62,
  chorus: 0.88,
  post: 0.78,
  bridge: 0.52,
  breakdown: 0.34,
  outro: 0.30,
});

export function directSongCandidates(plan, {
  variation = 0.68,
  candidateCount = 3,
  recentFingerprints = [],
  locks = {},
  entropy = null,
} = {}) {
  validatePlan(plan);
  const amount = clamp(Number(variation) || 0, 0, 1);
  const count = clamp(Math.round(Number(candidateCount) || 3), 2, 5);
  const baseSeed = normalizeSeed(entropy ?? freshEntropy());
  const recent = new Set((Array.isArray(recentFingerprints) ? recentFingerprints : []).map(String));
  const candidates = [];

  for (let index = 0; index < count; index += 1) {
    let salt = index;
    let candidate;
    do {
      const seed = mixSeed(baseSeed, salt + 1, Number(plan.seed) || 1);
      candidate = buildCandidate(plan, { amount, seed, index, locks });
      salt += count;
    } while (recent.has(candidate.fingerprint) && salt < count * 12);
    candidates.push(candidate);
  }

  const ranked = candidates
    .map((candidate) => Object.freeze({ ...candidate, score: scoreCandidate(candidate, plan) }))
    .sort((a, b) => b.score.total - a.score.total || a.fingerprint.localeCompare(b.fingerprint));

  return Object.freeze({
    schema: PABLOVOICE_SONG_DIRECTOR_SCHEMA,
    variation: amount,
    locks: Object.freeze(normalizeLocks(locks)),
    selected: ranked[0],
    candidates: Object.freeze(ranked),
  });
}

export function applyDirectedCandidate(plan, candidate) {
  validatePlan(plan);
  if (!candidate || candidate.schema !== PABLOVOICE_SONG_DIRECTOR_SCHEMA) throw new TypeError('song_director_candidate_required');
  const direction = candidate.providerDirection;
  return Object.freeze({
    ...plan,
    brief: `${String(plan.brief || '').trim()}\n\nPabloVoice 2.0 Song DNA: ${direction}`.trim().slice(0, 1200),
    seed: candidate.seed,
    pabloVoice2: Object.freeze({
      schema: PABLOVOICE_SONG_DIRECTOR_SCHEMA,
      fingerprint: candidate.fingerprint,
      palette: candidate.palette,
      variation: candidate.variation,
      energyCurve: candidate.energyCurve,
      directorScore: candidate.score || null,
    }),
  });
}

export function fingerprintSongDirection(value = {}) {
  const text = stableStringify(value);
  return `pv2_${hashString(text).toString(16).padStart(8, '0')}`;
}

function buildCandidate(plan, { amount, seed, index, locks }) {
  const normalizedLocks = normalizeLocks(locks);
  const palette = ARRANGEMENT_PALETTES[(seed + index) % ARRANGEMENT_PALETTES.length];
  const sectionEnergy = buildEnergyCurve(plan.sections, amount, seed);
  const harmonicColor = normalizedLocks.harmony ? 'preserve current harmony' : palette.harmony;
  const groove = normalizedLocks.groove ? 'preserve current groove' : palette.groove;
  const texture = normalizedLocks.instrumentation ? 'preserve current instrumentation' : palette.texture;
  const motif = normalizedLocks.motif ? 'preserve established motif' : motifDirection(seed, amount);
  const variationMode = amount < 0.34 ? 'subtle' : amount < 0.72 ? 'balanced' : 'bold';
  const providerDirection = [
    `variation ${variationMode}`,
    `groove: ${groove}`,
    `harmony: ${harmonicColor}`,
    `arrangement: ${texture}`,
    `contrast: ${palette.contrast}`,
    `motif: ${motif}`,
    `energy: ${sectionEnergy.map((item) => `${item.section}:${item.energy.toFixed(2)}`).join(', ')}`,
    'make verse, pre-chorus, chorus and bridge audibly distinct while preserving song identity',
    'avoid loop-like repetition; create transitions, fills and evolving density between sections',
  ].join('; ');

  const fingerprint = fingerprintSongDirection({ palette: palette.id, sectionEnergy, groove, harmonicColor, texture, motif, seed });
  return Object.freeze({
    schema: PABLOVOICE_SONG_DIRECTOR_SCHEMA,
    index,
    seed,
    variation: amount,
    variationMode,
    palette: palette.id,
    groove,
    harmonicColor,
    texture,
    motif,
    energyCurve: Object.freeze(sectionEnergy),
    providerDirection,
    fingerprint,
  });
}

function buildEnergyCurve(sections, variation, seed) {
  return sections.map((section, index) => {
    const id = normalizeSectionId(section.id || section.kind || section.label || 'verse');
    const base = SECTION_ENERGY[id] ?? 0.48;
    const jitter = ((((seed >>> (index % 16)) & 7) - 3) / 100) * variation;
    let energy = clamp(base + jitter, 0.12, 0.96);
    if (id === 'chorus') energy = Math.max(0.78, energy);
    if (id === 'bridge') energy = Math.min(0.66, energy);
    return Object.freeze({ section: id, energy: Number(energy.toFixed(3)) });
  });
}

function scoreCandidate(candidate, plan) {
  const curve = candidate.energyCurve || [];
  const choruses = curve.filter((item) => item.section === 'chorus').map((item) => item.energy);
  const verses = curve.filter((item) => item.section === 'verse').map((item) => item.energy);
  const bridges = curve.filter((item) => item.section === 'bridge').map((item) => item.energy);
  const chorus = average(choruses, 0.8);
  const verse = average(verses, 0.45);
  const bridge = average(bridges, 0.52);
  const contrast = clamp((chorus - verse) / 0.5, 0, 1);
  const bridgeContrast = bridges.length ? clamp(Math.abs(chorus - bridge) / 0.45, 0, 1) : 0.7;
  const promptCoverage = Math.min(1, String(plan.brief || '').trim().length / 80 + 0.35);
  const evolution = candidate.providerDirection.includes('avoid loop-like repetition') ? 1 : 0;
  const total = Number((contrast * 32 + bridgeContrast * 18 + promptCoverage * 20 + evolution * 20 + 10).toFixed(2));
  return Object.freeze({
    total,
    sectionContrast: Number(contrast.toFixed(3)),
    bridgeContrast: Number(bridgeContrast.toFixed(3)),
    promptCoverage: Number(promptCoverage.toFixed(3)),
    evolution,
  });
}

function motifDirection(seed, variation) {
  const shapes = ['three-note rising answer after the hook', 'short descending synth answer between vocal phrases', 'syncopated two-plus-one note signature', 'restrained call-and-response motif that returns only at payoffs'];
  const shape = shapes[seed % shapes.length];
  return variation < 0.35 ? `subtle ${shape}` : shape;
}

function normalizeLocks(value = {}) {
  return {
    bpm: value.bpm === true,
    key: value.key === true,
    lyrics: value.lyrics === true,
    structure: value.structure === true,
    motif: value.motif === true,
    harmony: value.harmony === true,
    groove: value.groove === true,
    instrumentation: value.instrumentation === true,
  };
}

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.sections) || !plan.sections.length) throw new TypeError('song_plan_required');
}

function normalizeSectionId(value) {
  const text = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  if (text.includes('pre')) return 'pre';
  if (text.includes('chorus') || text.includes('refrao')) return 'chorus';
  if (text.includes('verse') || text.includes('verso')) return 'verse';
  if (text.includes('bridge') || text.includes('ponte')) return 'bridge';
  if (text.includes('post')) return 'post';
  if (text.includes('break')) return 'breakdown';
  if (text.includes('intro')) return 'intro';
  if (text.includes('outro')) return 'outro';
  return text || 'verse';
}

function freshEntropy() {
  const values = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(values);
  return Number(values[0] || Date.now()) >>> 0;
}

function normalizeSeed(value) {
  const number = Number(value);
  return (Number.isFinite(number) ? Math.abs(Math.floor(number)) : hashString(String(value))) >>> 0 || 1;
}

function mixSeed(a, b, c) {
  let value = (a ^ Math.imul(b, 0x9e3779b1) ^ Math.imul(c, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d); value ^= value >>> 15; value = Math.imul(value, 0x846ca68b); value ^= value >>> 16;
  return (value >>> 0) & 0x7fffffff || 1;
}

function average(values, fallback) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
