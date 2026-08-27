import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ui = await readFile(new URL('../../packages/app/acoustic-evidence-status-ui.mjs', import.meta.url), 'utf8');
const ingestion = await readFile(new URL('../../packages/providers/src/remote-acoustic-evidence.mjs', import.meta.url), 'utf8');

test('Voice Lab status reads project-persisted evidence instead of uploading audio for validation', () => {
  assert.match(ui, /getProject/);
  assert.match(ui, /summarizePersistedAcousticEvidence/);
  assert.doesNotMatch(ui, /fetch\(/);
});

test('harmony pair validation requires explicit pair correlation', () => {
  assert.match(ingestion, /harmony_pair_id/);
  assert.match(ingestion, /if \(!row\.pairId\)/);
  assert.match(ingestion, /group\.high\.promotable && group\.low\.promotable/);
});

test('status keeps the render-ready versus acoustically-approved distinction visible', () => {
  assert.match(ui, /Áudio pronto não significa voz aprovada/);
  assert.match(ui, /pairId suficiente/);
});
