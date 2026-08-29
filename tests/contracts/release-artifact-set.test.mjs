import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');

const expected = [
  'apps/android/app/build/outputs/apk/release/app-release.apk',
  'apps/android/app/build/outputs/apk/release/app-release.apk.sha256',
  'apps/android/app/build/outputs/bundle/release/app-release.aab',
  'apps/android/app/build/outputs/bundle/release/app-release.aab.sha256',
];

test('signed artifact upload and draft release use the same four production files', () => {
  for (const path of expected) {
    const occurrences = workflow.split(path).length - 1;
    assert.ok(occurrences >= 2, `${path} must be present in signed upload and draft release set`);
  }
});

test('release publication never includes validation or debug APK paths', () => {
  const publication = workflow.slice(workflow.indexOf('- name: Upload stable signed artifacts'));
  assert.doesNotMatch(publication, /apk\/validation|apk\/debug|app-validation|app-debug/);
});

test('tag creation happens after signed APK validation and artifact retention', () => {
  const validate = workflow.indexOf('- name: Validate signed release APK');
  const upload = workflow.indexOf('- name: Upload stable signed artifacts');
  const tag = workflow.indexOf('- name: Create or verify release tag');
  const release = workflow.indexOf('- name: Create or refresh draft GitHub release');
  assert.ok(validate >= 0 && upload > validate && tag > upload && release > tag);
});
