import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gradle = await readFile(new URL('../../apps/android/app/build.gradle', import.meta.url), 'utf8');

function block(name) {
  const start = gradle.indexOf(`${name} {`);
  assert.ok(start >= 0, `${name} block missing`);
  const next = gradle.indexOf('\n        }', start);
  return gradle.slice(start, next >= 0 ? next : gradle.length);
}

test('release build keeps canonical package identity without validation suffixes', () => {
  const release = block('release');
  assert.doesNotMatch(release, /applicationIdSuffix/);
  assert.doesNotMatch(release, /versionNameSuffix/);
});

test('debug validation build remains explicitly non-production', () => {
  const debug = block('debug');
  assert.match(debug, /applicationIdSuffix\s+['"]\.validation['"]/);
  assert.match(debug, /versionNameSuffix\s+['"]-validation['"]/);
});
