import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('REGRESSION-001: neither Web nor Android boots from Vercel Authentication', async () => {
  const [app, html, activity] = await Promise.all([
    read('packages/app/app.js'), read('packages/app/index.html'),
    read('apps/android/app/src/main/java/com/pablovoice/studio/MainActivity.java'),
  ]);
  assert.doesNotMatch(app + html + activity, /https:\/\/[^\s'"<]+\.vercel\.app/i);
  assert.match(activity, /START_URL = APP_ORIGIN \+ "\/assets\/index\.html"/);
  assert.match(activity, /WebViewAssetLoader\.AssetsPathHandler/);
});

test('Web and Android resolve the same canonical packages', async () => {
  const [build, android] = await Promise.all([read('scripts/build-web.mjs'), read('apps/android/app/build.gradle')]);
  assert.match(build, /resolve\(packages, 'app'\)/);
  assert.match(build, /\['core', 'audio', 'analysis', 'songwriting'\]/);
  assert.match(android, /packages\/app/);
  assert.match(android, /file\('\.\.\/\.\.\/\.\.\/packages'\)/);
});
