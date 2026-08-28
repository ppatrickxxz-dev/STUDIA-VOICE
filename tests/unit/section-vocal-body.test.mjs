import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack, migrateProject } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import {
  applySectionVocalBody,
  parseSectionVocalBodyCommand,
  PABLO_SECTION_VOCAL_BODY_SOURCE,
} from '../../packages/core/src/section-vocal-body.mjs';

function projectWithVocal() {
  const project = createProject('Corpo regional', 1000);
  const vocal = createTrack({ name: 'Voz principal', assetId: 'voice', duration: 30, kind: 'recording' });
  const support = createTrack({ name: 'Instrumental', assetId: 'base', duration: 30, kind: 'audio' });
  project.tracks = [vocal, support];
  project.activeTrackId = support.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 8, endSeconds: 16, source: 'user_manual', confidence: 1,
  });
  return { project, vocal, support };
}

test('parses body and warmth language while blocking unsafe boosts', () => {
  assert.deepEqual(parseSectionVocalBodyCommand('dá mais corpo à minha voz só no refrão'), {
    section: 'chorus', label: 'Refrão', occurrence: null,
    gainDb: 1.5, frequencyHz: 220, q: 0.82, blocked: false,
  });
  assert.equal(parseSectionVocalBodyCommand('deixa minha voz mais quente no refrão').gainDb, 1.5);
  const unsafe = parseSectionVocalBodyCommand('coloca corpo na minha voz 5 dB no refrão');
  assert.equal(unsafe.blocked, true);
  assert.equal(unsafe.reason, 'body_out_of_safe_range');
  assert.equal(unsafe.requestedGainDb, 5);
});

test('applies one idempotent broad peaking EQ only to the safe vocal track', () => {
  const { project, vocal, support } = projectWithVocal();
  const command = parseSectionVocalBodyCommand('dá mais corpo à minha voz só no refrão');
  const first = applySectionVocalBody(project, command, { now: 2000 });
  assert.equal(first.ok, true);
  assert.equal(first.event.kind, 'peaking_eq');
  assert.equal(first.event.gainDb, 1.5);
  assert.equal(first.event.frequencyHz, 220);
  assert.equal(first.event.q, 0.82);
  assert.equal(first.event.startSeconds, 8);
  assert.equal(first.event.endSeconds, 16);
  assert.equal(first.event.source, PABLO_SECTION_VOCAL_BODY_SOURCE);
  assert.equal(first.project.tracks.find((track) => track.id === support.id).regionAutomation.length, 0);

  const second = applySectionVocalBody(first.project, command, { now: 3000 });
  const savedVocal = second.project.tracks.find((track) => track.id === vocal.id);
  assert.equal(savedVocal.regionAutomation.filter((event) => event.source === PABLO_SECTION_VOCAL_BODY_SOURCE).length, 1);
  assert.equal(second.replacedExisting, true);
});

test('regional peaking EQ survives project migration with frequency and Q metadata', () => {
  const { project } = projectWithVocal();
  const applied = applySectionVocalBody(project, parseSectionVocalBodyCommand('dá mais corpo à minha voz no refrão'));
  const migrated = migrateProject(applied.project);
  const event = migrated.tracks.find((track) => track.kind === 'recording').regionAutomation.find((item) => item.source === PABLO_SECTION_VOCAL_BODY_SOURCE);
  assert.equal(migrated.schemaVersion, 7);
  assert.equal(event.kind, 'peaking_eq');
  assert.equal(event.frequencyHz, 220);
  assert.equal(event.q, 0.82);
  assert.equal(event.gainDb, 1.5);
});

test('body uses the same confirmed-section and vocal ambiguity gates as other regional edits', () => {
  const { project } = projectWithVocal();
  project.tracks.push(createTrack({ name: 'Outra voz', assetId: 'voice2', duration: 30, kind: 'voice_variant' }));
  const command = parseSectionVocalBodyCommand('dá mais corpo à minha voz no refrão');
  const ambiguous = applySectionVocalBody(project, command);
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, 'vocal_track_ambiguous');

  project.activeTrackId = project.tracks.find((track) => track.kind === 'voice_variant').id;
  const resolved = applySectionVocalBody(project, command);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.track.kind, 'voice_variant');
});
