import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('section mix A/B boots in the canonical Pablo conversation shell', async () => {
  const [preboot, adapter] = await Promise.all([
    read('packages/app/preboot.mjs'),
    read('packages/app/pablo-section-mix-ab-adapter.mjs'),
  ]);
  assert.match(preboot, /pablo-section-mix-ab-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionMixABAdapter/);
  assert.match(adapter, /parseSectionMixABCommand/);
  assert.match(adapter, /data\.sectionMixAb|dataset\.sectionMixAb/);
});

test('A/B compares only Pablo section-mix ownership while retaining processed playback', async () => {
  const [core, runtime] = await Promise.all([
    read('packages/core/src/section-mix-ab.mjs'),
    read('packages/app/section-mix-ab-runtime.mjs'),
  ]);
  assert.match(core, /PABLO_SECTION_VOCAL_GAIN_SOURCE/);
  assert.match(core, /PABLO_SECTION_VOCAL_SPACE_SOURCE/);
  assert.match(core, /track\.regionAutomation = keep/);
  assert.match(runtime, /buildSectionMixABVariant/);
  assert.match(runtime, /auditionConfirmedSection\(prepared\.project, plan\.section, \{ mode: 'processed' \}\)/);
  assert.doesNotMatch(runtime, /mode: 'raw'/);
});

test('A/B is preview-only and reuses canonical undo instead of mutating project storage itself', async () => {
  const adapter = await read('packages/app/pablo-section-mix-ab-adapter.mjs');
  assert.match(adapter, /Prefiro A · desfazer/);
  assert.match(adapter, /desfaz o que você fez no/);
  assert.match(adapter, /form\.requestSubmit\(\)/);
  assert.doesNotMatch(adapter, /saveProject/);
  assert.doesNotMatch(adapter, /snapshotProject/);
});

test('A/B keeps decision semantics explicit and does not create inline CSS or duplicate audio assets', async () => {
  const adapter = await read('packages/app/pablo-section-mix-ab-adapter.mjs');
  assert.match(adapter, /Ouvir A/);
  assert.match(adapter, /Ouvir B/);
  assert.match(adapter, /Manter B/);
  assert.doesNotMatch(adapter, /createElement\(['"]style['"]\)/);
  assert.doesNotMatch(adapter, /saveAudioAsset/);
});
