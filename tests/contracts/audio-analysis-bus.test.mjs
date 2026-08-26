import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('Audio Analysis Bus is shipped to Web and Android from the canonical package tree', async () => {
  const [build, android, analyzer] = await Promise.all([
    read('scripts/build-web.mjs'),
    read('apps/android/app/build.gradle'),
    read('packages/analysis/src/analyzer.mjs'),
  ]);
  assert.match(build, /'analysis'/);
  assert.match(android, /file\('\.\.\/\.\.\/\.\.\/packages'\)/);
  assert.match(analyzer, /provenance:[\s\S]*kind: 'measured'/);
  assert.match(analyzer, /bpm: 'ENGINE_NOT_CONFIGURED'/);
});

test('audio assets only accept analysis carrying measured provenance', async () => {
  const storage = await read('packages/app/storage.mjs');
  assert.match(storage, /analysisIsMeasured/);
  assert.match(storage, /Análise de áudio sem proveniência mensurável/);
  assert.match(storage, /analysis: analysis \? structuredClone\(analysis\) : null/);
});
