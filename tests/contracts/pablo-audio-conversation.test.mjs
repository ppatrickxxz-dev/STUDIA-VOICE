import assert from 'node:assert/strict';
import test from 'node:test';
import { executePabloAudioMessage, interpretPabloAudioMessage } from '../../packages/app/pablo-conversation-audio.mjs';

test('everyday PT-BR voice-forward request maps to the project-aware mix tool', () => {
  const parsed = interpretPabloAudioMessage('Deixa minha voz mais na frente', { projectId: 'p1', trackId: 'vocal' });
  assert.equal(parsed.supported, true);
  assert.equal(parsed.tool, 'bring_voice_forward');
  assert.deepEqual(parsed.args, { projectId: 'p1', trackId: 'vocal' });
});

test('audio-to-instrument remains preview-only at the conversation boundary', () => {
  const parsed = interpretPabloAudioMessage('Transforma isso em instrumento', { assetId: 'voice-a' });
  assert.equal(parsed.tool, 'audio_to_instrument');
  assert.equal(parsed.previewPolicy, 'preview_only');
  assert.equal(parsed.args.preserveFormants, true);
});

test('runtime suggestion cannot be promoted to apply by the conversation layer', async () => {
  const result = await executePabloAudioMessage('Deixa minha voz mais na frente', { projectId: 'p1', trackId: 'vocal' }, {
    audioToolRuntime: async () => ({ ok: true, data: { confidence: 0.62, decision: 'suggest', execution: 'preview_only' } }),
  });
  assert.equal(result.canApply, false);
  assert.equal(result.execution, 'preview_only');
});

test('unknown creative request fails closed instead of inventing a tool', () => {
  const parsed = interpretPabloAudioMessage('Faz uma mágica surreal nisso aí');
  assert.equal(parsed.supported, false);
  assert.equal(parsed.reason, 'no_safe_audio_intent');
});
