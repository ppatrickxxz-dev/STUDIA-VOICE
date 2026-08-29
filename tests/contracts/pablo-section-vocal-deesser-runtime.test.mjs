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

test('de-esser adapter reuses canonical decoded analyzer and requires measured sibilance bands', async () => {
  const adapter = await read('packages/app/pablo-section-vocal-deesser-adapter.mjs');
  assert.match(adapter, /analyzeAudioTrack\(target\.track\)/);
  assert.match(adapter, /analysis\?\.voice\?\.sibilanceEvents/);
  assert.match(adapter, /analysis\?\.voice\?\.eventDetection\?\.source/);
  assert.match(adapter, /adaptiveFrequencyRequired: true/);
  assert.match(adapter, /frequencyMode !== 'adaptive'/);
  assert.doesNotMatch(adapter, /detectBreathAndSibilance|analyzeNoiseFrame|estimateSibilanceBand/);
});

test('canonical sibilance detector enriches the same events with local spectral evidence', async () => {
  const [detector, spectrum, voice] = await Promise.all([
    read('packages/audio/src/analyzers/breath-sibilance.mjs'),
    read('packages/audio/src/analyzers/sibilance-spectrum.mjs'),
    read('packages/audio/src/analyzers/voice.mjs'),
  ]);
  assert.match(detector, /enrichSibilanceEventsWithSpectrum\(samples, detectedSibilance, \{ sampleRate \}\)/);
  assert.match(spectrum, /local-sibilance-spectrum-v1/);
  assert.match(spectrum, /goertzelPower/);
  assert.match(spectrum, /frequencyHz/);
  assert.match(spectrum, /spectralConfidence/);
  assert.match(voice, /normalized\.frequencyHz = frequencyHz/);
  assert.match(voice, /normalized\.spectralConfidence = spectralConfidence/);
});

test('de-esser remains micro-window peaking EQ and fails closed when adaptive band is missing', async () => {
  const core = await read('packages/core/src/section-vocal-deesser.mjs');
  assert.match(core, /kind: 'peaking_eq'/);
  assert.match(core, /minFrequencyHz: 4800/);
  assert.match(core, /maxFrequencyHz: 10800/);
  assert.match(core, /spectralConfidenceThreshold: 0\.12/);
  assert.match(core, /adaptive_sibilance_band_required/);
  assert.match(core, /frequencyMode: windows\.every/);
  assert.match(core, /mergeCandidateWindows/);
  assert.doesNotMatch(core, /kind: 'high_shelf'/);
  assert.doesNotMatch(core, /AudioContext|OfflineAudioContext|createBiquadFilter/);
});

test('persistence verifies every adaptive de-esser window before claiming success', async () => {
  const adapter = await read('packages/app/pablo-section-vocal-deesser-adapter.mjs');
  assert.match(adapter, /saveProject\(snapshotted\)/);
  assert.match(adapter, /await getProject\(project\.id\)/);
  assert.match(adapter, /savedEvents\.length !== result\.events\.length/);
  assert.match(adapter, /savedEvent\.frequencyHz/);
  assert.match(adapter, /Number\(savedEvent\.frequencyHz\) >= 4800/);
  assert.match(adapter, /Number\(savedEvent\.frequencyHz\) <= 10800/);
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

test('regional peaking EQ normalization reaches the complete adaptive sibilance band in persistence and playback', async () => {
  const [project, eq] = await Promise.all([
    read('packages/core/src/project.mjs'),
    read('packages/audio/src/automation/region-eq.mjs'),
  ]);
  assert.match(project, /frequencyHz, 220\), 80, 12000/);
  assert.match(eq, /frequencyHz, 220\), 80, 12000/);
});
