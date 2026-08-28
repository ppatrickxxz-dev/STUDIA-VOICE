import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('canonical boot installs evidence-driven vocal de-esser before mix undo and A B', async () => {
  const preboot = await read('packages/app/preboot.mjs');
  assert.match(preboot, /pablo-section-vocal-deesser-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionVocalDeEsserAdapter/);
  assert.ok(preboot.indexOf('installPabloSectionVocalDeEsserAdapter();') < preboot.indexOf('installPabloSectionMixUndoAdapter();'));
});

test('de-esser adapter reuses canonical decoded analyzer and consumes real sibilance events', async () => {
  const adapter = await read('packages/app/pablo-section-vocal-deesser-adapter.mjs');
  assert.match(adapter, /analyzeAudioTrack\(target\.track\)/);
  assert.match(adapter, /analysis\?\.voice\?\.sibilanceEvents/);
  assert.match(adapter, /analysis\?\.voice\?\.eventDetection\?\.source/);
  assert.doesNotMatch(adapter, /detectBreathAndSibilance|analyzeNoiseFrame/);
});

test('de-esser is micro-window peaking EQ and never whole-section high shelf fallback', async () => {
  const core = await read('packages/core/src/section-vocal-deesser.mjs');
  assert.match(core, /kind: 'peaking_eq'/);
  assert.match(core, /frequencyHz: 7200/);
  assert.match(core, /confidenceThreshold: 0\.62/);
  assert.match(core, /no_sibilance_evidence/);
  assert.match(core, /mergeCandidateWindows/);
  assert.doesNotMatch(core, /kind: 'high_shelf'/);
  assert.doesNotMatch(core, /AudioContext|OfflineAudioContext|createBiquadFilter/);
});

test('persistence verifies every saved de-esser window before claiming success', async () => {
  const adapter = await read('packages/app/pablo-section-vocal-deesser-adapter.mjs');
  assert.match(adapter, /saveProject\(snapshotted\)/);
  assert.match(adapter, /await getProject\(project\.id\)/);
  assert.match(adapter, /savedEvents\.length !== result\.events\.length/);
  assert.match(adapter, /savedEvent\.frequencyHz/);
  assert.match(adapter, /savedEvent\.startSeconds/);
  assert.match(adapter, /savedEvent\.endSeconds/);
  assert.match(adapter, /Não vou dizer que foi aplicado/);
});

test('A B and selective undo own de-esser only through its canonical source plus section id', async () => {
  const [ab, undo] = await Promise.all([
    read('packages/core/src/section-mix-ab.mjs'),
    read('packages/core/src/section-mix-undo.mjs'),
  ]);
  assert.match(ab, /PABLO_SECTION_VOCAL_DEESSER_SOURCE/);
  assert.match(undo, /VOCAL_DEESSER: 'vocal_deesser'/);
  assert.match(undo, /PABLO_SECTION_VOCAL_DEESSER_SOURCE/);
  assert.match(undo, /id\.endsWith\(`:\$\{sectionId\}`\)/);
  assert.doesNotMatch(undo, /user_manual.*sourcesForMode|pablo_breath_intelligence.*sourcesForMode/);
});

test('regional peaking EQ normalization reaches the sibilance band in persistence and playback', async () => {
  const [project, eq] = await Promise.all([
    read('packages/core/src/project.mjs'),
    read('packages/audio/src/automation/region-eq.mjs'),
  ]);
  assert.match(project, /frequencyHz, 220\), 80, 12000/);
  assert.match(eq, /frequencyHz, 220\), 80, 12000/);
});
