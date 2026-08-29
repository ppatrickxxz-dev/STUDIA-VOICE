import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gate = await readFile(new URL('../../scripts/android-complete-user-flow-gate.sh', import.meta.url), 'utf8');
const ci = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('Android complete flow continues the imported project through real edit and save controls', () => {
  assert.match(gate, /pv-android-import-smoke/);
  assert.match(gate, /\[data-route="studio"\]/);
  assert.match(gate, /\[data-action="studio-tab"\]\[data-value="voice"\]/);
  assert.match(gate, /\[data-action="effect"\]\[data-value="clean"\]/);
  assert.match(gate, /\[data-action="save"\]/);
  assert.match(gate, /effects\?\.clean === true/);
  assert.match(gate, /ANDROID_COMPLETE_EDIT_SAVE_PASSED/);
});

test('Android complete flow proves persisted edit after relaunch before export', () => {
  assert.match(gate, /am force-stop/);
  assert.match(gate, /complete-flow-relaunch/);
  assert.match(gate, /EDIT_NOT_PERSISTED_AFTER_RELAUNCH/);
  assert.match(gate, /\[data-action="export"\]/);
  assert.match(gate, /ANDROID_COMPLETE_RELAUNCH_EXPORT_TRIGGERED/);
});

test('Android complete flow validates the actual exported WAV file', () => {
  assert.match(gate, /\/sdcard\/Download\/PabloVoice/);
  assert.match(gate, /exported-mix\.wav/);
  assert.match(gate, /data\[:4\] != b'RIFF'/);
  assert.match(gate, /data\[8:12\] != b'WAVE'/);
  assert.match(gate, /ANDROID_COMPLETE_USER_FLOW_EXPORT_WAV_PASSED/);
  assert.match(gate, /ANDROID_COMPLETE_USER_FLOW_GATE_PASSED/);
});

test('Canonical CI runs open-with then complete flow in the same emulator session', () => {
  assert.match(ci, /android-open-with-project-emulator:/);
  assert.match(ci, /script:\s*\|[\s\S]*android-open-with-project-emulator-gate\.sh[\s\S]*android-complete-user-flow-gate\.sh/);
  assert.match(ci, /test-results\/android-open-with-project-emulator/);
  assert.match(ci, /test-results\/android-complete-user-flow/);
});
