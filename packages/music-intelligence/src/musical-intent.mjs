export const MUSICAL_INTENT_SCHEMA = 'pmi_musical_intent_v1';

const SECTION_PATTERNS = Object.freeze([
  ['chorus', /\b(refr[aã]o|chorus|hook)\b/i],
  ['pre_chorus', /\b(pr[eé][ -]?refr[aã]o|pre[ -]?chorus)\b/i],
  ['verse', /\b(verso|estrofe|verse)\b/i],
  ['bridge', /\b(ponte|bridge)\b/i],
  ['post_chorus', /\b(p[oó]s[ -]?refr[aã]o|post[ -]?chorus)\b/i],
  ['intro', /\b(intro|introdu[cç][aã]o)\b/i],
  ['outro', /\b(outro|final)\b/i],
]);

const TARGET_PATTERNS = Object.freeze([
  ['drums', /\b(bateria|beat|kick|caixa|snare|hat|chimbal|percuss[aã]o)\b/i],
  ['bass', /\b(baixo|bass)\b/i],
  ['synth', /\b(synth|sintetizador|pad|pluck)\b/i],
  ['piano', /\b(piano|teclas|keys)\b/i],
  ['guitar', /\b(guitarra|viol[aã]o|guitar)\b/i],
  ['arrangement', /\b(arranjo|instrumental|m[uú]sica|faixa|track)\b/i],
  ['mix', /\b(mix|mixagem|som|master)\b/i],
]);

export function interpretMusicalIntent(message = '', context = {}) {
  const source = String(message || '').trim();
  const text = normalize(source);
  if (!text) return Object.freeze({ supported: false, reason: 'empty_message' });

  const deltas = {};
  const stylePositive = [];
  const styleNegative = [];
  const eraHints = [];
  const evidence = [];

  if (has(text, ['mais sensual', 'mais gostoso', 'mais envolvente'])) {
    addDelta(deltas, 'warmth', 0.24);
    addDelta(deltas, 'syncopation', 0.14);
    addDelta(deltas, 'density', -0.08);
    addDelta(deltas, 'transientSharpness', -0.10);
    add(stylePositive, 'sensual, smooth, controlled groove');
    evidence.push('sensuality');
  }

  if (has(text, ['mais 2000', 'anos 2000', 'y2k', '2000s'])) {
    add(eraHints, '2000s');
    add(stylePositive, '2000s / Y2K production character');
    evidence.push('era_2000s');
  }

  if (has(text, ['menos batestaca', 'sem batestaca', 'nao batestaca'])) {
    addDelta(deltas, 'density', -0.20);
    addDelta(deltas, 'transientSharpness', -0.22);
    addDelta(deltas, 'syncopation', 0.10);
    add(styleNegative, 'batestaca');
    evidence.push('avoid_batestaca');
  }

  if (/\bmais\s+(r&b|rnb)\b/i.test(source)) {
    add(stylePositive, 'R&B');
    addDelta(deltas, 'syncopation', 0.14);
    addDelta(deltas, 'warmth', 0.10);
    evidence.push('more_rnb');
  }
  if (/\bmenos\s+pop\b/i.test(source)) {
    add(styleNegative, 'generic pop');
    evidence.push('less_pop');
  }

  if (/\bbaixo\b.*\b(quadrado|reto|duro)\b|\b(quadrado|reto|duro)\b.*\bbaixo\b/i.test(source)) {
    addDelta(deltas, 'syncopation', 0.26);
    addDelta(deltas, 'humanize', 0.16);
    addDelta(deltas, 'noteVariation', 0.12);
    evidence.push('bass_too_square');
  }

  if (/\b(abre|abrir|maior|cresce|crescer)\b.*\b(refr[aã]o|chorus|hook)\b/i.test(source)) {
    addDelta(deltas, 'energy', 0.20);
    addDelta(deltas, 'width', 0.20);
    addDelta(deltas, 'density', 0.06);
    evidence.push('open_chorus');
  }

  if (/\b(sem|menos)\s+(?:ficar\s+|deixar\s+)?(barulho|barulhento|embolado|cheio demais)\b/i.test(source)) {
    addDelta(deltas, 'density', -0.14);
    addDelta(deltas, 'clarity', 0.16);
    add(styleNegative, 'overcrowded arrangement');
    evidence.push('avoid_overcrowding');
  }

  if (/\bmais\s+(vivo|viva|solto|solta|humano|humana)\b/i.test(source)) {
    addDelta(deltas, 'humanize', 0.18);
    addDelta(deltas, 'noteVariation', 0.10);
    evidence.push('more_human');
  }

  if (/\bmenos\s+(reta|reto|quadrada|quadrado)\b/i.test(source)) {
    addDelta(deltas, 'humanize', 0.16);
    addDelta(deltas, 'syncopation', 0.14);
    evidence.push('less_straight');
  }

  const target = inferTarget(source);
  const section = inferSection(source);
  const preserveAllElse = /\b(mant[eé]m|mantem|preserva|n[aã]o mexe|sem mexer)\b.*\b(tudo|resto|restante)\b/i.test(source)
    || /\b(s[oó]|somente|apenas)\b.*\b(troca|muda|altera|refaz)\b/i.test(source);
  const versionReference = /\b(primeiro|primeira|anterior|vers[aã]o anterior|take anterior)\b.*\b(melhor|prefiro|gostei mais)\b/i.test(source)
    ? 'prefer_previous'
    : null;

  const supported = evidence.length > 0 || target != null || section != null || preserveAllElse || versionReference != null;
  if (!supported) return Object.freeze({ supported: false, reason: 'no_musical_intent' });

  return Object.freeze({
    supported: true,
    schema: MUSICAL_INTENT_SCHEMA,
    source: source.slice(0, 1200),
    scope: Object.freeze({
      section,
      target,
      preserveUnselected: preserveAllElse || Boolean(section) || Boolean(target),
    }),
    deltas: Object.freeze(normalizeDeltas(deltas)),
    style: Object.freeze({
      positive: Object.freeze(unique(stylePositive)),
      negative: Object.freeze(unique(styleNegative)),
      eraHints: Object.freeze(unique(eraHints)),
    }),
    versionReference,
    evidence: Object.freeze(unique(evidence)),
    context: Object.freeze({
      projectId: String(context.projectId || '') || null,
      trackId: String(context.trackId || '') || null,
    }),
  });
}

function inferSection(text) {
  for (const [section, pattern] of SECTION_PATTERNS) if (pattern.test(text)) return section;
  return null;
}

function inferTarget(text) {
  for (const [target, pattern] of TARGET_PATTERNS) if (pattern.test(text)) return target;
  return null;
}

function addDelta(target, key, value) {
  target[key] = clamp((Number(target[key]) || 0) + value, -1, 1);
}

function normalizeDeltas(deltas) {
  return Object.fromEntries(Object.entries(deltas).map(([key, value]) => [key, Math.round(clamp(value, -1, 1) * 1000) / 1000]));
}

function has(text, phrases) {
  return phrases.some((phrase) => text.includes(normalize(phrase)));
}

function add(target, value) {
  if (value && !target.includes(value)) target.push(value);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}
