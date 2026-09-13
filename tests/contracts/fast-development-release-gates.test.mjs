import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ci = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const compositionCanary = await readFile(new URL('../../.github/workflows/native-music-pr-composition-canary.yml', import.meta.url), 'utf8');

const readyEvent = /types:\s*\[opened, synchronize, reopened, ready_for_review\]/;

test('draft PRs keep fast Web feedback while deferring physical Android gates', () => {
  assert.match(ci, readyEvent);

  const webStart = ci.indexOf('  web-and-contracts:');
  const androidStart = ci.indexOf('  android-build:');
  assert.ok(webStart >= 0 && androidStart > webStart, 'canonical Web and Android jobs must exist');

  const webJob = ci.slice(webStart, androidStart);
  const androidJobs = ci.slice(androidStart);

  assert.doesNotMatch(webJob, /pull_request\.draft/, 'fast Web/contracts feedback must still run for draft PRs');
  assert.match(androidJobs, /github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft == false/);
  assert.match(androidJobs, /android-emulator:/);
  assert.match(androidJobs, /android-import-emulator:/);
  assert.match(androidJobs, /android-open-with-project-emulator:/);
});

test('marking a PR ready re-enables the real composition canary instead of deleting the release proof', () => {
  assert.match(compositionCanary, readyEvent);
  assert.match(compositionCanary, /real-composition:/);
  assert.match(compositionCanary, /github\.event\.pull_request\.draft == false/);
  assert.match(compositionCanary, /Compose a real song through the same transparent-user runtime/);
  assert.match(compositionCanary, /REAL_COMPOSITION_PATH_VERIFIED/);
  assert.match(compositionCanary, /ffprobe/);
  assert.match(compositionCanary, /ffmpeg/);
});
