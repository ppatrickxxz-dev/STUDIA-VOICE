import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PABLOVOICE_SONG_DIRECTOR_SCHEMA,
  applyDirectedCandidate,
  directSongCandidates,
  fingerprintSongDirection,
} from '../../packages/music-intelligence/src/song-director.mjs';

const plan = Object.freeze({
  schema: 'pablovoice_song_creation_v1',
  brief: 'Pop R&B noturno com synths, baixo redondo e refrão forte',
  genre: 'rnb',
  mood: 'íntimo, elegante, noturno',
  bpm: 112,
  key: 'A',
  mode: 'minor',
  seed: 1919,
  sections: Object.freeze([
    Object.freeze({ id: 'intro', label: 'Intro' }),
    Object.freeze({ id: 'verso_1', label: 'Verso 1' }),
    Object.freeze({ id: 'pre_1', label: 'Pré' }),
    Object.freeze({ id: 'refrao_1', label: 'Refrão' }),
    Object.freeze({ id: 'verso_2', label: 'Verso 2' }),
    Object.freeze({ id: 'ponte', label: 'Ponte' }),
    Object.freeze({ id: 'refrao_2', label: 'Refrão final' }),
    Object.freeze({ id: 'outro', label: 'Outro' }),
  ]),
});

test('PabloVoice 2 director proposes ranked non-identical Song DNA candidates', () => {
  const directed = directSongCandidates(plan, { variation: 0.72, candidateCount: 3, entropy: 928374 });
  assert.equal(directed.schema, PABLOVOICE_SONG_DIRECTOR_SCHEMA);
  assert.equal(directed.candidates.length, 3);
  assert.equal(new Set(directed.candidates.map((item) => item.fingerprint)).size, 3);
  assert.ok(directed.selected.score.total > 0);
  assert.match(directed.selected.providerDirection, /avoid loop-like repetition/);
  assert.match(directed.selected.providerDirection, /energy:/);
});

test('PabloVoice 2 director respects creative locks while varying unlocked dimensions', () => {
  const directed = directSongCandidates(plan, {
    variation: 0.9,
    candidateCount: 3,
    entropy: 112233,
    locks: { groove: true, harmony: true, instrumentation: true, motif: true },
  });
  for (const candidate of directed.candidates) {
    assert.equal(candidate.groove, 'preserve current groove');
    assert.equal(candidate.harmonicColor, 'preserve current harmony');
    assert.equal(candidate.texture, 'preserve current instrumentation');
    assert.equal(candidate.motif, 'preserve established motif');
  }
});

test('directed plan stays compatible with the canonical music runtime', () => {
  const directed = directSongCandidates(plan, { variation: 0.6, candidateCount: 2, entropy: 443322 });
  const upgraded = applyDirectedCandidate(plan, directed.selected);
  assert.equal(upgraded.schema, plan.schema);
  assert.equal(upgraded.bpm, plan.bpm);
  assert.equal(upgraded.key, plan.key);
  assert.equal(upgraded.pabloVoice2.fingerprint, directed.selected.fingerprint);
  assert.match(upgraded.brief, /PabloVoice 2\.0 Song DNA:/);
  assert.ok(upgraded.brief.length <= 1200);
});

test('fingerprint is deterministic for the same direction payload', () => {
  const a = fingerprintSongDirection({ groove: 'pocket', motif: 'three notes', energy: [0.4, 0.9] });
  const b = fingerprintSongDirection({ energy: [0.4, 0.9], motif: 'three notes', groove: 'pocket' });
  assert.equal(a, b);
  assert.match(a, /^pv2_[0-9a-f]{8}$/);
});
