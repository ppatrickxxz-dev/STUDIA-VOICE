import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MUSICAL_INTENT_SCHEMA,
  PROJECT_MUSIC_GRAPH_SCHEMA,
  buildProjectMusicGraph,
  musicGraphContextPack,
  routeMusicalIntent,
} from '../../packages/music-intelligence/src/index.mjs';
import { compileMusicalOperation } from '../../packages/app/musical-operation-compiler.mjs';
import { reshapeInstrumentNotes } from '../../packages/app/pablo-instrument-operations.mjs';

function projectFixture() {
  return {
    schemaVersion: 9,
    id: 'project-graph-test',
    name: 'Music Graph Test',
    preset: 'music',
    activeTrackId: 'bass-track',
    lyrics: 'linha um\nlinha dois',
    notes: 'manter o refrão maior',
    arrangementMap: {
      schema: 'pablovoice_arrangement_map_v1',
      updatedAt: 1,
      sections: [
        { id: 'section_verse_0', kind: 'verse', label: 'Verso', startSeconds: 0, endSeconds: 4, timingStatus: 'confirmed', confidence: 1, source: 'test' },
        { id: 'section_chorus_4000', kind: 'chorus', label: 'Refrão', startSeconds: 4, endSeconds: 8, timingStatus: 'confirmed', confidence: 1, source: 'test' },
        { id: 'section_outro_8000', kind: 'outro', label: 'Outro', startSeconds: 8, endSeconds: 12, timingStatus: 'confirmed', confidence: 1, source: 'test' },
      ],
    },
    tracks: [
      {
        id: 'bass-track', assetId: 'bass-asset', name: 'Baixo', kind: 'generated_instrumental', role: 'instrumental',
        duration: 12, trimStart: 0, trimEnd: 12, offset: 0, gain: 1, pan: 0, muted: false, solo: false,
        effects: {}, regionAutomation: [], sampleRate: 48000, channels: 2,
      },
      {
        id: 'voice-track', assetId: 'voice-asset', name: 'Voz principal', kind: 'recording',
        duration: 12, trimStart: 0, trimEnd: 12, offset: 0, gain: 1, pan: 0, muted: false, solo: false,
        effects: {}, regionAutomation: [], sampleRate: 48000, channels: 1,
      },
    ],
    beatLab: { bpm: 120, bars: 6, swing: 0.08, steps: [1, 0, 1, 0] },
    instrumentLab: {
      preset: 'bass', bpm: 120, notes: [
        { midi: 40, velocity: 90, start_beat: 0, duration_beats: 1 },
        { midi: 43, velocity: 90, start_beat: 4, duration_beats: 1 },
        { midi: 45, velocity: 90, start_beat: 8, duration_beats: 1 },
        { midi: 47, velocity: 90, start_beat: 12, duration_beats: 1 },
        { midi: 48, velocity: 90, start_beat: 16, duration_beats: 1 },
      ],
    },
    revisions: [],
    songCreation: {
      schema: 'pablovoice_song_creation_v1',
      latestTakeId: 'take-1',
      takes: [{ id: 'take-1', brief: 'R&B', genre: 'rnb', mood: 'intimo', bpm: 120, key: 'A', mode: 'minor', durationSeconds: 12 }],
    },
  };
}

test('project music graph converges project structure, tracks, labs and take context', () => {
  const graph = buildProjectMusicGraph(projectFixture(), {
    pendingDraft: { text: 'novo refrão', version: 2, targetSection: 'chorus' },
  });
  assert.equal(graph.schema, PROJECT_MUSIC_GRAPH_SCHEMA);
  assert.equal(graph.structure.sections.length, 3);
  assert.equal(graph.tracks.length, 2);
  assert.equal(graph.tracks[1].role, 'lead-vocal');
  assert.equal(graph.labs.instrument.preset, 'bass');
  assert.equal(graph.songCreation.latestTake.id, 'take-1');
  assert.equal(graph.writing.pendingDraft.version, 2);

  const pack = musicGraphContextPack(graph);
  assert.equal(pack.graph_schema, PROJECT_MUSIC_GRAPH_SCHEMA);
  assert.equal(pack.project.track_count, 2);
  assert.equal(pack.structure.sections[1].kind, 'chorus');
  assert.equal(pack.song_creation.genre, 'rnb');
});

test('musical router resolves a requested section against the canonical graph', () => {
  const project = projectFixture();
  const intent = {
    schema: MUSICAL_INTENT_SCHEMA,
    supported: true,
    scope: { target: 'bass', section: 'chorus', preserveUnselected: true },
    deltas: { humanize: 0.6 },
    style: { positive: [], negative: [], eraHints: [] },
  };
  const route = routeMusicalIntent(intent, { project, projectId: project.id, trackId: 'bass-track' });
  assert.equal(route.context.musicGraphSchema, PROJECT_MUSIC_GRAPH_SCHEMA);
  assert.equal(route.scope.sectionId, 'section_chorus_4000');
  assert.equal(route.scope.sectionStartSeconds, 4);
  assert.equal(route.scope.sectionEndSeconds, 8);

  const plan = compileMusicalOperation(route, project);
  assert.equal(plan.ok, true);
  assert.equal(plan.executor, 'instrument_lab');
  assert.equal(plan.args.sectionId, 'section_chorus_4000');
  assert.equal(plan.args.preserveOutsideSection, true);
});

test('instrument reshape changes only notes inside a graph-resolved section', () => {
  const notes = projectFixture().instrumentLab.notes;
  const output = reshapeInstrumentNotes(notes, {
    humanize: 0.8,
    syncopation: 0.5,
    durationVariation: 0.6,
    scope: { startBeat: 8, endBeat: 16 },
  });

  assert.deepEqual(output[0], notes[0]);
  assert.deepEqual(output[1], notes[1]);
  assert.deepEqual(output[4], notes[4]);
  assert.equal(output.length, notes.length);
  assert.deepEqual(output.map((note) => note.midi), notes.map((note) => note.midi));
  assert.notDeepEqual(output[2], notes[2]);
  assert.notDeepEqual(output[3], notes[3]);
});
