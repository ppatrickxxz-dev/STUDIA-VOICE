import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPmiDraftApplyState,
  confirmPmiDraftApply,
  getPmiDraftApplyConfirmation,
  registerPmiDraftPreview,
} from '../../packages/app/pmi-draft-apply-state.mjs';

test('accepted draft action is stored for the exact preview version and text', () => {
  const projectId = 'pmi-confirmation-1';
  registerPmiDraftPreview(projectId, { draftVersion: 2, text: '[Refrão]\nVersão revisada' });

  const accepted = confirmPmiDraftApply(projectId, {
    mode: 'append',
    draftVersion: 2,
    text: '[Refrão]\nVersão revisada',
  });

  assert.deepEqual(accepted, {
    mode: 'append',
    draftVersion: 2,
    text: '[Refrão]\nVersão revisada',
  });
  assert.deepEqual(getPmiDraftApplyConfirmation(projectId, {
    draftVersion: 2,
    text: '[Refrão]\nVersão revisada',
  }), accepted);
  assert.equal(clearPmiDraftApplyState(projectId), true);
});

test('newer revised draft invalidates confirmation and blocks stale preview acceptance', () => {
  const projectId = 'pmi-confirmation-2';
  registerPmiDraftPreview(projectId, { draftVersion: 1, text: '[Refrão]\nPrimeiro' });
  assert.ok(confirmPmiDraftApply(projectId, {
    mode: 'replace',
    draftVersion: 1,
    text: '[Refrão]\nPrimeiro',
  }));

  registerPmiDraftPreview(projectId, { draftVersion: 2, text: '[Refrão]\nSegundo' });

  assert.equal(getPmiDraftApplyConfirmation(projectId, {
    draftVersion: 1,
    text: '[Refrão]\nPrimeiro',
  }), null);
  assert.equal(confirmPmiDraftApply(projectId, {
    mode: 'replace',
    draftVersion: 1,
    text: '[Refrão]\nPrimeiro',
  }), null);
  assert.deepEqual(confirmPmiDraftApply(projectId, {
    mode: 'replace',
    draftVersion: 2,
    text: '[Refrão]\nSegundo',
  }), {
    mode: 'replace',
    draftVersion: 2,
    text: '[Refrão]\nSegundo',
  });
  assert.equal(clearPmiDraftApplyState(projectId), true);
});

test('reading stored confirmation does not consume it before the caller clears state', () => {
  const projectId = 'pmi-confirmation-3';
  const draft = { draftVersion: 3, text: '[Ponte]\nVolta sem mapa' };
  registerPmiDraftPreview(projectId, draft);
  confirmPmiDraftApply(projectId, { ...draft, mode: 'replace' });

  const first = getPmiDraftApplyConfirmation(projectId, draft);
  const second = getPmiDraftApplyConfirmation(projectId, draft);
  assert.deepEqual(first, second);
  assert.equal(clearPmiDraftApplyState(projectId), true);
  assert.equal(getPmiDraftApplyConfirmation(projectId, draft), null);
});
