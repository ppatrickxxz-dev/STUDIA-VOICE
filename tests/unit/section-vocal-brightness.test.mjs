import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack, migrateProject } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import { applySectionVocalBrightness, parseSectionVocalBrightnessCommand, PABLO_SECTION_VOCAL_BRIGHTNESS_SOURCE } from '../../packages/core/src/section-vocal-brightness.mjs';

function projectWithVocal() {
  const project = createProject('Brilho regional', 1000);
  const vocal = createTrack({ name: 'Voz principal', assetId: 'voice', duration: 30, kind: 'recording' });
  const support = createTrack({ name: 'Instrumental', assetId: 'base', duration: 30, kind: 'audio' });
  project.tracks = [vocal, support]; project.activeTrackId = support.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, { kind: 'chorus', startSeconds: 8, endSeconds: 16, source: 'user_manual', confidence: 1 });
  return { project, vocal, support };
}

test('parses a simple brightness request and blocks unsafe shelf gain', () => {
  assert.deepEqual(parseSectionVocalBrightnessCommand('dá mais brilho à minha voz só no refrão'), { section: 'chorus', label: 'Refrão', occurrence: null, gainDb: 2.5, frequencyHz: 6500, blocked: false });
  const unsafe = parseSectionVocalBrightnessCommand('coloca brilho na minha voz 8 dB no refrão'); assert.equal(unsafe.blocked, true); assert.equal(unsafe.reason, 'brightness_out_of_safe_range'); assert.equal(unsafe.requestedGainDb, 8);
});

test('applies one idempotent high shelf only to the safe vocal track', () => {
  const { project, vocal, support } = projectWithVocal(); const command = parseSectionVocalBrightnessCommand('dá mais brilho à minha voz só no refrão');
  const first = applySectionVocalBrightness(project, command, { now: 2000 });
  assert.equal(first.ok, true); assert.equal(first.event.kind, 'high_shelf'); assert.equal(first.event.gainDb, 2.5); assert.equal(first.event.frequencyHz, 6500); assert.equal(first.event.startSeconds, 8); assert.equal(first.event.endSeconds, 16); assert.equal(first.event.source, PABLO_SECTION_VOCAL_BRIGHTNESS_SOURCE);
  assert.equal(first.project.tracks.find((track) => track.id === support.id).regionAutomation.length, 0);
  const second = applySectionVocalBrightness(first.project, command, { now: 3000 }); const savedVocal = second.project.tracks.find((track) => track.id === vocal.id);
  assert.equal(savedVocal.regionAutomation.filter((event) => event.source === PABLO_SECTION_VOCAL_BRIGHTNESS_SOURCE).length, 1); assert.equal(second.replacedExisting, true);
});

test('regional high shelf survives project migration with frequency metadata', () => {
  const { project } = projectWithVocal(); const applied = applySectionVocalBrightness(project, parseSectionVocalBrightnessCommand('dá mais brilho à minha voz no refrão')); const migrated = migrateProject(applied.project);
  const event = migrated.tracks.find((track) => track.kind === 'recording').regionAutomation.find((item) => item.source === PABLO_SECTION_VOCAL_BRIGHTNESS_SOURCE);
  assert.equal(migrated.schemaVersion, 8); assert.equal(event.kind, 'high_shelf'); assert.equal(event.frequencyHz, 6500); assert.equal(event.gainDb, 2.5);
});

test('brightness uses confirmed-section and vocal ambiguity gates already established by section editing', () => {
  const { project } = projectWithVocal(); project.tracks.push(createTrack({ name: 'Outra voz', assetId: 'voice2', duration: 30, kind: 'voice_variant' })); const command = parseSectionVocalBrightnessCommand('dá mais brilho à minha voz no refrão');
  const ambiguous = applySectionVocalBrightness(project, command); assert.equal(ambiguous.ok, false); assert.equal(ambiguous.reason, 'vocal_track_ambiguous');
  project.activeTrackId = project.tracks.find((track) => track.kind === 'voice_variant').id; const resolved = applySectionVocalBrightness(project, command); assert.equal(resolved.ok, true); assert.equal(resolved.track.kind, 'voice_variant');
});
