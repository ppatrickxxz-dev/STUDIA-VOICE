import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { executePabloAudioMessage } from '../../packages/app/pablo-conversation-audio.mjs';

test('explicit songwriting request calls the reviewed Composer callback and remains preview-only', async () => {
  let received = null;
  const result = await executePabloAudioMessage('Escreve um refrão dessa ideia', {
    projectId: 'local-1',
    lyrics: '[Verso]\nAté onde deu',
    notes: 'íntimo',
    preset: 'music',
  }, {
    generateMusicDraft: async (request) => {
      received = request;
      return { text: '[Refrão]\nFoi até onde deu', provider: 'openai_backend', model: 'test-model' };
    },
  });
  assert.equal(received.command, 'generate');
  assert.equal(received.targetSection, 'refrão');
  assert.equal(result.kind, 'pmi_generated_draft');
  assert.equal(result.execution, 'preview_only');
  assert.equal(result.canApply, false);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.text, '[Refrão]\nFoi até onde deu');
});

test('idea exploration stays local and never invokes the Composer callback', async () => {
  let calls = 0;
  const result = await executePabloAudioMessage('Quero criar uma música sobre desencontro numa viagem', {
    projectId: 'local-1',
    lyrics: '',
    preset: 'music',
  }, {
    generateMusicDraft: async () => { calls += 1; return { text: 'não deveria rodar' }; },
  });
  assert.equal(calls, 0);
  assert.equal(result.kind, 'pmi_music_session');
  assert.equal(result.execution, 'read_only');
});

test('rewrite without current lyrics is blocked before any network callback', async () => {
  let calls = 0;
  const result = await executePabloAudioMessage('Reescreve esse refrão sem perder meu jeito', {
    projectId: 'local-1',
    lyrics: '',
  }, {
    generateMusicDraft: async () => { calls += 1; return { text: 'não deveria rodar' }; },
  });
  assert.equal(calls, 0);
  assert.equal(result.kind, 'pmi_generation_blocked');
  assert.equal(result.canApply, false);
});

test('conversation UI uses authenticated agentTurn and requires manual review before lyrics change', async () => {
  const source = await readFile(new URL('../../packages/app/pablo-conversation-ui.mjs', import.meta.url), 'utf8');
  assert.match(source, /REVIEWED_SONG_COMMANDS = new Set\(\['generate', 'continue_section', 'rewrite', 'adapt_genre'\]\)/);
  assert.match(source, /remoteAuth\.ensureRemoteProject\(project\)/);
  assert.match(source, /remoteAuth\.agentTurn\(\{/);
  assert.match(source, /review_before_apply: true/);
  assert.match(source, /result\?\.kind === 'pmi_generated_draft'/);
  assert.match(source, /\['replace', 'Usar como letra'\], \['append', 'Adicionar à letra'\]/);
  assert.match(source, /applyPmiGeneratedDraft\(result\.text, mode\)/);
});

test('PMI Composer bridge does not embed a private provider credential', async () => {
  const source = await readFile(new URL('../../packages/app/pablo-conversation-ui.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /sk-[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(source, /OPENAI_API_KEY|service_role/i);
});
