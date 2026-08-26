import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const [html, app, activity, manifest] = await Promise.all([
  readFile(resolve(root, 'packages/app/index.html'), 'utf8'),
  readFile(resolve(root, 'packages/app/app.js'), 'utf8'),
  readFile(resolve(root, 'apps/android/app/src/main/java/com/pablovoice/studio/MainActivity.java'), 'utf8'),
  readFile(resolve(root, 'apps/android/app/src/main/AndroidManifest.xml'), 'utf8'),
]);

test('frontend has a restrictive CSP and no dynamic code execution', () => {
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /object-src 'none'/);
  assert.doesNotMatch(app, /\beval\s*\(|new Function\s*\(/);
});

test('uploads are bounded and decoded before becoming project tracks', () => {
  assert.match(app, /MAX_FILE_BYTES = 300 \* 1024 \* 1024/);
  assert.match(app, /engine\.decode\(provisional\.id, file\)/);
  assert.match(activity, /MAX_IMPORT_BYTES = 300L \* 1024L \* 1024L/);
});

test('Android uses least privilege for current features', () => {
  assert.match(manifest, /RECORD_AUDIO/);
  assert.doesNotMatch(manifest, /READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE/);
  assert.match(activity, /setAllowFileAccess\(false\)/);
  assert.match(activity, /MIXED_CONTENT_NEVER_ALLOW/);
});

