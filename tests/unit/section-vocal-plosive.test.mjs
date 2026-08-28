import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import {
  applySectionVocalPlosive,
  parseSectionVocalPlosiveCommand,
  planSectionVocalPlosive,
  PABLO_SECTION_VOCAL_PLOSIVE_SOURCE,
} from '../../packages/core/src/section-vocal-plosive.mjs';

function projectWithVocal() {
  const project = createProject('Plosivas', 1000);
  const vocal = createTrack({ name: 'Voz principal', assetId: 'voice', duration: 30, kind: 'recording' });
  const support = createTrack({ name: 'Instrumental', assetId: 'base', duration: 30, kind: 'audio' });
  project.tracks = [vocal, support];
  project.activeTrackId = support.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 8, endSeconds: 16, source: 'user_manual', confidence: 1,
  });
  return { project, vocal, support };
}

const evidence = [
  { start: 9.0, end: 9.055, confidence: 0.91, intensity: 0.95, frequencyHz: 120, spectralConfidence: 0.72 },
  { start: 9.07, end: 9.11, confidence: 0.83, intensity: 0.68, frequencyHz: 140, spectralConfidence: 0.61 },
  { start: 12.4, end: 12.46, confidence: 0.76, intensity: 0.55, frequencyHz: 180, spectralConfidence: 0.58 },
  { start: 20.0, end: 20.07, confidence: 0.96, intensity: 1, frequencyHz: 100, spectralConfidence: 0.8 },
  { start: 14.0, end: 14.05, confidence: 0.4, intensity: 1, frequencyHz: 120, spectralConfidence: 0.8 },
];

test('parses everyday plosive language without hijacking dynamics peaks', () => {
  const command = parseSectionVocalPlosiveCommand('segura os P e B da minha voz só no refrão');
  assert.equal(command.section, 'chorus');
  assert.equal(command.maxReductionDb, 4);
  assert.equal(command.blocked, false);
  assert.equal(parseSectionVocalPlosiveCommand('segura os picos da minha voz no refrão'), null);
  const unsafe = parseSectionVocalPlosiveCommand('tira as plosivas 8 dB no refrão');
  assert.equal(unsafe.blocked, true);
  assert.equal(unsafe.reason, 'plosive_out_of_safe_range');
});

test('requires measured acoustic plosive evidence and never creates a whole-section low cut', () => {
  const { project } = projectWithVocal();
  const command = parseSectionVocalPlosiveCommand('corrige os p e b no refrão');
  const missing = planSectionVocalPlosive(project, command);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'plosive_analysis_required');
  const empty = planSectionVocalPlosive(project, command, { plosiveEvents: [] });
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'no_plosive_evidence');
});

test('creates only confident in-section low-frequency micro cuts', () => {
  const { project } = projectWithVocal();
  const command = parseSectionVocalPlosiveCommand('segura as plosivas no refrão');
  const plan = planSectionVocalPlosive(project, command, { plosiveEvents: evidence, analysisSource: 'local-heuristic-v1' });
  assert.equal(plan.ok, true);
  assert.equal(plan.detectedCount, 2);
  assert.equal(plan.analysisSource, 'local-heuristic-v1');
  for (const event of plan.events) {
    assert.equal(event.kind, 'peaking_eq');
    assert.ok(event.frequencyHz >= 80 && event.frequencyHz <= 260);
    assert.equal(event.q, 0.72);
    assert.ok(event.gainDb <= -1.5 && event.gainDb >= -4);
    assert.ok(event.startSeconds >= 8 && event.endSeconds <= 16);
    assert.ok(event.endSeconds - event.startSeconds < 0.3);
    assert.equal(event.source, PABLO_SECTION_VOCAL_PLOSIVE_SOURCE);
    assert.ok(event.id.endsWith(`:${plan.section.id}`));
  }
});

test('applies idempotently only to the safe vocal target and preserves support track', () => {
  const { project, vocal, support } = projectWithVocal();
  const command = parseSectionVocalPlosiveCommand('segura os p e b no refrão');
  const first = applySectionVocalPlosive(project, command, { plosiveEvents: evidence, now: 2000 });
  assert.equal(first.ok, true);
  assert.equal(first.project.tracks.find((track) => track.id === support.id).regionAutomation.length, 0);
  assert.equal(first.project.tracks.find((track) => track.id === vocal.id).regionAutomation.filter((event) => event.source === PABLO_SECTION_VOCAL_PLOSIVE_SOURCE).length, 2);
  const changedEvidence = [{ start: 10, end: 10.06, confidence: 0.92, intensity: 0.8, frequencyHz: 100, spectralConfidence: 0.7 }];
  const second = applySectionVocalPlosive(first.project, command, { plosiveEvents: changedEvidence, now: 3000 });
  const saved = second.project.tracks.find((track) => track.id === vocal.id).regionAutomation.filter((event) => event.source === PABLO_SECTION_VOCAL_PLOSIVE_SOURCE);
  assert.equal(saved.length, 1);
  assert.equal(second.replacedExisting, true);
  assert.equal(second.replacedCount, 2);
});

test('rejects low-frequency events without spectral evidence instead of cutting voice body', () => {
  const { project } = projectWithVocal();
  const command = parseSectionVocalPlosiveCommand('segura as plosivas no refrão');
  const weak = [{ start: 9, end: 9.05, confidence: 0.95, intensity: 0.9, frequencyHz: 120, spectralConfidence: 0.05 }];
  const plan = planSectionVocalPlosive(project, command, { plosiveEvents: weak });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, 'no_plosive_evidence');
});
