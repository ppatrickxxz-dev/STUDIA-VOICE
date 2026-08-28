import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('mix export and processed preview share the canonical processed track source and restoration path', async () => {
  const engine = await read('packages/app/audio-engine.mjs');
  assert.match(engine, /createTrackSources\(context, buffer, track, mode/);
  assert.match(engine, /this\.restoredBuffer\(offline, track, this\.buffers\.get\(track\.id\)\)/);
  assert.match(engine, /createTrackSources\(offline, buffer, track, 'processed'/);
  assert.match(engine, /sourceRegionsToTrackTime\(track, track\.regionAutomation\)/);
});

test('export validates a cloned project, creates no treatment, and never persists an export revision', async () => {
  const contract = await read('packages/core/src/audio-export.mjs');
  const app = await read('packages/app/app.js');
  assert.match(contract, /migrateProject\(structuredClone\(project\)\)/);
  assert.doesNotMatch(contract, /regionAutomation\s*=|\.push\(|applySection|planSection/);
  const exportBody = app.match(/async function exportMix\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(exportBody, /structuredClone\(state\.project\)/);
  assert.doesNotMatch(exportBody, /saveCurrent|persistProject|snapshotProject/);
});
