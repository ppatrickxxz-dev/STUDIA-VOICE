import { createSongCreationPlan } from './song-creation-engine.mjs';

const BEATS_PER_BAR = 4;
const HEADER = /^\s*\[([^\]]+)\]\s*$/;
const BAR_HINT = /(\d+)\s*(?:bars?|compassos?)/i;

export function createProfessionalSongPlan(input = {}) {
  const base = createSongCreationPlan(input);
  const parsed = parseStructuredLyrics(input.lyrics);
  if (parsed.sections.length < 2) {
    return Object.freeze({
      ...base,
      professionalBlueprint: Object.freeze({
        schema: 'pablovoice_song_blueprint_v2',
        source: 'inferred',
        authoredStructure: false,
        sectionCount: base.sections.length,
      }),
    });
  }

  const targetBars = Math.max(4, Math.round(Number(base.totalBars) || 4));
  const sectionBars = resolveSectionBars(parsed.sections, targetBars);
  let cursorBar = 0;
  const sections = parsed.sections.map((source, index) => {
    const bars = sectionBars[index];
    const startBar = cursorBar;
    const endBar = startBar + bars;
    cursorBar = endBar;
    const id = semanticSectionId(source.header, index);
    return Object.freeze({
      id,
      label: cleanHeaderLabel(source.header),
      authoredHeader: source.header,
      directive: sectionDirective(source.header),
      startBar,
      endBar,
      bars,
      startBeat: startBar * BEATS_PER_BAR,
      endBeat: endBar * BEATS_PER_BAR,
      startSeconds: startBar * BEATS_PER_BAR * 60 / base.bpm,
      endSeconds: endBar * BEATS_PER_BAR * 60 / base.bpm,
    });
  });

  const guideLines = buildGuideLines(parsed.sections, sections);
  const durationSeconds = cursorBar * BEATS_PER_BAR * 60 / base.bpm;
  return Object.freeze({
    ...base,
    durationSeconds,
    totalBars: cursorBar,
    totalBeats: cursorBar * BEATS_PER_BAR,
    sections,
    guideLines,
    authoredLyrics: String(input.lyrics || '').trim().slice(0, 16000),
    professionalBlueprint: Object.freeze({
      schema: 'pablovoice_song_blueprint_v2',
      source: 'authored_lyrics',
      authoredStructure: true,
      sectionCount: sections.length,
      declaredBars: parsed.sections.map((section) => section.declaredBars),
      exactDeclaredBars: parsed.sections.every((section) => Number.isFinite(section.declaredBars)),
    }),
  });
}

export function parseStructuredLyrics(lyrics = '') {
  const sections = [];
  let current = null;
  for (const raw of String(lyrics || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const match = line.match(HEADER);
    if (match) {
      current = {
        header: match[1].trim(),
        declaredBars: Number(match[1].match(BAR_HINT)?.[1]) || null,
        lines: [],
      };
      sections.push(current);
      continue;
    }
    if (!line) continue;
    if (!current) {
      current = { header: 'Verse', declaredBars: null, lines: [] };
      sections.push(current);
    }
    current.lines.push(line);
  }
  return Object.freeze({ sections: sections.map((section) => Object.freeze({ ...section, lines: Object.freeze([...section.lines]) })) });
}

function resolveSectionBars(sections, targetBars) {
  const allDeclared = sections.every((section) => Number.isFinite(section.declaredBars) && section.declaredBars > 0);
  if (allDeclared) return sections.map((section) => Math.max(1, Math.round(section.declaredBars)));

  const fixed = sections.map((section) => Number.isFinite(section.declaredBars) && section.declaredBars > 0 ? Math.max(1, Math.round(section.declaredBars)) : null);
  const fixedTotal = fixed.reduce((sum, bars) => sum + (bars || 0), 0);
  const flexible = fixed.map((bars, index) => bars == null ? index : -1).filter((index) => index >= 0);
  const remaining = Math.max(flexible.length, targetBars - fixedTotal);
  const weights = flexible.map((index) => defaultBars(sections[index].header));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0) || flexible.length;
  const result = [...fixed];
  let assigned = 0;
  flexible.forEach((index, position) => {
    const last = position === flexible.length - 1;
    const bars = last ? Math.max(1, remaining - assigned) : Math.max(1, Math.round(remaining * weights[position] / weightTotal));
    result[index] = bars;
    assigned += bars;
  });
  return result.map((bars) => Math.max(1, Number(bars) || 1));
}

function defaultBars(header = '') {
  const kind = normalize(header);
  if (kind.includes('intro')) return 4;
  if (kind.includes('outro')) return 4;
  if (kind.includes('pre')) return 4;
  if (kind.includes('post') || kind.includes('pos')) return 4;
  if (kind.includes('break') || kind.includes('cut') || kind.includes('pickup')) return 2;
  if (kind.includes('bridge') || kind.includes('ponte') || kind.includes('rap')) return 8;
  if (kind.includes('chorus') || kind.includes('refr')) return 8;
  if (kind.includes('instrumental')) return 4;
  return 8;
}

function buildGuideLines(authored, sections) {
  const mapped = [];
  let index = 0;
  authored.forEach((source, sectionIndex) => {
    const target = sections[sectionIndex];
    if (!target || !source.lines.length) return;
    const span = Math.max(1, target.endBeat - target.startBeat);
    const slot = span / source.lines.length;
    source.lines.forEach((text, lineIndex) => {
      const startBeat = target.startBeat + lineIndex * slot;
      const endBeat = Math.min(target.endBeat, startBeat + slot * 0.9);
      mapped.push(Object.freeze({
        index: index++,
        text,
        sectionId: target.id,
        startBeat,
        endBeat,
        notes: [],
      }));
    });
  });
  return Object.freeze(mapped);
}

function semanticSectionId(header = '', index = 0) {
  const value = normalize(header);
  const number = Number(value.match(/\b(\d+)\b/)?.[1]) || index + 1;
  if (value.includes('intro')) return 'intro';
  if (value.includes('outro')) return 'outro';
  if (value.includes('beat cut') || value.includes('pickup') || value.includes('break')) return `break_${number}`;
  if (value.includes('instrumental')) return `instrumental_${number}`;
  if (value.includes('post') || value.includes('pos')) return `pos_refr_${number}`;
  if (value.includes('pre')) return `pre_refr_${number}`;
  if (value.includes('chorus') || value.includes('refr')) return `refr_${number}`;
  if (value.includes('bridge') || value.includes('ponte') || value.includes('rap')) return `ponte_rap_${number}`;
  return `verso_${number}`;
}

function sectionDirective(header = '') {
  const raw = String(header || '').trim();
  const value = normalize(raw);
  const descriptors = raw.split(/[-—,]/).slice(1).join(',').replace(BAR_HINT, '').trim();
  if (descriptors) return descriptors.slice(0, 180);
  if (value.includes('intro')) return 'estabelecer atmosfera e identidade; sem antecipar toda a energia';
  if (value.includes('pre')) return 'aumentar tensão e preparar a entrada do refrão';
  if (value.includes('chorus') || value.includes('refr')) return 'abrir a música, hook memorável e contraste real com o verso';
  if (value.includes('post') || value.includes('pos')) return 'turn instrumental e ad-libs contidos';
  if (value.includes('bridge') || value.includes('ponte') || value.includes('rap')) return 'contraste de fraseado e textura sem perder a identidade da música';
  if (value.includes('break') || value.includes('cut')) return 'quebra clara, espaço e pickup para a próxima seção';
  if (value.includes('outro')) return 'reduzir energia e concluir sem cortar cedo';
  if (value.includes('instrumental')) return 'movimento instrumental com desenvolvimento, não loop mecânico';
  return 'verso com espaço para a letra e evolução de arranjo';
}

function cleanHeaderLabel(header = '') {
  return String(header || '').replace(BAR_HINT, '').replace(/[-—,]+\s*$/, '').replace(/\s{2,}/g, ' ').trim().slice(0, 80) || 'Seção';
}

function normalize(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_]+/g, ' ');
}

export const PROFESSIONAL_SONG_PLAN = Object.freeze({
  schema: 'pablovoice_song_blueprint_v2',
  authoredStructureWins: true,
  preservesDeclaredBars: true,
  preservesSectionOrder: true,
  fallback: 'legacy_inference_only_without_structured_lyrics',
});
