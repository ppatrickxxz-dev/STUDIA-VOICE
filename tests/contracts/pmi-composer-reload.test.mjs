import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Composer UI persists each generated revision and restores the exact review state after reload', async () => {
  const source = await readFile(new URL('../../packages/app/pablo-conversation-ui.mjs', import.meta.url), 'utf8');
  assert.match(source, /await savePmiComposerState\(context\.projectId, \{/);
  assert.match(source, /baseLyrics: context\.lyrics/);
  assert.match(source, /const pendingDraft = project\?\.id \? await loadPmiComposerState\(project\.id, lyrics\) : null/);
  assert.match(source, /restorePendingComposerDraft\(\)\.catch/);
  assert.match(source, /registerPmiDraftPreview\(project\.id, \{ draftVersion: pending\.version, text: pending\.text \}\)/);
  assert.match(source, /Rascunho v\$\{pending\.version\} restaurado após recarregar/);
});

test('restored Composer draft remains explicit review with apply append and discard controls', async () => {
  const source = await readFile(new URL('../../packages/app/pablo-conversation-ui.mjs', import.meta.url), 'utf8');
  assert.match(source, /\['replace', 'Usar como letra'\], \['append', 'Adicionar à letra'\], \['discard', 'Descartar'\]/);
  assert.match(source, /if \(mode === 'discard'\)/);
  assert.match(source, /await clearPmiComposerState\(project\.id\)/);
  assert.match(source, /applyConfirmedPmiDraft\(project, \{ \.\.\.confirmation, draftVersion \}, snapshotProject\)/);
  assert.match(source, /await persistProject\(saved\)/);
  assert.match(source, /await clearPmiComposerState\(saved\.id\)/);
});

test('Composer pending state lazily reuses the existing IndexedDB settings store rather than another database', async () => {
  const source = await readFile(new URL('../../packages/app/pmi-composer-state.mjs', import.meta.url), 'utf8');
  assert.match(source, /await import\('\.\/storage\.mjs'\)/);
  assert.match(source, /const \{ getSetting \} = await import\('\.\/storage\.mjs'\)/);
  assert.match(source, /const \{ saveSetting \} = await import\('\.\/storage\.mjs'\)/);
  assert.doesNotMatch(source, /indexedDB\.open/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});
