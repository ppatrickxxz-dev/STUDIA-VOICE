import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const activity = await readFile(resolve(root, 'apps/android/app/src/main/java/com/pablovoice/studio/MainActivity.java'), 'utf8');
const recording = await readFile(resolve(root, 'packages/app/recording.mjs'), 'utf8');

test('REGRESSION-004/005: permission grant leads to AudioRecord PCM capture with fallback rates', () => {
  assert.match(activity, /requestPermissions\(new String\[]\{Manifest\.permission\.RECORD_AUDIO\}/);
  assert.match(activity, /new AudioRecord\(/);
  assert.match(activity, /48000, 44100, 32000, 16000/);
  assert.match(activity, /patchWavHeader/);
  assert.match(recording, /PabloVoiceOnMicPermission|PERMISSION_PENDING/);
  assert.match(recording, /MIME_CANDIDATES\.find/);
});

test('Android export is chunked and saved through MediaStore without storage permission', () => {
  assert.match(activity, /MediaStore\.Downloads\.RELATIVE_PATH/);
  assert.match(activity, /appendBase64/);
  assert.doesNotMatch(activity, /WRITE_EXTERNAL_STORAGE/);
});

