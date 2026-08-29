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

test('section controls use attribute presence and save click plus submit fallback share one verified mutation function', async () => {
  const ui = await read('packages/app/section-map-ui.mjs');
  for (const action of ['data-section-map-open', 'data-section-map-close', 'data-section-save', 'data-section-use-cursor', 'data-section-cancel-edit']) {
    assert.match(ui, new RegExp(`hasAttribute\\('${action}'\\)`));
  }
  assert.match(ui, /event\.preventDefault\(\)/);
  assert.match(ui, /await saveSectionForm\(form\)/);
  assert.match(ui, /async function saveSectionForm\(form\)/);
  assert.ok(ui.indexOf("hasAttribute('data-section-save')") < ui.indexOf("hasAttribute('data-section-use-cursor')"));
  assert.match(ui, /async function onSubmit\(event\)[\s\S]*await saveSectionForm\(form\)/);
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

test('section clock zero-pads whole and fractional seconds', async () => {
  const ui = await read('packages/app/section-map-ui.mjs');
  assert.match(ui, /String\(Math\.round\(seconds\)\)\.padStart\(2, '0'\)/);
  assert.match(ui, /seconds\.toFixed\(1\)\.padStart\(4, '0'\)/);
});

test('section UI uses the shared project-scoped Studio playhead and remains CSP-safe', async () => {
  const ui = await read('packages/app/section-map-ui.mjs');
  assert.match(ui, /studio-playhead-context\.mjs/);
  assert.match(ui, /document\.querySelector\('#current-time'\)/);
  assert.match(ui, /parseClockSeconds/);
  assert.match(ui, /recordStudioPlayhead\(projectId, parsed\)/);
  assert.match(ui, /readStudioPlayhead\(projectId\)/);
  assert.doesNotMatch(ui, /lastCursorSeconds|lastCursorProjectId/);
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
