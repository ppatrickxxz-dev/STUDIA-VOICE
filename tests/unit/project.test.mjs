import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack, migrateProject, snapshotProject, validateProject } from '../../packages/core/src/project.mjs';

test('project lifecycle keeps tracks and bounded history', () => {
  const project = createProject('Minha faixa', 1000);
  const track = createTrack({ name: 'Voz', assetId: 'asset_1', duration: 12.5, sampleRate: 48000 });
  project.tracks.push(track);
  project.activeTrackId = track.id;
  let current = project;
  for (let index = 0; index < 45; index += 1) current = snapshotProject(current, `v${index}`);
  assert.equal(current.revisions.length, 40);
  assert.equal(current.activeTrackId, track.id);
  assert.deepEqual(validateProject(current), { valid: true, errors: [] });
});

test('migration clamps unsafe legacy mixer values', () => {
  const migrated = migrateProject({
    id: 'legacy', name: 'Legacy', tracks: [{ id: 'track', assetId: 'audio', duration: 4, trimStart: -2, trimEnd: 99, gain: 8, pan: -4 }],
  });
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.tracks[0].trimStart, 0);
  assert.equal(migrated.tracks[0].trimEnd, 4);
  assert.equal(migrated.tracks[0].gain, 2);
  assert.equal(migrated.tracks[0].pan, -1);
});

test('region automation is normalized, persisted and snapshotted independently from effects', () => {
  const migrated = migrateProject({
    id: 'regions', name: 'Regions', tracks: [{
      id: 'voice', assetId: 'audio', duration: 5,
      regionAutomation: [
        { id: 'breath_1', kind: 'breath-gain', start: 1, end: 1.4, reductionDb: -6, confidence: 0.91, source: 'breath-intelligence' },
        { id: 'invalid', start: 8, end: 9, reductionDb: -100 },
      ],
    }],
  });
  assert.deepEqual(migrated.tracks[0].regionAutomation, [{
    id: 'breath_1', kind: 'breath-gain', startSeconds: 1, endSeconds: 1.4, gainDb: -6, confidence: 0.91, source: 'breath-intelligence', enabled: true,
  }]);
  const snap = snapshotProject(migrated, 'respirações');
  assert.deepEqual(snap.revisions.at(-1).tracks[0].regionAutomation, migrated.tracks[0].regionAutomation);
  assert.equal('regionAutomation' in snap.revisions.at(-1).tracks[0].effects, false);
});

test('validation rejects missing audio identity and inverted trim', () => {
  const result = validateProject({ id: 'p', name: 'P', tracks: [{ id: 't', trimStart: 3, trimEnd: 1 }] });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2);
});
