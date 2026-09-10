import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('professional composition runtime installs before the canonical boot', async () => {
  const html = await read('packages/app/index.html');
  const professional = html.indexOf('composition-professional-ui.mjs');
  const preboot = html.indexOf('preboot.mjs');
  assert.ok(professional >= 0, 'professional composition runtime must be loaded');
  assert.ok(preboot > professional, 'composition input guard must exist before app.js input handlers boot');
});

test('lyric typing keeps the same textarea node alive instead of monkeypatching the whole app renderer', async () => {
  const source = await read('packages/app/composition-professional-ui.mjs');
  assert.doesNotMatch(source, /Object\.defineProperty\(app,\s*['"]innerHTML['"]/);
  assert.match(source, /addEventListener\('input', onInputCapture, true\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /addEventListener\('compositionstart', onCompositionStart, true\)/);
  assert.match(source, /addEventListener\('compositionend', onCompositionEnd, true\)/);
  assert.match(source, /addEventListener\('focusout', onFocusOut, true\)/);
  assert.match(source, /commitLyrics\(lyrics\)/);
  assert.match(source, /pablovoice\.lyrics\.liveDraft/);
  assert.match(source, /visualViewport/);
});

test('Pablo Composer stays usable without exposing remote/local as product modes', async () => {
  const source = await read('packages/app/composition-professional-ui.mjs');
  assert.match(source, /tryRemoteComposer/);
  assert.match(source, /buildLocalCoauthor/);
  assert.match(source, /Coautor local ativo · sem bloqueio/);
  assert.match(source, /tag\.textContent = 'PABLO'/);
  assert.match(source, /tag\.textContent = 'MÚSICA'/);
  assert.doesNotMatch(source, /tag\.textContent = 'REMOTE'/);
  assert.doesNotMatch(source, /tag\.textContent = 'CREATOR'/);
  assert.match(source, /event\.target\?\.closest\?\.\('\[data-ai-compose-form\]'\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
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

test('local song creation varies musical decisions while explicit seeds remain reproducible', async () => {
  const source = await read('packages/app/song-creation-engine.mjs');
  assert.match(source, /variationId/);
  assert.match(source, /creativeProfile/);
  assert.match(source, /progressions:/);
  assert.match(source, /grooves:/);
  assert.match(source, /palettes:/);
  assert.match(source, /bassPattern/);
  assert.match(source, /accentPattern/);
  assert.match(source, /randomSeed\(\)/);
  assert.match(source, /seededRandom/);
});
