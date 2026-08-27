import test from 'node:test';
import assert from 'node:assert/strict';

import {
  executePabloAudioMessage,
  interpretPabloAudioMessage,
} from '../../packages/app/pablo-conversation-audio.mjs';

test('Pablo maps explicit Beat Lab language to deterministic local operations', () => {
  const humanize = interpretPabloAudioMessage('Humaniza essa bateria bastante');
  assert.equal(humanize.supported, true);
  assert.equal(humanize.kind, 'beat_operation');
  assert.equal(humanize.action, 'humanize');
  assert.equal(humanize.args.amount, 0.65);

  const groove = interpretPabloAudioMessage('Usa o groove desse áudio bem leve');
  assert.equal(groove.kind, 'beat_operation');
  assert.equal(groove.action, 'apply_groove');
  assert.equal(groove.args.amount, 0.35);

  const fill = interpretPabloAudioMessage('Faz uma virada grande');
  assert.equal(fill.action, 'fill');
  assert.equal(fill.args.intensity, 0.9);
});

test('section placement and genre generation abstain instead of inventing structure', () => {
  const section = interpretPabloAudioMessage('Faz uma virada antes do refrão');
  assert.equal(section.kind, 'beat_operation');
  assert.equal(section.action, 'fill_before_section');
  assert.equal(section.previewPolicy, 'preview_only');

  const genre = interpretPabloAudioMessage('Faz bateria funk aqui');
  assert.equal(genre.kind, 'beat_generation_plan');
  assert.equal(genre.args.genre, 'funk');
  assert.equal(genre.previewPolicy, 'preview_only');

  const creative = interpretPabloAudioMessage('Quero criar uma música funk sobre saudade');
  assert.equal(creative.supported, false);
  assert.equal(creative.reason, 'no_safe_audio_intent');
});

test('qualified beat operation executes before PMI and surfaces as a reversible deterministic edit', async () => {
  const seen = [];
  const result = await executePabloAudioMessage('Deixa essa bateria menos reta', { projectId: 'project_beat' }, {
    executeBeatOperation: async (operation, context) => {
      seen.push({ operation, context });
      return {
        ok: true,
        mutated: true,
        reply: 'Beat humanizado.',
        data: { projectId: context.projectId, humanize: operation.args.amount },
      };
    },
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].operation.action, 'humanize');
  assert.equal(seen[0].context.projectId, 'project_beat');
  assert.equal(result.kind, 'deterministic_edit');
  assert.equal(result.originalKind, 'beat_operation');
  assert.equal(result.domain, 'beat_lab');
  assert.equal(result.beatAction, 'humanize');
  assert.equal(result.canApply, true);
  assert.equal(result.execution, 'allowed');
  assert.equal(result.reply, 'Beat humanizado.');
});

test('blocked beat operation stays preview-only and preserves Beat Lab provenance', async () => {
  const result = await executePabloAudioMessage('Usa o groove desse áudio', { projectId: 'p' }, {
    executeBeatOperation: async () => ({
      ok: false,
      mutated: false,
      reason: 'groove_evidence_unavailable',
      reply: 'Sem groove confiável.',
    }),
  });

  assert.equal(result.kind, 'deterministic_edit');
  assert.equal(result.originalKind, 'beat_operation');
  assert.equal(result.domain, 'beat_lab');
  assert.equal(result.beatAction, 'apply_groove');
  assert.equal(result.canApply, false);
  assert.equal(result.execution, 'preview_only');
  assert.equal(result.result.reason, 'groove_evidence_unavailable');
  assert.equal(result.reply, 'Sem groove confiável.');
});

test('genre-pattern planning uses the same chat-safe deterministic preview contract', async () => {
  const result = await executePabloAudioMessage('Faz bateria funk aqui', { projectId: 'p' });
  assert.equal(result.kind, 'deterministic_edit');
  assert.equal(result.originalKind, 'beat_generation_plan');
  assert.equal(result.domain, 'beat_lab');
  assert.equal(result.beatAction, 'genre_pattern');
  assert.equal(result.canApply, false);
  assert.equal(result.execution, 'preview_only');
});
