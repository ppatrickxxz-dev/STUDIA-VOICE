import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateProject, snapshotProject } from '../../packages/core/src/project.mjs';
import { parseAuthorialFeedback, respondToAuthorialFeedback } from '../../packages/music-intelligence/src/index.mjs';
import { executePabloAudioMessage } from '../../packages/app/pablo-conversation-audio.mjs';

test('explicit PT-BR authorial feedback is parsed without editing lyrics', () => {
  const rejected = parseAuthorialFeedback('Não use a palavra promessa');
  assert.deepEqual(rejected, { supported: true, decision: 'rejected', category: 'term', value: 'promessa' });
  const accepted = parseAuthorialFeedback('Prefiro refrões mais curtos');
  assert.equal(accepted.supported, true); assert.equal(accepted.decision, 'accepted'); assert.equal(accepted.category, 'structure');
});

test('audio and mix preferences do not leak into authorial memory', () => {
  assert.equal(parseAuthorialFeedback('Prefiro menos graves').supported, false);
  assert.equal(parseAuthorialFeedback('Não use reverb').supported, false);
});

test('authorial feedback extends existing project memory as evidence', () => {
  const result = respondToAuthorialFeedback('Evite a palavra futuro', { authorialMemory: { schema: 'pmi_authorial_memory_v1', vocabulary: ['malícia'], avoid: ['promessa'], acceptedPatterns: ['term:malícia'], rejectedPatterns: ['term:promessa'], evidenceCount: 2 } });
  assert.equal(result.supported, true); assert.deepEqual(result.authorialMemory.avoid.sort(), ['futuro', 'promessa']); assert.equal(result.authorialMemory.evidenceCount, 3);
});

test('conversation boundary persists feedback but never rewrites the lyric itself', async () => {
  let persisted = null; let audioCalls = 0;
  const result = await executePabloAudioMessage('Não use a palavra promessa', { projectId: 'p1', lyrics: 'Sem promessa pro futuro', authorialMemory: null }, {
    audioToolRuntime: async () => { audioCalls += 1; return { ok: true }; },
    persistAuthorialMemory: async (memory, feedback) => { persisted = { memory, feedback }; return { ok: true, projectId: 'p1', evidenceCount: memory.evidenceCount }; },
  });
  assert.equal(result.kind, 'pmi_authorial_feedback'); assert.equal(result.canApply, true); assert.equal(result.execution, 'allowed'); assert.equal(audioCalls, 0); assert.deepEqual(persisted.memory.avoid, ['promessa']); assert.equal(result.authorialMemory.evidenceCount, 1);
});

test('current project schema bounds and snapshots authorial memory', () => {
  const migrated = migrateProject({ id: 'p1', name: 'Música', tracks: [], authorialMemory: { schema: 'anything', vocabulary: Array.from({ length: 100 }, (_, index) => `termo-${index}`), avoid: ['promessa'], acceptedPatterns: ['term:malícia'], rejectedPatterns: ['term:promessa'], evidenceCount: 3 } });
  assert.equal(migrated.schemaVersion, 9);
  assert.equal(migrated.authorialMemory.schema, 'pmi_authorial_memory_v1');
  assert.equal(migrated.authorialMemory.vocabulary.length, 80);
  assert.deepEqual(migrated.authorialMemory.avoid, ['promessa']);
  const snap = snapshotProject(migrated, 'memória autoral');
  assert.deepEqual(snap.revisions.at(-1).authorialMemory, migrated.authorialMemory);
});
