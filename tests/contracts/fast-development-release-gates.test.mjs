import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ci = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const compositionCanary = await readFile(new URL('../../.github/workflows/native-music-pr-composition-canary.yml', import.meta.url), 'utf8');
const cloudflareGate = await readFile(new URL('../../.github/workflows/cloudflare-runtime-gate.yml', import.meta.url), 'utf8');

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
  assert.match(androidJobs, /android-emulator:/, 'one physical Android emulator gate must remain');
  assert.match(androidJobs, /android-emulator-gate\.sh/, 'canonical launch gate must run');
  assert.match(androidJobs, /android-import-emulator-gate\.sh/, 'import flow must run in the unified emulator');
  assert.match(androidJobs, /android-open-with-project-emulator-gate\.sh/, 'open-with project flow must run in the unified emulator');
  assert.match(androidJobs, /android-complete-user-flow-gate\.sh/, 'complete user flow must run in the unified emulator');
  assert.doesNotMatch(androidJobs, /\n  android-import-emulator:/, 'import must not boot a second emulator job');
  assert.doesNotMatch(androidJobs, /\n  android-open-with-project-emulator:/, 'open-with must not boot a third emulator job');
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

test('Cloudflare keeps cheap contracts in draft and defers only the physical preview', () => {
  assert.match(cloudflareGate, readyEvent);
  const dryRunStart = cloudflareGate.indexOf('  dry-run:');
  const physicalStart = cloudflareGate.indexOf('  physical-preview:');
  assert.ok(dryRunStart >= 0 && physicalStart > dryRunStart, 'Cloudflare dry-run and physical preview jobs must exist');

  const dryRun = cloudflareGate.slice(dryRunStart, physicalStart);
  const physical = cloudflareGate.slice(physicalStart);
  assert.doesNotMatch(dryRun, /pull_request\.draft/, 'Cloudflare build/contracts must still run in draft');
  assert.match(physical, /github\.event_name == 'pull_request' && github\.event\.pull_request\.draft == false/);
  assert.match(physical, /Discover native Cloudflare public URL for this exact head/);
  assert.match(physical, /Smoke physical Studio, Site Vivo and connected music runtime/);
});
