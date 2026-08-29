import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CREDENTIAL_PATTERN,
  WEBVIEW_PATTERN,
  findPatternLines,
  shouldSkipCredentialPath,
} from '../../scripts/security-static-scan.mjs';

test('security scanner detects credential-shaped content without ripgrep', () => {
  const findings = findPatternLines([
    'safe=true',
    'token=sk-abcdefghijklmnopqrstuvwxyz123456',
    'done=true',
  ].join('\n'), CREDENTIAL_PATTERN);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 2);
});

test('security scanner detects unsafe Android WebView configuration', () => {
  assert.equal(findPatternLines('android:usesCleartextTraffic="true"', WEBVIEW_PATTERN).length, 1);
  assert.equal(findPatternLines('webSettings.setAllowFileAccess(true);', WEBVIEW_PATTERN).length, 1);
  assert.equal(findPatternLines('MIXED_CONTENT_ALWAYS_ALLOW', WEBVIEW_PATTERN).length, 1);
});

test('credential scan exclusions remain narrow and explicit', () => {
  assert.equal(shouldSkipCredentialPath('docs/inventory.md'), true);
  assert.equal(shouldSkipCredentialPath('scripts/security-gate.sh'), true);
  assert.equal(shouldSkipCredentialPath('scripts/security-static-scan.mjs'), true);
  assert.equal(shouldSkipCredentialPath('tests/unit/example.test.mjs'), true);
  assert.equal(shouldSkipCredentialPath('packages/app/src/runtime.mjs'), false);
});

test('security gate delegates to guaranteed Node scanner instead of optional rg', async () => {
  const shell = await readFile(new URL('../../scripts/security-gate.sh', import.meta.url), 'utf8');
  assert.match(shell, /node scripts\/security-static-scan\.mjs/);
  assert.doesNotMatch(shell, /\brg\b/);
});
