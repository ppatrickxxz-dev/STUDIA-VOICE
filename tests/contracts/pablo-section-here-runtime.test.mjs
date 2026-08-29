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
  assert.match(adapter, /executePabloAudioMessage\(explicit\.command, \{ projectId \}\)/);
  assert.match(adapter, /marca o \$\{spokenSection\(command\.section\)\} em \$\{playhead\.seconds\.toFixed\(3\)\} segundos/);
  assert.doesNotMatch(adapter, /analyzeLyrics|classifyStructure/);
});

test('section end here preserves the confirmed start and refuses missing or crossing structure', async () => {
  const adapter = await read('packages/app/pablo-section-here-adapter.mjs');
  const resolver = await read('packages/core/src/section-end-target.mjs');
  assert.match(adapter, /parseSectionEndHereCommand/);
  assert.match(adapter, /await getProject\(projectId\)/);
  assert.match(adapter, /resolveSectionEndTarget\(project\.arrangementMap, command\.section, endSeconds\)/);
  assert.match(adapter, /de \$\{resolved\.target\.startSeconds\.toFixed\(3\)\} a \$\{resolved\.endSeconds\.toFixed\(3\)\} segundos/);
  assert.match(adapter, /missing_confirmed_start/);
  assert.match(adapter, /crosses_confirmed_section/);
  assert.match(adapter, /o início foi preservado/);
  assert.match(resolver, /b\.startSeconds - a\.startSeconds/);
  assert.match(resolver, /section\.startSeconds > target\.startSeconds/);
  assert.match(resolver, /section\.startSeconds < end/);
});

test('playhead evidence is in-memory, bounded by age, positive-only and isolated by project id', async () => {
  const context = await read('packages/app/studio-playhead-context.mjs');
  assert.match(context, /10 \* 60 \* 1000/);
  assert.match(context, /value <= 0/);
  assert.match(context, /playheads\.get\(id\)/);
  assert.match(context, /reason: 'playhead_stale'/);
  assert.doesNotMatch(context, /localStorage|sessionStorage|indexedDB/);
});
