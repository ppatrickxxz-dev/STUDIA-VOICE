import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import { applySectionVocalGain, parseSectionVocalGainCommand } from '../../packages/core/src/section-vocal-gain.mjs';
import { applySectionVocalSpace, parseSectionVocalSpaceCommand } from '../../packages/core/src/section-vocal-space.mjs';
import {
  applySectionMixUndo,
  countSectionMixEvents,
  parseSectionMixUndoCommand,
  SECTION_MIX_UNDO_MODES,
} from '../../packages/core/src/section-mix-undo.mjs';

function mixedProject() {
  let project = createProject('Undo section mix', 1000);
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

test('parses explicit and broad Pablo section undo commands without hijacking generic undo', () => {
  assert.deepEqual(parseSectionMixUndoCommand('desfaz o ganho da voz no refrão'), {
    section: 'chorus', label: 'Refrão', occurrence: null, mode: SECTION_MIX_UNDO_MODES.VOCAL_GAIN,
  });
  assert.deepEqual(parseSectionMixUndoCommand('desfaz o espaço vocal no segundo refrão'), {
    section: 'chorus', label: 'Refrão', occurrence: 2, mode: SECTION_MIX_UNDO_MODES.VOCAL_SPACE,
  });
  assert.deepEqual(parseSectionMixUndoCommand('desfaz o que você fez no refrão'), {
    section: 'chorus', label: 'Refrão', occurrence: null, mode: SECTION_MIX_UNDO_MODES.ALL,
  });
  assert.equal(parseSectionMixUndoCommand('desfaz isso'), null);
  assert.equal(parseSectionMixUndoCommand('remove o refrão'), null);
});

test('undo vocal gain removes only Pablo vocal-gain source for the confirmed section', () => {
  const { project, vocalId, supportId, sectionId } = mixedProject();
  const command = parseSectionMixUndoCommand('desfaz o ganho da voz no refrão');
  const result = applySectionMixUndo(project, command, { now: 5000 });
  assert.equal(result.ok, true);
  assert.equal(result.removed.length, 1);
  assert.equal(countSectionMixEvents(result.project, sectionId, SECTION_MIX_UNDO_MODES.VOCAL_GAIN), 0);
  assert.equal(countSectionMixEvents(result.project, sectionId, SECTION_MIX_UNDO_MODES.VOCAL_SPACE), 1);
  const vocal = result.project.tracks.find((track) => track.id === vocalId);
  const support = result.project.tracks.find((track) => track.id === supportId);
  assert.equal(vocal.regionAutomation.some((event) => event.source === 'user_manual'), true);
  assert.equal(vocal.regionAutomation.some((event) => event.source === 'pablo_breath_intelligence'), true);
  assert.equal(support.regionAutomation.some((event) => event.source === 'pablo_section_vocal_space'), true);
});

test('broad undo removes only Pablo section-mix sources and preserves manual/breath automation', () => {
  const { project, vocalId, supportId, sectionId } = mixedProject();
  const result = applySectionMixUndo(project, parseSectionMixUndoCommand('desfaz o que você fez no refrão'), { now: 6000 });
  assert.equal(result.ok, true);
  assert.equal(result.removed.length, 2);
  assert.equal(countSectionMixEvents(result.project, sectionId, SECTION_MIX_UNDO_MODES.ALL), 0);
  const vocal = result.project.tracks.find((track) => track.id === vocalId);
  const support = result.project.tracks.find((track) => track.id === supportId);
  assert.deepEqual(vocal.regionAutomation.map((event) => event.source).sort(), ['pablo_breath_intelligence', 'user_manual']);
  assert.equal(support.regionAutomation.length, 0);
});

test('undo fails closed when no Pablo-owned target exists or section occurrence is ambiguous', () => {
  const { project } = mixedProject();
  const first = applySectionMixUndo(project, parseSectionMixUndoCommand('desfaz o ganho da voz no refrão'));
  const second = applySectionMixUndo(first.project, parseSectionMixUndoCommand('desfaz o ganho da voz no refrão'));
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'nothing_to_undo');

  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 20, endSeconds: 25, source: 'user_manual', confidence: 1,
  });
  const ambiguous = applySectionMixUndo(project, parseSectionMixUndoCommand('desfaz o que você fez no refrão'));
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, 'ambiguous_occurrence');
});
