import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack, migrateProject } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import {
  applySectionVocalDynamics,
  parseSectionVocalDynamicsCommand,
  PABLO_SECTION_VOCAL_DYNAMICS_SOURCE,
} from '../../packages/core/src/section-vocal-dynamics.mjs';

function projectWithVocal() {
  const project = createProject('Dinâmica regional', 1000);
  const vocal = createTrack({ name: 'Voz principal', assetId: 'voice', duration: 30, kind: 'recording' });
  const support = createTrack({ name: 'Instrumental', assetId: 'base', duration: 30, kind: 'audio' });
  project.tracks = [vocal, support];
  project.activeTrackId = support.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 8, endSeconds: 16, source: 'user_manual', confidence: 1,
  });
  return { project, vocal, support };
}

test('parses safe regional peak control and rejects aggressive explicit ratio', () => {
  const command = parseSectionVocalDynamicsCommand('segura os picos da minha voz só no refrão');
  assert.equal(command.section, 'chorus');
  assert.equal(command.thresholdDb, -18);
  assert.equal(command.ratio, 2.2);
  assert.equal(command.blocked, false);
  const explicit = parseSectionVocalDynamicsCommand('comprime minha voz 3:1 no refrão');
  assert.equal(explicit.ratio, 3);
  const unsafe = parseSectionVocalDynamicsCommand('comprime minha voz 8:1 no refrão');
  assert.equal(unsafe.blocked, true);
  assert.equal(unsafe.reason, 'dynamics_out_of_safe_range');
  assert.equal(unsafe.requestedRatio, 8);
});

test('applies one idempotent compressor only to the resolved vocal track', () => {
  const { project, vocal, support } = projectWithVocal();
  const command = parseSectionVocalDynamicsCommand('segura os picos da minha voz só no refrão');
  const first = applySectionVocalDynamics(project, command, { now: 2000 });
  assert.equal(first.ok, true);
  assert.equal(first.event.kind, 'compressor');
  assert.equal(first.event.thresholdDb, -18);
  assert.equal(first.event.ratio, 2.2);
  assert.equal(first.event.startSeconds, 8);
  assert.equal(first.event.endSeconds, 16);
  assert.equal(first.event.source, PABLO_SECTION_VOCAL_DYNAMICS_SOURCE);
  assert.equal(first.project.tracks.find((track) => track.id === support.id).regionAutomation.length, 0);
  const second = applySectionVocalDynamics(first.project, command, { now: 3000 });
  const savedVocal = second.project.tracks.find((track) => track.id === vocal.id);
  assert.equal(savedVocal.regionAutomation.filter((event) => event.source === PABLO_SECTION_VOCAL_DYNAMICS_SOURCE).length, 1);
  assert.equal(second.replacedExisting, true);
});

test('schema v8 migration preserves regional compressor metadata', () => {
  const { project } = projectWithVocal();
  const applied = applySectionVocalDynamics(project, parseSectionVocalDynamicsCommand('segura os picos da minha voz no refrão'));
  const migrated = migrateProject(applied.project);
  const event = migrated.tracks.find((track) => track.kind === 'recording').regionAutomation.find((item) => item.source === PABLO_SECTION_VOCAL_DYNAMICS_SOURCE);
  assert.equal(migrated.schemaVersion, 8);
  assert.equal(event.kind, 'compressor');
  assert.equal(event.thresholdDb, -18);
  assert.equal(event.ratio, 2.2);
  assert.equal(event.kneeDb, 6);
  assert.equal(event.attackSeconds, 0.006);
  assert.equal(event.releaseSeconds, 0.12);
});

test('dynamics keeps vocal ambiguity gates instead of selecting by track name', () => {
  const { project } = projectWithVocal();
  project.tracks.push(createTrack({ name: 'Outra voz', assetId: 'voice2', duration: 30, kind: 'voice_variant' }));
  const command = parseSectionVocalDynamicsCommand('controla a dinâmica da minha voz no refrão');
  const ambiguous = applySectionVocalDynamics(project, command);
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, 'vocal_track_ambiguous');
  project.activeTrackId = project.tracks.find((track) => track.kind === 'voice_variant').id;
  const resolved = applySectionVocalDynamics(project, command);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.track.kind, 'voice_variant');
});
