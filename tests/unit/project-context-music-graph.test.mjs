import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildUnifiedProjectContext } from '../../packages/app/project-context.mjs';

test('project context derives the canonical music graph without persisting a second truth', async () => {
  const project = {
    schemaVersion: 9,
    id: 'context-graph-project',
    name: 'Context Graph',
    preset: 'music',
    activeTrackId: 'voice',
    lyrics: 'linha atual',
    notes: 'mais íntimo no verso',
    tracks: [{
      id: 'voice',
      assetId: 'voice-asset',
      name: 'Voz',
      kind: 'recording',
      duration: 8,
      trimStart: 0,
      trimEnd: 8,
      offset: 0,
      gain: 1,
      pan: 0,
      effects: {},
      regionAutomation: [],
    }],
    arrangementMap: {
      schema: 'pablovoice_arrangement_map_v1',
      updatedAt: 1,
      sections: [{
        id: 'section_verse_0',
        kind: 'verse',
        label: 'Verso',
        startSeconds: 0,
        endSeconds: 8,
        source: 'test',
        timingStatus: 'confirmed',
        confidence: 1,
      }],
    },
    revisions: [],
  };

  const unified = await buildUnifiedProjectContext(project, {
    pendingDraft: { text: 'rascunho', version: 3, targetSection: 'verse' },
  });
  assert.ok(unified);
  assert.equal(unified.graph.schema, 'pablovoice_project_music_graph_v1');
  assert.equal(unified.graph.source.persistedSeparately, false);
  assert.equal(unified.contextPack.graph_schema, 'pablovoice_project_music_graph_v1');
  assert.equal(unified.contextPack.structure.sections[0].id, 'section_verse_0');
  assert.equal(unified.contextPack.tracks[0].role, 'lead-vocal');
  assert.equal(unified.contextPack.pmi.pending_draft.version, 3);
});

test('Pablo conversation feeds the same graph to local PMI and remote Composer/reasoning', async () => {
  const source = await readFile(new URL('../../packages/app/pablo-conversation-ui.mjs', import.meta.url), 'utf8');
  assert.match(source, /buildUnifiedProjectContext/);
  assert.match(source, /musicGraph:\s*unified\?\.graph\s*\|\|\s*null/);
  assert.match(source, /projectContext:\s*unified\?\.contextPack\s*\|\|\s*null/);
  assert.match(source, /music_graph:\s*unified\.contextPack/);
  assert.match(source, /context_pack:\s*await remoteContextPack\(project\)/);
});
