import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import {
  applySectionVocalSpace,
  parseSectionVocalSpaceCommand,
  PABLO_SECTION_VOCAL_SPACE_SOURCE,
  resolveSupportTrack,
} from '../../packages/core/src/section-vocal-space.mjs';

function projectWithVocalAndSupport() {
  const project = createProject('Vocal space', 1000);
  const vocal = createTrack({ name: 'Voz', assetId: 'voice', duration: 30, kind: 'recording' });
  const support = createTrack({ name: 'Instrumental', assetId: 'inst', duration: 30, kind: 'audio' });
  project.tracks = [vocal, support];
  project.activeTrackId = support.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 8, endSeconds: 16, source: 'user_manual', confidence: 1,
  });
  return { project, vocal, support };
}

test('parses conservative PT-BR section vocal-space commands', () => {
  assert.deepEqual(parseSectionVocalSpaceCommand('abre espaço pra minha voz só no refrão'), {
    section: 'chorus', label: 'Refrão', occurrence: null, attenuationDb: 1.5, blocked: false,
  });
  assert.deepEqual(parseSectionVocalSpaceCommand('abaixa um pouco o instrumental no segundo refrão'), {
    section: 'chorus', label: 'Refrão', occurrence: 2, attenuationDb: 1, blocked: false,
  });
  assert.equal(parseSectionVocalSpaceCommand('abre espaço pra voz'), null);
  const unsafe = parseSectionVocalSpaceCommand('reduz o instrumental 6 dB no refrão');
  assert.equal(unsafe.blocked, true);
  assert.equal(unsafe.reason, 'attenuation_out_of_safe_range');
});

test('support targeting excludes vocal, harmony, beat-fill and refuses multiple eligible bases', () => {
  const { project, vocal, support } = projectWithVocalAndSupport();
  project.tracks.push(createTrack({ name: 'Harmonia', assetId: 'h', duration: 30, kind: 'harmony' }));
  project.tracks.push(createTrack({ name: 'Virada', assetId: 'f', duration: 2, kind: 'beat-fill' }));
  assert.equal(resolveSupportTrack(project, vocal.id).track.id, support.id);

  const second = createTrack({ name: 'Beat', assetId: 'beat', duration: 30, kind: 'beat' });
  project.tracks.push(second);
  assert.equal(resolveSupportTrack(project, vocal.id).reason, 'support_track_ambiguous');
});

test('applies attenuation only to the support track, leaves vocal untouched and replaces on repeat', () => {
  const { project, vocal, support } = projectWithVocalAndSupport();
  const command = parseSectionVocalSpaceCommand('abre espaço pra minha voz só no refrão');
  const first = applySectionVocalSpace(project, command, { now: 2000 });
  assert.equal(first.ok, true);
  assert.equal(first.track.id, support.id);
  assert.equal(first.vocalTrack.id, vocal.id);
  assert.equal(first.event.startSeconds, 8);
  assert.equal(first.event.endSeconds, 16);
  assert.equal(first.event.gainDb, -1.5);
  assert.equal(first.event.source, PABLO_SECTION_VOCAL_SPACE_SOURCE);
  assert.equal(first.project.tracks.find((track) => track.id === vocal.id).regionAutomation.length, 0);

  const second = applySectionVocalSpace(first.project, command, { now: 3000 });
  const savedSupport = second.project.tracks.find((track) => track.id === support.id);
  assert.equal(second.replacedExisting, true);
  assert.equal(savedSupport.regionAutomation.filter((event) => event.source === PABLO_SECTION_VOCAL_SPACE_SOURCE).length, 1);
});

test('requires complete section, an identified vocal and one eligible support track', () => {
  const { project, vocal } = projectWithVocalAndSupport();
  const command = parseSectionVocalSpaceCommand('abre espaço pra minha voz no refrão');
  project.arrangementMap.sections[0].endSeconds = null;
  assert.equal(applySectionVocalSpace(project, command).reason, 'missing_confirmed_end');

  project.arrangementMap.sections[0].endSeconds = 16;
  vocal.kind = 'audio';
  assert.equal(applySectionVocalSpace(project, command).reason, 'vocal_track_missing');
});
