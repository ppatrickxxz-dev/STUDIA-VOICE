import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, migrateProject, snapshotProject } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';

test('new projects carry the canonical arrangement map in schema v7', () => {
  const project = createProject('Mapa');
  assert.equal(project.schemaVersion, 7);
  assert.equal(project.arrangementMap?.schema, 'pablovoice_arrangement_map_v1');
  assert.deepEqual(project.arrangementMap?.sections, []);
});

test('legacy projects migrate without inventing section timings', () => {
  const migrated = migrateProject({
    schemaVersion: 5,
    id: 'legacy-project',
    name: 'Legacy',
    tracks: [],
    lyrics: '[Refrão]\nEu volto aqui',
    revisions: [],
  });

  assert.equal(migrated.schemaVersion, 7);
  assert.deepEqual(migrated.arrangementMap.sections, []);
});

test('snapshots retain confirmed arrangement timing and Beat Lab state', () => {
  const project = createProject('Com timeline');
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus',
    startSeconds: 45,
    endSeconds: 61,
    source: 'user_manual',
    confidence: 1,
  });
  project.beatLab = { schema: 'pablovoice_beat_lab_v2', bpm: 120, lanes: [] };

  const saved = snapshotProject(project, 'Refrão marcado na timeline');
  const revision = saved.revisions.at(-1);
  assert.equal(revision.label, 'Refrão marcado na timeline');
  assert.equal(revision.arrangementMap.sections[0].startSeconds, 45);
  assert.equal(revision.arrangementMap.sections[0].timingStatus, 'confirmed');
  assert.equal(revision.beatLab.schema, 'pablovoice_beat_lab_v2');
});
