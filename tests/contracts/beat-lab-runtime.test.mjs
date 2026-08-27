import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Beat Lab boots in the canonical shell and consumes Sampler pads', async () => {
  const [preboot, ui, engine] = await Promise.all([
    read('packages/app/preboot.mjs'),
    read('packages/app/beat-lab-ui.mjs'),
    read('packages/app/beat-lab-engine.mjs'),
  ]);
  assert.match(preboot, /beat-lab-ui\.mjs/);
  assert.match(preboot, /installBeatLab/);
  assert.match(ui, /normalizeSamplerState\(activeProject\.sampler/);
  assert.match(ui, /Crie pads no Sampler primeiro/);
  assert.match(engine, /padId/);
  assert.doesNotMatch(engine, /detectOnsets/);
});

test('Beat Lab has real sample preview and offline WAV render into a project track', async () => {
  const ui = await read('packages/app/beat-lab-ui.mjs');
  assert.match(ui, /createBufferSource/);
  assert.match(ui, /source\.start\(startTime/);
  assert.match(ui, /OfflineAudioContext/);
  assert.match(ui, /encodePcmWav/);
  assert.match(ui, /saveAudioAsset/);
  assert.match(ui, /createTrack/);
  assert.match(ui, /kind: 'beat'/);
  assert.match(ui, /snapshotProject\(activeProject, 'Beat criado'\)/);
});

test('Beat Lab styling respects canonical CSP and supports variable grid lengths without inline style', async () => {
  const [ui, css] = await Promise.all([
    read('packages/app/beat-lab-ui.mjs'),
    read('packages/app/beat-lab.css'),
  ]);
  assert.match(ui, /href = '\.\/beat-lab\.css'/);
  assert.doesNotMatch(ui, /createElement\(['"]style['"]\)/);
  assert.doesNotMatch(ui, /\.style\./);
  assert.match(css, /\.pv-beat-row\.steps-8/);
  assert.match(css, /\.pv-beat-row\.steps-16/);
  assert.match(css, /\.pv-beat-row\.steps-32/);
});

test('Beat Lab exposes semantic lanes, reference groove, humanize and fill without duplicating analysis', async () => {
  const [ui, engine] = await Promise.all([
    read('packages/app/beat-lab-ui.mjs'),
    read('packages/app/beat-lab-engine.mjs'),
  ]);
  assert.match(ui, /data-beat-organize/);
  assert.match(ui, /data-beat-groove/);
  assert.match(ui, /data-beat-humanize/);
  assert.match(ui, /data-beat-fill/);
  assert.match(engine, /selectSemanticPads/);
  assert.match(engine, /refreshBeatLanesFromSampler/);
  assert.match(engine, /generateBeatFill/);
  assert.match(engine, /deterministicCentered/);
  assert.doesNotMatch(engine, /Math\.random/);
});

test('Beat Lab still exposes velocity, swing and 8/16/32 step patterns', async () => {
  const [ui, engine] = await Promise.all([
    read('packages/app/beat-lab-ui.mjs'),
    read('packages/app/beat-lab-engine.mjs'),
  ]);
  assert.match(ui, /data-beat-velocity/);
  assert.match(ui, /data-beat-swing/);
  assert.match(engine, /\[8, 16, 32\]/);
  assert.match(engine, /duplicateBeatPattern/);
});
