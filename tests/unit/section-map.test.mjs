import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARRANGEMENT_MAP_SCHEMA,
  createArrangementMap,
  findConfirmedSection,
  normalizeArrangementMap,
  normalizeSectionKind,
  parseClockSeconds,
  removeArrangementSection,
  replaceConfirmedSection,
  upsertConfirmedSection,
} from '../../packages/core/src/section-map.mjs';

test('section map normalizes Portuguese section names and clock values', () => {
  assert.equal(normalizeSectionKind('Refrão'), 'chorus');
  assert.equal(normalizeSectionKind('pré-refrão'), 'pre_chorus');
  assert.equal(normalizeSectionKind('ponte'), 'bridge');
  assert.equal(parseClockSeconds('1:12'), 72);
  assert.equal(parseClockSeconds('0:45.5'), 45.5);
  assert.equal(parseClockSeconds('45,25'), 45.25);
  assert.equal(parseClockSeconds('1:75'), null);
});

test('confirmed manual sections are ordered, persisted and resolved by occurrence', () => {
  let map = createArrangementMap();
  map = upsertConfirmedSection(map, { kind: 'refrão', startSeconds: 92, source: 'user_manual', confidence: 1 });
  map = upsertConfirmedSection(map, { kind: 'refrão', startSeconds: 45, endSeconds: 61, source: 'user_manual', confidence: 1 });

  assert.equal(map.schema, ARRANGEMENT_MAP_SCHEMA);
  assert.deepEqual(map.sections.map((section) => section.startSeconds), [45, 92]);
  assert.equal(findConfirmedSection(map, 'chorus')?.startSeconds, 45);
  assert.equal(findConfirmedSection(map, 'refrão', { occurrence: 2 })?.startSeconds, 92);
  assert.equal(findConfirmedSection(map, 'chorus')?.timingStatus, 'confirmed');
});

test('confirmed sections can be edited and removed through canonical map operations', () => {
  let map = upsertConfirmedSection(createArrangementMap(), { kind: 'chorus', startSeconds: 45, source: 'user_manual' });
  const originalId = map.sections[0].id;
  map = replaceConfirmedSection(map, originalId, { kind: 'chorus', startSeconds: 48.5, endSeconds: 64, source: 'user_manual', confidence: 1 });
  assert.equal(map.sections.length, 1);
  assert.equal(map.sections[0].startSeconds, 48.5);
  assert.equal(map.sections[0].endSeconds, 64);
  assert.notEqual(map.sections[0].id, originalId);

  map = removeArrangementSection(map, map.sections[0].id);
  assert.deepEqual(map.sections, []);
});

test('editing a missing section fails closed instead of creating a surprise marker', () => {
  assert.throws(() => replaceConfirmedSection(createArrangementMap(), 'missing', {
    kind: 'chorus', startSeconds: 20,
  }), /não encontrada/i);
});

test('unconfirmed or weak timing is never promoted into an executable section', () => {
  const map = normalizeArrangementMap({
    sections: [
      { kind: 'chorus', startSeconds: 30, source: 'lyrics_heading', timingStatus: 'unconfirmed', confidence: 1 },
      { kind: 'chorus', startSeconds: 60, source: 'detector_preview', timingStatus: 'confirmed', confidence: 0.79 },
      { kind: 'bridge', startSeconds: -2, timingStatus: 'confirmed', confidence: 1 },
    ],
  });

  assert.equal(findConfirmedSection(map, 'chorus'), null);
  assert.equal(map.sections.some((section) => section.kind === 'bridge'), false);
});

test('invalid section ranges fail closed', () => {
  assert.throws(() => upsertConfirmedSection(createArrangementMap(), {
    kind: 'chorus', startSeconds: 50, endSeconds: 40,
  }), /tempo final/i);
  assert.throws(() => upsertConfirmedSection(createArrangementMap(), {
    kind: 'inventada', startSeconds: 10,
  }), /seção musical/i);
});
