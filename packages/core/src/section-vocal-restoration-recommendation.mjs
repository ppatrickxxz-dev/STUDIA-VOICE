import { normalizeSectionKind, sectionLabel } from './section-map.mjs';
import {
  DEFAULT_CLEANUP,
  planSectionVocalCleanup,
  resolveSectionVocalCleanupTarget,
} from './section-vocal-cleanup.mjs';

export const PABLO_VOCAL_RESTORATION_RECOMMENDATION_SOURCE = 'pablo_section_vocal_restoration_recommendation';

export function parseSectionVocalRestorationRecommendationCommand(message = '') {
  const text = normalizeText(message);
  if (!text) return null;
  const asksRecommendation = /\b(vale a pena|vale|e seguro|eh seguro|seguro|recomenda|recomendacao|devo|acha que|posso)\b/.test(text);
  const mentionsRestoration = /\b(ruido|denoise|limpar o ruido|tirar o ruido|reduzir o ruido|reverb|reverberacao|de reverb|dereverb|eco|reflexo|restauracao|restaurar|limpeza da voz|limpar a voz)\b/.test(text);
  if (!asksRecommendation || !mentionsRestoration) return null;
  const sectionMatch = text.match(/\b(pre[- ]?refrao|refrao|verso|ponte|intro|rap|outro)\b/);
  const section = normalizeSectionKind(sectionMatch?.[1] || '');
  if (!section) return null;
  let scope = 'restoration';
  if (/\b(ruido|denoise|limpar o ruido|tirar o ruido|reduzir o ruido)\b/.test(text)) scope = 'denoise';
  if (/\b(reverb|reverberacao|de reverb|dereverb|eco|reflexo)\b/.test(text)) scope = 'dereverb';
  if (/\b(restauracao|restaurar|limpeza da voz|limpar a voz)\b/.test(text) && /\b(ruido|reverb|eco|reflexo)\b/.test(text)) scope = 'restoration';
  return {
    section,
    label: sectionLabel(section),
    occurrence: parseOccurrence(text),
    scope,
    blocked: false,
  };
}

export function resolveSectionVocalRestorationRecommendationTarget(project, command) {
  return resolveSectionVocalCleanupTarget(project, command);
}

export function planSectionVocalRestorationRecommendation(project, command, { analysis = null } = {}) {
  const target = resolveSectionVocalRestorationRecommendationTarget(project, command);
  if (!target.ok) return target;
  const restoration = analysis?.voice?.restoration;
  if (!restoration || !Array.isArray(restoration.windows)) {
    return { ...target, ok: false, reason: 'restoration_analysis_required' };
  }

  const cleanupCommand = {
    section: command.section,
    label: command.label,
    occurrence: command.occurrence,
    intensity: 'balanced',
    blocked: false,
  };
  const cleanup = planSectionVocalCleanup(target.project, cleanupCommand, { analysis });
  const modules = cleanup?.modules || {};
  const guard = explainGuard(restoration?.timbreGuard, restoration?.source);
  const windows = restoration.windows.filter((window) => overlaps(window, target.range));
  const noiseWindows = windows.map((window) => ({ window, evidence: window?.noise })).filter((item) => item.evidence);
  const reverbWindows = windows.map((window) => ({ window, evidence: window?.reverb })).filter((item) => item.evidence);
  const hum = qualifyingHum(analysis?.voice?.noiseEvents, target.range);

  const denoise = explainDenoise(noiseWindows, modules?.denoise, guard);
  const dereverb = explainDereverb(reverbWindows, modules?.dereverb, guard);
  const relevant = command.scope === 'denoise' ? [denoise] : command.scope === 'dereverb' ? [dereverb] : [denoise, dereverb];

  return {
    ...target,
    ok: true,
    source: PABLO_VOCAL_RESTORATION_RECOMMENDATION_SOURCE,
    readOnly: true,
    scope: command.scope,
    guard,
    denoise,
    dereverb,
    hum: {
      count: hum.length,
      frequenciesHz: [...new Set(hum.map((event) => Math.round(Number(event.frequencyHz))).filter(Number.isFinite))].sort((a, b) => a - b),
      strongestConfidence: roundHundredth(Math.max(0, ...hum.map((event) => Number(event.confidence) || 0))),
      note: hum.length ? 'diagnostic_only_no_automatic_notch' : 'none',
    },
    recommendation: relevant.some((item) => item.status === 'recommended')
      ? 'recommended'
      : relevant.some((item) => item.status === 'guard_blocked' || item.status === 'not_recommended')
        ? 'not_recommended'
        : 'not_needed',
  };
}

function explainGuard(guard, restorationSource) {
  const checks = {
    canonicalProfile: restorationSource === 'local-vocal-restoration-profile-v1',
    canonicalGuard: guard?.source === 'bounded-vocal-timbre-guard-v1',
    pitchPreserving: guard?.pitchPreserving === true,
    formantPreserving: guard?.formantPreserving === true,
    voicedMargin: Number(guard?.voicedMarginDb) >= DEFAULT_CLEANUP.minVoicedMarginDb,
    noiseReductionBounded: Number(guard?.maxNoiseReductionDb) > 0 && Number(guard?.maxNoiseReductionDb) <= DEFAULT_CLEANUP.maxNoiseReductionDb,
    dereverbBounded: Number(guard?.maxDereverbAmount) > 0 && Number(guard?.maxDereverbAmount) <= DEFAULT_CLEANUP.maxDereverbAmount,
  };
  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    voicedMarginDb: finiteOrNull(guard?.voicedMarginDb),
    maxNoiseReductionDb: finiteOrNull(guard?.maxNoiseReductionDb),
    maxDereverbAmount: finiteOrNull(guard?.maxDereverbAmount),
    source: String(guard?.source || 'unavailable'),
  };
}

function explainDenoise(items, module, guard) {
  const actionable = items.filter((item) => item.evidence?.actionable === true);
  const strongest = strongestBy(items, (item) => Number(item.evidence?.confidence) || 0);
  const evidence = strongest?.evidence || null;
  let status = 'not_needed';
  let reason = 'no_noise_window_in_section';
  if (items.length && !guard.ready) {
    status = 'guard_blocked';
    reason = 'timbre_guard_not_ready';
  } else if (module?.applied) {
    status = 'recommended';
    reason = 'canonical_cleanup_would_apply';
  } else if (items.length) {
    status = 'not_recommended';
    reason = actionable.length ? 'cleanup_declined_actionable_noise' : 'noise_evidence_below_canonical_gate';
  }
  return {
    status,
    reason,
    wouldApply: Boolean(module?.applied),
    evidenceCount: items.length,
    actionableEvidenceCount: actionable.length,
    confidence: roundHundredth(Number(evidence?.confidence) || 0),
    noiseFloorDb: finiteOrNull(evidence?.noiseFloorDb),
    voicedLevelDb: finiteOrNull(evidence?.voicedLevelDb),
    snrDb: finiteOrNull(evidence?.snrDb),
    thresholdDb: finiteOrNull(evidence?.thresholdDb),
    voicedMarginDb: finitePairDifference(evidence?.voicedLevelDb, evidence?.thresholdDb),
    suggestedReductionDb: finiteOrNull(evidence?.reductionDb),
    quietFrameCount: Math.max(0, Number(evidence?.quietFrameCount) || 0),
    voicedFrameCount: Math.max(0, Number(evidence?.voicedFrameCount) || 0),
  };
}

function explainDereverb(items, module, guard) {
  const actionable = items.filter((item) => item.evidence?.actionable === true);
  const strongest = strongestBy(items, (item) => Number(item.evidence?.confidence) || 0);
  const evidence = strongest?.evidence || null;
  let status = 'not_needed';
  let reason = 'no_reflection_window_in_section';
  if (items.length && !guard.ready) {
    status = 'guard_blocked';
    reason = 'timbre_guard_not_ready';
  } else if (module?.applied) {
    status = 'recommended';
    reason = 'canonical_cleanup_would_apply';
  } else if (items.length) {
    status = 'not_recommended';
    reason = actionable.length ? 'cleanup_declined_actionable_reflection' : (items.some((item) => item.evidence?.delayConsistent === false) ? 'reflection_delay_not_consistent' : 'reflection_evidence_below_canonical_gate');
  }
  return {
    status,
    reason,
    wouldApply: Boolean(module?.applied),
    evidenceCount: items.length,
    actionableEvidenceCount: actionable.length,
    confidence: roundHundredth(Number(evidence?.confidence) || 0),
    reflectionDelayMs: finiteOrNull(evidence?.reflectionDelayMs),
    correlation: finiteOrNull(evidence?.correlation),
    prominence: finiteOrNull(evidence?.prominence),
    suggestedAmount: finiteOrNull(evidence?.amount),
    delayConsistent: evidence?.delayConsistent === true,
  };
}

function qualifyingHum(events, range) {
  if (!Array.isArray(events)) return [];
  return events.filter((event) => event?.noiseKind === 'hum' && overlaps(event, range) && Number(event?.confidence) >= 0.68 && Number(event?.stationarity) >= 0.55);
}

function strongestBy(items, score) {
  return [...items].sort((a, b) => score(b) - score(a))[0] || null;
}

function overlaps(event, range) {
  const start = Number(event?.startSeconds ?? event?.start ?? event?.time);
  const end = Number(event?.endSeconds ?? event?.end ?? event?.time);
  const rangeStart = Number(range?.startSeconds);
  const rangeEnd = Number(range?.endSeconds);
  return [start, end, rangeStart, rangeEnd].every(Number.isFinite)
    && end > start
    && Math.min(end, rangeEnd) > Math.max(start, rangeStart);
}

function finiteOrNull(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function finitePairDifference(a, b) { return Number.isFinite(Number(a)) && Number.isFinite(Number(b)) ? Math.round((Number(a) - Number(b)) * 10) / 10 : null; }
function roundHundredth(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function parseOccurrence(text) {
  if (/\b(primeir[oa]|1[oa]?)\b/.test(text)) return 1;
  if (/\b(segund[oa]|2[oa]?)\b/.test(text)) return 2;
  if (/\b(terceir[oa]|3[oa]?)\b/.test(text)) return 3;
  return null;
}
function normalizeText(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[/_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
