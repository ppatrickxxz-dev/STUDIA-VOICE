import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('canonical pipeline computes stationary-noise evidence separately from five-family vocal event provenance', async () => {
  const pipeline = await read('packages/audio/src/analyzers/pipeline.mjs');
  assert.match(pipeline, /detectBackgroundNoise/);
  assert.match(pipeline, /noiseEvents = null/);
  assert.match(pipeline, /noiseDetectionOptions/);
  assert.match(pipeline, /noiseDetection:\s*\{/);
  assert.match(pipeline, /source: needsNoiseDetection \? 'local-heuristic-v1' : 'provided'/);
  const eventSourceMatch = pipeline.match(/eventDetection:\s*\{[\s\S]*?source:\s*([^,\n]+)/);
  assert.ok(eventSourceMatch, 'expected eventDetection source contract');
  assert.doesNotMatch(eventSourceMatch[1], /needsNoiseDetection/);
});

test('stationary noise detector excludes voiced and known vocal-event regions before promotion', async () => {
  const detector = await read('packages/audio/src/analyzers/background-noise.mjs');
  assert.match(detector, /pitchContour = \[\]/);
  assert.match(detector, /excludedEvents = \[\]/);
  assert.match(detector, /overlapsVoicedPitch/);
  assert.match(detector, /overlapsAny/);
  assert.match(detector, /minFrames = 3/);
  assert.match(detector, /stationarity/);
  assert.match(detector, /HUM_BASES = Object\.freeze\(\[50, 60\]\)/);
  assert.doesNotMatch(detector, /AudioContext|OfflineAudioContext|createBiquadFilter|createDynamicsCompressor/);
});

test('vocal scan reports noise and hum as review-only findings and never turns them into cleanup ownership', async () => {
  const scan = await read('packages/core/src/section-vocal-scan.mjs');
  assert.match(scan, /qualifyingNoiseEvents/);
  assert.match(scan, /event\.noiseKind === 'hum' \? 'hum' : 'noise'/);
  assert.match(scan, /buildFinding\(type, event, target, \{ autoEdit: false \}\)/);
  assert.match(scan, /Hum de rede/);
  assert.match(scan, /Ruído de fundo/);
  assert.doesNotMatch(scan, /PABLO_SECTION_VOCAL_CLEANUP_SOURCES\.NOISE|PABLO_SECTION_VOCAL_CLEANUP_SOURCES\.HUM/);
});

test('diagnostic adapter remains read-only and tells the user no denoise was applied', async () => {
  const adapter = await read('packages/app/pablo-section-vocal-scan-adapter.mjs');
  assert.match(adapter, /Ruído\/hum está em diagnóstico somente/);
  assert.match(adapter, /não apliquei redução automática sem um gate próprio de denoise/);
  assert.doesNotMatch(adapter, /saveProject|snapshotProject|regionAutomation\s*=|applySectionVocal|denoise\(/);
});
