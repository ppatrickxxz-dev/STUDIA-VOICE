import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import { applySectionVocalGain, parseSectionVocalGainCommand } from '../../packages/core/src/section-vocal-gain.mjs';
import { applySectionVocalSpace, parseSectionVocalSpaceCommand } from '../../packages/core/src/section-vocal-space.mjs';
import {
  buildSectionMixABVariant,
  parseSectionMixABCommand,
  planSectionMixAB,
} from '../../packages/core/src/section-mix-ab.mjs';

function mixedProject() {
  let project = createProject('A/B section mix', 1000);
  const vocal = createTrack({ name: 'Voz', assetId: 'voice', duration: 30, kind: 'recording' });
  const support = createTrack({ name: 'Base', assetId: 'base', duration: 30, kind: 'audio' });
  project.tracks = [vocal, support];
  project.activeTrackId = support.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 8, endSeconds: 16, source: 'user_manual', confidence: 1,
  });
  project = applySectionVocalGain(project, parseSectionVocalGainCommand('aumenta minha voz no refrão')).project;
  project = applySectionVocalSpace(project, parseSectionVocalSpaceCommand('abre espaço pra minha voz no refrão')).project;
  const savedVocal = project.tracks.find((track) => track.id === vocal.id);
  savedVocal.regionAutomation.push(
    { id: 'manual_gain_1', kind: 'gain', startSeconds: 9, endSeconds: 10, gainDb: -0.5, confidence: 1, source: 'user_manual', enabled: true },
    { id: 'breath_1', kind: 'gain', startSeconds: 11, endSeconds: 11.2, gainDb: -2, confidence: 0.9, source: 'pablo_breath_intelligence', enabled: true },
  );
  return { project, vocalId: vocal.id, supportId: support.id, sectionId: project.arrangementMap.sections[0].id };
}

test('parses A/B requests without hijacking ordinary section audition', () => {
  assert.deepEqual(parseSectionMixABCommand('compara o refrão'), {
    section: 'chorus', label: 'Refrão', occurrence: null,
  });
  assert.deepEqual(parseSectionMixABCommand('faz A/B do segundo refrão'), {
    section: 'chorus', label: 'Refrão', occurrence: 2,
  });
  assert.deepEqual(parseSectionMixABCommand('ouve antes e depois da ponte'), {
    section: 'bridge', label: 'Ponte', occurrence: null,
  });
  assert.equal(parseSectionMixABCommand('toca o refrão'), null);
  assert.equal(parseSectionMixABCommand('compara essa parte'), null);
});

test('A removes only Pablo section-mix events and preserves the rest of the processed mix', () => {
  const { project, vocalId, supportId, sectionId } = mixedProject();
  const before = structuredClone(project);
  const plan = planSectionMixAB(project, parseSectionMixABCommand('compara o refrão'));
  assert.equal(plan.ok, true);
  assert.equal(plan.matches.length, 2);

  const a = buildSectionMixABVariant(project, sectionId, 'A');
  const vocal = a.project.tracks.find((track) => track.id === vocalId);
  const support = a.project.tracks.find((track) => track.id === supportId);
  assert.equal(a.removed.length, 2);
  assert.deepEqual(vocal.regionAutomation.map((event) => event.source).sort(), ['pablo_breath_intelligence', 'user_manual']);
  assert.equal(support.regionAutomation.length, 0);
  assert.deepEqual(project, before);
});

test('B preserves the exact persisted section-mix automation while still cloning project state', () => {
  const { project, sectionId } = mixedProject();
  const b = buildSectionMixABVariant(project, sectionId, 'B');
  assert.equal(b.removed.length, 0);
  assert.notEqual(b.project, project);
  assert.equal(b.project.tracks.flatMap((track) => track.regionAutomation).filter((event) => event.source === 'pablo_section_vocal_gain').length, 1);
  assert.equal(b.project.tracks.flatMap((track) => track.regionAutomation).filter((event) => event.source === 'pablo_section_vocal_space').length, 1);
});

test('A/B fails closed without Pablo edits and when a section occurrence is ambiguous', () => {
  const { project } = mixedProject();
  const clean = structuredClone(project);
  for (const track of clean.tracks) {
    track.regionAutomation = track.regionAutomation.filter((event) => !String(event.source).startsWith('pablo_section_'));
  }
  const empty = planSectionMixAB(clean, parseSectionMixABCommand('compara o refrão'));
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'nothing_to_compare');

  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 20, endSeconds: 25, source: 'user_manual', confidence: 1,
  });
  const ambiguous = planSectionMixAB(project, parseSectionMixABCommand('compara o refrão'));
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, 'ambiguous_occurrence');
});
