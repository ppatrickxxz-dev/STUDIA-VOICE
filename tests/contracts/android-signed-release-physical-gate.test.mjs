import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
const gate = await readFile(new URL('../../scripts/android-signed-release-emulator-gate.sh', import.meta.url), 'utf8');
const aabGate = await readFile(new URL('../../scripts/android-validate-signed-aab.sh', import.meta.url), 'utf8');

test('signed release explicitly verifies production APK and AAB with the same signer', () => {
  assert.match(workflow, /validate-apk\.sh "\$APK" com\.pablovoice\.studio/);
  assert.match(workflow, /android-validate-signed-aab\.sh "\$APK" "\$AAB"/);
  assert.match(workflow, /app-release\.apk\.sha256/);
  assert.match(workflow, /app-release\.aab\.sha256/);
  assert.match(workflow, /app-release\.aab\.jarsigner\.txt/);
  assert.match(workflow, /app-release\.aab\.signer-sha256\.txt/);

  assert.match(aabGate, /jarsigner -verify -verbose -certs/);
  assert.doesNotMatch(aabGate, /jarsigner -verify -strict/);
  assert.match(aabGate, /jar verified\./);
  assert.match(aabGate, /apksigner verify --print-certs/);
  assert.match(aabGate, /keytool -printcert -jarfile/);
  assert.match(aabGate, /ANDROID_RELEASE_SIGNER_MISMATCH/);
  assert.match(aabGate, /\[ "\$apk_cert_sha256" != "\$aab_cert_sha256" \]/);
  assert.match(aabGate, /ANDROID_SIGNED_AAB_VALIDATION_PASSED/);
});

test('signed production APK is physically tested after the signing job on the same SHA', () => {
  assert.match(workflow, /signed-release-emulator:\s*\n\s*needs: signed-release/);
  assert.match(workflow, /name: pablovoice-signed-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /find artifacts\/android-signed -name app-release\.apk/);
  assert.match(workflow, /android-signed-release-emulator-gate\.sh/);
  assert.match(workflow, /pablovoice-android-signed-release-evidence-\$\{\{ github\.sha \}\}/);
});

test('signed physical gate uses canonical production identity and rejects validation identity', () => {
  assert.match(gate, /production_package="com\.pablovoice\.studio"/);
  assert.match(gate, /validation_package="com\.pablovoice\.studio\.validation"/);
  assert.match(gate, /pm path "\$production_package"/);
  assert.match(gate, /ANDROID_SIGNED_RELEASE_VALIDATION_PACKAGE_PRESENT/);
});

test('signed physical gate reuses the real open-with, persistence and WAV export gates', () => {
  assert.match(gate, /android-open-with-project-emulator-gate\.sh/);
  assert.match(gate, /android-complete-user-flow-gate\.sh/);
  assert.match(gate, /bash "\$open_with_gate" "\$apk_path"/);
  assert.match(gate, /bash "\$complete_flow_gate"/);
  assert.match(gate, /ANDROID_SIGNED_RELEASE_PHYSICAL_GATE_PASSED/);
});

test('tag and GitHub release mutation remain dispatch-only', () => {
  const dispatchGuards = workflow.match(/if: github\.event_name == 'workflow_dispatch'/g) || [];
  assert.ok(dispatchGuards.length >= 3);
  assert.match(workflow, /- name: Create or verify release tag\s*\n\s*if: github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /- name: Create or refresh draft GitHub release\s*\n\s*if: github\.event_name == 'workflow_dispatch'/);
});
