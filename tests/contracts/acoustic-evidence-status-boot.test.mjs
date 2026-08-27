import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const preboot = await readFile(new URL('../../packages/app/preboot.mjs', import.meta.url), 'utf8');
const ui = await readFile(new URL('../../packages/app/acoustic-evidence-status-ui.mjs', import.meta.url), 'utf8');

test('canonical boot installs the acoustic evidence status layer', () => {
  assert.match(preboot, /import\('\.\/acoustic-evidence-status-ui\.mjs'\)/);
  assert.match(preboot, /installAcousticEvidenceStatusUI\(\)/);
});

test('evidence UI explicitly states that a completed render is not acoustic approval', () => {
  assert.match(ui, /Áudio pronto não significa voz aprovada/);
  assert.match(ui, /identity|identidade/i);
  assert.match(ui, /high \+ low/);
});
