import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

function functionBody(source, name) {
  const marker = new RegExp(`async function ${name}\\([^)]*\\) \\{`, 'm');
  const match = marker.exec(source);
  assert.ok(match, `expected ${name}`);
  let depth = 0;
  for (let index = match.index; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, index + 1);
    }
  }
  throw new Error(`Could not read ${name}`);
}

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
  const engine = await read('packages/app/audio-engine.mjs');
  assert.match(contract, /migrateProject\(structuredClone\(project\)\)/);
  assert.match(contract, /if \(trackId\)/);
  assert.match(engine, /trackId,\s*\n\s*\}\)/);
  assert.doesNotMatch(contract, /regionAutomation\s*=|\.push\(|applySection|planSection/);
  const exportBody = functionBody(app, 'exportMix');
  assert.match(exportBody, /structuredClone\(state\.project\)/);
  assert.match(exportBody, /engine\.render\(projectBeforeExport, projectBeforeExport\.preset\)/);
  assert.match(exportBody, /projectBeforeExport\.name/);
  assert.match(exportBody, /projectBeforeExport\.preset/);
  assert.match(exportBody, /await saveBlob\(blob, filename\)/);
  assert.doesNotMatch(exportBody, /state\.project\.(?:name|preset)/);
  assert.doesNotMatch(exportBody, /saveCurrent|persistProject|snapshotProject/);
});

test('individual processed-track export uses renderTrack and remains storage-immutable', async () => {
  const app = await read('packages/app/app.js');
  const exportBody = functionBody(app, 'exportTrack');
  assert.match(exportBody, /structuredClone\(state\.project\)/);
  assert.match(exportBody, /projectBeforeExport\.tracks\.find/);
  assert.match(exportBody, /engine\.renderTrack\(projectBeforeExport, track\.id, projectBeforeExport\.preset\)/);
  assert.match(exportBody, /encodeWav\(buffer\)/);
  assert.match(exportBody, /projectBeforeExport\.name/);
  assert.match(exportBody, /projectBeforeExport\.preset/);
  assert.match(exportBody, /await saveBlob\(blob,/);
  assert.doesNotMatch(exportBody, /state\.project\.(?:name|preset)/);
  assert.doesNotMatch(exportBody, /saveCurrent|persistProject|snapshotProject|regionAutomation\.push/);
});

test('Web export prefers Android native save bridge before browser download fallback', async () => {
  const app = await read('packages/app/app.js');
  const body = functionBody(app, 'saveBlob');
  const bridgeIndex = body.indexOf('globalThis.PabloVoiceAndroid');
  const beginIndex = body.indexOf('bridge.beginSave');
  const fallbackIndex = body.indexOf('URL.createObjectURL');
  assert.ok(bridgeIndex >= 0, 'saveBlob must resolve the Android bridge');
  assert.ok(beginIndex > bridgeIndex, 'saveBlob must start native Android save through beginSave');
  assert.ok(fallbackIndex > beginIndex, 'browser download fallback must remain after Android bridge attempt');
  assert.match(body, /if \(bridge\?\.beginSave\)/);
  assert.match(body, /bridge\.beginSave\(filename, blob\.type\)/);
  assert.match(body, /const bytes = new Uint8Array\(await blob\.arrayBuffer\(\)\)/);
  assert.match(body, /const chunkSize = 48 \* 1024/);
  assert.match(body, /bridge\.appendBase64\(btoa\(binary\)\)/);
  assert.match(body, /bridge\.finishSave\(\)/);
  assert.match(body, /catch \(error\) \{\s*bridge\.abortSave\(\);\s*throw error;\s*\}/);
  assert.match(body, /anchor\.download = filename/);
  assert.match(body, /URL\.revokeObjectURL\(url\)/);
});
