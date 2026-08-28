import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import {
  parseSectionVocalScanCommand,
  planSectionVocalScan,
  PABLO_SECTION_VOCAL_SCAN_SOURCE,
} from '../../packages/core/src/section-vocal-scan.mjs';

function projectWithVocal() {
  const project = createProject('Diagnóstico', 1000);
  const vocal = createTrack({ name: 'Voz principal', assetId: 'voice', duration: 30, kind: 'recording' });
  const support = createTrack({ name: 'Instrumental', assetId: 'base', duration: 30, kind: 'audio' });
  project.tracks = [vocal, support];
  project.activeTrackId = support.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 8, endSeconds: 16, source: 'user_manual', confidence: 1,
  });
  const sectionId = project.arrangementMap.sections[0].id;
  vocal.regionAutomation.push({
    id: `manual:${sectionId}`, kind: 'gain', startSeconds: 8, endSeconds: 16,
    gainDb: 0.7, confidence: 1, source: 'user_manual', enabled: true,
  });
  return { project, vocal, support };
}

function richAnalysis() {
  return {
    voice: {
      eventDetection: { source: 'local-heuristic-v1' },
      breathEvents: [
        { start: 8.7, end: 8.9, confidence: 0.92, intensity: 0.9 },
        { start: 20, end: 20.2, confidence: 0.96, intensity: 1 },
      ],
      sibilanceEvents: [
        { start: 9.4, end: 9.5, confidence: 0.91, intensity: 0.88, frequencyHz: 9200, spectralConfidence: 0.72, spectralSource: 'local-sibilance-spectrum-v1' },
      ],
      plosiveEvents: [
        { start: 10.2, end: 10.26, confidence: 0.92, intensity: 0.9, frequencyHz: 120, spectralConfidence: 0.74, spectralSource: 'plosive-lowband-goertzel-refined-v1' },
      ],
      clickEvents: [
        { start: 11.1, end: 11.115, confidence: 0.9, intensity: 0.86, differenceRatio: 1.2, lowFrequencyRatio: 0.18, source: 'vocal-click-impulse-v1' },
      ],
      peakEvents: [
        { start: 12, end: 12.05, confidence: 0.9, intensity: 0.93, peak: 0.7, transientRise: 2.8, source: 'vocal-peak-transient-v1' },
        { start: 13.2, end: 13.25, confidence: 0.84, intensity: 0.82, peak: 0.62, transientRise: 2.3, source: 'vocal-peak-transient-v1' },
      ],
    },
  };
}

test('parses explicit diagnostic language with a named section and does not hijack cleanup edits', () => {
  const parsed = parseSectionVocalScanCommand('Pablo, analisa minha voz só no refrão');
  assert.equal(parsed.section, 'chorus');
  assert.equal(parsed.label, 'Refrão');
  assert.equal(parseSectionVocalScanCommand('analisa minha voz'), null);
  assert.equal(parseSectionVocalScanCommand('limpa minha voz no refrão'), null);
  assert.equal(parseSectionVocalScanCommand('trata minha voz no refrão'), null);
});

test('reports five evidence families from the same cleanup gates and keeps positions sorted', () => {
  const { project } = projectWithVocal();
  const command = parseSectionVocalScanCommand('analisa minha voz no refrão');
  const result = planSectionVocalScan(project, command, { analysis: richAnalysis() });
  assert.equal(result.ok, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.source, PABLO_SECTION_VOCAL_SCAN_SOURCE);
  assert.equal(result.clean, false);
  const types = new Set(result.findings.map((finding) => finding.type));
  for (const type of ['breath', 'sibilance', 'plosive', 'click', 'peak']) assert.ok(types.has(type), `missing ${type}`);
  assert.ok(result.findings.every((finding) => finding.timelineStartSeconds >= 8 && finding.timelineEndSeconds <= 16));
  assert.deepEqual(result.findings.map((finding) => finding.timelineStartSeconds), [...result.findings.map((finding) => finding.timelineStartSeconds)].sort((a, b) => a - b));
  assert.ok(result.findings.some((finding) => finding.type === 'sibilance' && finding.frequencyHz === 9200));
  assert.ok(result.findings.some((finding) => finding.type === 'plosive' && finding.frequencyHz === 120));
  assert.equal(result.modules.dynamics.applied, true);
  assert.ok(result.findings.filter((finding) => finding.type === 'peak').every((finding) => finding.autoEdit));
});

test('peak diagnosis exposes review-only evidence when one moderate peak is not enough for automatic dynamics', () => {
  const { project } = projectWithVocal();
  const analysis = richAnalysis();
  analysis.voice.breathEvents = [];
  analysis.voice.sibilanceEvents = [];
  analysis.voice.plosiveEvents = [];
  analysis.voice.clickEvents = [];
  analysis.voice.peakEvents = [{ start: 12, end: 12.04, confidence: 0.74, intensity: 0.68, peak: 0.42, transientRise: 2.1 }];
  const result = planSectionVocalScan(project, parseSectionVocalScanCommand('faz um diagnóstico da minha voz no refrão'), { analysis });
  assert.equal(result.ok, true);
  assert.equal(result.modules.dynamics.applied, false);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].type, 'peak');
  assert.equal(result.findings[0].autoEdit, false);
  assert.equal(result.actionableCount, 0);
  assert.equal(result.reviewCount, 1);
});

test('weak or out-of-section observations stay visible only in raw counts and never become actionable findings', () => {
  const { project } = projectWithVocal();
  const analysis = {
    voice: {
      eventDetection: { source: 'provided' },
      breathEvents: [{ start: 9, end: 9.1, confidence: 0.6, intensity: 0.5 }],
      sibilanceEvents: [{ start: 20, end: 20.1, confidence: 0.95, intensity: 0.95, frequencyHz: 9000, spectralConfidence: 0.8 }],
      plosiveEvents: [{ start: 10, end: 10.05, confidence: 0.4, intensity: 0.2, frequencyHz: 120, spectralConfidence: 0.2 }],
      clickEvents: [{ start: 11, end: 11.01, confidence: 0.5, intensity: 0.2, differenceRatio: 0.3, lowFrequencyRatio: 0.2 }],
      peakEvents: [{ start: 12, end: 12.04, confidence: 0.5, intensity: 0.4 }],
    },
  };
  const result = planSectionVocalScan(project, parseSectionVocalScanCommand('quais problemas tem na minha voz no refrão'), { analysis });
  assert.equal(result.ok, true);
  assert.equal(result.clean, true);
  assert.equal(result.findings.length, 0);
  assert.equal(result.observed.breaths, 1);
  assert.equal(result.observed.sibilance, 0);
  assert.equal(result.observed.plosives, 1);
  assert.equal(result.observed.clicks, 1);
  assert.equal(result.observed.peaks, 1);
  assert.equal(result.actionableCount, 0);
});

test('scan is pure read-only planning: project automation revisions and timestamps remain byte-for-byte unchanged', () => {
  const { project } = projectWithVocal();
  const before = JSON.stringify(project);
  const result = planSectionVocalScan(project, parseSectionVocalScanCommand('escaneia minha voz no refrão'), { analysis: richAnalysis() });
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(project), before);
  assert.equal(project.revisions.length, JSON.parse(before).revisions.length);
  assert.equal(project.tracks[0].regionAutomation.length, 1);
});

test('missing analysis fails closed while a genuinely clean diagnosis succeeds without inventing a problem', () => {
  const { project } = projectWithVocal();
  const command = parseSectionVocalScanCommand('analisa minha voz no refrão');
  const missing = planSectionVocalScan(project, command);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'scan_analysis_required');

  const clean = planSectionVocalScan(project, command, {
    analysis: {
      voice: {
        eventDetection: { source: 'provided' },
        breathEvents: [], sibilanceEvents: [], plosiveEvents: [], clickEvents: [], peakEvents: [],
      },
    },
  });
  assert.equal(clean.ok, true);
  assert.equal(clean.clean, true);
  assert.deepEqual(clean.findings, []);
});
