import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('canonical boot installs vocal scan before cleanup so diagnostic language stays read-only', async () => {
  const preboot = await read('packages/app/preboot.mjs');
  assert.match(preboot, /pablo-section-vocal-scan-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionVocalScanAdapter/);
  assert.ok(preboot.indexOf('installPabloSectionVocalScanAdapter();') < preboot.indexOf('installPabloSectionVocalCleanupAdapter();'));
});

test('scan adapter decodes the vocal once through canonical analyzeAudioTrack and never persists', async () => {
  const adapter = await read('packages/app/pablo-section-vocal-scan-adapter.mjs');
  assert.match(adapter, /analyzeAudioTrack\(target\.track\)/);
  assert.match(adapter, /planSectionVocalScan\(project, command, \{ analysis \}\)/);
  assert.match(adapter, /diagnóstico vocal · somente leitura/);
  assert.doesNotMatch(adapter, /detectBreathAndSibilance|detectPlosives|detectVocalPeaks|detectVocalClicks|decodeAudioData/);
  assert.doesNotMatch(adapter, /saveProject|snapshotProject|regionAutomation\s*=|push\(/);
});

test('scan core reuses cleanup gates rather than duplicating acoustic decision thresholds', async () => {
  const core = await read('packages/core/src/section-vocal-scan.mjs');
  assert.match(core, /planSectionVocalCleanup/);
  assert.match(core, /DEFAULT_CLEANUP\.peakConfidenceThreshold/);
  assert.match(core, /DEFAULT_CLEANUP\.peakIntensityThreshold/);
  assert.match(core, /readOnly: true/);
  assert.match(core, /PABLO_SECTION_VOCAL_SCAN_SOURCE/);
  assert.doesNotMatch(core, /saveProject|snapshotProject|AudioContext|OfflineAudioContext|createBiquadFilter|createDynamicsCompressor/);
});

test('scan has no mutation or remote-generation surface', async () => {
  const [core, adapter] = await Promise.all([
    read('packages/core/src/section-vocal-scan.mjs'),
    read('packages/app/pablo-section-vocal-scan-adapter.mjs'),
  ]);
  const source = `${core}\n${adapter}`;
  assert.doesNotMatch(source, /fetch\(|agentTurn|generateMusicDraft|Composer|provider|OPENAI|Eleven|Suno/);
  assert.doesNotMatch(source, /applySectionVocalCleanup|applySectionVocalClick|applySectionVocalPlosive|applySectionVocalDeEsser/);
});
