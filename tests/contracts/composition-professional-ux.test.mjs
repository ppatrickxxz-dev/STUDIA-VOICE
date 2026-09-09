import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('keyboard stabilization installs before the legacy app boot', async () => {
  const html = await read('packages/app/index.html');
  const professional = html.indexOf('composition-professional-ui.mjs');
  const preboot = html.indexOf('preboot.mjs');
  assert.ok(professional >= 0, 'professional composition runtime must be loaded');
  assert.ok(preboot > professional, 'keyboard guard must load before app.js can be imported by preboot');
});

test('lyric typing preserves the live textarea while internal project state still receives input', async () => {
  const source = await read('packages/app/composition-professional-ui.mjs');
  assert.match(source, /Object\.defineProperty\(app, 'innerHTML'/);
  assert.match(source, /runtime\.suppressAppRewrite && lyrics && document\.activeElement === lyrics/);
  assert.match(source, /addEventListener\('compositionstart'/);
  assert.match(source, /addEventListener\('compositionend'/);
  assert.match(source, /setTimeout\(\(\) => \{ runtime\.suppressAppRewrite = false; \}, 0\)/);
  assert.match(source, /analyzeLyrics\(String\(value \|\| ''\)\)/);
  assert.match(source, /visualViewport/);
});

test('mobile composition controls are compact and keep a 16px lyric editor for Android keyboards', async () => {
  const css = await read('packages/app/composition-professional-ui.css');
  assert.match(css, /#lyrics\{[^}]*font-size:16px!important/s);
  assert.match(css, /\.pv-create-kind/);
  assert.match(css, /\.pv-creation-advanced/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /--pv-keyboard-inset/);
});

test('Instrument Lab keeps section edits additive and whole-song replacement non-destructive', async () => {
  const source = await read('packages/app/instrument-integration.mjs');
  assert.match(source, /ui\.scope !== 'full' && ui\.operation === 'replace'/);
  assert.match(source, /replaced\.muted = true/);
  assert.match(source, /replaced\.replacedByTrackId = track\.id/);
  assert.match(source, /track\.replacesTrackId = replaced\.id/);
  assert.match(source, /track\.offset = section\?\.startSeconds \|\| 0/);
  assert.match(source, /track\.role = ui\.role/);
  assert.match(source, /engine = 'pablovoice-local-synth-v2'/);
});
