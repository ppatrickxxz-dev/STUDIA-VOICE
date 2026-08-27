import assert from 'node:assert/strict';
import test from 'node:test';
import { executePabloAudioMessage, interpretPabloAudioMessage } from '../packages/app/pablo-conversation-audio.mjs';

test('maps everyday PT-BR mix request to bring_voice_forward', () => {
  const parsed = interpretPabloAudioMessage('Deixa minha voz mais na frente', { projectId: 'p1', trackId: 'vocal' });
  assert.equal(parsed.supported, true);
  assert.equal(parsed.kind, 'tool_call');
  assert.equal(parsed.tool, 'bring_voice_forward');
  assert.equal(parsed.args.projectId, 'p1');
  assert.equal(parsed.args.trackId, 'vocal');
});

test('maps breath request to confidence-gated breath tool', () => {
  const parsed = interpretPabloAudioMessage('Suaviza minhas respirações', { assetId: 'voice-a' });
  assert.equal(parsed.tool, 'soften_breaths');
  assert.equal(parsed.args.assetId, 'voice-a');
  assert.equal(parsed.args.mode, 'soften');
});

test('maps audio-to-instrument request without requiring DAW jargon', () => {
  const parsed = interpretPabloAudioMessage('Transforma isso em instrumento', { assetId: 'sample-1' });
  assert.equal(parsed.tool, 'audio_to_instrument');
  assert.equal(parsed.args.preserveFormants, true);
  assert.equal(parsed.previewPolicy, 'preview_only');
});

test('keeps existing deterministic edits available as fallback', () => {
  const parsed = interpretPabloAudioMessage('Deixa minha voz mais limpa e centraliza ela', { trackId: 'v1' });
  assert.equal(parsed.kind, 'deterministic_edit');
  assert.equal(parsed.intent.supported, true);
  assert.equal(parsed.trackId, 'v1');
});

test('tool execution respects runtime preview_only instead of claiming apply', async () => {
  const result = await executePabloAudioMessage(
    'Deixa minha voz mais na frente',
    { projectId: 'p1', trackId: 'vocal' },
    { audioToolRuntime: async () => ({ ok: true, data: { confidence: 0.6, decision: 'suggest', execution: 'preview_only' } }) },
  );
  assert.equal(result.execution, 'preview_only');
  assert.equal(result.canApply, false);
});

test('tool execution only becomes applicable when runtime explicitly allows it', async () => {
  const result = await executePabloAudioMessage(
    'Deixa minha voz mais na frente',
    { projectId: 'p1', trackId: 'vocal' },
    { audioToolRuntime: async () => ({ ok: true, data: { confidence: 0.93, decision: 'auto', execution: 'allowed' } }) },
  );
  assert.equal(result.execution, 'allowed');
  assert.equal(result.canApply, true);
});

test('unknown request fails closed', () => {
  const parsed = interpretPabloAudioMessage('Faz algo surreal aí');
  assert.equal(parsed.supported, false);
  assert.equal(parsed.reason, 'no_safe_audio_intent');
});
