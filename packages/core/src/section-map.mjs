export const ARRANGEMENT_MAP_SCHEMA = 'pablovoice_arrangement_map_v1';

const SECTION_ALIASES = Object.freeze({
  intro: 'intro',
  introducao: 'intro',
  verso: 'verse',
  verse: 'verse',
  pre: 'pre_chorus',
  'pre-refrao': 'pre_chorus',
  'pre refrao': 'pre_chorus',
  prerefrao: 'pre_chorus',
  prechorus: 'pre_chorus',
  refrao: 'chorus',
  chorus: 'chorus',
  ponte: 'bridge',
  bridge: 'bridge',
  rap: 'rap',
  outro: 'outro',
  final: 'outro',
});

const SECTION_LABELS = Object.freeze({
  intro: 'Intro',
  verse: 'Verso',
  pre_chorus: 'Pré-refrão',
  chorus: 'Refrão',
  bridge: 'Ponte',
  rap: 'Rap',
  outro: 'Outro',
});

export function createArrangementMap() {
  return {
    schema: ARRANGEMENT_MAP_SCHEMA,
    sections: [],
    updatedAt: Date.now(),
  };
}

export function normalizeArrangementMap(input = {}) {
  const sections = Array.isArray(input?.sections)
    ? input.sections.map(normalizeArrangementSection).filter(Boolean).slice(0, 96)
    : [];
  sections.sort((a, b) => a.startSeconds - b.startSeconds || a.kind.localeCompare(b.kind));
  return {
    schema: ARRANGEMENT_MAP_SCHEMA,
    sections,
    updatedAt: finite(input?.updatedAt, Date.now()),
  };
}

export function normalizeArrangementSection(input = {}) {
  const kind = normalizeSectionKind(input?.kind || input?.label);
  const startSeconds = finite(input?.startSeconds ?? input?.start, NaN);
  if (!kind || !Number.isFinite(startSeconds) || startSeconds < 0) return null;
  const rawEnd = finite(input?.endSeconds ?? input?.end, NaN);
  const endSeconds = Number.isFinite(rawEnd) && rawEnd > startSeconds ? rawEnd : null;
  const source = String(input?.source || 'manual').slice(0, 64);
  const timingStatus = input?.timingStatus === 'confirmed' ? 'confirmed' : 'unconfirmed';
  const confidence = timingStatus === 'confirmed' ? clamp(finite(input?.confidence, 1), 0, 1) : clamp(finite(input?.confidence, 0), 0, 1);
  return {
    id: String(input?.id || sectionId(kind, startSeconds)).slice(0, 120),
    kind,
    label: String(input?.label || sectionLabel(kind)).slice(0, 64),
    startSeconds: roundMillis(startSeconds),
    endSeconds: endSeconds == null ? null : roundMillis(endSeconds),
    source,
    timingStatus,
    confidence,
  };
}

export function upsertConfirmedSection(map, {
  kind,
  startSeconds,
  endSeconds = null,
  source = 'user_manual',
  confidence = 1,
} = {}) {
  const normalizedKind = normalizeSectionKind(kind);
  const start = finite(startSeconds, NaN);
  const end = endSeconds == null ? null : finite(endSeconds, NaN);
  if (!normalizedKind) throw new TypeError('Seção musical inválida.');
  if (!Number.isFinite(start) || start < 0) throw new TypeError('Tempo inicial da seção inválido.');
  if (end != null && (!Number.isFinite(end) || end <= start)) throw new TypeError('Tempo final da seção inválido.');

  const clean = normalizeArrangementMap(map);
  const section = normalizeArrangementSection({
    kind: normalizedKind,
    startSeconds: start,
    endSeconds: end,
    source,
    timingStatus: 'confirmed',
    confidence,
  });
  const duplicateIndex = clean.sections.findIndex((item) => item.kind === normalizedKind && Math.abs(item.startSeconds - section.startSeconds) <= 0.25);
  if (duplicateIndex >= 0) clean.sections[duplicateIndex] = section;
  else clean.sections.push(section);
  clean.sections.sort((a, b) => a.startSeconds - b.startSeconds || a.kind.localeCompare(b.kind));
  clean.updatedAt = Date.now();
  return clean;
}

export function findConfirmedSection(map, kind, { occurrence = 1 } = {}) {
  const normalizedKind = normalizeSectionKind(kind);
  if (!normalizedKind) return null;
  const matches = normalizeArrangementMap(map).sections.filter((section) =>
    section.kind === normalizedKind
    && section.timingStatus === 'confirmed'
    && Number.isFinite(section.startSeconds)
    && section.confidence >= 0.8);
  const index = Math.max(0, Math.floor(Number(occurrence) || 1) - 1);
  return matches[index] || null;
}

export function normalizeSectionKind(value = '') {
  const key = normalizeText(value).replace(/^pre[- ]?refrao$/, 'pre-refrao');
  return SECTION_ALIASES[key] || null;
}

export function sectionLabel(kind = '') {
  return SECTION_LABELS[normalizeSectionKind(kind) || kind] || 'Seção';
}

export function parseClockSeconds(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  const clock = text.match(/^(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (clock) {
    const minutes = Number(clock[1]);
    const seconds = Number(clock[2]);
    const millis = Number(`0.${clock[3] || 0}`);
    if (seconds >= 60) return null;
    return roundMillis(minutes * 60 + seconds + millis);
  }
  const number = Number(text.replace(',', '.'));
  return Number.isFinite(number) && number >= 0 ? roundMillis(number) : null;
}

function sectionId(kind, startSeconds) {
  return `section_${kind}_${Math.round(startSeconds * 1000)}`;
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roundMillis(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
