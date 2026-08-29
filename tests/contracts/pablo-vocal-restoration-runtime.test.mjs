import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('canonical analysis exposes regional noise and reflection evidence without a second decode', async () => {
  const [pipeline, analyzer, runtime] = await Promise.all([
    read('packages/audio/src/analyzers/pipeline.mjs'),
    read('packages/audio/src/analyzers/vocal-restoration.mjs'),
    read('packages/app/audio-analysis-runtime.mjs'),
  ]);
  assert.match(pipeline, /analyzeVocalRestoration/);
  assert.match(pipeline, /pitchContour: pitch\.pitchContour/);
  assert.match(pipeline, /noiseWindowCount/);
  assert.match(pipeline, /reverbWindowCount/);
  assert.match(analyzer, /vocal-noise-floor-v1/);
  assert.match(analyzer, /vocal-early-reflection-v1/);
  assert.match(analyzer, /bounded-vocal-timbre-guard-v1/);
  assert.equal((runtime.match(/decodeAudioData/g) || []).length, 1);
});

test('cleanup owns bounded denoise and dereverb events behind explicit timbre guards', async () => {
  const [cleanup, project, adapter] = await Promise.all([
    read('packages/core/src/section-vocal-cleanup.mjs'),
    read('packages/core/src/project.mjs'),
    read('packages/app/pablo-section-vocal-cleanup-adapter.mjs'),
  ]);
  assert.match(cleanup, /pablo_section_vocal_cleanup_denoise/);
  assert.match(cleanup, /pablo_section_vocal_cleanup_dereverb/);
  assert.match(cleanup, /kind: 'vocal_denoise'/);
  assert.match(cleanup, /kind: 'vocal_dereverb'/);
  assert.match(cleanup, /pitchPreserving === true/);
  assert.match(cleanup, /formantPreserving === true/);
  assert.match(cleanup, /minVoicedMarginDb: 10/);
  assert.match(cleanup, /maxNoiseReductionDb: 5\.5/);
  assert.match(cleanup, /maxDereverbAmount: 0\.2/);
  assert.match(project, /PROJECT_SCHEMA_VERSION = 9/);
  assert.match(project, /kind === 'vocal_denoise'/);
  assert.match(project, /kind === 'vocal_dereverb'/);
  assert.match(adapter, /timbreProtected/);
  assert.match(adapter, /voicedMarginDb/);
  assert.match(adapter, /reflectionDelayMs/);
});

test('preview and offline export use the same real non-destructive PCM restoration path', async () => {
  const [engine, dsp] = await Promise.all([
    read('packages/app/audio-engine.mjs'),
    read('packages/audio/src/automation/region-restoration.mjs'),
  ]);
  assert.match(engine, /cloneWithVocalRestoration/);
  assert.match(engine, /this\.restoredBuffer\(context/);
  assert.match(engine, /this\.restoredBuffer\(offline/);
  assert.match(engine, /pablovoice:vocal-restoration-rendered/);
  assert.match(dsp, /applyDenoise/);
  assert.match(dsp, /applyDereverb/);
  assert.match(dsp, /output\.getChannelData/);
  assert.doesNotMatch(dsp, /fetch\(|provider|OPENAI|Suno|Eleven/);
});

test('scan explains restoration evidence while A B and undo inherit cleanup ownership', async () => {
  const [scan, scanAdapter, ab, undo] = await Promise.all([
    read('packages/core/src/section-vocal-scan.mjs'),
    read('packages/app/pablo-section-vocal-scan-adapter.mjs'),
    read('packages/core/src/section-mix-ab.mjs'),
    read('packages/core/src/section-mix-undo.mjs'),
  ]);
  assert.match(scan, /Ruído de fundo/);
  assert.match(scan, /Reflexo do ambiente/);
  assert.match(scan, /timbreProtected/);
  assert.match(scanAdapter, /SNR/);
  assert.match(scanAdapter, /reflexo/);
  assert.match(ab, /PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST/);
  assert.match(undo, /PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST/);
});
