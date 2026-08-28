import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import {
  applyFullVocalTreatment,
  parseFullVocalTreatmentCommand,
  planFullVocalTreatment,
  PABLO_FULL_VOCAL_TREATMENT_SOURCE,
} from '../../packages/core/src/full-vocal-treatment.mjs';

function projectWithSections() {
  const project = createProject('Tratamento por prioridade', 1000);
  const vocal = createTrack({ name: 'Voz principal', assetId: 'voice', duration: 42, kind: 'recording' });
  const support = createTrack({ name: 'Instrumental', assetId: 'base', duration: 42, kind: 'audio' });
  project.tracks = [vocal, support];
  project.activeTrackId = support.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, { kind: 'chorus', startSeconds: 8, endSeconds: 16, source: 'user_manual', confidence: 1 });
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, { kind: 'verse', startSeconds: 18, endSeconds: 24, source: 'user_manual', confidence: 1 });
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, { kind: 'chorus', startSeconds: 30, endSeconds: 38, source: 'user_manual', confidence: 1 });
  const first = project.arrangementMap.sections[0];
  vocal.regionAutomation.push({ id: `manual_gain:${first.id}`, kind: 'gain', startSeconds: 8, endSeconds: 16, gainDb: 0.8, confidence: 1, source: 'user_manual', enabled: true });
  return { project, vocal };
}

function markSectionTreated(project, vocal, index = 0) {
  const section = project.arrangementMap.sections[index];
  vocal.regionAutomation.push({
    id: `pablo_section_vocal_cleanup_plosive:${vocal.id}:1:${section.id}`,
    kind: 'peaking_eq',
    startSeconds: Number(section.startSeconds),
    endSeconds: Number(section.endSeconds),
    gainDb: -2,
    frequencyHz: 120,
    confidence: 0.9,
    source: 'pablo_section_vocal_cleanup_plosive',
    enabled: true,
  });
  return section;
}

function richAnalysis() {
  return {
    voice: {
      eventDetection: { source: 'local-heuristic-v1' },
      breathEvents: [
        { start: 8.7, end: 8.9, confidence: 0.94, intensity: 0.91 },
        { start: 19.0, end: 19.15, confidence: 0.93, intensity: 0.9 },
      ],
      sibilanceEvents: [
        { start: 9.4, end: 9.5, confidence: 0.91, intensity: 0.88, frequencyHz: 9200, spectralConfidence: 0.74, spectralSource: 'local-sibilance-spectrum-v1' },
      ],
      plosiveEvents: [
        { start: 10.2, end: 10.26, confidence: 0.92, intensity: 0.9, frequencyHz: 120, spectralConfidence: 0.76, spectralSource: 'plosive-lowband-goertzel-refined-v1' },
        { start: 31.2, end: 31.26, confidence: 0.91, intensity: 0.89, frequencyHz: 118, spectralConfidence: 0.76, spectralSource: 'plosive-lowband-goertzel-refined-v1' },
      ],
      clickEvents: [
        { start: 11.1, end: 11.115, confidence: 0.9, intensity: 0.86, differenceRatio: 1.2, lowFrequencyRatio: 0.18, source: 'vocal-click-impulse-v1' },
        { start: 32.0, end: 32.015, confidence: 0.89, intensity: 0.85, differenceRatio: 1.1, lowFrequencyRatio: 0.2, source: 'vocal-click-impulse-v1' },
      ],
      peakEvents: [
        { start: 12, end: 12.05, confidence: 0.9, intensity: 0.93, peak: 0.7, transientRise: 2.8, source: 'vocal-peak-transient-v1' },
        { start: 13.2, end: 13.25, confidence: 0.84, intensity: 0.82, peak: 0.62, transientRise: 2.3, source: 'vocal-peak-transient-v1' },
      ],
      restoration: null,
    },
  };
}

test('parses whole-voice treatment intent without hijacking scan or section cleanup commands', () => {
  const parsed = parseFullVocalTreatmentCommand('Pablo, trata minha voz inteira por prioridade');
  assert.equal(parsed.scope, 'priority_confirmed_sections');
  assert.equal(parsed.maxSections, 3);
  assert.equal(parsed.intensity, 'balanced');
  const continued = parseFullVocalTreatmentCommand('Pablo, continua o tratamento vocal');
  assert.equal(continued.scope, 'remaining_priority_confirmed_sections');
  assert.equal(continued.mode, 'continue');
  assert.equal(continued.skipPreviouslyTreated, true);
  assert.equal(parseFullVocalTreatmentCommand('Pablo, analisa minha voz inteira'), null);
  assert.equal(parseFullVocalTreatmentCommand('limpa minha voz no refrão'), null);
  assert.equal(parseFullVocalTreatmentCommand('desfaz a limpeza da voz inteira'), null);
});

test('plans a priority treatment chain from the full vocal scan ranking and stays read-only', () => {
  const { project } = projectWithSections();
  const before = JSON.stringify(project);
  const command = parseFullVocalTreatmentCommand('trata minha voz inteira por prioridade top 2');
  const result = planFullVocalTreatment(project, command, { analysis: richAnalysis() });
  assert.equal(result.ok, true);
  assert.equal(result.source, PABLO_FULL_VOCAL_TREATMENT_SOURCE);
  assert.equal(result.readOnly, true);
  assert.equal(result.analysisPasses, 1);
  assert.equal(result.plannedSectionCount, 2);
  assert.equal(result.plannedSections[0].kind, 'chorus');
  assert.equal(result.plannedSections[0].occurrence, 1);
  assert.equal(result.plannedSections[0].modules.deesser.applied, true);
  assert.equal(result.plannedSections[0].modules.plosive.applied, true);
  assert.equal(result.plannedSections[0].modules.click.applied, true);
  assert.ok(result.plannedSections[0].eventCount >= 4);
  assert.equal(JSON.stringify(project), before);
});

test('continuing treatment skips already treated sections and plans only remaining candidates', () => {
  const { project, vocal } = projectWithSections();
  const first = markSectionTreated(project, vocal, 0);
  const before = JSON.stringify(project);
  const command = parseFullVocalTreatmentCommand('continua o tratamento vocal');
  const result = planFullVocalTreatment(project, command, { analysis: richAnalysis() });
  assert.equal(result.ok, true);
  assert.equal(result.continueMode, true);
  assert.equal(result.previouslyTreatedCount, 1);
  assert.equal(result.previouslyTreatedSections[0].sectionId, first.id);
  assert.equal(result.skippedSections.some((section) => section.reason === 'already_treated'), true);
  assert.equal(result.plannedSections.some((section) => section.sectionId === first.id), false);
  assert.equal(result.plannedSections[0].kind, 'chorus');
  assert.equal(result.plannedSections[0].occurrence, 2);
  assert.equal(JSON.stringify(project), before);
});

test('continuing treatment fails closed when every actionable section is already treated', () => {
  const { project, vocal } = projectWithSections();
  markSectionTreated(project, vocal, 0);
  markSectionTreated(project, vocal, 1);
  markSectionTreated(project, vocal, 2);
  const command = parseFullVocalTreatmentCommand('prosseguir tratamento vocal');
  const result = planFullVocalTreatment(project, command, { analysis: richAnalysis() });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_remaining_priority_cleanup_evidence');
  assert.equal(result.previouslyTreatedCount, result.candidateCount);
});

test('applies only planned priority sections and preserves manual automation', () => {
  const { project, vocal } = projectWithSections();
  const command = parseFullVocalTreatmentCommand('corrige os problemas da minha voz inteira por prioridade top 2');
  const result = applyFullVocalTreatment(project, command, { analysis: richAnalysis(), now: 2000 });
  assert.equal(result.ok, true);
  assert.equal(result.mutated, true);
  assert.equal(result.appliedSectionCount, 2);
  assert.ok(result.appliedEventCount >= 6);
  const track = result.project.tracks.find((candidate) => candidate.id === vocal.id);
  assert.ok(track.regionAutomation.some((event) => event.source === 'user_manual'));
  for (const section of result.appliedSections) {
    for (const eventId of section.eventIds) assert.ok(track.regionAutomation.some((event) => event.id === eventId));
  }
});

test('fails closed without analysis or without actionable cleanup evidence', () => {
  const { project } = projectWithSections();
  const command = parseFullVocalTreatmentCommand('limpa minha voz inteira por prioridade');
  const missing = planFullVocalTreatment(project, command);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'treatment_analysis_required');

  const clean = planFullVocalTreatment(project, command, {
    analysis: { voice: { eventDetection: { source: 'provided' }, breathEvents: [], sibilanceEvents: [], plosiveEvents: [], clickEvents: [], peakEvents: [] } },
  });
  assert.equal(clean.ok, false);
  assert.equal(clean.reason, 'no_priority_cleanup_evidence');
});
