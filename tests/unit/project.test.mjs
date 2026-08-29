import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack, migrateProject, snapshotProject, validateProject } from '../../packages/core/src/project.mjs';

test('project lifecycle keeps tracks and bounded history', () => {
  const project = createProject('Minha faixa', 1000);
  const track = createTrack({ name: 'Voz', assetId: 'asset_1', duration: 12.5, sampleRate: 48000 });
  project.tracks.push(track); project.activeTrackId = track.id;
  let current = project;
  for (let index = 0; index < 45; index += 1) current = snapshotProject(current, `v${index}`);
  assert.equal(current.revisions.length, 40); assert.equal(current.activeTrackId, track.id); assert.deepEqual(validateProject(current), { valid: true, errors: [] });
});

test('migration clamps unsafe legacy mixer values', () => {
  const migrated = migrateProject({ id: 'legacy', name: 'Legacy', tracks: [{ id: 'track', assetId: 'audio', duration: 4, trimStart: -2, trimEnd: 99, gain: 8, pan: -4 }] });
  assert.equal(migrated.schemaVersion, 9);
  assert.equal(migrated.tracks[0].trimStart, 0); assert.equal(migrated.tracks[0].trimEnd, 4); assert.equal(migrated.tracks[0].gain, 2); assert.equal(migrated.tracks[0].pan, -1);
  assert.equal(migrated.arrangementMap?.schema, 'pablovoice_arrangement_map_v1'); assert.deepEqual(migrated.arrangementMap?.sections, []);
});

test('region automation is normalized, persisted and snapshotted independently from effects', () => {
  const migrated = migrateProject({ id: 'regions', name: 'Regions', tracks: [{ id: 'voice', assetId: 'audio', duration: 5, regionAutomation: [
    { id: 'breath_1', kind: 'breath-gain', start: 1, end: 1.4, reductionDb: -6, confidence: 0.91, source: 'breath-intelligence' },
    { id: 'invalid', start: 8, end: 9, reductionDb: -100 },
  ] }] });
  assert.deepEqual(migrated.tracks[0].regionAutomation, [{ id: 'breath_1', kind: 'breath-gain', startSeconds: 1, endSeconds: 1.4, gainDb: -6, confidence: 0.91, source: 'breath-intelligence', enabled: true }]);
  const snap = snapshotProject(migrated, 'respirações');
  assert.deepEqual(snap.revisions.at(-1).tracks[0].regionAutomation, migrated.tracks[0].regionAutomation);
  assert.equal('regionAutomation' in snap.revisions.at(-1).tracks[0].effects, false);
});

test('schema v9 preserves safe vocal restoration evidence and revokes forged timbre protection', () => {
  const migrated = migrateProject({
    id: 'restoration', name: 'Restoration', tracks: [{
      id: 'voice', assetId: 'audio', duration: 5, regionAutomation: [
        {
          id: 'denoise', kind: 'vocal_denoise', startSeconds: 0.2, endSeconds: 2.2,
          thresholdDb: -40, reductionDb: 3.2, attackSeconds: 0.008, releaseSeconds: 0.1,
          noiseFloorDb: -46, voicedLevelDb: -20, snrDb: 26, voicedMarginDb: 20,
          confidence: 0.88, timbreProtected: true, guardSource: 'bounded-vocal-timbre-guard-v1',
        },
        {
          id: 'dereverb', kind: 'vocal_dereverb', startSeconds: 0.2, endSeconds: 2.2,
          reflectionDelayMs: 36, amount: 0.16, dampingHz: 5200, correlation: 0.52,
          prominence: 0.14, confidence: 0.9, timbreProtected: true,
          guardSource: 'bounded-vocal-timbre-guard-v1',
        },
        {
          id: 'forged', kind: 'vocal_dereverb', startSeconds: 0.2, endSeconds: 2.2,
          reflectionDelayMs: 180, amount: 0.8, correlation: 0.8, prominence: 0.3,
          confidence: 1, timbreProtected: true, guardSource: 'bounded-vocal-timbre-guard-v1',
        },
      ],
    }],
  });
  assert.equal(migrated.schemaVersion, 9);
  assert.equal(migrated.tracks[0].regionAutomation.find((event) => event.id === 'denoise').timbreProtected, true);
  assert.equal(migrated.tracks[0].regionAutomation.find((event) => event.id === 'dereverb').timbreProtected, true);
  const forged = migrated.tracks[0].regionAutomation.find((event) => event.id === 'forged');
  assert.equal(forged.reflectionDelayMs, 90);
  assert.equal(forged.amount, 0.2);
  assert.equal(forged.timbreProtected, false);
});

test('validation rejects missing audio identity and inverted trim', () => {
  const result = validateProject({ id: 'p', name: 'P', tracks: [{ id: 't', trimStart: 3, trimEnd: 1 }] });
  assert.equal(result.valid, false); assert.equal(result.errors.length, 2);
});
