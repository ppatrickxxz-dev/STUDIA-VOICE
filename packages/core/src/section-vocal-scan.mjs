import { normalizeSectionKind, sectionLabel } from './section-map.mjs';
import {
  DEFAULT_CLEANUP,
  PABLO_SECTION_VOCAL_CLEANUP_SOURCES,
  planSectionVocalCleanup,
  resolveSectionVocalCleanupTarget,
} from './section-vocal-cleanup.mjs';

export const PABLO_SECTION_VOCAL_SCAN_SOURCE = 'pablo_section_vocal_scan';

export function parseSectionVocalScanCommand(message = '') {
  const text = normalizeText(message);
  if (!text || /\b(limpa|limpar|trata|tratar|desfaz|desfazer|remove|remover)\b/.test(text)) return null;
  const intent = /\b(analisa (?:a|minha) voz|analisar (?:a|minha) voz|escaneia (?:a|minha) voz|escanear (?:a|minha) voz|diagnostico (?:da|na) (?:minha )?voz|faz um diagnostico (?:da|na) (?:minha )?voz|o que (?:tem|esta) (?:de errado|ruim) (?:na|da) minha voz|quais problemas (?:tem|existem) (?:na|da) minha voz|ouve minha voz e diz o que tem)\b/.test(text);
  if (!intent) return null;
  const sectionMatch = text.match(/\b(pre[- ]?refrao|refrao|verso|ponte|intro|rap|outro)\b/);
  const section = normalizeSectionKind(sectionMatch?.[1] || '');
  if (!section) return null;
  return {
    section,
    label: sectionLabel(section),
    occurrence: parseOccurrence(text),
    blocked: false,
  };
}

export function resolveSectionVocalScanTarget(project, command) {
  return resolveSectionVocalCleanupTarget(project, command);
}

export function planSectionVocalScan(project, command, { analysis = null } = {}) {
  const target = resolveSectionVocalScanTarget(project, command);
  if (!target.ok) return target;
  if (!analysis?.voice) return { ...target, ok: false, reason: 'scan_analysis_required' };

  const cleanupCommand = {
    section: command.section,
    label: command.label,
    occurrence: command.occurrence,
    intensity: 'balanced',
    blocked: false,
  };
  const cleanup = planSectionVocalCleanup(target.project, cleanupCommand, { analysis });
  const cleanupEvents = Array.isArray(cleanup?.events) ? cleanup.events : [];
  const modules = cleanup?.modules || emptyModules();
  const findings = [];

  for (const event of cleanupEvents) {
    const type = typeForCleanupSource(event?.source);
    if (!type || type === 'peak') continue;
    findings.push(buildFinding(type, event, target, { autoEdit: true }));
  }

  const peakEvidence = qualifyingPeakEvents(analysis.voice.peakEvents, target.range);
  const dynamicsAutoEdit = Boolean(modules?.dynamics?.applied);
  for (const event of peakEvidence) {
    findings.push(buildFinding('peak', {
      startSeconds: Number(event.start ?? event.time),
      endSeconds: Number(event.end ?? event.time),
      confidence: Number(event.confidence) || 0,
      intensity: Number(event.intensity) || 0,
      peak: Number(event.peak),
      transientRise: Number(event.transientRise),
    }, target, { autoEdit: dynamicsAutoEdit }));
  }

  findings.sort((a, b) => a.timelineStartSeconds - b.timelineStartSeconds || a.type.localeCompare(b.type));
  const observed = observedCounts(analysis.voice, target.range);
  const actionableCount = findings.filter((finding) => finding.autoEdit).length;
  const reviewCount = findings.length - actionableCount;

  return {
    ...target,
    ok: true,
    source: PABLO_SECTION_VOCAL_SCAN_SOURCE,
    readOnly: true,
    findings,
    modules,
    observed,
    actionableCount,
    reviewCount,
    clean: findings.length === 0,
    analysisSource: String(analysis.voice.eventDetection?.source || 'unknown'),
  };
}

function buildFinding(type, event, target, { autoEdit = true } = {}) {
  const start = Number(event?.startSeconds ?? event?.start ?? event?.time);
  const end = Number(event?.endSeconds ?? event?.end ?? event?.time);
  const confidence = clamp01(event?.confidence);
  const timelineStartSeconds = sourceToTimeline(start, target);
  const timelineEndSeconds = sourceToTimeline(end, target);
  const finding = {
    type,
    label: findingLabel(type),
    startSeconds: roundMillis(start),
    endSeconds: roundMillis(end),
    timelineStartSeconds: roundMillis(timelineStartSeconds),
    timelineEndSeconds: roundMillis(timelineEndSeconds),
    relativeSeconds: roundMillis(Math.max(0, timelineStartSeconds - Number(target.section.startSeconds || 0))),
    confidence: roundHundredth(confidence),
    autoEdit: Boolean(autoEdit),
  };
  if (Number.isFinite(Number(event?.intensity))) finding.intensity = roundHundredth(clamp01(event.intensity));
  if (Number.isFinite(Number(event?.frequencyHz))) finding.frequencyHz = Math.round(Number(event.frequencyHz));
  if (Number.isFinite(Number(event?.gainDb))) finding.suggestedGainDb = roundTenth(Number(event.gainDb));
  if (Number.isFinite(Number(event?.peak))) finding.peak = roundHundredth(Number(event.peak));
  if (Number.isFinite(Number(event?.transientRise))) finding.transientRise = roundHundredth(Number(event.transientRise));
  if (Number.isFinite(Number(event?.noiseFloorDb))) finding.noiseFloorDb = roundTenth(Number(event.noiseFloorDb));
  if (Number.isFinite(Number(event?.snrDb))) finding.snrDb = roundTenth(Number(event.snrDb));
  if (Number.isFinite(Number(event?.reductionDb))) finding.reductionDb = roundTenth(Number(event.reductionDb));
  if (Number.isFinite(Number(event?.reflectionDelayMs))) finding.reflectionDelayMs = roundTenth(Number(event.reflectionDelayMs));
  if (Number.isFinite(Number(event?.correlation))) finding.correlation = roundHundredth(Number(event.correlation));
  if (Number.isFinite(Number(event?.amount))) finding.dereverbAmount = roundHundredth(Number(event.amount));
  if (event?.timbreProtected === true) finding.timbreProtected = true;
  return finding;
}

function typeForCleanupSource(source) {
  if (source === PABLO_SECTION_VOCAL_CLEANUP_SOURCES.BREATH) return 'breath';
  if (source === PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DEESSER) return 'sibilance';
  if (source === PABLO_SECTION_VOCAL_CLEANUP_SOURCES.PLOSIVE) return 'plosive';
  if (source === PABLO_SECTION_VOCAL_CLEANUP_SOURCES.CLICK) return 'click';
  if (source === PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DYNAMICS) return 'peak';
  if (source === PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DENOISE) return 'noise';
  if (source === PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DEREVERB) return 'reverb';
  return null;
}

function findingLabel(type) {
  if (type === 'breath') return 'Respiração forte';
  if (type === 'sibilance') return 'Sibilância';
  if (type === 'plosive') return 'Estouro de P/B';
  if (type === 'click') return 'Estalo curto';
  if (type === 'peak') return 'Pico de dinâmica';
  if (type === 'noise') return 'Ruído de fundo';
  if (type === 'reverb') return 'Reflexo do ambiente';
  return 'Evidência vocal';
}

function observedCounts(voice, range) {
  return {
    breaths: countOverlap(voice?.breathEvents, range),
    sibilance: countOverlap(voice?.sibilanceEvents, range),
    plosives: countOverlap(voice?.plosiveEvents, range),
    clicks: countOverlap(voice?.clickEvents, range),
    peaks: countOverlap(voice?.peakEvents, range),
    noiseWindows: countRestorationWindows(voice?.restoration?.windows, range, 'noise'),
    reverbWindows: countRestorationWindows(voice?.restoration?.windows, range, 'reverb'),
  };
}

function countRestorationWindows(windows, range, family) {
  if (!Array.isArray(windows)) return 0;
  return windows.filter((window) => overlapsRange(window, range) && window?.[family]?.actionable === true).length;
}

function countOverlap(events, range) {
  if (!Array.isArray(events)) return 0;
  return events.filter((event) => overlapsRange(event, range)).length;
}

function qualifyingPeakEvents(events, range) {
  if (!Array.isArray(events)) return [];
  return events.filter((event) => {
    if (!overlapsRange(event, range)) return false;
    const confidence = clamp01(event?.confidence);
    const intensity = clamp01(event?.intensity);
    return confidence >= DEFAULT_CLEANUP.peakConfidenceThreshold
      && intensity >= DEFAULT_CLEANUP.peakIntensityThreshold;
  });
}

function overlapsRange(event, range) {
  const start = Number(event?.startSeconds ?? event?.start ?? event?.time);
  const end = Number(event?.endSeconds ?? event?.end ?? event?.time);
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    && Math.min(end, range.endSeconds) > Math.max(start, range.startSeconds);
}

function sourceToTimeline(sourceSeconds, target) {
  const sourceStart = Number(target.range.startSeconds);
  const sourceEnd = Number(target.range.endSeconds);
  const timelineStart = Number(target.section.startSeconds);
  const timelineEnd = Number(target.section.endSeconds);
  if (![sourceSeconds, sourceStart, sourceEnd, timelineStart, timelineEnd].every(Number.isFinite)) return sourceSeconds;
  const sourceSpan = sourceEnd - sourceStart;
  const timelineSpan = timelineEnd - timelineStart;
  if (!(sourceSpan > 0) || !(timelineSpan > 0)) return timelineStart;
  const ratio = clamp01((sourceSeconds - sourceStart) / sourceSpan);
  return timelineStart + ratio * timelineSpan;
}

function emptyModules() {
  return {
    breath: { applied: false, count: 0 },
    deesser: { applied: false, count: 0 },
    plosive: { applied: false, count: 0 },
    click: { applied: false, count: 0 },
    dynamics: { applied: false, count: 0, evidenceCount: 0 },
    denoise: { applied: false, count: 0, evidenceCount: 0 },
    dereverb: { applied: false, count: 0, evidenceCount: 0 },
  };
}

function parseOccurrence(text) {
  if (/\b(primeir[oa]|1[oa]?)\b/.test(text)) return 1;
  if (/\b(segund[oa]|2[oa]?)\b/.test(text)) return 2;
  if (/\b(terceir[oa]|3[oa]?)\b/.test(text)) return 3;
  return null;
}
function normalizeText(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[/_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function roundMillis(value) { return Math.round(Number(value) * 1000) / 1000; }
function roundHundredth(value) { return Math.round(Number(value) * 100) / 100; }
function roundTenth(value) { return Math.round(Number(value) * 10) / 10; }
function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
