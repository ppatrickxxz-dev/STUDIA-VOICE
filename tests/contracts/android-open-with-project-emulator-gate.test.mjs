import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gate = await readFile(new URL('../../scripts/android-open-with-project-emulator-gate.sh', import.meta.url), 'utf8');
const ci = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('Android open-with project gate proves import is consumed into persisted project state', () => {
  assert.match(gate, /android\.intent\.action\.VIEW|ACTION_VIEW|am start -W/);
  assert.match(gate, /content:\/\/media/);
  assert.match(gate, /indexedDB\.open\('pablovoice_mobile_v2', 3\)/);
  assert.match(gate, /projects/);
  assert.match(gate, /audio/);
  assert.match(gate, /pv-android-import-smoke/);
  assert.match(gate, /ANDROID_OPEN_WITH_PROJECT_IMPORT_PASSED/);
  assert.match(gate, /ANDROID_OPEN_WITH_PROJECT_IMPORT_GATE_PASSED/);
});

test('Android open-with project gate proves persistence across app relaunch', () => {
  assert.match(gate, /open-with-project-relaunch/);
  assert.match(gate, /force-stop/);
  assert.match(gate, /assert_project_imported open-with-project-relaunch/);
});

test('Android open-with project gate fails closed and captures evidence', () => {
  assert.match(gate, /ANDROID_OPEN_WITH_PROJECT_DEVTOOLS_SOCKET_MISSING/);
  assert.match(gate, /ANDROID_OPEN_WITH_PROJECT_IMPORT_MISSING/);
  assert.match(gate, /ANDROID_OPEN_WITH_PROJECT_RELAUNCH_IMPORT_MISSING/);
  assert.match(gate, /ANDROID_OPEN_WITH_PROJECT_RENDER_GATE_FAILED/);
  assert.match(gate, /ANDROID_OPEN_WITH_PROJECT_FATAL_CRASH_DETECTED/);
  assert.match(gate, /\$\{label\}-project-devtools\.txt/);
  assert.match(gate, /\$\{label\}-devtools-pages\.txt/);
});

test('Android open-with project gate waits for the app-owned IndexedDB schema', () => {
  assert.match(gate, /pm clear/);
  assert.match(gate, /APP_NOT_READY/);
  assert.match(gate, /PROJECT_STORES_NOT_READY/);
  assert.match(gate, /document\.documentElement\.dataset\.pvReady === 'true'/);
  assert.match(gate, /indexedDB\.open\('pablovoice_mobile_v2', 3\)/);
  assert.ok(gate.indexOf('APP_NOT_READY') < gate.indexOf("indexedDB.open('pablovoice_mobile_v2', 3)"));
});

test('Android open-with project gate retries DevTools while the WebView is still booting', () => {
  assert.match(gate, /retryableError/);
  assert.match(gate, /NO_PAGE_TARGET/);
  assert.match(gate, /websocket closed/);
  assert.match(gate, /while time\.monotonic\(\) < deadline/);
});

test('Canonical CI runs Android open-with project gate after validation APK build', () => {
  assert.match(ci, /android-open-with-project-emulator:/);
  assert.match(ci, /needs: android-build/);
  assert.match(ci, /scripts\/android-open-with-project-emulator-gate\.sh/);
  assert.match(ci, /pablovoice-android-open-with-project-emulator-evidence/);
});
