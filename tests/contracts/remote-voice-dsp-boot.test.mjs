import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexUrl = new URL('../../packages/app/index.html', import.meta.url);
const runtimeUrl = new URL('../../packages/app/remote-voice-dsp-runtime.mjs', import.meta.url);

test('Web and Android WebView boot the authenticated B06/B07 runtime bridge', async () => {
  const [html, runtime] = await Promise.all([
    readFile(indexUrl, 'utf8'),
    readFile(runtimeUrl, 'utf8'),
  ]);
  assert.match(html, /<script type="module" src="\.\/remote-voice-dsp-runtime\.mjs"><\/script>/);
  assert.match(runtime, /progress-kaggle-harmony-v73/);
  assert.match(runtime, /diagnose-voice-v70-once/);
  assert.match(runtime, /benchmarkPass: false/);
  assert.doesNotMatch(runtime, /service[_-]?role/i);
});
