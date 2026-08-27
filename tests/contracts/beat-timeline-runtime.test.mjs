import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Pablo runtime escalates qualified timeline plans into real audio render', async () => {
  const runtime = await read('packages/app/pablo-beat-runtime.mjs');
  assert.match(runtime, /requiresAudioRender === true/);
  assert.match(runtime, /timelineRender/);
  assert.match(runtime, /beat-timeline-runtime\.mjs/);
  assert.match(runtime, /renderPabloBeatTimeline\(project, result\.timelineRender\)/);
  assert.match(runtime, /timeline_render_runtime_unavailable/);
});

test('timeline renderer creates a real WAV beat-fill track at canonical track offset', async () => {
  const renderer = await read('packages/app/beat-timeline-runtime.mjs');
  assert.match(renderer, /OfflineAudioContext/);
  assert.match(renderer, /encodePcmWav/);
  assert.match(renderer, /createTrack/);
  assert.match(renderer, /kind: 'beat-fill'/);
  assert.match(renderer, /track\.offset = startSeconds/);
  assert.match(renderer, /track\.trimEnd = rendered\.duration/);
  assert.match(renderer, /source\.start\(start, padStart, sliceDuration\)/);
  assert.match(renderer, /Math\.min\(available, requestedSlice, maxMediaDuration\)/);
  assert.doesNotMatch(renderer, /fetch\(|agentTurn|RemoteAuthAdapter/);
});

test('render persistence is atomic and replaces Pablo fill for the same section', async () => {
  const [renderer, atomic, engine] = await Promise.all([
    read('packages/app/beat-timeline-runtime.mjs'),
    read('packages/app/atomic-audio-project-storage.mjs'),
    read('packages/app/audio-engine.mjs'),
  ]);
  assert.match(renderer, /isSameTimelineTarget/);
  assert.match(renderer, /deleteAssetIds: staleAssetIds/);
  assert.match(renderer, /replacedPriorFill/);
  assert.match(renderer, /saveProjectWithAudioAsset/);
  assert.match(atomic, /transaction\(\['projects', 'audio'\], 'readwrite'\)/);
  assert.match(atomic, /objectStore\('audio'\)\.put\(audioValue\)/);
  assert.match(atomic, /objectStore\('projects'\)\.put\(project\)/);
  assert.match(atomic, /objectStore\('audio'\)\.delete\(id\)/);
  assert.match(engine, /timelineStart = Number\(track\.offset \|\| 0\)/);
});

test('timeline render keeps section provenance on the resulting project track', async () => {
  const renderer = await read('packages/app/beat-timeline-runtime.mjs');
  assert.match(renderer, /pablovoice_beat_timeline_event_v1/);
  assert.match(renderer, /operation: 'fill_before_section'/);
  assert.match(renderer, /generatedBy: 'pablo'/);
  assert.match(renderer, /targetSectionId/);
  assert.match(renderer, /targetStartSeconds: endSeconds/);
  assert.match(renderer, /sourcePadIds/);
  assert.match(renderer, /snapshotProject\(next, `Virada antes de \$\{targetLabel\}`\)/);
});
