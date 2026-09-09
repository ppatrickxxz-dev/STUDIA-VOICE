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
import { createPabloVoiceAudioToolRuntime } from '../../packages/providers/src/pablovoice-audio-tools.mjs';

function projectFixture() {
  return {
    schemaVersion: 9,
    id: 'specialists-project',
    name: 'Specialists',
    activeTrackId: 'lead',
    arrangementMap: {
      schema: 'pablovoice_arrangement_map_v1',
      sections: [
        { id: 'verse-1', kind: 'verse', label: 'Verso', startSeconds: 0, endSeconds: 4, timingStatus: 'confirmed', confidence: 1 },
        { id: 'chorus-1', kind: 'chorus', label: 'Refrão', startSeconds: 4, endSeconds: 8, timingStatus: 'confirmed', confidence: 1 },
      ],
    },
    tracks: [
      { id: 'lead', assetId: 'lead-asset', name: 'Voz principal', kind: 'recording', duration: 8, trimStart: 0, trimEnd: 8, offset: 0, gain: 1, pan: 0, effects: {}, regionAutomation: [] },
      { id: 'stem-vocal', assetId: 'stem-vocal-asset', name: 'Stem · Vocal', kind: 'audio', stemType: 'vocal', duration: 8, trimStart: 0, trimEnd: 8, offset: 0, gain: 1, pan: 0, effects: {}, regionAutomation: [], renderJobId: 'job-1', remoteAssetId: 'remote-vocal', remoteProjectId: 'remote-project', remoteSha256: 'a'.repeat(64), provider: 'kaggle', engine: 'Demucs', model: 'htdemucs' },
      { id: 'stem-inst', assetId: 'stem-inst-asset', name: 'Stem · Instrumental', kind: 'audio', stemType: 'instrumental', duration: 8, trimStart: 0, trimEnd: 8, offset: 0, gain: 1, pan: 0, effects: {}, regionAutomation: [], renderJobId: 'job-1', remoteAssetId: 'remote-inst', remoteProjectId: 'remote-project', remoteSha256: 'b'.repeat(64), provider: 'kaggle', engine: 'Demucs', model: 'htdemucs' },
    ],
    beatLab: { bpm: 120, bars: 4, steps: [1, 0, 1, 0] },
    instrumentLab: { preset: 'bass', bpm: 120, notes: [{ midi: 40, velocity: 90, start_beat: 0, duration_beats: 1 }] },
    revisions: [],
    songCreation: {
      schema: 'pablovoice_song_creation_v1',
      latestTakeId: 'take-2',
      takes: [
        { id: 'take-1', providerSongId: 'song-1', durationSeconds: 8, createdAt: 1 },
        { id: 'take-2', providerSongId: 'song-2', derivedFromTakeId: 'take-1', referenceTrackId: 'lead', durationSeconds: 8, createdAt: 2 },
      ],
    },
  };
}

test('music graph exposes stem provenance, take lineage and only supplied acoustic evidence', () => {
  const project = projectFixture();
  const evidence = new Map([['lead-asset', {
    schemaVersion: 2,
    assetId: 'lead-asset',
    music: { bpm: { value: 120, confidence: 0.9 } },
    voice: { pitchHz: { value: 220, confidence: 0.9 } },
    signal: { loudnessLufs: -16, peak: 0.8, clipping: 0, onsets: [1, 2] },
    confidence: { voice: 0.91, pitch: 0.9 },
    validity: { complete: true },
  }]]);
  const graph = buildProjectMusicGraph(project, { evidenceByTrack: evidence });

  assert.equal(graph.schema, PROJECT_MUSIC_GRAPH_SCHEMA);
  assert.equal(graph.tracks.find((track) => track.id === 'stem-vocal').role, 'stem-vocal');
  assert.equal(graph.tracks.find((track) => track.id === 'stem-inst').role, 'stem-instrumental');
  assert.equal(graph.songCreation.lineage.length, 2);
  assert.equal(graph.songCreation.lineage[1].parentTakeId, 'take-1');
  assert.equal(graph.evidence.tracks.length, 1);
  assert.equal(graph.evidence.tracks[0].trackId, 'lead');

  const pack = musicGraphContextPack(graph);
  assert.equal(pack.tracks.find((track) => track.id === 'stem-vocal').provenance.render_job_id, 'job-1');
  assert.equal(pack.tracks.find((track) => track.id === 'stem-vocal').provenance.sha256, 'a'.repeat(64));
  assert.equal(pack.song_creation.lineage[1].parentTakeId, 'take-1');
  assert.equal(pack.evidence.tracks[0].asset_id, 'lead-asset');
});

test('audio specialist validates asset ownership against the same project graph', async () => {
  const graph = buildProjectMusicGraph(projectFixture());
  const runtime = createPabloVoiceAudioToolRuntime({
    getMusicGraph: async () => graph,
    getAnalysis: async (assetId) => assetId === 'lead-asset' ? {
      assetId,
      music: { bpm: { value: 120, confidence: 0.9 } },
      signal: { loudnessLufs: -16 },
      voice: { pitchHz: { value: 220, confidence: 0.9 } },
      confidence: { pitch: 0.9 },
      validity: { complete: true },
    } : null,
    getMixState: async () => null,
  });

  const valid = await runtime('inspect_audio', { projectId: 'specialists-project', assetId: 'lead-asset' });
  assert.equal(valid.ok, true);
  assert.equal(valid.data.musicGraph.schema, PROJECT_MUSIC_GRAPH_SCHEMA);
  assert.equal(valid.data.musicGraph.projectId, 'specialists-project');

  const crossProject = await runtime('inspect_audio', { projectId: 'specialists-project', assetId: 'alien-asset' });
  assert.equal(crossProject.ok, false);
  assert.equal(crossProject.reason, 'asset_outside_music_graph');
});

test('section-scoped Beat Lab request fails closed instead of mutating the global pattern', () => {
  const project = projectFixture();
  const intent = {
    schema: MUSICAL_INTENT_SCHEMA,
    supported: true,
    scope: { target: 'drums', section: 'chorus', preserveUnselected: true },
    deltas: { humanize: 0.7 },
    style: { positive: [], negative: [], eraHints: [] },
  };
  const route = routeMusicalIntent(intent, { project, projectId: project.id });
  assert.equal(route.scope.sectionId, 'chorus-1');
  const plan = compileMusicalOperation(route, project);
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, 'beat_section_local_executor_required');
  assert.equal(project.beatLab.steps.join(','), '1,0,1,0');
});

test('ambiguous section remains unresolved until occurrence or playhead disambiguates it', () => {
  const project = projectFixture();
  project.arrangementMap.sections.push({ id: 'chorus-2', kind: 'chorus', label: 'Refrão', startSeconds: 8, endSeconds: 12, timingStatus: 'confirmed', confidence: 1 });
  const intent = {
    schema: MUSICAL_INTENT_SCHEMA,
    supported: true,
    scope: { target: 'bass', section: 'chorus', preserveUnselected: true },
    deltas: { humanize: 0.5 },
    style: { positive: [], negative: [], eraHints: [] },
  };
  const route = routeMusicalIntent(intent, { project, projectId: project.id });
  assert.equal(route.scope.sectionAmbiguous, true);
  assert.equal(route.scope.sectionId, null);
  const plan = compileMusicalOperation(route, project);
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, 'instrument_section_mapping_unavailable');
});
