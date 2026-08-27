import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('canonical boot installs the Studio section map UI', async () => {
  const preboot = await read('packages/app/preboot.mjs');
  assert.match(preboot, /section-map-ui\.mjs/);
  assert.match(preboot, /installSectionMapUI/);
});

test('section UI edits the canonical arrangement map and snapshots every mutation', async () => {
  const ui = await read('packages/app/section-map-ui.mjs');
  assert.match(ui, /normalizeArrangementMap/);
  assert.match(ui, /upsertConfirmedSection/);
  assert.match(ui, /replaceConfirmedSection/);
  assert.match(ui, /removeArrangementSection/);
  assert.match(ui, /snapshotProject/);
  assert.match(ui, /saveProject/);
  assert.match(ui, /source: 'user_manual'/);
  assert.match(ui, /confidence: 1/);
});

test('section UI can use the real Studio cursor and remains CSP-safe', async () => {
  const ui = await read('packages/app/section-map-ui.mjs');
  assert.match(ui, /document\.querySelector\('#current-time'\)/);
  assert.match(ui, /parseClockSeconds/);
  assert.match(ui, /link\.href = '\.\/section-map\.css'/);
  assert.doesNotMatch(ui, /createElement\('style'\)/);
  assert.doesNotMatch(ui, /\.style\./);
  assert.doesNotMatch(ui, /style="/);
});

test('section UI language explains that Pablo uses the confirmed Studio times', async () => {
  const ui = await read('packages/app/section-map-ui.mjs');
  assert.match(ui, /O Pablo usa exatamente estes tempos/);
  assert.match(ui, /timing confirmado/);
  assert.match(ui, /Usar cursor/);
});
