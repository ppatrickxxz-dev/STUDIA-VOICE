import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('canonical boot installs Pablo confirmed section audition after contextual section handling', async () => {
  const preboot = await read('packages/app/preboot.mjs');
  assert.match(preboot, /pablo-section-audition-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionAuditionAdapter/);
  assert.ok(preboot.indexOf('installPabloSectionHereAdapter();') < preboot.indexOf('installPabloSectionAuditionAdapter();'));
});

test('section audition uses the canonical PabloAudioEngine and project assets instead of a second simplified player', async () => {
  const runtime = await read('packages/app/section-audition-runtime.mjs');
  assert.match(runtime, /PabloAudioEngine/);
  assert.match(runtime, /getAudioAsset/);
  assert.match(runtime, /await engine\.decode\(track\.id, asset\.blob\)/);
  assert.match(runtime, /await engine\.play\(project/);
  assert.match(runtime, /position: startSeconds/);
  assert.match(runtime, /mode/);
  assert.match(runtime, /position >= endSeconds - 0\.015/);
  assert.match(runtime, /engine\.stop\(false\)/);
  assert.doesNotMatch(runtime, /new Audio\(|HTMLAudioElement|createElement\(['"]audio/);
});

test('Pablo audition boundary requires a complete confirmed section and explicit occurrence when ambiguous', async () => {
  const adapter = await read('packages/app/pablo-section-audition-adapter.mjs');
  assert.match(adapter, /parseSectionAuditionCommand/);
  assert.match(adapter, /resolveConfirmedSectionAudition/);
  assert.match(adapter, /missing_confirmed_section/);
  assert.match(adapter, /missing_confirmed_end/);
  assert.match(adapter, /ambiguous_occurrence/);
  assert.match(adapter, /missing_occurrence/);
  assert.match(adapter, /auditionConfirmedSection\(project, resolved\.section/);
  assert.match(adapter, /mode: 'processed'/);
  assert.doesNotMatch(adapter, /agentTurn|fetch\(|remoteAuth/);
});

test('audition runtime exposes only bounded playback status for browser evidence', async () => {
  const runtime = await read('packages/app/section-audition-runtime.mjs');
  assert.match(runtime, /getSectionAuditionStatus/);
  assert.match(runtime, /projectId/);
  assert.match(runtime, /sectionId/);
  assert.match(runtime, /startSeconds/);
  assert.match(runtime, /endSeconds/);
  assert.doesNotMatch(runtime, /localStorage|sessionStorage/);
});
