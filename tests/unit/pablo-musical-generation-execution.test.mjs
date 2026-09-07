import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import { buildMusicalPlanReview } from '../../packages/app/pablo-musical-plan-review.mjs';
import {
  executeReviewedSectionRegeneration,
  prepareReviewedSectionRegeneration,
  resolveSectionTarget,
} from '../../packages/app/pablo-musical-generation-execution.mjs';

function projectWithTake({ twoChoruses = false } = {}) {
  const project = createProject('Regeneration test', 1000);
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus',
    startSeconds: 10,
    endSeconds: 20,
    source: 'test',
    confidence: 1,
  });
  if (twoChoruses) {
    project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
      kind: 'chorus',
      startSeconds: 30,
      endSeconds: 42,
      source: 'test',
      confidence: 1,
    });
  }
  project.songCreation = {
    latestTakeId: 'songtake_connected_1',
    takes: [{
      id: 'songtake_connected_1',
      providerSongId: 'song_provider_abc',
      referenceTrackId: 'track_connected_1',
      durationSeconds: 60,
      bpm: 105,
      key: 'A',
      mode: 'minor',
      genre: 'rnb',
      mood: 'sensual',
      brief: 'R&B moderno e elegante',
      guideLines: [],
      render: { provider: 'elevenmusic', model: 'music_v2' },
    }],
  };
  project.tracks = [{
    id: 'track_connected_1',
    assetId: 'asset_connected_1',
    name: 'Versão conectada · Take 1',
    type: 'audio/mpeg',
    duration: 60,
    offset: 0,
    trimStart: 0,
    trimEnd: 60,
    providerSongId: 'song_provider_abc',
  }];
  project.activeTrackId = 'track_connected_1';
  return project;
}

test('reviewed generation resolves one confirmed chorus and preserves the rest', async () => {
  const project = projectWithTake();
  const review = await buildMusicalPlanReview('abre mais o refrão sem mexer no resto', project);
  assert.equal(review.supported, true);
  assert.equal(review.executionPlan.executor, 'music_generation');
  assert.equal(review.executionPlan.action, 'regenerate_section');

  const prepared = prepareReviewedSectionRegeneration(review, project, { playhead: { ok: false } });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.targetSection.kind, 'chorus');
  assert.equal(prepared.targetSource, 'unique_confirmed_section');
  assert.equal(prepared.providerPlan.sourceSongId, 'song_provider_abc');
  assert.equal(prepared.providerPlan.section.startMs, 10_000);
  assert.equal(prepared.providerPlan.section.endMs, 20_000);
  assert.equal(prepared.preserveUnselected, true);
});

test('multiple choruses fail closed unless a recent playhead resolves exactly one', async () => {
  const project = projectWithTake({ twoChoruses: true });
  const review = await buildMusicalPlanReview('abre mais o refrão sem mexer no resto', project);

  const ambiguous = prepareReviewedSectionRegeneration(review, project, { playhead: { ok: false } });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, 'section_ambiguous');
  assert.equal(ambiguous.matches, 2);

  const resolved = prepareReviewedSectionRegeneration(review, project, {
    playhead: { ok: true, projectId: project.id, seconds: 34, capturedAt: Date.now(), ageMs: 0 },
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.targetSection.startSeconds, 30);
  assert.equal(resolved.targetSource, 'recent_studio_playhead');

  const direct = resolveSectionTarget(project, 'chorus', {
    playhead: { ok: true, seconds: 12 },
    takeDurationSeconds: 60,
  });
  assert.equal(direct.ok, true);
  assert.equal(direct.section.startSeconds, 10);
});

test('review fingerprint rejects a stale continuity song id before provider execution', async () => {
  const project = projectWithTake();
  const review = await buildMusicalPlanReview('abre mais o refrão sem mexer no resto', project);
  const drifted = structuredClone(project);
  drifted.songCreation.takes[0].providerSongId = 'song_provider_newer';
  drifted.tracks[0].providerSongId = 'song_provider_newer';

  const prepared = prepareReviewedSectionRegeneration(review, drifted, { playhead: { ok: false } });
  assert.equal(prepared.ok, false);
  assert.equal(prepared.reason, 'musical_state_drift');
});

test('provider is called only during explicit execution and result is persisted as a new take', async () => {
  const project = projectWithTake();
  const review = await buildMusicalPlanReview('abre mais o refrão sem mexer no resto', project);
  let providerCalls = 0;
  let persistCalls = 0;
  const generatedBlob = new Blob([new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0])], { type: 'audio/mpeg' });

  const client = {
    async regenerateSection(input) {
      providerCalls += 1;
      assert.equal(input.sourceSongId, 'song_provider_abc');
      assert.equal(input.durationMs, 60_000);
      assert.equal(input.section.startMs, 10_000);
      assert.equal(input.section.endMs, 20_000);
      return {
        ok: true,
        blob: generatedBlob,
        type: 'audio/mpeg',
        provider: 'elevenmusic',
        model: 'music_v2',
        songId: 'song_provider_regen_2',
        requestId: 'request_123',
        remoteProjectId: 'remote_project_1',
      };
    },
  };
  const persist = async (sourceProject, plan, result) => {
    persistCalls += 1;
    assert.equal(sourceProject.id, project.id);
    assert.equal(plan.section.id, project.arrangementMap.sections[0].id);
    assert.equal(result.blob, generatedBlob);
    return {
      project: { ...structuredClone(sourceProject), updatedAt: 2000 },
      track: { id: 'track_connected_2' },
      take: { id: 'songtake_connected_2', providerSongId: result.songId },
      takeNumber: 2,
      assetId: 'asset_connected_2',
    };
  };

  assert.equal(providerCalls, 0, 'building the review must not call the provider');
  const result = await executeReviewedSectionRegeneration(review, project, {
    client,
    persist,
    playhead: { ok: false },
  });
  assert.equal(providerCalls, 1);
  assert.equal(persistCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.mutated, true);
  assert.equal(result.takeNumber, 2);
  assert.equal(result.audioBlob, generatedBlob);
  assert.equal(result.preserveUnselected, true);
});
