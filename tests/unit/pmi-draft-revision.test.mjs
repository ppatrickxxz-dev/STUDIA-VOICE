import test from 'node:test';
import assert from 'node:assert/strict';
import { planPendingDraftRevision } from '../../packages/music-intelligence/src/draft-revision.mjs';

test('revises a pending generated draft without requiring it to be applied to project lyrics', () => {
  const result = planPendingDraftRevision('Gostei, mas deixa esse refrão menos óbvio', {
    lyrics: '[Verso]\nEu fui até onde deu',
    notes: 'R&B íntimo',
    pendingDraft: {
      text: '[Refrão]\nAté onde deu, eu fui',
      command: 'generate',
      targetSection: 'refrão',
    },
  });
  assert.equal(result.supported, true);
  assert.equal(result.command, 'rewrite');
  assert.equal(result.request.contextPack.pending_draft, '[Refrão]\nAté onde deu, eu fui');
  assert.equal(result.request.contextPack.current_lyrics, '[Verso]\nEu fui até onde deu');
  assert.equal(result.request.constraints.revise_pending_draft_only, true);
  assert.equal(result.request.constraints.review_before_apply, true);
});

test('does not hijack ordinary conversation when no pending draft exists', () => {
  const result = planPendingDraftRevision('deixa esse refrão menos óbvio', { lyrics: '' });
  assert.equal(result.supported, false);
});

test('does not treat unrelated audio requests as draft revision', () => {
  const result = planPendingDraftRevision('deixa minha voz mais na frente', {
    pendingDraft: { text: '[Refrão]\nAlguma coisa' },
  });
  assert.equal(result.supported, false);
});
