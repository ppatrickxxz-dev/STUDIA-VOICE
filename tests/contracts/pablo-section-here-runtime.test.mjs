import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('canonical boot installs the contextual Pablo section adapter', async () => {
  const preboot = await read('packages/app/preboot.mjs');
  assert.match(preboot, /pablo-section-here-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionHereAdapter/);
});

test('Studio Sections and Pablo share one project-scoped playhead source', async () => {
  const [sections, adapter] = await Promise.all([
    read('packages/app/section-map-ui.mjs'),
    read('packages/app/pablo-section-here-adapter.mjs'),
  ]);
  assert.match(sections, /studio-playhead-context\.mjs/);
  assert.match(sections, /recordStudioPlayhead/);
  assert.match(sections, /readStudioPlayhead/);
  assert.doesNotMatch(sections, /lastCursorSeconds|lastCursorProjectId/);
  assert.match(adapter, /studio-playhead-context\.mjs/);
  assert.match(adapter, /readStudioPlayhead\(projectId\)/);
});

test('here resolution fails closed and hands an explicit time to the existing Pablo pipeline', async () => {
  const adapter = await read('packages/app/pablo-section-here-adapter.mjs');
  assert.match(adapter, /event\.stopImmediatePropagation\(\)/);
  assert.match(adapter, /if \(!playhead\.ok\)/);
  assert.match(adapter, /Não tenho um ponto recente e confirmado/);
  assert.match(adapter, /Não alterei o projeto/);
  assert.match(adapter, /executePabloAudioMessage\(explicit, \{ projectId \}\)/);
  assert.match(adapter, /em \$\{playhead\.seconds\.toFixed\(3\)\} segundos/);
  assert.doesNotMatch(adapter, /analyzeLyrics|classifyStructure/);
});

test('playhead evidence is in-memory, bounded by age, positive-only and isolated by project id', async () => {
  const context = await read('packages/app/studio-playhead-context.mjs');
  assert.match(context, /10 \* 60 \* 1000/);
  assert.match(context, /value <= 0/);
  assert.match(context, /playheads\.get\(id\)/);
  assert.match(context, /reason: 'playhead_stale'/);
  assert.doesNotMatch(context, /localStorage|sessionStorage|indexedDB/);
});
