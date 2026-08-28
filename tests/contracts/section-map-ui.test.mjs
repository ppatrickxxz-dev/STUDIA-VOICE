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

test('section form uses named controls and confirms persistence by re-reading IndexedDB before success', async () => {
  const ui = await read('packages/app/section-map-ui.mjs');
  assert.match(ui, /form\.elements\.namedItem\('kind'\)/);
  assert.match(ui, /form\.elements\.namedItem\('start'\)/);
  assert.match(ui, /form\.elements\.namedItem\('end'\)/);
  assert.match(ui, /persistVerifiedArrangementMap/);
  assert.match(ui, /await getProject\(saved\.id\)/);
  assert.match(ui, /mustContainId/);
  assert.match(ui, /mustNotContainId/);
  assert.match(ui, /Não marquei como salva/);
  assert.match(ui, /Não marquei como concluída/);
});

test('section UI can use the real or last-heard Studio cursor and remains CSP-safe', async () => {
  const ui = await read('packages/app/section-map-ui.mjs');
  assert.match(ui, /document\.querySelector\('#current-time'\)/);
  assert.match(ui, /parseClockSeconds/);
  assert.match(ui, /lastCursorSeconds/);
  assert.match(ui, /lastCursorProjectId/);
  assert.match(ui, /if \(projectId !== lastCursorProjectId\)/);
  assert.match(ui, /live != null && live > 0 \? live : lastCursorSeconds/);
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
  assert.match(ui, /último ponto ouvido antes de parar/);
});
