import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('canonical boot installs full vocal scan before section scan and cleanup', async () => {
  const preboot = await read('packages/app/preboot.mjs');
  assert.match(preboot, /pablo-full-vocal-scan-adapter\.mjs/);
  assert.match(preboot, /installPabloFullVocalScanAdapter/);
  assert.ok(preboot.indexOf('installPabloFullVocalScanAdapter();') < preboot.indexOf('installPabloSectionVocalScanAdapter();'));
  assert.ok(preboot.indexOf('installPabloFullVocalScanAdapter();') < preboot.indexOf('installPabloSectionVocalCleanupAdapter();'));
});

test('full scan adapter analyzes the selected vocal exactly once and never persists', async () => {
  const adapter = await read('packages/app/pablo-full-vocal-scan-adapter.mjs');
  assert.equal((adapter.match(/analyzeAudioTrack\(target\.track\)/g) || []).length, 1);
  assert.match(adapter, /planFullVocalScan\(project, \{ analysis \}\)/);
  assert.match(adapter, /varredura vocal completa · somente leitura/);
  assert.doesNotMatch(adapter, /saveProject|snapshotProject|saveAudioAsset|regionAutomation\s*=|decodeAudioData/);
});

test('full scan core reuses the canonical section scan instead of creating another acoustic detector', async () => {
  const core = await read('packages/core/src/full-vocal-scan.mjs');
  assert.match(core, /planSectionVocalScan/);
  assert.match(core, /analysisPasses: 1/);
  assert.match(core, /readOnly: true/);
  assert.match(core, /PABLO_FULL_VOCAL_SCAN_SOURCE/);
  assert.doesNotMatch(core, /DEFAULT_CLEANUP|detectBreath|detectSibil|detectPlosive|detectVocal|AudioContext|OfflineAudioContext/);
});

test('full scan has no mutation or remote-provider surface', async () => {
  const [core, adapter] = await Promise.all([
    read('packages/core/src/full-vocal-scan.mjs'),
    read('packages/app/pablo-full-vocal-scan-adapter.mjs'),
  ]);
  const source = `${core}\n${adapter}`;
  assert.doesNotMatch(source, /fetch\(|agentTurn|generateMusicDraft|provider|OPENAI|Eleven|Suno/);
  assert.doesNotMatch(source, /applySectionVocalCleanup|applySectionVocalClick|applySectionVocalPlosive|applySectionVocalDeEsser/);
});
