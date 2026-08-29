import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gate = await readFile(new URL('../../scripts/android-emulator-gate.sh', import.meta.url), 'utf8');

test('Android emulator gate distinguishes background resume from process relaunch', () => {
  assert.match(gate, /KEYCODE_HOME/);
  assert.match(gate, /wait_for_background/);
  assert.match(gate, /resume_and_wait/);
  assert.match(gate, /background_pid.*launch_pid/s);
  assert.match(gate, /resume_pid.*launch_pid/s);
  assert.match(gate, /process_start_ticks/);
  assert.match(gate, /relaunch_start_ticks.*launch_start_ticks/s);
});

test('Android lifecycle evidence fails closed and reports all three rendered stages', () => {
  assert.match(gate, /ANDROID_BACKGROUND_PROCESS_LOST/);
  assert.match(gate, /ANDROID_BACKGROUND_PID_CHANGED/);
  assert.match(gate, /ANDROID_BACKGROUND_PROCESS_CHANGED/);
  assert.match(gate, /ANDROID_RESUME_PID_CHANGED/);
  assert.match(gate, /ANDROID_RESUME_PROCESS_CHANGED/);
  assert.match(gate, /ANDROID_RELAUNCH_PROCESS_NOT_RESTARTED/);
  assert.match(gate, /ANDROID_EMULATOR_LIFECYCLE_GATE_PASSED/);
  assert.match(gate, /launch_variation=.*foreground_variation=.*relaunch_variation=/);
  assert.match(gate, /MIC_CAPTURE_REQUIRES_PHYSICAL_DEVICE/);
});

test('Android emulator gate captures installed native package contract before lifecycle', () => {
  assert.match(gate, /assert_native_package_contract/);
  assert.match(gate, /package-contract\.txt/);
  assert.match(gate, /package-appops\.txt/);
  assert.match(gate, /android\.permission\.RECORD_AUDIO/);
  assert.match(gate, /ANDROID_NATIVE_RECORD_AUDIO_PERMISSION_MISSING/);
  assert.match(gate, /ANDROID_NATIVE_RECORD_AUDIO_PERMISSION_NOT_GRANTED/);
  assert.match(gate, /ANDROID_NATIVE_MAIN_ACTIVITY_MISSING/);
  assert.match(gate, /ANDROID_NATIVE_AUDIO_IMPORT_ENTRYPOINT_MISSING/);
  assert.match(gate, /ANDROID_NATIVE_PACKAGE_CONTRACT_PASSED/);
  assert.match(gate, /ANDROID_NATIVE_PACKAGE_CONTRACT_EVIDENCE_CAPTURED/);
});
