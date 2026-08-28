import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('canonical boot installs selective section mix undo after section mix writers', async () => {
  const preboot = await read('packages/app/preboot.mjs');
  assert.match(preboot, /pablo-section-mix-undo-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionMixUndoAdapter/);
  assert.ok(preboot.indexOf('installPabloSectionVocalSpaceAdapter();') < preboot.indexOf('installPabloSectionMixUndoAdapter();'));
});

test('undo identifies Pablo-owned events by source plus confirmed section id', async () => {
  const core = await read('packages/core/src/section-mix-undo.mjs');
  assert.match(core, /PABLO_SECTION_VOCAL_GAIN_SOURCE/);
  assert.match(core, /PABLO_SECTION_VOCAL_SPACE_SOURCE/);
  assert.match(core, /PABLO_SECTION_VOCAL_BRIGHTNESS_SOURCE/);
  assert.match(core, /PABLO_SECTION_VOCAL_BODY_SOURCE/);
  assert.match(core, /PABLO_SECTION_VOCAL_SOFTNESS_SOURCE/);
  assert.match(core, /id\.endsWith\(`:\$\{sectionId\}`\)/);
  assert.match(core, /resolveConfirmedSectionAudition/);
  assert.doesNotMatch(core, /user_manual.*sourcesForMode|pablo_breath_intelligence.*sourcesForMode/);
});

test('broad undo filters only canonical section-mix sources and preserves unrelated automation', async () => {
  const core = await read('packages/core/src/section-mix-undo.mjs');
  assert.match(core, /sourcesForMode\(command\.mode\)/);
  assert.match(core, /else keep\.push\(event\)/);
  assert.match(core, /PABLO_SECTION_VOCAL_GAIN_SOURCE/);
  assert.match(core, /PABLO_SECTION_VOCAL_SPACE_SOURCE/);
  assert.match(core, /PABLO_SECTION_VOCAL_BRIGHTNESS_SOURCE/);
  assert.match(core, /PABLO_SECTION_VOCAL_BODY_SOURCE/);
  assert.match(core, /PABLO_SECTION_VOCAL_SOFTNESS_SOURCE/);
  assert.doesNotMatch(core, /regionAutomation\s*=\s*\[\]/);
});

test('runtime snapshots, persists, re-reads and verifies zero remaining target events before success', async () => {
  const adapter = await read('packages/app/pablo-section-mix-undo-adapter.mjs');
  assert.match(adapter, /snapshotProject/);
  assert.match(adapter, /saveProject\(snapshotted\)/);
  assert.match(adapter, /await getProject\(project\.id\)/);
  assert.match(adapter, /countSectionMixEvents\(persisted, result\.section\.id, command\.mode\)/);
  assert.match(adapter, /if \(remaining !== 0\)/);
});

test('ambiguous occurrence and absent Pablo edit fail closed instead of deleting by proximity', async () => {
  const adapter = await read('packages/app/pablo-section-mix-undo-adapter.mjs');
  assert.match(adapter, /ambiguous_occurrence/);
  assert.match(adapter, /nothing_to_undo/);
  assert.match(adapter, /Automação manual e outras edições foram preservadas/);
});
