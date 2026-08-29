import test from 'node:test';
import assert from 'node:assert/strict';
import { executePabloAudioMessage } from '../../packages/app/pablo-conversation-audio.mjs';

test('generated and revised previews expose their version without changing apply payload text', async () => {
  const projectId = 'pending-version-label-contract';
  let calls = 0;
  const generateMusicDraft = async () => {
    calls += 1;
    return { text: calls === 1 ? '[Refrão]\nVersão um' : '[Refrão]\nVersão dois' };
  };
  const context = { projectId, lyrics: '[Verso]\nBase salva', notes: 'íntimo', preset: 'music' };

  const first = await executePabloAudioMessage('Escreve um refrão dessa ideia', context, { generateMusicDraft });
  assert.equal(first.draftVersion, 1);
  assert.match(first.reply, /^Rascunho v1 · revise antes de aplicar\./);
  assert.equal(first.text, '[Refrão]\nVersão um');

  const second = await executePabloAudioMessage('Gostei, mas deixa esse refrão menos óbvio', context, { generateMusicDraft });
  assert.equal(second.draftVersion, 2);
  assert.equal(second.previousDraftVersion, 1);
  assert.match(second.reply, /^Rascunho v2 · revise antes de aplicar\./);
  assert.equal(second.text, '[Refrão]\nVersão dois');
});

test('changing saved lyrics invalidates the old pending draft before the next rewrite', async () => {
  const projectId = 'pending-acceptance-contract';
  const requests = [];
  const generateMusicDraft = async (request) => {
    requests.push(request);
    return requests.length === 1
      ? { text: '[Refrão]\nRascunho aceito' }
      : { text: '[Refrão]\nReescrita da letra salva' };
  };

  const beforeApply = { projectId, lyrics: '[Verso]\nLetra original', preset: 'music' };
  const draft = await executePabloAudioMessage('Escreve um refrão dessa ideia', beforeApply, { generateMusicDraft });
  assert.equal(draft.draftVersion, 1);

  const afterApply = { projectId, lyrics: draft.text, preset: 'music' };
  const rewrite = await executePabloAudioMessage('Reescreve esse refrão sem perder meu jeito', afterApply, { generateMusicDraft });

  assert.equal(requests.length, 2);
  assert.equal(requests[1].command, 'rewrite');
  assert.equal(requests[1].contextPack.current_lyrics, '[Refrão]\nRascunho aceito');
  assert.equal(Object.hasOwn(requests[1].contextPack, 'pending_draft'), false);
  assert.equal(rewrite.draftVersion, 1);
  assert.equal(rewrite.revisionOfPending, false);
});

test('an external lyric edit also expires stale preview state', async () => {
  const projectId = 'pending-external-edit-contract';
  let calls = 0;
  const generateMusicDraft = async () => {
    calls += 1;
    return { text: '[Refrão]\nPreview antigo' };
  };
  await executePabloAudioMessage('Escreve um refrão sobre a estrada', {
    projectId,
    lyrics: '[Verso]\nAntes',
  }, { generateMusicDraft });

  const result = await executePabloAudioMessage('Gostei, mas deixa esse refrão menos óbvio', {
    projectId,
    lyrics: '[Verso]\nEditei manualmente depois',
  }, { generateMusicDraft });

  assert.equal(calls, 1);
  assert.notEqual(result.kind, 'pmi_generated_draft');
});
