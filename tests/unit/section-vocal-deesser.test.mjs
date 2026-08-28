import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack, migrateProject } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import {
  applySectionVocalDeEsser,
  parseSectionVocalDeEsserCommand,
  planSectionVocalDeEsser,
  PABLO_SECTION_VOCAL_DEESSER_SOURCE,
} from '../../packages/core/src/section-vocal-deesser.mjs';

function projectWithVocal() {
  const project = createProject('De-esser regional', 1000);
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
  { start: 9.0, end: 9.09, confidence: 0.88, intensity: 0.9 },
  { start: 9.105, end: 9.18, confidence: 0.82, intensity: 0.7 },
  { start: 12.4, end: 12.52, confidence: 0.73, intensity: 0.6 },
  { start: 20.0, end: 20.12, confidence: 0.96, intensity: 1 },
  { start: 14.0, end: 14.08, confidence: 0.4, intensity: 1 },
];

test('parses de-esser language without hijacking generic less-brightness requests', () => {
  const parsed = parseSectionVocalDeEsserCommand('segura os esses da minha voz só no refrão');
  assert.equal(parsed.section, 'chorus');
  assert.equal(parsed.maxReductionDb, 3.2);
  assert.equal(parsed.frequencyHz, 7200);
  assert.equal(parsed.blocked, false);
  assert.equal(parseSectionVocalDeEsserCommand('deixa minha voz com menos brilho no refrão'), null);
  const unsafe = parseSectionVocalDeEsserCommand('tira os esses da minha voz 8 dB no refrão');
  assert.equal(unsafe.blocked, true);
  assert.equal(unsafe.reason, 'deesser_out_of_safe_range');
});

test('requires acoustic sibilance evidence instead of creating whole-section EQ', () => {
  const { project } = projectWithVocal();
  const command = parseSectionVocalDeEsserCommand('reduz a sibilância no refrão');
  const missing = planSectionVocalDeEsser(project, command);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'sibilance_analysis_required');
  const empty = planSectionVocalDeEsser(project, command, { sibilanceEvents: [] });
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'no_sibilance_evidence');
});

test('turns only confident in-section sibilance into bounded micro peaking cuts', () => {
  const { project } = projectWithVocal();
  const command = parseSectionVocalDeEsserCommand('segura os esses da minha voz só no refrão');
  const plan = planSectionVocalDeEsser(project, command, { sibilanceEvents: evidence, analysisSource: 'local-heuristic-v1' });
  assert.equal(plan.ok, true);
  assert.equal(plan.detectedCount, 2);
  assert.equal(plan.analysisSource, 'local-heuristic-v1');
  for (const event of plan.events) {
    assert.equal(event.kind, 'peaking_eq');
    assert.equal(event.frequencyHz, 7200);
    assert.equal(event.q, 1.5);
    assert.ok(event.gainDb <= -1.2 && event.gainDb >= -3.2);
    assert.ok(event.startSeconds >= 8 && event.endSeconds <= 16);
    assert.ok(event.endSeconds - event.startSeconds < 0.5);
    assert.equal(event.source, PABLO_SECTION_VOCAL_DEESSER_SOURCE);
    assert.ok(event.id.endsWith(`:${plan.section.id}`));
  }
});

test('applies idempotent de-esser windows only to the resolved vocal track', () => {
  const { project, vocal, support } = projectWithVocal();
  const command = parseSectionVocalDeEsserCommand('segura os esses da minha voz no refrão');
  const first = applySectionVocalDeEsser(project, command, { sibilanceEvents: evidence, now: 2000 });
  assert.equal(first.ok, true);
  assert.equal(first.project.tracks.find((track) => track.id === support.id).regionAutomation.length, 0);
  assert.equal(first.project.tracks.find((track) => track.id === vocal.id).regionAutomation.filter((event) => event.source === PABLO_SECTION_VOCAL_DEESSER_SOURCE).length, 2);

  const changedEvidence = [{ start: 10, end: 10.12, confidence: 0.9, intensity: 0.8 }];
  const second = applySectionVocalDeEsser(first.project, command, { sibilanceEvents: changedEvidence, now: 3000 });
  const saved = second.project.tracks.find((track) => track.id === vocal.id).regionAutomation.filter((event) => event.source === PABLO_SECTION_VOCAL_DEESSER_SOURCE);
  assert.equal(saved.length, 1);
  assert.equal(second.replacedExisting, true);
  assert.equal(second.replacedCount, 2);
});

test('schema v8 preserves sibilance-band peaking frequency instead of clamping it to presence band', () => {
  const { project } = projectWithVocal();
  const applied = applySectionVocalDeEsser(project, parseSectionVocalDeEsserCommand('tira os esses no refrão'), { sibilanceEvents: evidence });
  const migrated = migrateProject(applied.project);
  const deEsser = migrated.tracks.find((track) => track.kind === 'recording').regionAutomation.filter((event) => event.source === PABLO_SECTION_VOCAL_DEESSER_SOURCE);
  assert.equal(migrated.schemaVersion, 8);
  assert.equal(deEsser.length, 2);
  assert.ok(deEsser.every((event) => event.frequencyHz === 7200));
});
