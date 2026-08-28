import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('canonical boot installs cleanup before selective undo and A B', async () => {
  const preboot = await read('packages/app/preboot.mjs');
  assert.match(preboot, /pablo-section-vocal-cleanup-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionVocalCleanupAdapter/);
  assert.ok(preboot.indexOf('installPabloSectionVocalCleanupAdapter();') < preboot.indexOf('installPabloSectionMixUndoAdapter();'));
});

test('cleanup adapter decodes the vocal once through canonical analyzeAudioTrack', async () => {
  const adapter = await read('packages/app/pablo-section-vocal-cleanup-adapter.mjs');
  assert.match(adapter, /analyzeAudioTrack\(target\.track\)/);
  assert.match(adapter, /applySectionVocalCleanup\(project, command, \{ analysis/);
  assert.doesNotMatch(adapter, /detectBreathAndSibilance|detectPlosives|detectVocalPeaks|detectVocalClicks|decodeAudioData/);
  assert.match(adapter, /A limpeza vocal não foi confirmada/);
});

test('cleanup core delegates sibilance plosive click and dynamics to existing canonical planners', async () => {
  const core = await read('packages/core/src/section-vocal-cleanup.mjs');
  assert.match(core, /planSectionVocalDeEsser/);
  assert.match(core, /adaptiveFrequencyRequired: true/);
  assert.match(core, /planSectionVocalPlosive/);
  assert.match(core, /planSectionVocalClick/);
  assert.match(core, /planSectionVocalDynamics/);
  assert.match(core, /no_cleanup_evidence/);
  assert.match(core, /breathConfidenceThreshold: 0\.82/);
  assert.match(core, /peakConfidenceThreshold: 0\.66/);
  assert.doesNotMatch(core, /AudioContext|OfflineAudioContext|createBiquadFilter|createDynamicsCompressor/);
});

test('vocal peak evidence remains the canonical fourth voice event family', async () => {
  const [pipeline, voice, peaks] = await Promise.all([
    read('packages/audio/src/analyzers/pipeline.mjs'),
    read('packages/audio/src/analyzers/voice.mjs'),
    read('packages/audio/src/analyzers/vocal-peaks.mjs'),
  ]);
  assert.match(pipeline, /detectVocalPeaks/);
  assert.match(pipeline, /peakEvents: resolvedPeaks/);
  assert.match(pipeline, /peakCount: resolvedPeaks\.length/);
  assert.match(voice, /peakEvents: normalizeEvents\(peakEvents\)/);
  assert.match(peaks, /vocal-peak-transient-v1/);
  assert.match(peaks, /transientRise/);
});

test('vocal click evidence is the canonical fifth voice event family and excludes plosive or sustained-peak overlap', async () => {
  const [pipeline, voice, clicks] = await Promise.all([
    read('packages/audio/src/analyzers/pipeline.mjs'),
    read('packages/audio/src/analyzers/voice.mjs'),
    read('packages/audio/src/analyzers/vocal-clicks.mjs'),
  ]);
  assert.match(pipeline, /detectVocalClicks/);
  assert.match(pipeline, /clickEvents: resolvedClicks/);
  assert.match(pipeline, /clickCount: resolvedClicks\.length/);
  assert.match(pipeline, /plosiveEvents: resolvedPlosives/);
  assert.match(pipeline, /peakEvents: resolvedPeaks/);
  assert.match(voice, /clickEvents: normalizeEvents\(clickEvents\)/);
  assert.match(clicks, /vocal-click-impulse-v1/);
  assert.match(clicks, /overlapsPlosive/);
  assert.match(clicks, /overlapsLargePeak/);
  assert.match(clicks, /differenceRatio/);
  assert.match(clicks, /lowFrequencyRatio/);
});

test('cleanup owns separate sources so it cannot overwrite independently applied Pablo edits', async () => {
  const cleanup = await read('packages/core/src/section-vocal-cleanup.mjs');
  assert.match(cleanup, /pablo_section_vocal_cleanup_breath/);
  assert.match(cleanup, /pablo_section_vocal_cleanup_deesser/);
  assert.match(cleanup, /pablo_section_vocal_cleanup_plosive/);
  assert.match(cleanup, /pablo_section_vocal_cleanup_click/);
  assert.match(cleanup, /pablo_section_vocal_cleanup_dynamics/);
  assert.doesNotMatch(cleanup, /source: PABLO_SECTION_VOCAL_DEESSER_SOURCE/);
  assert.doesNotMatch(cleanup, /source: PABLO_SECTION_VOCAL_PLOSIVE_SOURCE/);
  assert.doesNotMatch(cleanup, /source: PABLO_SECTION_VOCAL_CLICK_SOURCE/);
});

test('A B and undo explicitly include cleanup ownership without matching manual automation', async () => {
  const [ab, undo, undoAdapter] = await Promise.all([
    read('packages/core/src/section-mix-ab.mjs'),
    read('packages/core/src/section-mix-undo.mjs'),
    read('packages/app/pablo-section-mix-undo-adapter.mjs'),
  ]);
  assert.match(ab, /PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST/);
  assert.match(undo, /VOCAL_CLEANUP: 'vocal_cleanup'/);
  assert.match(undo, /PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST/);
  assert.match(undoAdapter, /Desfiz a limpeza vocal/);
  assert.match(undoAdapter, /preservei ajustes de voz aplicados separadamente/);
});
