import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Android emulator waits for both Web/contracts and APK validation', async () => {
  const source = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(source, /android-emulator:\s*\n\s+needs: \[web-and-contracts, android-build\]/);
});

test('CI keeps cancel-in-progress enabled for superseded PR heads', async () => {
  const source = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(source, /concurrency:\s*\n\s+group: pablovoice-ci-\$\{\{ github\.ref \}\}\s*\n\s+cancel-in-progress: true/);
});
