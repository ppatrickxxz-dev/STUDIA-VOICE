import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('canonical boot installs plosive adapter before mix undo and A B', async () => {
  const preboot = await read('packages/app/preboot.mjs');
  assert.match(preboot, /pablo-section-vocal-plosive-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionVocalPlosiveAdapter/);
  assert.ok(preboot.indexOf('installPabloSectionVocalPlosiveAdapter();') < preboot.indexOf('installPabloSectionMixUndoAdapter();'));
});

test('canonical analyzer exposes measured plosive evidence in the same voice pipeline', async () => {
  const [pipeline, voice, detector] = await Promise.all([
    read('packages/audio/src/analyzers/pipeline.mjs'),
    read('packages/audio/src/analyzers/voice.mjs'),
    read('packages/audio/src/analyzers/plosive.mjs'),
  ]);
  assert.match(pipeline, /detectPlosives\(samples/);
  assert.match(pipeline, /plosiveEvents: resolvedPlosives/);
  assert.match(pipeline, /plosiveCount: resolvedPlosives\.length/);
  assert.match(voice, /plosiveEvents: normalizeEvents\(plosiveEvents\)/);
  assert.match(detector, /lowFrequencyRatio/);
  assert.match(detector, /transientRise/);
  assert.match(detector, /plosive-lowband-goertzel-v1/);
});

test('plosive adapter reuses analyzeAudioTrack and fails closed without evidence', async () => {
  const adapter = await read('packages/app/pablo-section-vocal-plosive-adapter.mjs');
  assert.match(adapter, /analyzeAudioTrack\(target\.track\)/);
  assert.match(adapter, /analysis\?\.voice\?\.plosiveEvents/);
  assert.doesNotMatch(adapter, /detectPlosives|analyzePlosiveFrame/);
  assert.match(adapter, /Não cortei os graves por aproximação/);
});

test('plosive treatment is micro peaking EQ and never whole-section high-pass fallback', async () => {
  const core = await read('packages/core/src/section-vocal-plosive.mjs');
  assert.match(core, /kind: 'peaking_eq'/);
  assert.match(core, /minFrequencyHz: 80/);
  assert.match(core, /maxFrequencyHz: 260/);
  assert.match(core, /no_plosive_evidence/);
  assert.match(core, /spectralConfidenceThreshold/);
  assert.doesNotMatch(core, /highpass|high_pass|low_shelf|kind: 'gain'/);
});

test('A B and selective undo own plosive cuts only by canonical source and section id', async () => {
  const [ab, undo, adapter] = await Promise.all([
    read('packages/core/src/section-mix-ab.mjs'),
    read('packages/core/src/section-mix-undo.mjs'),
    read('packages/app/pablo-section-mix-undo-adapter.mjs'),
  ]);
  assert.match(ab, /PABLO_SECTION_VOCAL_PLOSIVE_SOURCE/);
  assert.match(undo, /VOCAL_PLOSIVE: 'vocal_plosive'/);
  assert.match(undo, /PABLO_SECTION_VOCAL_PLOSIVE_SOURCE/);
  assert.match(adapter, /tratamento de plosivas/);
});
