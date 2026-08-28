import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import {
  applySectionVocalPresence,
  parseSectionVocalPresenceCommand,
  PABLO_SECTION_VOCAL_PRESENCE_SOURCE,
} from '../../packages/core/src/section-vocal-presence.mjs';

function projectWithVocal() {
  const project = createProject('Presença regional', 1000);
  const vocal = createTrack({ name: 'Voz principal', assetId: 'voice', duration: 30, kind: 'recording' });
  const support = createTrack({ name: 'Instrumental', assetId: 'base', duration: 30, kind: 'audio' });
  project.tracks = [vocal, support];
  project.activeTrackId = support.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 8, endSeconds: 16, source: 'user_manual', confidence: 1,
  });
  return { project, vocal, support };
}

test('parses presence language without reusing brightness semantics and blocks unsafe gain', () => {
  assert.deepEqual(parseSectionVocalPresenceCommand('deixa minha voz mais presente só no refrão'), {
    section: 'chorus', label: 'Refrão', occurrence: null,
    gainDb: 1.8, frequencyHz: 3200, q: 0.9, blocked: false,
  });
  assert.equal(parseSectionVocalPresenceCommand('dá mais brilho à minha voz no refrão'), null);
  const unsafe = parseSectionVocalPresenceCommand('traz minha voz mais pra frente 6 dB no refrão');
  assert.equal(unsafe.blocked, true);
  assert.equal(unsafe.reason, 'presence_out_of_safe_range');
  assert.equal(unsafe.requestedGainDb, 6);
});

test('applies one idempotent peaking presence EQ only to the safe vocal track', () => {
  const { project, vocal, support } = projectWithVocal();
  const command = parseSectionVocalPresenceCommand('deixa minha voz mais presente só no refrão');
  const first = applySectionVocalPresence(project, command, { now: 2000 });
  assert.equal(first.ok, true);
  assert.equal(first.event.kind, 'peaking_eq');
  assert.equal(first.event.gainDb, 1.8);
  assert.equal(first.event.frequencyHz, 3200);
  assert.equal(first.event.q, 0.9);
  assert.equal(first.event.startSeconds, 8);
  assert.equal(first.event.endSeconds, 16);
  assert.equal(first.event.source, PABLO_SECTION_VOCAL_PRESENCE_SOURCE);
  assert.equal(first.project.tracks.find((track) => track.id === support.id).regionAutomation.length, 0);

  const second = applySectionVocalPresence(first.project, command, { now: 3000 });
  const savedVocal = second.project.tracks.find((track) => track.id === vocal.id);
  assert.equal(savedVocal.regionAutomation.filter((event) => event.source === PABLO_SECTION_VOCAL_PRESENCE_SOURCE).length, 1);
  assert.equal(second.replacedExisting, true);
});

test('presence keeps confirmed-section and vocal ambiguity gates', () => {
  const { project } = projectWithVocal();
  project.tracks.push(createTrack({ name: 'Outra voz', assetId: 'voice2', duration: 30, kind: 'voice_variant' }));
  const command = parseSectionVocalPresenceCommand('mais clareza na minha voz no refrão');
  const ambiguous = applySectionVocalPresence(project, command);
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, 'vocal_track_ambiguous');

  project.activeTrackId = project.tracks.find((track) => track.kind === 'voice_variant').id;
  const resolved = applySectionVocalPresence(project, command);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.track.kind, 'voice_variant');
});
