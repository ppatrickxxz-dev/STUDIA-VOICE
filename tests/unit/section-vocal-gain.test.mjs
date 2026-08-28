import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import {
  applySectionVocalGain,
  parseSectionVocalGainCommand,
  PABLO_SECTION_VOCAL_GAIN_SOURCE,
  resolveVocalTrack,
  timelineRangeToSourceRegion,
} from '../../packages/core/src/section-vocal-gain.mjs';

function projectWithSection() {
  const project = createProject('Section gain', 1000);
  const vocal = createTrack({ name: 'Minha voz', assetId: 'voice-a', duration: 30, sampleRate: 48000, kind: 'recording' });
  const instrumental = createTrack({ name: 'Beat', assetId: 'beat-a', duration: 30, sampleRate: 48000, kind: 'audio' });
  project.tracks = [vocal, instrumental];
  project.activeTrackId = instrumental.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 10, endSeconds: 18, source: 'user_manual', confidence: 1,
  });
  return { project, vocal, instrumental };
}

test('parses bounded PT-BR vocal gain commands scoped to a confirmed section', () => {
  assert.deepEqual(parseSectionVocalGainCommand('aumenta minha voz só no refrão'), {
    section: 'chorus', label: 'Refrão', occurrence: null, gainDb: 2, blocked: false,
  });
  assert.deepEqual(parseSectionVocalGainCommand('sobe um pouco minha voz no segundo refrão'), {
    section: 'chorus', label: 'Refrão', occurrence: 2, gainDb: 1.5, blocked: false,
  });
  assert.equal(parseSectionVocalGainCommand('voz mais presente no mix'), null);
  assert.equal(parseSectionVocalGainCommand('aumenta o refrão'), null);
  const unsafe = parseSectionVocalGainCommand('aumenta minha voz 8 dB no refrão');
  assert.equal(unsafe.blocked, true);
  assert.equal(unsafe.reason, 'gain_out_of_safe_range');
});

test('vocal targeting uses recording/voice_variant evidence and fails closed on ambiguity', () => {
  const { project, vocal } = projectWithSection();
  assert.equal(resolveVocalTrack(project).track.id, vocal.id);

  const second = createTrack({ name: 'Variante', assetId: 'voice-b', duration: 30, kind: 'voice_variant' });
  project.tracks.push(second);
  project.activeTrackId = project.tracks.find((track) => track.kind === 'audio').id;
  assert.equal(resolveVocalTrack(project).reason, 'vocal_track_ambiguous');
  project.activeTrackId = second.id;
  assert.equal(resolveVocalTrack(project).track.id, second.id);
});

test('timeline section maps back to source coordinates with trim, offset and pitch rate', () => {
  const track = createTrack({ name: 'Voz', assetId: 'voice', duration: 40, kind: 'recording' });
  track.offset = 4;
  track.trimStart = 6;
  track.trimEnd = 30;
  track.effects.pitchSemitones = 12;
  const mapped = timelineRangeToSourceRegion(track, 7, 11);
  assert.equal(mapped.ok, true);
  assert.equal(mapped.startSeconds, 12);
  assert.equal(mapped.endSeconds, 20);
  assert.equal(mapped.timelineStartSeconds, 7);
  assert.equal(mapped.timelineEndSeconds, 11);
});

test('applies one reversible Pablo-owned region only to the vocal track and replaces on repeat', () => {
  const { project, vocal, instrumental } = projectWithSection();
  const command = parseSectionVocalGainCommand('aumenta minha voz só no refrão');
  const first = applySectionVocalGain(project, command, { now: 2000 });
  assert.equal(first.ok, true);
  assert.equal(first.track.id, vocal.id);
  assert.equal(first.event.startSeconds, 10);
  assert.equal(first.event.endSeconds, 18);
  assert.equal(first.event.gainDb, 2);
  assert.equal(first.event.source, PABLO_SECTION_VOCAL_GAIN_SOURCE);
  assert.equal(first.project.tracks.find((track) => track.id === instrumental.id).regionAutomation.length, 0);

  const second = applySectionVocalGain(first.project, command, { now: 3000 });
  const savedVocal = second.project.tracks.find((track) => track.id === vocal.id);
  assert.equal(second.replacedExisting, true);
  assert.equal(savedVocal.regionAutomation.filter((event) => event.source === PABLO_SECTION_VOCAL_GAIN_SOURCE).length, 1);
});

test('requires a complete confirmed occurrence and real overlap with the vocal track', () => {
  const { project } = projectWithSection();
  project.arrangementMap.sections[0].endSeconds = null;
  const command = parseSectionVocalGainCommand('sobe minha voz no refrão');
  assert.equal(applySectionVocalGain(project, command).reason, 'missing_confirmed_end');

  project.arrangementMap.sections[0].endSeconds = 18;
  const vocal = project.tracks.find((track) => track.kind === 'recording');
  vocal.offset = 22;
  assert.equal(applySectionVocalGain(project, command).reason, 'section_outside_vocal_track');
});
