import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack, snapshotProject } from '../../packages/core/src/project.mjs';
import {
  applyConfirmedPmiDraft,
  clearPmiComposerState,
  composerStateKey,
  loadPmiComposerState,
  savePmiComposerState,
} from '../../packages/app/pmi-composer-state.mjs';

function memoryStore() {
  const values = new Map();
  return {
    read: async (key, fallback = null) => values.has(key) ? values.get(key) : fallback,
    write: async (key, value) => { values.set(key, value); },
    remove: async (key) => { values.delete(key); },
    values,
  };
}

test('pending Composer draft survives a storage round-trip only while base lyrics are unchanged', async () => {
  const storage = memoryStore();
  await savePmiComposerState('project-1', {
    text: '[Refrão]\nAté onde deu',
    version: 2,
    command: 'rewrite',
    targetSection: 'refrão',
    baseLyrics: '[Verso]\nEstrada sem destino',
    provider: 'openai_backend',
    model: 'gpt-5.4-mini',
  }, storage);

  const restored = await loadPmiComposerState('project-1', '[Verso]\nEstrada sem destino', storage);
  assert.equal(restored.text, '[Refrão]\nAté onde deu');
  assert.equal(restored.version, 2);
  assert.equal(restored.provider, 'openai_backend');

  const stale = await loadPmiComposerState('project-1', '[Verso]\nEditei manualmente', storage);
  assert.equal(stale, null);
  assert.equal(storage.values.has(composerStateKey('project-1')), false);
  assert.equal(await loadPmiComposerState('project-1', '[Verso]\nEstrada sem destino', storage), null);
});

test('explicit clear physically removes the pending draft without touching project content', async () => {
  const storage = memoryStore();
  await savePmiComposerState('project-2', { text: 'rascunho', version: 1, baseLyrics: 'base' }, storage);
  const key = composerStateKey('project-2');
  assert.equal(storage.values.has(key), true);
  assert.equal(await clearPmiComposerState('project-2', storage), true);
  assert.equal(storage.values.has(key), false);
  assert.equal(await loadPmiComposerState('project-2', 'base', storage), null);
});

test('applying a confirmed draft changes lyrics and revision metadata without project or track drift', () => {
  const project = createProject('Drift guard', 1_700_000_000_000);
  project.id = 'project-drift';
  project.lyrics = '[Verso]\nOriginal';
  project.notes = 'nota intacta';
  project.preset = 'music';
  project.metadata = { custom: 'preservar' };
  const first = createTrack({ name: 'Voz', assetId: 'asset-voice', duration: 12.5, kind: 'recording' });
  const second = createTrack({ name: 'Base', assetId: 'asset-base', duration: 18, kind: 'audio' });
  first.trimStart = 0.4; first.trimEnd = 11.8; first.gain = 1.1; first.pan = -0.1; first.effects.presence = true;
  second.trimStart = 1.2; second.trimEnd = 17.2; second.gain = 0.8; second.pan = 0.2; second.effects.warm = true;
  project.tracks = [first, second];
  project.activeTrackId = first.id;

  const invariant = structuredClone({
    id: project.id,
    name: project.name,
    notes: project.notes,
    preset: project.preset,
    metadata: project.metadata,
    activeTrackId: project.activeTrackId,
    tracks: project.tracks,
  });
  const applied = applyConfirmedPmiDraft(project, {
    mode: 'replace',
    draftVersion: 3,
    text: '[Refrão]\nNovo trecho',
  }, snapshotProject);

  assert.equal(project.lyrics, '[Verso]\nOriginal');
  assert.equal(applied.lyrics, '[Refrão]\nNovo trecho');
  assert.deepEqual({
    id: applied.id,
    name: applied.name,
    notes: applied.notes,
    preset: applied.preset,
    metadata: applied.metadata,
    activeTrackId: applied.activeTrackId,
    tracks: applied.tracks,
  }, invariant);
  assert.equal(applied.revisions.length, 1);
  assert.equal(applied.revisions.at(-1).lyrics, '[Refrão]\nNovo trecho');
});
