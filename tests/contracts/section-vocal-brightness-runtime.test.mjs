import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('brightness adapter boots in the canonical Pablo shell and persists only after verification', async () => {
  const [preboot, adapter] = await Promise.all([
    read('packages/app/preboot.mjs'),
    read('packages/app/pablo-section-vocal-brightness-adapter.mjs'),
  ]);
  assert.match(preboot, /pablo-section-vocal-brightness-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionVocalBrightnessAdapter/);
  assert.match(adapter, /snapshotProject/);
  assert.match(adapter, /saveProject/);
  assert.match(adapter, /getProject\(project\.id\)/);
  assert.match(adapter, /savedEvent\.kind !== 'high_shelf'/);
  assert.match(adapter, /frequencyHz/);
});

test('audio engine renders high shelf automation in the same processed path used by preview and offline export', async () => {
  const engine = await read('packages/app/audio-engine.mjs');
  assert.match(engine, /regionalHighShelfEvents/);
  assert.match(engine, /highShelfAutomationPoints/);
  assert.match(engine, /connectRegionalEq/);
  assert.match(engine, /connectRegionalBiquad/);
  assert.match(engine, /'highshelf', highShelfAutomationPoints/);
  assert.match(engine, /eq\.frequency\.value = event\.frequencyHz/);
  assert.match(engine, /createTrackSources\(offline, .*'processed'/s);
});

test('regional gain and regional EQ remain separate automation kinds', async () => {
  const [gain, eq] = await Promise.all([
    read('packages/audio/src/automation/region-gain.mjs'),
    read('packages/audio/src/automation/region-eq.mjs'),
  ]);
  assert.match(gain, /String\(event\?\.kind \|\| 'gain'\) !== 'gain'/);
  assert.match(eq, /REGIONAL_HIGH_SHELF_KIND = 'high_shelf'/);
  assert.match(eq, /startsInside/);
});

test('A/B and selective undo own brightness by canonical source instead of broad EQ deletion', async () => {
  const [ab, undo] = await Promise.all([
    read('packages/core/src/section-mix-ab.mjs'),
    read('packages/core/src/section-mix-undo.mjs'),
  ]);
  assert.match(ab, /PABLO_SECTION_VOCAL_BRIGHTNESS_SOURCE/);
  assert.match(undo, /VOCAL_BRIGHTNESS/);
  assert.match(undo, /PABLO_SECTION_VOCAL_BRIGHTNESS_SOURCE/);
  assert.doesNotMatch(undo, /regionAutomation\s*=\s*\[\]/);
});
