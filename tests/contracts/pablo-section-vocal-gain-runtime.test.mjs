import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('canonical boot installs section-targeted vocal gain after section boundaries', async () => {
  const preboot = await read('packages/app/preboot.mjs');
  assert.match(preboot, /pablo-section-vocal-gain-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionVocalGainAdapter/);
  assert.ok(preboot.indexOf('installPabloSectionHereAdapter();') < preboot.indexOf('installPabloSectionVocalGainAdapter();'));
});

test('section vocal gain persists canonical regionAutomation and verifies it before success', async () => {
  const [adapter, planner, engine] = await Promise.all([
    read('packages/app/pablo-section-vocal-gain-adapter.mjs'),
    read('packages/core/src/section-vocal-gain.mjs'),
    read('packages/app/audio-engine.mjs'),
  ]);
  assert.match(adapter, /snapshotProject/);
  assert.match(adapter, /saveProject\(snapshotted\)/);
  assert.match(adapter, /await getProject\(project\.id\)/);
  assert.match(adapter, /pablo_section_vocal_gain|PABLO_SECTION_VOCAL_GAIN_SOURCE/);
  assert.match(planner, /regionAutomation/);
  assert.match(planner, /prior\.filter\(\(event\) => event\?\.id !== plan\.event\.id\)/);
  assert.match(engine, /sourceRegionsToTrackTime\(track, track\.regionAutomation\)/);
  assert.match(engine, /automateRegions\(regional\.gain/);
});

test('vocal targeting is evidence-based and generic audio filenames cannot become voice automatically', async () => {
  const planner = await read('packages/core/src/section-vocal-gain.mjs');
  assert.match(planner, /new Set\(\['recording', 'voice_variant'\]\)/);
  assert.match(planner, /vocal_track_ambiguous/);
  assert.doesNotMatch(planner, /track\.name.*voz|name.*vocal|filename/i);
});

test('timeline to source mapping accounts for trim offset and pitch instead of copying section seconds blindly', async () => {
  const planner = await read('packages/core/src/section-vocal-gain.mjs');
  assert.match(planner, /2 \*\* \(Number\(track\?\.effects\?\.pitchSemitones/);
  assert.match(planner, /track\?\.offset/);
  assert.match(planner, /track\?\.trimStart/);
  assert.match(planner, /track\?\.trimEnd/);
  assert.match(planner, /sourceStart = trimStart \+ \(overlapStart - offset\) \* rate/);
});

test('unsafe boost and incomplete or ambiguous section requests fail closed', async () => {
  const planner = await read('packages/core/src/section-vocal-gain.mjs');
  const adapter = await read('packages/app/pablo-section-vocal-gain-adapter.mjs');
  assert.match(planner, /explicitDb > 4/);
  assert.match(adapter, /gain_out_of_safe_range/);
  assert.match(adapter, /missing_confirmed_end/);
  assert.match(adapter, /ambiguous_occurrence/);
  assert.match(adapter, /Não alterei|não alterei/i);
});
