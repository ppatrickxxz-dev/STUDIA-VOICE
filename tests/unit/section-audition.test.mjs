import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSectionAuditionCommand, resolveConfirmedSectionAudition } from '../../packages/core/src/section-audition.mjs';
import { createArrangementMap, upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';

function add(map, kind, startSeconds, endSeconds = null) {
  return upsertConfirmedSection(map, { kind, startSeconds, endSeconds, source: 'user_manual', confidence: 1 });
}

test('Pablo parses natural PT-BR section audition commands and optional occurrence', () => {
  assert.deepEqual(parseSectionAuditionCommand('toca o refrão'), { section: 'chorus', label: 'Refrão', occurrence: null });
  assert.deepEqual(parseSectionAuditionCommand('quero ouvir o segundo refrão'), { section: 'chorus', label: 'Refrão', occurrence: 2 });
  assert.deepEqual(parseSectionAuditionCommand('reproduz a ponte'), { section: 'bridge', label: 'Ponte', occurrence: null });
  assert.deepEqual(parseSectionAuditionCommand('escuta o pré-refrão'), { section: 'pre_chorus', label: 'Pré-refrão', occurrence: null });
  assert.equal(parseSectionAuditionCommand('escreve um refrão'), null);
});

test('one complete confirmed section resolves directly for audition', () => {
  let map = createArrangementMap(1);
  map = add(map, 'chorus', 20, 32);
  const result = resolveConfirmedSectionAudition(map, 'chorus');
  assert.equal(result.ok, true);
  assert.equal(result.startSeconds, 20);
  assert.equal(result.endSeconds, 32);
});

test('section with confirmed start but no confirmed end fails closed', () => {
  let map = createArrangementMap(1);
  map = add(map, 'chorus', 20);
  const result = resolveConfirmedSectionAudition(map, 'chorus');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_confirmed_end');
});

test('multiple occurrences require an explicit ordinal and then resolve exactly that occurrence', () => {
  let map = createArrangementMap(1);
  map = add(map, 'chorus', 20, 32);
  map = add(map, 'chorus', 60, 72);
  const ambiguous = resolveConfirmedSectionAudition(map, 'chorus');
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, 'ambiguous_occurrence');
  assert.equal(ambiguous.count, 2);
  const second = resolveConfirmedSectionAudition(map, 'chorus', { occurrence: 2 });
  assert.equal(second.ok, true);
  assert.equal(second.section.startSeconds, 60);
  assert.equal(second.section.endSeconds, 72);
});

test('missing occurrence or section never falls back to another timing', () => {
  let map = createArrangementMap(1);
  map = add(map, 'verse', 10, 18);
  assert.equal(resolveConfirmedSectionAudition(map, 'chorus').reason, 'missing_confirmed_section');
  assert.equal(resolveConfirmedSectionAudition(map, 'verse', { occurrence: 2 }).reason, 'missing_occurrence');
});
