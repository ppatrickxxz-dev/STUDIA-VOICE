import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('canonical boot installs full treatment after full scan and before section cleanup', async () => {
  const preboot = await read('packages/app/preboot.mjs');
  assert.match(preboot, /pablo-full-vocal-treatment-adapter\.mjs/);
  assert.match(preboot, /installPabloFullVocalTreatmentAdapter/);
  assert.ok(preboot.indexOf('installPabloFullVocalScanAdapter();') < preboot.indexOf('installPabloFullVocalTreatmentAdapter();'));
  assert.ok(preboot.indexOf('installPabloFullVocalTreatmentAdapter();') < preboot.indexOf('installPabloSectionVocalCleanupAdapter();'));
});

test('full treatment adapter analyzes the resolved vocal once and verifies persisted cleanup events', async () => {
  const adapter = await read('packages/app/pablo-full-vocal-treatment-adapter.mjs');
  assert.match(adapter, /analyzeAudioTrack\(target\.track\)/);
  assert.match(adapter, /applyFullVocalTreatment\(project, command, \{ analysis, now: Date\.now\(\) \}\)/);
  assert.match(adapter, /snapshotProject/);
  assert.match(adapter, /saveProject/);
  assert.match(adapter, /isTreatmentPersisted/);
  assert.match(adapter, /PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST/);
  assert.match(adapter, /Continuei o tratamento vocal por prioridade/);
  assert.match(adapter, /no_remaining_priority_cleanup_evidence/);
  assert.doesNotMatch(adapter, /detectBreathAndSibilance|detectPlosives|detectVocalPeaks|detectVocalClicks|decodeAudioData/);
});

test('full treatment core reuses scan ranking and canonical cleanup authority', async () => {
  const core = await read('packages/core/src/full-vocal-treatment.mjs');
  assert.match(core, /planFullVocalScan/);
  assert.match(core, /planSectionVocalCleanup/);
  assert.match(core, /applySectionVocalCleanup/);
  assert.match(core, /isCleanupEventForSection/);
  assert.match(core, /skipPreviouslyTreated/);
  assert.match(core, /already_treated/);
  assert.match(core, /analysisPasses/);
  assert.doesNotMatch(core, /AudioContext|OfflineAudioContext|createBiquadFilter|createDynamicsCompressor/);
  assert.doesNotMatch(core, /saveProject|snapshotProject|fetch\(|provider|OPENAI|Eleven|Suno/);
});

test('full treatment parser is separate from read-only scan, continue, and section-only cleanup language', async () => {
  const core = await read('packages/core/src/full-vocal-treatment.mjs');
  assert.match(core, /parseFullVocalTreatmentCommand/);
  assert.match(core, /analisa\|analisar\|escaneia/);
  assert.match(core, /limpa \(\?:a\|minha\) voz/);
  assert.match(core, /continua\|continuar\|prossegue\|prosseguir/);
  assert.match(core, /remaining_priority_confirmed_sections/);
  assert.match(core, /secao por secao\|por secoes/);
});
