import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('canonical boot installs section vocal-space adapter after vocal targeting primitives', async () => {
  const preboot = await read('packages/app/preboot.mjs');
  assert.match(preboot, /pablo-section-vocal-space-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionVocalSpaceAdapter/);
  assert.ok(preboot.indexOf('installPabloSectionVocalGainAdapter();') < preboot.indexOf('installPabloSectionVocalSpaceAdapter();'));
});

test('vocal-space planner reuses confirmed section mapping and never automates the vocal track', async () => {
  const planner = await read('packages/core/src/section-vocal-space.mjs');
  assert.match(planner, /resolveVocalTrack\(clean\)/);
  assert.match(planner, /resolveSupportTrack\(clean, vocal\.track\.id\)/);
  assert.match(planner, /timelineRangeToSourceRegion\(support\.track/);
  assert.match(planner, /gainDb = -attenuationDb/);
  assert.match(planner, /track\.regionAutomation/);
  assert.doesNotMatch(planner, /vocal\.track\.regionAutomation\s*=/);
});

test('automatic support selection is narrow and excludes harmony and generated fills', async () => {
  const planner = await read('packages/core/src/section-vocal-space.mjs');
  assert.match(planner, /new Set\(\['audio', 'beat'\]\)/);
  assert.match(planner, /support_track_ambiguous/);
  assert.doesNotMatch(planner, /harmony.*SUPPORT_KINDS|beat-fill.*SUPPORT_KINDS/);
});

test('runtime persists one Pablo-owned attenuation and verifies IndexedDB before success', async () => {
  const [adapter, engine] = await Promise.all([
    read('packages/app/pablo-section-vocal-space-adapter.mjs'),
    read('packages/app/audio-engine.mjs'),
  ]);
  assert.match(adapter, /snapshotProject/);
  assert.match(adapter, /saveProject\(snapshotted\)/);
  assert.match(adapter, /await getProject\(project\.id\)/);
  assert.match(adapter, /PABLO_SECTION_VOCAL_SPACE_SOURCE/);
  assert.match(engine, /sourceRegionsToTrackTime\(track, track\.regionAutomation\)/);
});

test('attenuation gate refuses reductions above 3 dB instead of silently clamping user intent', async () => {
  const [planner, adapter] = await Promise.all([
    read('packages/core/src/section-vocal-space.mjs'),
    read('packages/app/pablo-section-vocal-space-adapter.mjs'),
  ]);
  assert.match(planner, /explicitDb > 3/);
  assert.match(adapter, /só atenúo automaticamente até 3 dB por seção/);
  assert.match(adapter, /support_track_ambiguous/);
});
