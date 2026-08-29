import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gate = await readFile(new URL('../../scripts/android-import-emulator-gate.sh', import.meta.url), 'utf8');
const ci = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('Android import emulator gate proves open-with pending import through native bridge', () => {
  assert.match(gate, /android\.intent\.action\.VIEW|ACTION_VIEW|am start -W/);
  assert.match(gate, /file:\/\/\$\{remote_wav\}|file:\/\//);
  assert.match(gate, /pendingImportSize/);
  assert.match(gate, /pendingImportName/);
  assert.match(gate, /pendingImportMime/);
  assert.match(gate, /pendingImportChunkBase64/);
  assert.match(gate, /ANDROID_IMPORT_OPEN_WITH_PENDING_SMOKE_PASSED/);
  assert.match(gate, /ANDROID_IMPORT_OPEN_WITH_GATE_PASSED/);
});

test('Android import emulator gate accepts app-consumed project evidence after boot', () => {
  assert.match(gate, /pm clear/);
  assert.match(gate, /CONSUMED_BEFORE_PENDING_INSPECTION/);
  assert.match(gate, /document\.documentElement\.dataset\.pvReady === 'true'/);
  assert.match(gate, /indexedDB\.open\('pablovoice_mobile_v2', 3\)/);
  assert.match(gate, /PROJECT_STORES_NOT_READY/);
  assert.match(gate, /projects/);
  assert.match(gate, /audio/);
});

test('Android import emulator gate fails closed and captures evidence', () => {
  assert.match(gate, /ANDROID_IMPORT_OPEN_WITH_DEVTOOLS_SOCKET_MISSING/);
  assert.match(gate, /ANDROID_IMPORT_OPEN_WITH_PENDING_SMOKE_MISSING/);
  assert.match(gate, /ANDROID_IMPORT_RENDER_GATE_FAILED/);
  assert.match(gate, /ANDROID_IMPORT_FATAL_CRASH_DETECTED/);
  assert.match(gate, /import-smoke-devtools\.txt/);
  assert.match(gate, /import-smoke-source-file\.txt/);
});

test('Canonical CI runs Android import emulator gate after validation APK build', () => {
  assert.match(ci, /android-import-emulator:/);
  assert.match(ci, /needs: android-build/);
  assert.match(ci, /scripts\/android-import-emulator-gate\.sh/);
  assert.match(ci, /pablovoice-android-import-emulator-evidence/);
});
