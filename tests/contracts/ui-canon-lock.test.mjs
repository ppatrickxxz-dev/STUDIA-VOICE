import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../../packages/app/index.html', import.meta.url), 'utf8');
const canonicalUi = await readFile(new URL('../../packages/app/canonical-ui.mjs', import.meta.url), 'utf8');
const canonicalCss = await readFile(new URL('../../packages/app/canonical-ui.css', import.meta.url), 'utf8');
const canonDoc = await readFile(new URL('../../docs/UI_CANON_LOCK.md', import.meta.url), 'utf8');

const companions = ['Nota Drop', 'Star Spark', 'Wave Ribbon', 'EQ Bloom', 'Chime Lantern', 'Vinyl Groove'];

test('PabloVoice loads the canonical presentation layer without replacing the product shell', () => {
  assert.match(index, /<title>PabloVoice<\/title>/);
  assert.match(index, /\.\/canonical-ui\.css/);
  assert.match(index, /\.\/canonical-ui\.mjs/);
  assert.match(canonicalUi, /retro-tape-onyx-galaxy-v1/);
  assert.match(canonicalCss, /Retro Tape \+ Ônix Galáxia/);
});

test('canonical Pablo and companion assets remain the visual source of truth', async () => {
  assert.match(canonicalUi, /\/site\/assets\/pablo_fullbody\.webp/);
  assert.match(canonicalUi, /\/site\/assets\/companions_board\.webp/);
  await access(new URL('../../packages/site-vivo/assets/pablo_fullbody.webp', import.meta.url));
  await access(new URL('../../packages/site-vivo/assets/companions_board.webp', import.meta.url));
  for (const name of companions) {
    assert.match(canonicalUi, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(canonDoc, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('provider brands are presentation details, never PabloVoice product navigation', () => {
  assert.match(canonDoc, /Suno and ElevenLabs are benchmark\/research references/);
  assert.match(canonicalUi, /motor de alta qualidade/);
  const visibleCanon = canonicalUi.replace(/const PROVIDER_COPY[\s\S]*?\]\);/, '');
  assert.doesNotMatch(visibleCanon, /ElevenLabs|Eleven Music|Music v2|\bSuno\b/i);
});

test('UI canon explicitly locks Pablo, companions and creative flow', () => {
  assert.match(canonDoc, /Product name: \*\*PabloVoice\*\*/);
  assert.match(canonDoc, /Pablo is the central creative companion\/AI/);
  assert.match(canonDoc, /idea \/ brief -> lyrics or instrumental-first -> music take -> guide -> record\/voice -> section editing -> stems\/arrangement -> mix\/master -> export/);
  assert.match(canonDoc, /must not silently/);
});
