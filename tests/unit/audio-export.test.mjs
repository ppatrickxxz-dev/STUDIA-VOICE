import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { prepareAudioExport } from '../../packages/core/src/audio-export.mjs';

function projectWithTrack() {
  const project = createProject('Export real', 1000);
  const track = createTrack({ name: 'Voz', assetId: 'asset_voice', duration: 4, kind: 'recording' });
  track.regionAutomation.push(
    { id: 'gain', kind: 'gain', startSeconds: 0, endSeconds: 1, gainDb: -2, source: 'pablo_section_vocal_gain', enabled: true },
    { id: 'cleanup', kind: 'vocal_denoise', startSeconds: 1, endSeconds: 2, reductionDb: 3, thresholdDb: -42, voicedLevelDb: -18, snrDb: 12, voicedMarginDb: 24, timbreProtected: true, guardSource: 'bounded-vocal-timbre-guard-v1', source: 'pablo_section_vocal_cleanup_denoise', enabled: true },
    { id: 'restoration', kind: 'vocal_dereverb', startSeconds: 2, endSeconds: 3, amount: 0.1, reflectionDelayMs: 36, correlation: 0.4, prominence: 0.2, timbreProtected: true, guardSource: 'bounded-vocal-timbre-guard-v1', source: 'pablo_section_vocal_cleanup_dereverb', enabled: true },
  );
  project.tracks.push(track);
  project.activeTrackId = track.id;
  return project;
}

test('export snapshot keeps saved regional treatment, restoration, and cleanup without adding or duplicating filters', () => {
  const project = projectWithTrack();
  const before = structuredClone(project);
  const exported = prepareAudioExport(project, { hasBuffer: () => true });
  assert.deepEqual(
    exported.tracks[0].regionAutomation.map(({ id, kind, source }) => ({ id, kind, source })),
    before.tracks[0].regionAutomation.map(({ id, kind, source }) => ({ id, kind, source })),
  );
  assert.equal(exported.tracks[0].regionAutomation.length, 3);
  assert.deepEqual(project, before);
  assert.notEqual(exported, project);
});

test('export fails closed for invalid project, track asset, and missing decoded audio', () => {
  assert.throws(() => prepareAudioExport(null, { hasBuffer: () => true }), /Projeto inválido/);
  const invalidTrack = projectWithTrack();
  invalidTrack.tracks[0].assetId = '';
  assert.throws(() => prepareAudioExport(invalidTrack, { hasBuffer: () => true }), /Track sem ID ou arquivo/);
  assert.throws(() => prepareAudioExport(projectWithTrack(), { hasBuffer: () => false }), /não está disponível/);
});
