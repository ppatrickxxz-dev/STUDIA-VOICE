import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const preboot = await readFile(new URL('../../packages/app/preboot.mjs', import.meta.url), 'utf8');
const index = await readFile(new URL('../../packages/app/index.html', import.meta.url), 'utf8');
const ui = await readFile(new URL('../../packages/app/pablovoice-vnext-ui.mjs', import.meta.url), 'utf8');
const css = await readFile(new URL('../../packages/app/pablovoice-vnext-ui.css', import.meta.url), 'utf8');
const sw = await readFile(new URL('../../packages/app/service-worker.js', import.meta.url), 'utf8');

test('vNext product shell is part of the canonical boot and offline shell', () => {
  assert.match(preboot, /import\('\.\/pablovoice-vnext-ui\.mjs'\)/);
  assert.match(preboot, /installPabloVoiceVNextUI\(\)/);
  assert.match(index, /pablovoice-vnext-ui\.css/);
  assert.match(index, /pablovoice-vnext-compat\.css/);
  assert.match(sw, /pablovoice-vnext-ui\.mjs/);
  assert.match(sw, /pablovoice-vnext-ui\.css/);
  assert.match(sw, /pablovoice-vnext-compat\.css/);
});

test('vNext derives project state from the unified Music Graph instead of a parallel project model', () => {
  assert.match(ui, /buildUnifiedProjectContext/);
  assert.match(ui, /runtime\.graph/);
  assert.doesNotMatch(ui, /persistedSeparately\s*:\s*true/);
  assert.match(ui, /graph\.structure\?\.sections/);
  assert.match(ui, /graph\.tracks/);
  assert.match(ui, /graph\.songCreation\?\.takeCount/);
});

test('vNext delegates specialist actions to existing real product hooks', () => {
  for (const hook of [
    'data-beat-lab-open',
    'data-instrument-open',
    'data-action="studio-tab"',
    'data-section-map-open',
    'data-pv-studio-stems',
    'data-action="record"',
    'data-action="play"',
  ]) assert.ok(ui.includes(hook), `missing real specialist hook: ${hook}`);
});

test('canonical Pablo and companion board remain the only character asset sources used by vNext', () => {
  assert.match(ui, /\/site\/assets\/pablo_fullbody\.webp/);
  assert.match(css, /\/site\/assets\/companions_board\.webp/);
  for (const companion of ['Nota Drop', 'Wave Ribbon', 'Chime Lantern', 'EQ Bloom', 'Vinyl Groove', 'Star Spark']) {
    assert.ok(ui.includes(companion), `missing canonical companion: ${companion}`);
  }
});

test('the pocket device is a playback visualizer with preserved companion meanings', () => {
  assert.match(ui, /POCKET VISUALIZER/);
  assert.match(ui, /TOCANDO AGORA/);
  assert.match(ui, /captura musical · melodia · groove/);
  assert.match(ui, /movimento · seções · continuidade/);
  assert.match(ui, /palavras · sentido · guia/);
  assert.match(ui, /clareza · timbre · equilíbrio/);
  assert.match(ui, /textura · impacto · balanço/);
  assert.match(ui, /faísca · ousadia · direção/);
});
