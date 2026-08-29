import test from 'node:test';
import assert from 'node:assert/strict';
import { planPendingDraftRevision, normalizePendingDraft } from '../../packages/music-intelligence/src/draft-revision.mjs';

test('revises a pending generated draft without requiring it to be applied to project lyrics', () => {
  const result = planPendingDraftRevision('Gostei, mas deixa esse refrão menos óbvio', {
    lyrics: '[Verso]\nEu fui até onde deu',
    notes: 'R&B íntimo',
    authorialMemory: { avoid: ['promessa'], evidenceCount: 1 },
    pendingDraft: {
      text: '[Refrão]\nAté onde deu, eu fui',
      version: 1,
      command: 'generate',
      targetSection: 'refrão',
    },
  });
  assert.equal(result.supported, true);
  assert.equal(result.kind, 'pmi_draft_revision_request');
  assert.equal(result.command, 'rewrite');
  assert.equal(result.pendingVersion, 1);
  assert.match(result.request.task, /Revise somente o rascunho pendente/);
  assert.equal(result.request.contextPack.user_request, 'Gostei, mas deixa esse refrão menos óbvio');
  assert.equal(result.request.contextPack.pending_draft, '[Refrão]\nAté onde deu, eu fui');
  assert.equal(result.request.contextPack.current_lyrics, '[Verso]\nEu fui até onde deu');
  assert.equal(result.request.constraints.revise_pending_draft_only, true);
  assert.equal(result.request.constraints.review_before_apply, true);
});

test('does not hijack ordinary conversation when no pending draft exists', () => {
  const result = planPendingDraftRevision('deixa esse refrão menos óbvio', { lyrics: '' });
  assert.equal(result.supported, false);
});

test('does not treat audio or mix requests as pending lyric revision', () => {
  for (const message of ['deixa minha voz mais na frente', 'deixa esse áudio mais alto', 'menos grave nesse mix']) {
    const result = planPendingDraftRevision(message, {
      pendingDraft: { text: '[Refrão]\nAlguma coisa', version: 1 },
    });
    assert.equal(result.supported, false, message);
  }
});

test('a request for another or new refrain remains a fresh generation, not a revision', () => {
  for (const message of ['faz outro refrão', 'cria uma nova versão do refrão', 'Faz uma ponte sobre a volta']) {
    const result = planPendingDraftRevision(message, {
      pendingDraft: { text: '[Refrão]\nAlguma coisa', version: 2 },
    });
    assert.equal(result.supported, false, message);
  }
});

test('pending draft normalization is bounded and versioned', () => {
  const normalized = normalizePendingDraft({
    text: '  trecho  ',
    version: 150,
    command: 'rewrite',
    targetSection: 'refrão',
  });
  assert.equal(normalized.text, 'trecho');
  assert.equal(normalized.version, 99);
  assert.equal(normalized.command, 'rewrite');
  assert.equal(normalized.targetSection, 'refrão');
});