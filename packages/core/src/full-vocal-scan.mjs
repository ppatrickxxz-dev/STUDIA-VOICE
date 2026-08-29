import { migrateProject } from './project.mjs';
import { normalizeArrangementMap, sectionLabel } from './section-map.mjs';
import { resolveVocalTrack } from './section-vocal-gain.mjs';
import { planSectionVocalScan } from './section-vocal-scan.mjs';

export const PABLO_FULL_VOCAL_SCAN_SOURCE = 'pablo_full_vocal_section_scan';

export function parseFullVocalScanCommand(message = '') {
  const text = normalizeText(message);
  if (!text || /\b(limpa|limpar|trata|tratar|corrige|corrigir|desfaz|desfazer|remove|remover|aplica|aplicar)\b/.test(text)) return null;
  if (/\b(pre refrao|refrao|verso|ponte|intro|rap|outro)\b/.test(text) && !/\b(secao por secao|por secoes|todas as secoes)\b/.test(text)) return null;
  const vocalIntent = /\b(analisa (?:a|minha) voz|analisar (?:a|minha) voz|escaneia (?:a|minha) voz|escanear (?:a|minha) voz|diagnostico (?:completo )?(?:da|na) (?:minha )?voz|varredura (?:completa )?(?:da|na|de) (?:minha )?voz|varre (?:a|minha) voz|ouve minha voz)\b/.test(text);
  const wholeIntent = /\b(inteira|inteiro|completa|completo|toda|todo|do inicio ao fim|secao por secao|por secoes|todas as secoes|projeto inteiro|faixa inteira|musica inteira)\b/.test(text);
  if (!vocalIntent || !wholeIntent) return null;
  return { scope: 'all_confirmed_sections', readOnly: true, blocked: false };
}

export function resolveFullVocalScanTarget(project) {
  const clean = migrateProject(project);
  const vocal = resolveVocalTrack(clean);
  if (!vocal.ok) return vocal;
  const sections = normalizeArrangementMap(clean.arrangementMap).sections.filter((section) =>
    section.timingStatus === 'confirmed'
    && Number(section.confidence) >= 0.8
    && Number.isFinite(Number(section.startSeconds))
    && Number.isFinite(Number(section.endSeconds))
    && Number(section.endSeconds) > Number(section.startSeconds));
  if (!sections.length) return { ok: false, reason: 'missing_confirmed_sections' };
  return { ok: true, project: clean, track: vocal.track, sections };
}

export function planFullVocalScan(project, { analysis = null } = {}) {
  const target = resolveFullVocalScanTarget(project);
  if (!target.ok) return target;
  if (!analysis?.voice) return { ...target, ok: false, reason: 'scan_analysis_required' };

  const canonicalSections = scannableOccurrenceSections(target.project.arrangementMap);
  const sections = [];
  const skipped = [];

  for (const section of target.sections) {
    const occurrence = occurrenceForSection(section, canonicalSections);
    const command = {
      section: section.kind,
      label: section.label || sectionLabel(section.kind),
      occurrence,
      blocked: false,
    };
    const scan = planSectionVocalScan(target.project, command, { analysis });
    if (!scan.ok) {
      skipped.push({
        sectionId: section.id,
        kind: section.kind,
        label: section.label || sectionLabel(section.kind),
        occurrence,
        startSeconds: Number(section.startSeconds),
        endSeconds: Number(section.endSeconds),
        reason: scan.reason,
      });
      continue;
    }
    const priorityScore = scoreFindings(scan.findings);
    sections.push({
      sectionId: scan.section.id,
      kind: scan.section.kind,
      label: scan.section.label || sectionLabel(scan.section.kind),
      occurrence,
      startSeconds: Number(scan.section.startSeconds),
      endSeconds: Number(scan.section.endSeconds),
      findings: scan.findings,
      actionableCount: scan.actionableCount,
      reviewCount: scan.reviewCount,
      observed: scan.observed,
      clean: scan.clean,
      priorityScore,
      priority: priorityLabel(priorityScore, scan.findings.length),
      topTypes: topFindingTypes(scan.findings),
    });
  }

  if (!sections.length) {
    return { ...target, ok: false, reason: 'no_scannable_confirmed_sections', skipped };
  }

  const rankedSections = sections
    .filter((section) => !section.clean)
    .slice()
    .sort((a, b) => b.priorityScore - a.priorityScore || a.startSeconds - b.startSeconds);
  const totalFindings = sections.reduce((sum, section) => sum + section.findings.length, 0);
  const actionableCount = sections.reduce((sum, section) => sum + section.actionableCount, 0);
  const reviewCount = sections.reduce((sum, section) => sum + section.reviewCount, 0);

  return {
    ok: true,
    source: PABLO_FULL_VOCAL_SCAN_SOURCE,
    readOnly: true,
    analysisPasses: 1,
    trackId: target.track.id,
    scannedSectionCount: sections.length,
    skippedSectionCount: skipped.length,
    sections,
    skipped,
    rankedSections,
    totalFindings,
    actionableCount,
    reviewCount,
    clean: totalFindings === 0,
    analysisSource: String(analysis.voice.eventDetection?.source || 'unknown'),
    noiseAnalysisSource: String(analysis.voice.noiseDetection?.source || 'unknown'),
    restorationSource: String(analysis.voice.restoration?.source || 'unavailable'),
  };
}

function scannableOccurrenceSections(map) {
  return normalizeArrangementMap(map).sections.filter((section) =>
    section.timingStatus === 'confirmed'
    && Number(section.confidence) >= 0.8
    && Number.isFinite(Number(section.startSeconds)));
}

function occurrenceForSection(section, canonicalSections) {
  const matches = canonicalSections.filter((candidate) => candidate.kind === section.kind);
  const index = matches.findIndex((candidate) => candidate.id === section.id);
  const fallbackIndex = matches.findIndex((candidate) =>
    Number(candidate.startSeconds) === Number(section.startSeconds));
  return Math.max(1, (index >= 0 ? index : fallbackIndex) + 1);
}

function scoreFindings(findings = []) {
  return roundHundredth(findings.reduce((sum, finding) => {
    const confidence = clamp01(finding?.confidence);
    const actionMultiplier = finding?.autoEdit ? 1.25 : 1;
    return sum + findingWeight(finding?.type) * (0.5 + confidence * 0.5) * actionMultiplier;
  }, 0));
}

function findingWeight(type) {
  if (type === 'noise' || type === 'reverb') return 1.4;
  if (type === 'sibilance' || type === 'plosive' || type === 'click') return 1.2;
  if (type === 'breath') return 1;
  if (type === 'peak') return 0.9;
  if (type === 'hum' || type === 'broadband_noise') return 0.7;
  return 0.8;
}

function priorityLabel(score, count) {
  if (!count) return 'clean';
  if (score >= 6) return 'high';
  if (score >= 2.5) return 'medium';
  return 'low';
}

function topFindingTypes(findings = []) {
  const counts = new Map();
  for (const finding of findings) counts.set(finding.type, (counts.get(finding.type) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([type, count]) => ({ type, count }));
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
function roundHundredth(value) { return Math.round(Number(value) * 100) / 100; }
function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
