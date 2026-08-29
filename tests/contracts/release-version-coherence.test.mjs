import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageText = await readFile(new URL('../../package.json', import.meta.url), 'utf8');
const gradle = await readFile(new URL('../../apps/android/app/build.gradle', import.meta.url), 'utf8');
const pkg = JSON.parse(packageText);

function quotedGradleValue(name) {
  const match = gradle.match(new RegExp(`${name}\\s+['\"]([^'\"]+)['\"]`));
  return match?.[1] ?? null;
}

function numericGradleValue(name) {
  const match = gradle.match(new RegExp(`${name}\\s+(\\d+)`));
  return match ? Number(match[1]) : null;
}

test('Android versionName exactly matches the canonical package version', () => {
  assert.equal(quotedGradleValue('versionName'), pkg.version);
});

test('release candidate version maps to the deterministic Android versionCode scheme', () => {
  const match = String(pkg.version).match(/^(\d+)\.(\d+)\.(\d+)-rc\.(\d+)$/);
  assert.ok(match, `expected release-candidate semantic version, got ${pkg.version}`);
  const [, major, minor, patch, rc] = match.map(Number);
  const expectedCode = major * 10000 + minor * 1000 + patch * 100 + rc;
  assert.equal(numericGradleValue('versionCode'), expectedCode);
});

test('Android release identity remains the canonical PabloVoice application', () => {
  assert.equal(quotedGradleValue('applicationId'), 'com.pablovoice.studio');
  assert.equal(numericGradleValue('targetSdk'), 35);
  assert.ok(numericGradleValue('minSdk') >= 24);
});
