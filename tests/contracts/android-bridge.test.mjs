import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const activity = await readFile(resolve(root, 'apps/android/app/src/main/java/com/pablovoice/studio/MainActivity.java'), 'utf8');
const recording = await readFile(resolve(root, 'packages/app/recording.mjs'), 'utf8');

function methodBody(name) {
  const match = activity.match(new RegExp(`@JavascriptInterface public synchronized (?:boolean|void) ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n        \\}`));
  return match?.[0] || '';
}

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

test('Android bridge save path is transactional and MediaStore-scoped', () => {
  const beginSave = methodBody('beginSave');
  const appendBase64 = methodBody('appendBase64');
  const finishSave = methodBody('finishSave');
  const abortSave = methodBody('abortSave');

  assert.match(beginSave, /abortSave\(\)/);
  assert.match(beginSave, /File\.createTempFile\("pv-export-", "\.part", activity\.getCacheDir\(\)\)/);
  assert.match(beginSave, /new FileOutputStream\(exportFile\)/);

  assert.match(appendBase64, /android\.util\.Base64\.decode\(chunk, android\.util\.Base64\.DEFAULT\)/);
  assert.match(appendBase64, /exportOutput\.write/);

  assert.match(finishSave, /exportOutput\.flush\(\)/);
  assert.match(finishSave, /saveFile\(activity, exportFile, exportName, exportMime\)/);
  assert.match(finishSave, /exportFile\.delete\(\)/);
  assert.match(finishSave, /Salvo em Downloads\/PabloVoice/);

  assert.match(abortSave, /exportOutput\.close\(\)/);
  assert.match(abortSave, /exportFile\.delete\(\)/);

  assert.match(activity, /MediaStore\.Downloads\.DISPLAY_NAME/);
  assert.match(activity, /MediaStore\.Downloads\.MIME_TYPE/);
  assert.match(activity, /MediaStore\.Downloads\.RELATIVE_PATH/);
  assert.match(activity, /Environment\.DIRECTORY_DOWNLOADS \+ "\/PabloVoice"/);
  assert.match(activity, /MediaStore\.Downloads\.IS_PENDING, 1/);
  assert.match(activity, /MediaStore\.Downloads\.IS_PENDING, 0/);
  assert.match(activity, /context\.getContentResolver\(\)\.delete\(item, null, null\)/);
  assert.doesNotMatch(activity, /Environment\.getExternalStorageDirectory/);
});

