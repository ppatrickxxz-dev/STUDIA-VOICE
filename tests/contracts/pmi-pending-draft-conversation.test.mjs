import test from 'node:test';
import assert from 'node:assert/strict';
import { executePabloAudioMessage } from '../../packages/app/pablo-conversation-audio.mjs';

test('generated draft can be revised conversationally before it is applied', async () => {
  const calls = [];
  const generateMusicDraft = async (request) => {
    calls.push(request);
    return { text: calls.length === 1 ? '[Refrão]\nPrimeira versão' : '[Refrão]\nVersão menos óbvia', provider: 'test' };
  };
  const context = { projectId: 'draft-project', lyrics: '[Verso]\nAté onde deu', notes: 'íntimo', preset: 'music' };
  const first = await executePabloAudioMessage('Escreve um refrão sobre até onde deu', context, { generateMusicDraft });
  assert.equal(first.kind, 'pmi_generated_draft');
  assert.equal(first.text, '[Refrão]\nPrimeira versão');
  assert.equal(first.canApply, false);

  const revised = await executePabloAudioMessage('Gostei, mas deixa esse refrão menos óbvio', context, { generateMusicDraft });
  assert.equal(revised.kind, 'pmi_generated_draft');
  assert.equal(revised.revisedPendingDraft, true);
  assert.equal(revised.text, '[Refrão]\nVersão menos óbvia');
  assert.equal(calls[1].contextPack.pending_draft, '[Refrão]\nPrimeira versão');
  assert.equal(calls[1].constraints.revise_pending_draft_only, true);
  assert.equal(context.lyrics, '[Verso]\nAté onde deu');
});
