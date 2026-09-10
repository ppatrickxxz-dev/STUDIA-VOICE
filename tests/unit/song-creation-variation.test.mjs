import test from 'node:test';
import assert from 'node:assert/strict';
import { createSongCreationPlan } from '../../packages/app/song-creation-engine.mjs';

const INPUT = Object.freeze({
  brief: 'R&B anos 2000 com funk carioca, synths, grave redondo e refrão forte',
  lyrics: '[Verso]\nChega mais perto\nSem promessa pra depois\n\n[Refrão]\nHoje é eu e você',
  genre: 'rnb',
  bpm: 112,
  durationSeconds: 60,
  key: 'A',
});

function musicalFingerprint(plan) {
  return JSON.stringify({
    progression: plan.progression,
    creativeProfile: plan.creativeProfile,
    pad: plan.padNotes.slice(0, 24),
    bass: plan.bassNotes.slice(0, 24),
    accent: plan.accentNotes.slice(0, 24),
    guide: plan.guideNotes.slice(0, 24),
    drums: plan.drumEvents.slice(0, 48),
    sections: plan.sections.map(({ id, startBar, endBar }) => ({ id, startBar, endBar })),
  });
}

test('different variation seeds produce musically different takes for the same request', () => {
  const a = createSongCreationPlan({ ...INPUT, variationSeed: 0x10203040 });
  const b = createSongCreationPlan({ ...INPUT, variationSeed: 0x90abcdef });
  assert.notEqual(a.variationId, b.variationId);
  assert.notEqual(musicalFingerprint(a), musicalFingerprint(b));
});

test('an explicit variation seed reproduces the same musical take for A/B and history', () => {
  const a = createSongCreationPlan({ ...INPUT, variationSeed: 0x55667788 });
  const b = createSongCreationPlan({ ...INPUT, variationSeed: 0x55667788 });
  assert.equal(a.variationId, b.variationId);
  assert.equal(musicalFingerprint(a), musicalFingerprint(b));
});

test('automatic creation allocates a fresh variation identity instead of hashing only prompt and lyrics', () => {
  const ids = new Set(Array.from({ length: 6 }, () => createSongCreationPlan(INPUT).variationId));
  assert.ok(ids.size > 1, 'successive takes must not collapse to one deterministic variation');
});
