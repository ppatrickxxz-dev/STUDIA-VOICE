import test from 'node:test';
import assert from 'node:assert/strict';
import { directSongCandidates } from '../packages/music-intelligence/src/song-director.mjs';

test('Portuguese section ids from professional blueprint map to musical energy roles', () => {
  const plan = {
    brief: 'R&B brasileiro sensual com refrão maior',
    artistBrief: 'R&B brasileiro sensual com refrão maior, versos íntimos e ponte baixa',
    sections: [
      { id: 'intro' },
      { id: 'verso_2' },
      { id: 'pre_refr_3' },
      { id: 'refr_4' },
      { id: 'pos_refr_5' },
      { id: 'ponte_rap_6' },
      { id: 'break_7' },
      { id: 'outro' },
    ],
  };
  const directed = directSongCandidates(plan, { variation: 0.5, candidateCount: 2, entropy: 42 });
  const curve = directed.selected.energyCurve;
  const roles = curve.map((item) => item.section);
  assert.deepEqual(roles, ['intro', 'verse', 'pre', 'chorus', 'post', 'bridge', 'breakdown', 'outro']);
  const chorus = curve.find((item) => item.section === 'chorus');
  const verse = curve.find((item) => item.section === 'verse');
  assert.ok(chorus.energy >= 0.78);
  assert.ok(chorus.energy > verse.energy);
});
