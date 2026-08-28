import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('body adapter boots in canonical Pablo shell and verifies persisted peaking metadata', async () => {
  const [preboot, adapter] = await Promise.all([
    read('packages/app/preboot.mjs'),
    read('packages/app/pablo-section-vocal-body-adapter.mjs'),
  ]);
  assert.match(preboot, /pablo-section-vocal-body-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionVocalBodyAdapter/);
  assert.match(adapter, /saveProject\(snapshotted\)/);
  assert.match(adapter, /await getProject\(project\.id\)/);
  assert.match(adapter, /savedEvent\.kind !== 'peaking_eq'/);
  assert.match(adapter, /savedEvent\.frequencyHz/);
  assert.match(adapter, /savedEvent\.q/);
});

test('audio engine renders regional peaking EQ in the same processed path as high shelf and offline export', async () => {
  const [engine, regionalEq] = await Promise.all([
    read('packages/app/audio-engine.mjs'),
    read('packages/audio/src/automation/region-eq.mjs'),
  ]);
  assert.match(engine, /regionalPeakingEqEvents/);
  assert.match(engine, /peakingEqAutomationPoints/);
  assert.match(engine, /connectRegionalEq/);
  assert.match(engine, /eq\.type = type/);
  assert.match(engine, /eq\.frequency\.value = event\.frequencyHz/);
  assert.match(engine, /eq\.Q\.value = event\.q \?\? 1/);
  assert.match(engine, /createTrackSources\(offline/);
  assert.match(regionalEq, /REGIONAL_PEAKING_EQ_KIND = 'peaking_eq'/);
  assert.match(regionalEq, /startsInside/);
});

test('regional gain remains isolated from both EQ kinds', async () => {
  const gain = await read('packages/audio/src/automation/region-gain.mjs');
  assert.match(gain, /event\?\.kind !== 'gain'/);
});

test('A B and selective undo own body only through the Pablo source', async () => {
  const [ab, undo] = await Promise.all([
    read('packages/core/src/section-mix-ab.mjs'),
    read('packages/core/src/section-mix-undo.mjs'),
  ]);
  assert.match(ab, /PABLO_SECTION_VOCAL_BODY_SOURCE/);
  assert.match(undo, /VOCAL_BODY: 'vocal_body'/);
  assert.match(undo, /PABLO_SECTION_VOCAL_BODY_SOURCE/);
  assert.doesNotMatch(undo, /user_manual.*sourcesForMode|pablo_breath_intelligence.*sourcesForMode/);
});
