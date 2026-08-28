import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import { PABLO_SECTION_VOCAL_CLEANUP_SOURCES } from '../../packages/core/src/section-vocal-cleanup.mjs';
import {
  applySectionMixUndo,
  parseSectionMixUndoCommand,
  SECTION_MIX_UNDO_MODES,
} from '../../packages/core/src/section-mix-undo.mjs';
import {
  buildSectionMixABVariant,
  parseSectionMixABCommand,
  planSectionMixAB,
  SECTION_MIX_AB_MODES,
} from '../../packages/core/src/section-mix-ab.mjs';

function restorationProject() {
  const project = createProject('Selective restoration A/B undo', 1000);
  const vocal = createTrack({ name: 'Voz', assetId: 'voice', duration: 20, kind: 'recording' });
  project.tracks = [vocal];
  project.activeTrackId = vocal.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 4, endSeconds: 12, source: 'user_manual', confidence: 1,
  });
  const sectionId = project.arrangementMap.sections[0].id;
  vocal.regionAutomation.push(
    {
      id: `denoise:${vocal.id}:1:${sectionId}`, kind: 'vocal_denoise', startSeconds: 4, endSeconds: 12,
      thresholdDb: -42, reductionDb: 3, noiseFloorDb: -48, voicedLevelDb: -20, snrDb: 28, voicedMarginDb: 14,
      confidence: 0.9, source: PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DENOISE, enabled: true,
    },
    {
      id: `dereverb:${vocal.id}:1:${sectionId}`, kind: 'vocal_dereverb', startSeconds: 4, endSeconds: 12,
      reflectionDelayMs: 36, amount: 0.15, dampingHz: 5200, correlation: 0.8, prominence: 0.75,
      confidence: 0.88, source: PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DEREVERB, enabled: true,
    },
    {
      id: `manual:${sectionId}`, kind: 'gain', startSeconds: 5, endSeconds: 6, gainDb: 0.4,
      confidence: 1, source: 'user_manual', enabled: true,
    },
  );
  return { project, sectionId, vocalId: vocal.id };
}

function sources(project, vocalId) {
  return project.tracks.find((track) => track.id === vocalId).regionAutomation.map((event) => event.source);
}

test('parses selective restoration A/B and undo while keeping broad commands broad', () => {
  assert.equal(parseSectionMixABCommand('compara só o denoise no refrão').mode, SECTION_MIX_AB_MODES.DENOISE);
  assert.equal(parseSectionMixABCommand('compara só o de-reverb no refrão').mode, SECTION_MIX_AB_MODES.DEREVERB);
  assert.equal(parseSectionMixABCommand('compara o refrão').mode, SECTION_MIX_AB_MODES.ALL);
  assert.equal(parseSectionMixUndoCommand('desfaz só o denoise no refrão').mode, SECTION_MIX_UNDO_MODES.VOCAL_DENOISE);
  assert.equal(parseSectionMixUndoCommand('desfaz só o de-reverb no refrão').mode, SECTION_MIX_UNDO_MODES.VOCAL_DEREVERB);
  assert.equal(parseSectionMixUndoCommand('desfaz a limpeza no refrão').mode, SECTION_MIX_UNDO_MODES.VOCAL_CLEANUP);
});

test('selective A removes only requested restoration family and never mutates persisted input', () => {
  const { project, sectionId, vocalId } = restorationProject();
  const before = structuredClone(project);
  const denoisePlan = planSectionMixAB(project, parseSectionMixABCommand('compara só o denoise no refrão'));
  assert.equal(denoisePlan.ok, true);
  assert.deepEqual(denoisePlan.sources, [PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DENOISE]);
  const aDenoise = buildSectionMixABVariant(project, sectionId, 'A', denoisePlan.mode);
  assert.equal(aDenoise.removed.length, 1);
  assert.equal(sources(aDenoise.project, vocalId).includes(PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DENOISE), false);
  assert.equal(sources(aDenoise.project, vocalId).includes(PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DEREVERB), true);
  assert.equal(sources(aDenoise.project, vocalId).includes('user_manual'), true);
  assert.deepEqual(project, before);

  const dereverbPlan = planSectionMixAB(project, parseSectionMixABCommand('compara só o de-reverb no refrão'));
  const aDereverb = buildSectionMixABVariant(project, sectionId, 'A', dereverbPlan.mode);
  assert.equal(sources(aDereverb.project, vocalId).includes(PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DEREVERB), false);
  assert.equal(sources(aDereverb.project, vocalId).includes(PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DENOISE), true);
  assert.equal(sources(aDereverb.project, vocalId).includes('user_manual'), true);
});

test('B is an unchanged clone and selective undo preserves the other restoration plus manual automation', () => {
  const { project, sectionId, vocalId } = restorationProject();
  const b = buildSectionMixABVariant(project, sectionId, 'B', SECTION_MIX_AB_MODES.DENOISE);
  assert.notEqual(b.project, project);
  assert.deepEqual(sources(b.project, vocalId).sort(), sources(project, vocalId).sort());

  const undoDenoise = applySectionMixUndo(project, parseSectionMixUndoCommand('desfaz só o denoise no refrão'), { now: 5000 });
  assert.equal(undoDenoise.ok, true);
  assert.equal(undoDenoise.removed.length, 1);
  assert.equal(sources(undoDenoise.project, vocalId).includes(PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DENOISE), false);
  assert.equal(sources(undoDenoise.project, vocalId).includes(PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DEREVERB), true);
  assert.equal(sources(undoDenoise.project, vocalId).includes('user_manual'), true);

  const undoDereverb = applySectionMixUndo(project, parseSectionMixUndoCommand('desfaz só o de-reverb no refrão'), { now: 6000 });
  assert.equal(undoDereverb.ok, true);
  assert.equal(undoDereverb.removed.length, 1);
  assert.equal(sources(undoDereverb.project, vocalId).includes(PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DEREVERB), false);
  assert.equal(sources(undoDereverb.project, vocalId).includes(PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DENOISE), true);
  assert.equal(sources(undoDereverb.project, vocalId).includes('user_manual'), true);
});

test('selective comparison fails closed when only the other restoration exists', () => {
  const { project, vocalId } = restorationProject();
  const vocal = project.tracks.find((track) => track.id === vocalId);
  vocal.regionAutomation = vocal.regionAutomation.filter((event) => event.source !== PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DENOISE);
  const plan = planSectionMixAB(project, parseSectionMixABCommand('compara só o denoise no refrão'));
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, 'nothing_to_compare');
});
