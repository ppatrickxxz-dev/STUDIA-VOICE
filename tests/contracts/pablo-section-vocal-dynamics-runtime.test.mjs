import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('dynamics adapter boots in canonical Pablo shell and verifies persisted compressor metadata', async () => {
  const [preboot, adapter] = await Promise.all([
    read('packages/app/preboot.mjs'),
    read('packages/app/pablo-section-vocal-dynamics-adapter.mjs'),
  ]);
  assert.match(preboot, /pablo-section-vocal-dynamics-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionVocalDynamicsAdapter/);
  assert.match(adapter, /saveProject\(snapshotted\)/);
  assert.match(adapter, /await getProject\(project\.id\)/);
  assert.match(adapter, /savedEvent\.kind !== 'compressor'/);
  assert.match(adapter, /savedEvent\.thresholdDb/);
  assert.match(adapter, /savedEvent\.ratio/);
});

test('canonical audio engine renders real regional DynamicsCompressorNode in preview and offline paths', async () => {
  const [engine, dynamics] = await Promise.all([
    read('packages/app/audio-engine.mjs'),
    read('packages/audio/src/automation/region-dynamics.mjs'),
  ]);
  assert.match(engine, /regionalCompressorEvents/);
  assert.match(engine, /compressorAutomationPoints/);
  assert.match(engine, /connectRegionalDynamics/);
  assert.match(engine, /context\.createDynamicsCompressor\(\)/);
  assert.match(engine, /value\.threshold\.setValueAtTime\(0, when\)/);
  assert.match(engine, /value\.ratio\.setValueAtTime\(1, when\)/);
  assert.match(engine, /createTrackSources\(offline/);
  assert.match(dynamics, /REGIONAL_COMPRESSOR_KIND = 'compressor'/);
  assert.match(dynamics, /ratio: 1/);
  assert.match(dynamics, /startsInside/);
});

test('schema v9 persists compressor fields while gain EQ and compressor remain separate automation kinds', async () => {
  const [project, gain] = await Promise.all([
    read('packages/core/src/project.mjs'),
    read('packages/audio/src/automation/region-gain.mjs'),
  ]);
  assert.match(project, /PROJECT_SCHEMA_VERSION = 9/);
  assert.match(project, /kind === 'compressor'/);
  assert.match(project, /thresholdDb/);
  assert.match(project, /attackSeconds/);
  assert.match(gain, /String\(event\?\.kind \|\| 'gain'\) !== 'gain'/);
});

test('A B and selective undo own dynamics only through the Pablo source', async () => {
  const [ab, undo] = await Promise.all([
    read('packages/core/src/section-mix-ab.mjs'),
    read('packages/core/src/section-mix-undo.mjs'),
  ]);
  assert.match(ab, /PABLO_SECTION_VOCAL_DYNAMICS_SOURCE/);
  assert.match(undo, /VOCAL_DYNAMICS: 'vocal_dynamics'/);
  assert.match(undo, /PABLO_SECTION_VOCAL_DYNAMICS_SOURCE/);
  assert.doesNotMatch(undo, /regionAutomation\s*=\s*\[\]/);
});
