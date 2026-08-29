import test from 'node:test';
import assert from 'node:assert/strict';
import { clearPmiPendingDraft, executePabloAudioMessage } from '../../packages/app/pablo-conversation-audio.mjs';

test('generated draft can be revised conversationally before anything is applied to project lyrics', async () => {
  const calls = [];
  const context = {
    projectId: 'pending-draft-contract-1',
    lyrics: '[Verso]\nEu fui até onde deu',
    notes: 'R&B íntimo',
    preset: 'music',
    authorialMemory: { avoid: ['promessa'], evidenceCount: 1 },
  };
  const generateMusicDraft = async (request) => {
    calls.push(request);
    return calls.length === 1
      ? { text: '[Refrão]\nAté onde deu, eu fui', provider: 'test-provider', model: 'test-model' }
      : { text: '[Refrão]\nO mapa acabou antes de mim', provider: 'test-provider', model: 'test-model' };
  };

  const first = await executePabloAudioMessage('Escreve um refrão dessa ideia', context, { generateMusicDraft });
  assert.equal(first.kind, 'pmi_generated_draft');
  assert.equal(first.draftVersion, 1);
  assert.equal(first.canApply, false);
  assert.equal(first.reviewRequired, true);

  const revised = await executePabloAudioMessage('Gostei, mas deixa esse refrão menos óbvio', context, { generateMusicDraft });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].command, 'rewrite');
  assert.equal(calls[1].contextPack.pending_draft, '[Refrão]\nAté onde deu, eu fui');
  assert.equal(calls[1].contextPack.current_lyrics, '[Verso]\nEu fui até onde deu');
  assert.equal(calls[1].constraints.revise_pending_draft_only, true);
  assert.equal(revised.kind, 'pmi_generated_draft');
  assert.equal(revised.text, '[Refrão]\nO mapa acabou antes de mim');
  assert.equal(revised.draftVersion, 2);
  assert.equal(revised.previousDraftVersion, 1);
  assert.equal(revised.revisionOfPending, true);
  assert.equal(revised.execution, 'preview_only');
  assert.equal(revised.canApply, false);
});

test('pending lyric draft never hijacks an audio command', async () => {
  const projectId = 'pending-draft-contract-2';
  let generatorCalls = 0;
  await executePabloAudioMessage('Escreve um refrão sobre um desencontro', { projectId, lyrics: '' }, {
    generateMusicDraft: async () => {
      generatorCalls += 1;
      return { text: '[Refrão]\nDesencontro' };
    },
  });

  let audioCalls = 0;
  const result = await executePabloAudioMessage('deixa minha voz mais na frente', { projectId, lyrics: '' }, {
    generateMusicDraft: async () => {
      generatorCalls += 1;
      return { text: 'não deveria gerar' };
    },
    audioToolRuntime: async (tool) => {
      audioCalls += 1;
      assert.equal(tool, 'bring_voice_forward');
      return { ok: true, data: { execution: 'allowed' } };
    },
  });
  assert.equal(generatorCalls, 1);
  assert.equal(audioCalls, 1);
  assert.equal(result.kind, 'tool_call');
  assert.equal(result.tool, 'bring_voice_forward');
});

test('asking for another refrain starts a fresh preview chain instead of rewriting the pending draft', async () => {
  const projectId = 'pending-draft-contract-3';
  let calls = 0;
  const generateMusicDraft = async (request) => {
    calls += 1;
    return { text: calls === 1 ? 'primeiro' : 'outro', command: request.command };
  };
  const context = { projectId, lyrics: '', preset: 'music' };
  await executePabloAudioMessage('Escreve um refrão sobre a estrada', context, { generateMusicDraft });
  const next = await executePabloAudioMessage('Faz outro refrão', context, { generateMusicDraft });
  assert.equal(calls, 2);
  assert.equal(next.command, 'generate');
  assert.equal(next.draftVersion, 1);
  assert.equal(next.revisionOfPending, false);
});

test('asking for a bridge starts a fresh preview chain instead of rewriting an older draft', async () => {
  const projectId = 'pending-draft-contract-4';
  const calls = [];
  const generateMusicDraft = async (request) => {
    calls.push(request);
    return { text: calls.length === 1 ? '[Refrão]\nPrimeiro' : '[Ponte]\nVolta sem mapa' };
  };
  const context = { projectId, lyrics: '[Verso]\nAté onde deu', preset: 'music' };
  await executePabloAudioMessage('Escreve um refrão sobre a estrada', context, { generateMusicDraft });

  const bridge = await executePabloAudioMessage('Faz uma ponte sobre a volta', context, { generateMusicDraft });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].command, 'generate');
  assert.equal(calls[1].targetSection, 'ponte');
  assert.equal(Object.hasOwn(calls[1].contextPack, 'pending_draft'), false);
  assert.equal(bridge.command, 'generate');
  assert.equal(bridge.draftVersion, 1);
  assert.equal(bridge.revisionOfPending, false);
});

test('cleared pending draft cannot be revised after apply', async () => {
  const projectId = 'pending-draft-contract-5';
  let calls = 0;
  const context = { projectId, lyrics: '[Verso]\nAté onde deu', preset: 'music' };
  await executePabloAudioMessage('Escreve um refrão sobre a estrada', context, {
    generateMusicDraft: async () => {
      calls += 1;
      return { text: '[Refrão]\nPreview antigo' };
    },
  });

  assert.equal(clearPmiPendingDraft(projectId), true);
  const result = await executePabloAudioMessage('Gostei, mas deixa esse refrão menos óbvio', context, {
    generateMusicDraft: async () => {
      calls += 1;
      return { text: 'não deveria revisar' };
    },
  });

  assert.equal(calls, 1);
  assert.notEqual(result.kind, 'pmi_generated_draft');
});