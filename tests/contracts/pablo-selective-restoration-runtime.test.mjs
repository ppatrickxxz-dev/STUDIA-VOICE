import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('canonical boot orders recommendation then selective restoration then broad cleanup', async () => {
  const preboot = await read('packages/app/preboot.mjs');
  assert.match(preboot, /pablo-section-vocal-restoration-selective-adapter\.mjs/);
  const recommendation = preboot.indexOf('installPabloSectionVocalRestorationRecommendationAdapter();');
  const selective = preboot.indexOf('installPabloSectionVocalRestorationSelectiveAdapter();');
  const cleanup = preboot.indexOf('installPabloSectionVocalCleanupAdapter();');
  assert.ok(recommendation > 0 && recommendation < selective && selective < cleanup);
});

test('selective restoration reuses canonical cleanup planning and writes only the requested restoration source', async () => {
  const core = await read('packages/core/src/section-vocal-restoration-selective.mjs');
  assert.match(core, /planSectionVocalCleanup/);
  assert.match(core, /PABLO_SECTION_VOCAL_CLEANUP_SOURCES\.DENOISE/);
  assert.match(core, /PABLO_SECTION_VOCAL_CLEANUP_SOURCES\.DEREVERB/);
  assert.match(core, /event\?\.source === plan\.source/);
  assert.doesNotMatch(core, /BiquadFilter|DynamicsCompressor|OfflineAudioContext|fetch\(/);
});

test('adapter requires acoustic analysis, snapshots only successful edits and verifies IndexedDB before success', async () => {
  const adapter = await read('packages/app/pablo-section-vocal-restoration-selective-adapter.mjs');
  assert.match(adapter, /analyzeAudioTrack\(target\.track\)/);
  assert.match(adapter, /snapshotProject\(result\.project/);
  assert.match(adapter, /await saveProject\(snapshotted\)/);
  assert.match(adapter, /const persisted = await getProject\(project\.id\)/);
  assert.match(adapter, /A restauração seletiva não foi confirmada/);
  assert.match(adapter, /não apliquei de-reverb/i);
  assert.match(adapter, /não apliquei denoise/i);
});
