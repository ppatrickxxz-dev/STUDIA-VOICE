import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('softness adapter boots canonically and verifies the exact persisted EQ event', async () => {
  const [preboot, adapter] = await Promise.all([
    read('packages/app/preboot.mjs'),
    read('packages/app/pablo-section-vocal-softness-adapter.mjs'),
  ]);
  assert.match(preboot, /pablo-section-vocal-softness-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionVocalSoftnessAdapter/);
  assert.match(adapter, /saveProject\(snapshotted\)/);
  assert.match(adapter, /await getProject\(project\.id\)/);
  assert.match(adapter, /savedEvent\.kind !== result\.event\.kind/);
  assert.match(adapter, /savedEvent\.frequencyHz/);
  assert.match(adapter, /savedEvent\.q/);
});

test('softness reuses only already-supported high shelf and peaking EQ render paths', async () => {
  const [core, engine, project] = await Promise.all([
    read('packages/core/src/section-vocal-softness.mjs'),
    read('packages/app/audio-engine.mjs'),
    read('packages/core/src/project.mjs'),
  ]);
  assert.match(core, /kind: 'high_shelf'/);
  assert.match(core, /kind: 'peaking_eq'/);
  assert.match(engine, /regionalHighShelfEvents/);
  assert.match(engine, /regionalPeakingEqEvents/);
  assert.match(engine, /createTrackSources\(offline/);
  assert.match(project, /kind === 'high_shelf' \|\| kind === 'peaking_eq'/);
  assert.doesNotMatch(core, /AudioContext|OfflineAudioContext|createBiquadFilter/);
});

test('A B and undo identify softness by source plus confirmed section id', async () => {
  const [ab, undo] = await Promise.all([
    read('packages/core/src/section-mix-ab.mjs'),
    read('packages/core/src/section-mix-undo.mjs'),
  ]);
  assert.match(ab, /PABLO_SECTION_VOCAL_SOFTNESS_SOURCE/);
  assert.match(undo, /VOCAL_SOFTNESS: 'vocal_softness'/);
  assert.match(undo, /PABLO_SECTION_VOCAL_SOFTNESS_SOURCE/);
  assert.match(undo, /id\.endsWith\(`:\$\{sectionId\}`\)/);
  assert.doesNotMatch(undo, /user_manual.*sourcesForMode|pablo_breath_intelligence.*sourcesForMode/);
});

test('one section softness id replaces its prior mode instead of stacking hidden subtractive EQ', async () => {
  const core = await read('packages/core/src/section-vocal-softness.mjs');
  assert.match(core, /const id = `\$\{PABLO_SECTION_VOCAL_SOFTNESS_SOURCE\}:\$\{vocal\.track\.id\}:\$\{sectionResult\.section\.id\}`/);
  assert.match(core, /prior\.filter\(\(event\) => event\?\.id !== plan\.event\.id\)/);
});
