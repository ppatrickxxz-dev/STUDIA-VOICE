import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gradle = await readFile(new URL('../../apps/android/app/build.gradle', import.meta.url), 'utf8');

test('validation APK is distinguishable from the production package and version', () => {
  assert.match(gradle, /applicationIdSuffix\s+['"]\.validation['"]/);
  assert.match(gradle, /versionNameSuffix\s+['"]-validation['"]/);
});

test('release versionCode remains a positive Android-compatible integer', () => {
  const match = gradle.match(/versionCode\s+(\d+)/);
  assert.ok(match, 'versionCode missing');
  const versionCode = Number(match[1]);
  assert.ok(Number.isSafeInteger(versionCode));
  assert.ok(versionCode > 0 && versionCode < 2147483647);
});
