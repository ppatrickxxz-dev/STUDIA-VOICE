import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = await readFile(resolve(import.meta.dirname, '../../packages/app/app.js'), 'utf8');
const actions = [...source.matchAll(/data-action=\\?"([a-z-]+)\\?"/g)].map((match) => match[1]);
const unique = [...new Set(actions)].sort();
const expected = [
  'ab', 'cancel-record', 'close-modal', 'copy-rhyme', 'delete-project', 'effect', 'export', 'export-track',
  'find-rhymes', 'home', 'import', 'insert-structure', 'mute', 'new-project', 'open-project',
  'play', 'preset', 'record', 'save', 'seek', 'select-track', 'settings', 'solo', 'stop',
  'stop-record', 'studio-tab',
].sort();

test('every rendered UI action belongs to the reviewed action contract', () => {
  assert.deepEqual(unique, expected);
});

test('REGRESSION-003: A/B and effect controls route through audible preview engine', () => {
  assert.match(source, /playbackMode: 'processed'/);
  assert.match(source, /mode: state\.playbackMode/);
  assert.match(source, /action === 'effect'/);
  assert.match(source, /restartPreview\(\)/);
});

test('no enabled AI, stems, or voice-conversion button is rendered', () => {
  assert.doesNotMatch(source, /data-action="(?:ai|stems|voice-conversion)"/);
  assert.match(source, /\['IA generativa', false/);
  assert.match(source, /\['Separação de stems', false/);
  assert.match(source, /\['Conversão vocal', false/);
});

