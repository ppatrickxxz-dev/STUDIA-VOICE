import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import {
  applySectionVocalSoftness,
  parseSectionVocalSoftnessCommand,
  PABLO_SECTION_VOCAL_SOFTNESS_SOURCE,
  SOFTNESS_MODES,
} from '../../packages/core/src/section-vocal-softness.mjs';

function projectWithVocal() {
  const project = createProject('Suavização regional', 1000);
  const vocal = createTrack({ name: 'Voz principal', assetId: 'voice', duration: 30, kind: 'recording' });
  const support = createTrack({ name: 'Instrumental', assetId: 'base', duration: 30, kind: 'audio' });
  project.tracks = [vocal, support];
  project.activeTrackId = support.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 8, endSeconds: 16, source: 'user_manual', confidence: 1,
  });
  return { project, vocal, support };
}

test('maps less brightness and less harshness to different safe EQ shapes', () => {
  const darken = parseSectionVocalSoftnessCommand('deixa minha voz com menos brilho no refrão');
  assert.equal(darken.mode, SOFTNESS_MODES.DARKEN);
  assert.equal(darken.kind, 'high_shelf');
  assert.equal(darken.gainDb, -2);
  assert.equal(darken.frequencyHz, 6500);

  const deharsh = parseSectionVocalSoftnessCommand('deixa minha voz menos estridente no refrão');
  assert.equal(deharsh.mode, SOFTNESS_MODES.DEHARSH);
  assert.equal(deharsh.kind, 'peaking_eq');
  assert.equal(deharsh.gainDb, -1.5);
  assert.equal(deharsh.frequencyHz, 3800);
  assert.equal(deharsh.q, 1.15);
});

test('blocks excessive reductions instead of silently clamping intent', () => {
  const darken = parseSectionVocalSoftnessCommand('deixa minha voz com menos brilho 6 dB no refrão');
  assert.equal(darken.blocked, true);
  assert.equal(darken.maxReductionDb, 4);
  const deharsh = parseSectionVocalSoftnessCommand('deixa minha voz menos estridente 5 dB no refrão');
  assert.equal(deharsh.blocked, true);
  assert.equal(deharsh.maxReductionDb, 3);
});

test('one Pablo softness slot replaces darken with deharsh instead of stacking hidden tone cuts', () => {
  const { project, vocal, support } = projectWithVocal();
  const first = applySectionVocalSoftness(project, parseSectionVocalSoftnessCommand('deixa minha voz com menos brilho no refrão'), { now: 2000 });
  assert.equal(first.ok, true);
  assert.equal(first.event.kind, 'high_shelf');
  assert.equal(first.event.source, PABLO_SECTION_VOCAL_SOFTNESS_SOURCE);
  assert.equal(first.project.tracks.find((track) => track.id === support.id).regionAutomation.length, 0);

  const second = applySectionVocalSoftness(first.project, parseSectionVocalSoftnessCommand('deixa minha voz menos estridente no refrão'), { now: 3000 });
  const savedVocal = second.project.tracks.find((track) => track.id === vocal.id);
  const softness = savedVocal.regionAutomation.filter((event) => event.source === PABLO_SECTION_VOCAL_SOFTNESS_SOURCE);
  assert.equal(softness.length, 1);
  assert.equal(softness[0].kind, 'peaking_eq');
  assert.equal(softness[0].frequencyHz, 3800);
  assert.equal(softness[0].gainDb, -1.5);
  assert.equal(second.replacedExisting, true);
});

test('softness reuses confirmed section and vocal ambiguity gates', () => {
  const { project } = projectWithVocal();
  project.tracks.push(createTrack({ name: 'Outra voz', assetId: 'voice2', duration: 30, kind: 'voice_variant' }));
  const command = parseSectionVocalSoftnessCommand('deixa minha voz menos estridente no refrão');
  const ambiguous = applySectionVocalSoftness(project, command);
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, 'vocal_track_ambiguous');
  project.activeTrackId = project.tracks.find((track) => track.kind === 'voice_variant').id;
  assert.equal(applySectionVocalSoftness(project, command).ok, true);
});
