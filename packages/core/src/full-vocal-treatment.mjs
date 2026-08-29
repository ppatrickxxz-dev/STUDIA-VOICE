import { planFullVocalScan, resolveFullVocalScanTarget } from './full-vocal-scan.mjs';
import {
  applySectionVocalCleanup,
  isCleanupEventForSection,
  planSectionVocalCleanup,
} from './section-vocal-cleanup.mjs';

export const PABLO_FULL_VOCAL_TREATMENT_SOURCE = 'pablo_full_vocal_priority_treatment';
export const DEFAULT_FULL_VOCAL_TREATMENT = Object.freeze({ maxSections: 3 });

export function parseFullVocalTreatmentCommand(message = '') {
  const text = normalizeText(message);
  if (!text || /\b(desfaz|desfazer|volta|voltar|compara|comparar|prefiro)\b/.test(text)) return null;
  if (/\b(analisa|analisar|escaneia|escanear|diagnostico|varredura|varre|ouve)\b/.test(text) && !/\b(limpa|limpar|trata|tratar|corrige|corrigir|aplica|aplicar|executa|executar|continua|continuar|prossegue|prosseguir)\b/.test(text)) return null;
  if (/\b(pre refrao|refrao|verso|ponte|intro|rap|outro)\b/.test(text) && !/\b(secao por secao|por secoes|todas as secoes|todos os trechos|voz inteira|faixa inteira|musica inteira|projeto inteiro|proximas secoes|secoes restantes)\b/.test(text)) return null;

  const continueIntent = /\b(continua|continuar|prossegue|prosseguir|segue|seguir|retoma|retomar)\b/.test(text)
    && /\b(tratamento vocal|limpeza vocal|tratamento da voz|limpeza da voz|tratar minha voz|limpar minha voz|voz)\b/.test(text);
  const treatmentIntent = /\b(limpa (?:a|minha) voz|limpar (?:a|minha) voz|trata (?:a|minha) voz|tratar (?:a|minha) voz|corrige (?:os problemas )?(?:da|na) minha voz|corrigir (?:os problemas )?(?:da|na) minha voz|aplica (?:a )?limpeza vocal|aplicar (?:a )?limpeza vocal|executa (?:a )?limpeza vocal|fazer tratamento vocal|faz tratamento vocal)\b/.test(text);
  const wholeIntent = /\b(inteira|inteiro|completa|completo|toda|todo|do inicio ao fim|secao por secao|por secoes|todas as secoes|todos os trechos|por prioridade|mais criticos|mais criticas|proximas secoes|secoes restantes|restante|restantes|projeto inteiro|faixa inteira|musica inteira)\b/.test(text);
  if (!continueIntent && (!treatmentIntent || !wholeIntent)) return null;

  return {
    scope: continueIntent ? 'remaining_priority_confirmed_sections' : 'priority_confirmed_sections',
    source: PABLO_FULL_VOCAL_TREATMENT_SOURCE,
    mode: continueIntent ? 'continue' : 'priority',
    skipPreviouslyTreated: continueIntent,
    maxSections: parseMaxSections(text),
    intensity: /\b(leve|levemente|sutil|sutilmente|um pouco|pouquinho)\b/.test(text) ? 'light' : 'balanced',
    blocked: false,
  };
}

export function resolveFullVocalTreatmentTarget(project) {
  return resolveFullVocalScanTarget(project);
}

export function planFullVocalTreatment(project, command = {}, { analysis = null } = {}) {
  const target = resolveFullVocalTreatmentTarget(project);
  if (!target.ok) return target;
  if (!analysis?.voice) return { ...target, ok: false, reason: 'treatment_analysis_required' };

  const scan = planFullVocalScan(target.project, { analysis });
  if (!scan.ok) return { ...target, ...scan, ok: false };

  const maxSections = boundedLimit(command.maxSections, scan.rankedSections.length);
  const candidates = scan.rankedSections.filter((section) => Number(section.actionableCount) > 0);
  const treatedSectionIds = command.skipPreviouslyTreated ? treatedCleanupSectionIds(target.track, candidates) : new Set();
  const plannedSections = [];
  const skippedSections = [];
  const previouslyTreatedSections = [];

  for (const section of candidates) {
    if (treatedSectionIds.has(section.sectionId)) {
      const skipped = skipFor(section, 'already_treated');
      skippedSections.push(skipped);
      previouslyTreatedSections.push(skipped);
      continue;
    }
    const cleanupCommand = cleanupCommandForSection(section, command);
    if (plannedSections.length >= maxSections) {
      skippedSections.push(skipFor(section, 'outside_priority_limit'));
      continue;
    }
    const cleanup = planSectionVocalCleanup(target.project, cleanupCommand, { analysis });
    if (!cleanup.ok) {
      skippedSections.push(skipFor(section, cleanup.reason || 'cleanup_not_safe'));
      continue;
    }
    plannedSections.push({
      sectionId: section.sectionId,
      kind: section.kind,
      label: section.label,
      occurrence: section.occurrence,
      priority: section.priority,
      priorityScore: section.priorityScore,
      findingCount: section.findings.length,
      actionableCount: section.actionableCount,
      reviewCount: section.reviewCount,
      topTypes: section.topTypes,
      command: cleanupCommand,
      modules: cleanup.modules,
      eventCount: cleanup.events.length,
      events: cleanup.events,
    });
  }

  if (!plannedSections.length) {
    return {
      ok: false,
      reason: command.skipPreviouslyTreated && candidates.length && previouslyTreatedSections.length === candidates.length
        ? 'no_remaining_priority_cleanup_evidence'
        : 'no_priority_cleanup_evidence',
      source: PABLO_FULL_VOCAL_TREATMENT_SOURCE,
      scan,
      skippedSections,
      previouslyTreatedSections,
      previouslyTreatedCount: previouslyTreatedSections.length,
      candidateCount: candidates.length,
      remainingCandidateCount: Math.max(0, candidates.length - previouslyTreatedSections.length),
      continueMode: Boolean(command.skipPreviouslyTreated),
    };
  }

  return {
    ok: true,
    source: PABLO_FULL_VOCAL_TREATMENT_SOURCE,
    readOnly: true,
    continueMode: Boolean(command.skipPreviouslyTreated),
    analysisPasses: scan.analysisPasses,
    trackId: scan.trackId,
    scannedSectionCount: scan.scannedSectionCount,
    rankedSectionCount: scan.rankedSections.length,
    candidateCount: candidates.length,
    remainingCandidateCount: Math.max(0, candidates.length - previouslyTreatedSections.length),
    previouslyTreatedCount: previouslyTreatedSections.length,
    previouslyTreatedSections,
    plannedSectionCount: plannedSections.length,
    skippedSectionCount: skippedSections.length + scan.skippedSectionCount,
    totalScanFindings: scan.totalFindings,
    totalScanActionable: scan.actionableCount,
    totalScanReview: scan.reviewCount,
    plannedEventCount: plannedSections.reduce((sum, section) => sum + section.eventCount, 0),
    plannedSections,
    skippedSections: [...skippedSections, ...scan.skipped],
    scan,
  };
}

export function applyFullVocalTreatment(project, command = {}, options = {}) {
  const plan = planFullVocalTreatment(project, command, options);
  if (!plan.ok) return plan;
  let current = resolveFullVocalTreatmentTarget(project).project;
  const appliedSections = [];
  const applicationSkipped = [];
  const now = Number(options.now) || Date.now();

  for (const planned of plan.plannedSections) {
    const result = applySectionVocalCleanup(current, planned.command, { ...options, now });
    if (!result.ok) {
      applicationSkipped.push(skipFor(planned, result.reason || 'apply_failed'));
      continue;
    }
    current = result.project;
    appliedSections.push({
      sectionId: result.section.id,
      kind: result.section.kind,
      label: result.section.label,
      occurrence: planned.occurrence,
      priority: planned.priority,
      priorityScore: planned.priorityScore,
      eventCount: result.events.length,
      eventIds: result.events.map((event) => event.id),
      sources: [...new Set(result.events.map((event) => event.source))].sort(),
      modules: result.modules,
      replacedExisting: result.replacedExisting,
      replacedCount: result.replacedCount,
    });
  }

  if (!appliedSections.length) {
    return {
      ...plan,
      ok: false,
      reason: 'priority_treatment_apply_failed',
      applicationSkipped,
    };
  }

  current.updatedAt = now;
  return {
    ...plan,
    ok: true,
    project: current,
    mutated: true,
    appliedSections,
    appliedSectionCount: appliedSections.length,
    appliedEventCount: appliedSections.reduce((sum, section) => sum + section.eventCount, 0),
    applicationSkipped,
  };
}

function cleanupCommandForSection(section, command) {
  return {
    section: section.kind,
    label: section.label,
    occurrence: section.occurrence,
    intensity: command.intensity || 'balanced',
    blocked: false,
  };
}

function treatedCleanupSectionIds(track, sections = []) {
  const knownSectionIds = new Set(sections.map((section) => section.sectionId).filter(Boolean));
  const treated = new Set();
  const automation = Array.isArray(track?.regionAutomation) ? track.regionAutomation : [];
  for (const event of automation) {
    if (event?.enabled === false) continue;
    for (const sectionId of knownSectionIds) {
      if (isCleanupEventForSection(event, sectionId)) treated.add(sectionId);
    }
  }
  return treated;
}

function skipFor(section, reason) {
  return {
    sectionId: section.sectionId,
    kind: section.kind,
    label: section.label,
    occurrence: section.occurrence || null,
    priority: section.priority || null,
    priorityScore: Number(section.priorityScore) || 0,
    reason,
  };
}

function parseMaxSections(text) {
  const topMatch = text.match(/\b(?:top|primeir[oa]s?|so|somente|apenas)\s*(\d{1,2})\b/);
  if (topMatch) return clampInt(topMatch[1], 1, 12);
  const ateMatch = text.match(/\b(?:ate|no maximo)\s*(\d{1,2})\b/);
  if (ateMatch) return clampInt(ateMatch[1], 1, 12);
  if (/\b(todas as secoes|todos os trechos|tudo que for seguro)\b/.test(text)) return 96;
  return DEFAULT_FULL_VOCAL_TREATMENT.maxSections;
}

function boundedLimit(value, available) {
  const max = clampInt(value, 1, 96);
  const count = Math.max(0, Number(available) || 0);
  return Math.max(1, Math.min(max, count || max));
}
function clampInt(value, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}
function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[/_-]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
