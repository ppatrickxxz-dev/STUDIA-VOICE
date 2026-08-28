import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('selective restoration A/B owns denoise and de-reverb as separate canonical sources', async () => {
  const core = await read('packages/core/src/section-mix-ab.mjs');
  assert.match(core, /SECTION_MIX_AB_MODES/);
  assert.match(core, /DENOISE: 'denoise'/);
  assert.match(core, /DEREVERB: 'dereverb'/);
  assert.match(core, /PABLO_SECTION_VOCAL_CLEANUP_SOURCES\.DENOISE/);
  assert.match(core, /PABLO_SECTION_VOCAL_CLEANUP_SOURCES\.DEREVERB/);
  assert.match(core, /sourcesForABMode\(mode\)/);
});

test('selective A/B mode reaches the canonical processed audition without mutating storage', async () => {
  const [runtime, adapter] = await Promise.all([
    read('packages/app/section-mix-ab-runtime.mjs'),
    read('packages/app/pablo-section-mix-ab-adapter.mjs'),
  ]);
  assert.match(runtime, /buildSectionMixABVariant\(plan\.project, plan\.section\.id, variant, plan\.mode\)/);
  assert.match(runtime, /auditionConfirmedSection\(prepared\.project, plan\.section, \{ mode: 'processed' \}\)/);
  assert.match(adapter, /data\.abMode|dataset\.abMode/);
  assert.match(adapter, /desfaz só o denoise no/);
  assert.match(adapter, /desfaz só o de-reverb no/);
  assert.doesNotMatch(adapter, /saveProject/);
  assert.doesNotMatch(adapter, /snapshotProject/);
});

test('selective restoration undo maps each command to one cleanup source and verifies persistence', async () => {
  const [core, adapter] = await Promise.all([
    read('packages/core/src/section-mix-undo.mjs'),
    read('packages/app/pablo-section-mix-undo-adapter.mjs'),
  ]);
  assert.match(core, /VOCAL_DENOISE: 'vocal_denoise'/);
  assert.match(core, /VOCAL_DEREVERB: 'vocal_dereverb'/);
  assert.match(core, /VOCAL_DENOISE\).*PABLO_SECTION_VOCAL_CLEANUP_SOURCES\.DENOISE/s);
  assert.match(core, /VOCAL_DEREVERB\).*PABLO_SECTION_VOCAL_CLEANUP_SOURCES\.DEREVERB/s);
  assert.match(adapter, /countSectionMixEvents\(persisted, result\.section\.id, command\.mode\)/);
  assert.match(adapter, /Desfiz só o denoise/);
  assert.match(adapter, /Desfiz só o de-reverb/);
});

test('broad cleanup undo and broad A/B remain available instead of being replaced by selective modes', async () => {
  const [ab, undo] = await Promise.all([
    read('packages/core/src/section-mix-ab.mjs'),
    read('packages/core/src/section-mix-undo.mjs'),
  ]);
  assert.match(ab, /ALL: 'all'/);
  assert.match(ab, /PABLO_SECTION_MIX_SOURCES/);
  assert.match(undo, /VOCAL_CLEANUP: 'vocal_cleanup'/);
  assert.match(undo, /PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST/);
});
