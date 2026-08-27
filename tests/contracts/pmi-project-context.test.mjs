import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { executePabloAudioMessage } from '../../packages/app/pablo-conversation-audio.mjs';

test('PMI creation receives current lyrics, notes, preset and authorial memory from conversation context', async () => {
  const result = await executePabloAudioMessage('Quero criar uma música sobre uma viagem que não chegou ao destino', {
    projectId: 'p1',
    preset: 'music',
    lyrics: '[Verso]\nEu fui até onde deu',
    notes: 'R&B íntimo',
    authorialMemory: {
      schema: 'pmi_authorial_memory_v1',
      vocabulary: ['caminho'],
      avoid: ['promessa'],
      acceptedPatterns: ['term:caminho'],
      rejectedPatterns: ['term:promessa'],
      evidenceCount: 2,
    },
  });
  assert.equal(result.supported, true);
  assert.equal(result.kind, 'pmi_music_session');
  assert.equal(result.session.lyricsOriginal, '[Verso]\nEu fui até onde deu');
  assert.equal(result.session.projectNotes, 'R&B íntimo');
  assert.equal(result.session.authorialMemory.evidenceCount, 2);
  assert.ok(result.session.lyricAnalysis);
});

test('conversation UI forwards bounded creative project context and persists only explicit authorial feedback', async () => {
  const source = await readFile(new URL('../../packages/app/pablo-conversation-ui.mjs', import.meta.url), 'utf8');
  assert.match(source, /lyrics: String\(project\?\.lyrics \|\| ''\)\.slice\(0, 12000\)/);
  assert.match(source, /notes: String\(project\?\.notes \|\| ''\)\.slice\(0, 4000\)/);
  assert.match(source, /preset: project\?\.preset \|\| null/);
  assert.match(source, /authorialMemory: project\?\.authorialMemory \? structuredClone\(project\.authorialMemory\) : null/);
  assert.match(source, /persistAuthorialMemory: persistAuthorialMemoryState/);
  assert.match(source, /project\.authorialMemory = authorialMemory \? structuredClone\(authorialMemory\) : null/);
});

test('all PMI reply kinds render directly instead of falling through the audio-analysis formatter', async () => {
  const source = await readFile(new URL('../../packages/app/pablo-conversation-ui.mjs', import.meta.url), 'utf8');
  for (const kind of ['pmi_music_session', 'pmi_authorial_feedback', 'pmi_generation_request', 'pmi_generation_blocked', 'pmi_generated_draft']) {
    assert.match(source, new RegExp(`['"]${kind}['"]`));
  }
  assert.match(source, /\.includes\(result\.kind\)/);
  assert.match(source, /return result\.reply \|\| result\.text \|\| 'Entendi sua direção criativa\.'/);
});
