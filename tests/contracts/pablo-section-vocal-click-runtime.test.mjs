import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('canonical boot installs evidence-driven vocal click treatment before cleanup undo and A B', async () => {
  const preboot = await read('packages/app/preboot.mjs');
  assert.match(preboot, /pablo-section-vocal-click-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionVocalClickAdapter/);
  assert.ok(preboot.indexOf('installPabloSectionVocalClickAdapter();') < preboot.indexOf('installPabloSectionVocalCleanupAdapter();'));
  assert.ok(preboot.indexOf('installPabloSectionVocalClickAdapter();') < preboot.indexOf('installPabloSectionMixUndoAdapter();'));
});

test('click adapter reuses canonical decoded analyzer and never runs a second detector', async () => {
  const adapter = await read('packages/app/pablo-section-vocal-click-adapter.mjs');
  assert.match(adapter, /analyzeAudioTrack\(target\.track\)/);
  assert.match(adapter, /analysis\?\.voice\?\.clickEvents/);
  assert.match(adapter, /analysis\?\.voice\?\.eventDetection\?\.source/);
  assert.doesNotMatch(adapter, /detectVocalClicks|decodeAudioData|AudioContext/);
  assert.match(adapter, /O tratamento de estalos não foi confirmado/);
});

test('click core produces only bounded micro gain attenuation and fails closed without evidence', async () => {
  const core = await read('packages/core/src/section-vocal-click.mjs');
  assert.match(core, /kind: 'gain'/);
  assert.match(core, /maxDurationSeconds: 0\.05/);
  assert.match(core, /differenceRatioThreshold: 0\.45/);
  assert.match(core, /maxLowFrequencyRatio: 0\.58/);
  assert.match(core, /no_click_evidence/);
  assert.match(core, /click_analysis_required/);
  assert.doesNotMatch(core, /kind: 'peaking_eq'|high_shelf|compressor|AudioContext/);
});

test('click detector excludes plosive and sustained peak overlap instead of treating every transient as a mouth click', async () => {
  const detector = await read('packages/audio/src/analyzers/vocal-clicks.mjs');
  assert.match(detector, /overlapsPlosive/);
  assert.match(detector, /overlapsLargePeak/);
  assert.match(detector, /duration < 0\.05/);
  assert.match(detector, /differenceRatio/);
  assert.match(detector, /lowFrequencyRatio/);
  assert.match(detector, /baselineRms == null \? 1/);
});

test('A B and selective undo own standalone clicks only through canonical source plus section id', async () => {
  const [ab, undo, undoAdapter] = await Promise.all([
    read('packages/core/src/section-mix-ab.mjs'),
    read('packages/core/src/section-mix-undo.mjs'),
    read('packages/app/pablo-section-mix-undo-adapter.mjs'),
  ]);
  assert.match(ab, /PABLO_SECTION_VOCAL_CLICK_SOURCE/);
  assert.match(undo, /VOCAL_CLICK: 'vocal_click'/);
  assert.match(undo, /PABLO_SECTION_VOCAL_CLICK_SOURCE/);
  assert.match(undo, /id\.endsWith\(`:\$\{sectionId\}`\)/);
  assert.match(undoAdapter, /Desfiz o tratamento de estalos/);
});
