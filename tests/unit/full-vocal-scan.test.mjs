import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import {
  parseFullVocalScanCommand,
  planFullVocalScan,
  PABLO_FULL_VOCAL_SCAN_SOURCE,
} from '../../packages/core/src/full-vocal-scan.mjs';

function projectWithSections() {
  const project = createProject('Varredura completa', 1000);
  const vocal = createTrack({ name: 'Voz principal', assetId: 'voice', duration: 40, kind: 'recording' });
  const support = createTrack({ name: 'Instrumental', assetId: 'base', duration: 40, kind: 'audio' });
  project.tracks = [vocal, support];
  project.activeTrackId = support.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'verse', startSeconds: 2, endSeconds: 8, source: 'user_manual', confidence: 1,
  });
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 8, endSeconds: 16, source: 'user_manual', confidence: 1,
  });
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 20, endSeconds: 28, source: 'user_manual', confidence: 1,
  });
  return { project, vocal };
}

function analysisWithSectionDifferences() {
  return {
    voice: {
      eventDetection: { source: 'provided' },
      breathEvents: [
        { start: 9.0, end: 9.2, confidence: 0.94, intensity: 0.9 },
        { start: 10.0, end: 10.2, confidence: 0.93, intensity: 0.88 },
        { start: 11.0, end: 11.2, confidence: 0.92, intensity: 0.86 },
      ],
      sibilanceEvents: [],
      plosiveEvents: [],
      clickEvents: [],
      peakEvents: [
        { start: 21.0, end: 21.05, confidence: 0.74, intensity: 0.68, peak: 0.5, transientRise: 2.1 },
      ],
      noiseEvents: [],
    },
  };
}

test('parses whole-voice diagnostic intent without hijacking section scans or edits', () => {
  assert.ok(parseFullVocalScanCommand('Pablo, faz uma varredura completa da minha voz'));
  assert.ok(parseFullVocalScanCommand('escaneia minha voz inteira por seções'));
  assert.equal(parseFullVocalScanCommand('analisa minha voz no refrão'), null);
  assert.equal(parseFullVocalScanCommand('limpa minha voz inteira'), null);
});

test('scans every confirmed section from one supplied analysis and ranks the sections with findings', () => {
  const { project } = projectWithSections();
  const result = planFullVocalScan(project, { analysis: analysisWithSectionDifferences() });
  assert.equal(result.ok, true);
  assert.equal(result.source, PABLO_FULL_VOCAL_SCAN_SOURCE);
  assert.equal(result.readOnly, true);
  assert.equal(result.analysisPasses, 1);
  assert.equal(result.scannedSectionCount, 3);
  assert.equal(result.skippedSectionCount, 0);
  assert.equal(result.sections.filter((section) => section.kind === 'chorus').length, 2);
  assert.deepEqual(result.sections.filter((section) => section.kind === 'chorus').map((section) => section.occurrence), [1, 2]);
  assert.equal(result.sections.find((section) => section.kind === 'verse').clean, true);
  assert.equal(result.rankedSections[0].kind, 'chorus');
  assert.equal(result.rankedSections[0].occurrence, 1);
  assert.equal(result.rankedSections[0].priority, 'medium');
  assert.ok(result.rankedSections[0].findings.every((finding) => finding.type === 'breath'));
  assert.equal(result.rankedSections[1].occurrence, 2);
  assert.equal(result.rankedSections[1].findings[0].type, 'peak');
  assert.equal(result.rankedSections[1].findings[0].autoEdit, false);
  assert.equal(result.totalFindings, 4);
  assert.equal(result.actionableCount, 3);
  assert.equal(result.reviewCount, 1);
});

test('full scan is byte-for-byte read-only and does not create automation or revisions', () => {
  const { project, vocal } = projectWithSections();
  vocal.regionAutomation.push({ id: 'manual', kind: 'gain', startSeconds: 2, endSeconds: 8, gainDb: 0.5, source: 'user_manual', enabled: true });
  const before = JSON.stringify(project);
  const result = planFullVocalScan(project, { analysis: analysisWithSectionDifferences() });
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(project), before);
  assert.equal(project.revisions.length, JSON.parse(before).revisions.length);
  assert.equal(project.tracks[0].regionAutomation.length, 1);
});

test('fails closed without confirmed sections or without acoustic analysis', () => {
  const project = createProject('Sem mapa', 1000);
  project.tracks = [createTrack({ name: 'Voz', assetId: 'voice', duration: 20, kind: 'recording' })];
  const noSections = planFullVocalScan(project, { analysis: analysisWithSectionDifferences() });
  assert.equal(noSections.ok, false);
  assert.equal(noSections.reason, 'missing_confirmed_sections');

  const { project: mapped } = projectWithSections();
  const noAnalysis = planFullVocalScan(mapped);
  assert.equal(noAnalysis.ok, false);
  assert.equal(noAnalysis.reason, 'scan_analysis_required');
});
