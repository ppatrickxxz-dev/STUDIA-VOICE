import { normalizeSectionKind, sectionLabel } from './section-map.mjs';
import {
  PABLO_SECTION_VOCAL_CLEANUP_SOURCES,
  planSectionVocalCleanup,
  resolveSectionVocalCleanupTarget,
} from './section-vocal-cleanup.mjs';

export const SELECTIVE_VOCAL_RESTORATION_MODES = Object.freeze({
  DENOISE: 'denoise',
  DEREVERB: 'dereverb',
});

export function parseSelectiveVocalRestorationCommand(message = '') {
  const text = normalizeText(message);
  if (!text || /\b(vale a pena|recomenda|recomendacao|e seguro|eh seguro|acha que|devo|desfaz|desfazer|volta|voltar)\b/.test(text)) return null;
  const denoiseIntent = /\b(aplica|aplicar|faz|fazer|usa|usar|reduz|reduzir|tira|tirar|remove|remover)\b.*\b(denoise|ruido de fundo|ruido)\b/.test(text)
    || /\b(denoise)\b.*\b(aplica|faz|usa)\b/.test(text);
  const dereverbIntent = /\b(aplica|aplicar|faz|fazer|usa|usar|reduz|reduzir|tira|tirar|remove|remover)\b.*\b(de reverb|dereverb|reverb|reverberacao|eco|reflexo)\b/.test(text)
    || /\b(de reverb|dereverb)\b.*\b(aplica|faz|usa)\b/.test(text);
  if (denoiseIntent === dereverbIntent) return null;
  const sectionMatch = text.match(/\b(pre[- ]?refrao|refrao|verso|ponte|intro|rap|outro)\b/);
  const section = normalizeSectionKind(sectionMatch?.[1] || '');
  if (!section) return null;
  return {
    section,
    label: sectionLabel(section),
    occurrence: parseOccurrence(text),
    mode: denoiseIntent ? SELECTIVE_VOCAL_RESTORATION_MODES.DENOISE : SELECTIVE_VOCAL_RESTORATION_MODES.DEREVERB,
    intensity: /\b(leve|levemente|sutil|sutilmente|um pouco|pouquinho)\b/.test(text) ? 'light' : 'balanced',
    blocked: false,
  };
}

export function resolveSelectiveVocalRestorationTarget(project, command) {
  return resolveSectionVocalCleanupTarget(project, command);
}

export function planSelectiveVocalRestoration(project, command, { analysis = null } = {}) {
  const target = resolveSelectiveVocalRestorationTarget(project, command);
  if (!target.ok) return target;
  if (!analysis?.voice?.restoration) return { ...target, ok: false, reason: 'restoration_analysis_required' };
  const cleanupCommand = {
    section: command.section,
    label: command.label,
    occurrence: command.occurrence,
    intensity: command.intensity || 'balanced',
    blocked: false,
  };
  const cleanup = planSectionVocalCleanup(target.project, cleanupCommand, { analysis });
  const module = command.mode === SELECTIVE_VOCAL_RESTORATION_MODES.DENOISE ? cleanup?.modules?.denoise : cleanup?.modules?.dereverb;
  const source = command.mode === SELECTIVE_VOCAL_RESTORATION_MODES.DENOISE
    ? PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DENOISE
    : PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DEREVERB;
  const events = (Array.isArray(cleanup?.events) ? cleanup.events : []).filter((event) => event?.source === source);
  if (!module?.applied || !events.length) {
    return {
      ...target,
      ok: false,
      reason: command.mode === SELECTIVE_VOCAL_RESTORATION_MODES.DENOISE ? 'no_safe_noise_profile' : 'no_safe_reverb_profile',
      mode: command.mode,
      module: module || null,
    };
  }
  return {
    ...target,
    ok: true,
    mode: command.mode,
    source,
    events,
    module,
    timbreProtected: events.every((event) => event?.timbreProtected === true),
  };
}

export function applySelectiveVocalRestoration(project, command, options = {}) {
  const plan = planSelectiveVocalRestoration(project, command, options);
  if (!plan.ok) return plan;
  const next = plan.project;
  const track = next.tracks.find((candidate) => candidate.id === plan.track.id);
  if (!track) return { ok: false, reason: 'vocal_track_missing' };
  const prior = Array.isArray(track.regionAutomation) ? track.regionAutomation : [];
  const removed = prior.filter((event) => event?.source === plan.source && belongsToSection(event, plan.section.id));
  track.regionAutomation = [
    ...prior.filter((event) => !(event?.source === plan.source && belongsToSection(event, plan.section.id))),
    ...plan.events,
  ];
  const now = Number(options.now) || Date.now();
  track.updatedAt = now;
  next.updatedAt = now;
  return {
    ...plan,
    project: next,
    track,
    mutated: true,
    replacedExisting: removed.length > 0,
    replacedCount: removed.length,
  };
}

function belongsToSection(event, sectionId) {
  return Boolean(sectionId) && String(event?.id || '').endsWith(`:${sectionId}`);
}
function parseOccurrence(text) {
  if (/\b(primeir[oa]|1[oa]?)\b/.test(text)) return 1;
  if (/\b(segund[oa]|2[oa]?)\b/.test(text)) return 2;
  if (/\b(terceir[oa]|3[oa]?)\b/.test(text)) return 3;
  return null;
}
function normalizeText(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[/_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
