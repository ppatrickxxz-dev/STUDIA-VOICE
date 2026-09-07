import test from 'node:test';
import assert from 'node:assert/strict';
import { latestEditableSongTake, resolveSectionRegeneration } from '../../packages/app/music-section-regeneration.mjs';
import { executeSectionRegenerationRuntime } from '../../packages/app/section-regeneration-runtime.mjs';
import { persistSectionRegeneration } from '../../packages/app/music-section-regeneration-persistence.mjs';

function baseProject() {
  return {
    id: 'local-project',
    name: 'Repaint test',
    tracks: [{ id: 'track-native', assetId: 'local-source', name: 'PabloVoice GPU', type: 'audio/flac', duration: 30 }],
    activeTrackId: 'track-native',
    arrangementMap: {
      sections: [
        { id: 'verse-1', kind: 'verse', label: 'Verso 1', startSeconds: 0, endSeconds: 10, timingStatus: 'confirmed', confidence: 1 },
        { id: 'chorus-1', kind: 'chorus', label: 'Refrão', startSeconds: 10, endSeconds: 20, timingStatus: 'confirmed', confidence: 1 },
        { id: 'outro', kind: 'outro', label: 'Outro', startSeconds: 20, endSeconds: 30, timingStatus: 'confirmed', confidence: 1 },
      ],
    },
    songCreation: {
      latestTakeId: 'take-legacy-newer',
      takes: [
        {
          id: 'take-native', createdAt: 10, durationSeconds: 30, bpm: 120, key: 'A', mode: 'minor',
          referenceTrackId: 'track-native', remoteProjectId: 'remote-project', remoteAssetId: 'native-asset-id',
          brief: 'R&B escuro', genre: 'rnb', mood: 'íntimo',
          guideLines: [{ text: 'fica aqui', startBeat: 22 }],
          render: { provider: 'kaggle', model: 'acestep-v15-turbo' },
        },
        {
          id: 'take-legacy-newer', createdAt: 20, durationSeconds: 30, bpm: 120,
          referenceTrackId: 'track-legacy', providerSongId: 'legacy-song-id',
          render: { provider: 'elevenmusic', model: 'music_v2' },
        },
      ],
    },
  };
}

test('native editable take is preferred over a newer legacy song-id take', () => {
  const project = baseProject();
  assert.equal(latestEditableSongTake(project).id, 'take-native');
  const plan = resolveSectionRegeneration(project, 'chorus-1', { direction: 'abre mais o refrão' });
  assert.equal(plan.ok, true);
  assert.equal(plan.sourceProvider, 'pablovoice_native_repaint');
  assert.equal(plan.sourceAssetId, 'native-asset-id');
  assert.equal(plan.sourceSongId, null);
  assert.equal(plan.section.startMs, 10_000);
  assert.equal(plan.section.endMs, 20_000);
  assert.ok(plan.section.positiveStyles.includes('abre mais o refrão'));
});

test('legacy song-id remains compatible when no native source asset exists', () => {
  const project = baseProject();
  project.songCreation.takes = [project.songCreation.takes[1]];
  const plan = resolveSectionRegeneration(project, 'chorus-1', { direction: 'mais energia' });
  assert.equal(plan.ok, true);
  assert.equal(plan.sourceProvider, 'elevenmusic_song_id');
  assert.equal(plan.sourceAssetId, null);
  assert.equal(plan.sourceSongId, 'legacy-song-id');
});

test('provider-neutral runtime routes native plan to repaintSection only', async () => {
  const project = baseProject();
  const plan = resolveSectionRegeneration(project, 'chorus-1', { direction: 'mais synths' });
  let nativeCalls = 0;
  let legacyCalls = 0;
  const result = await executeSectionRegenerationRuntime(project, plan, {
    native: {
      async repaintSection(args) {
        nativeCalls += 1;
        assert.equal(args.sourceAssetId, 'native-asset-id');
        assert.equal(args.section.startMs, 10_000);
        return { ok: true, blob: new Blob(['native']), provider: 'kaggle' };
      },
    },
    legacy: { async regenerateSection() { legacyCalls += 1; return { ok: true }; } },
  });
  assert.equal(result.ok, true);
  assert.equal(nativeCalls, 1);
  assert.equal(legacyCalls, 0);
});

test('provider-neutral runtime still routes old project to song-id regeneration', async () => {
  const project = baseProject();
  project.songCreation.takes = [project.songCreation.takes[1]];
  const plan = resolveSectionRegeneration(project, 'chorus-1', { direction: 'mais synths' });
  let calls = 0;
  const result = await executeSectionRegenerationRuntime(project, plan, {
    legacy: {
      async regenerateSection(args) {
        calls += 1;
        assert.equal(args.sourceSongId, 'legacy-song-id');
        return { ok: true, blob: new Blob(['legacy']), provider: 'elevenmusic' };
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});

test('native repaint persistence records new remote asset, SHA, derivation and preservation proof', async () => {
  const project = baseProject();
  const plan = resolveSectionRegeneration(project, 'chorus-1', { direction: 'abre mais' });
  let savedAudio = null;
  let savedProject = null;
  const result = {
    ok: true,
    blob: new Blob(['verified repaint']),
    type: 'audio/flac',
    provider: 'kaggle',
    model: 'acestep-v15-turbo',
    modelRevision: 'ca1e85fe9430179831e6bc6be790c332190a3866',
    requestId: 'repaint-job',
    remoteProjectId: 'remote-project',
    source: 'pablovoice_native_music_repaint_v1',
    sha256: 'a'.repeat(64),
    asset: { id: 'new-remote-asset', duration_seconds: 30, sample_rate: 48000, channels: 2, sha256: 'a'.repeat(64) },
    job: { proof: { preserved_outside_verified: true } },
  };
  const persisted = await persistSectionRegeneration(project, plan, result, {
    saveAudio: async (asset) => { savedAudio = asset; return asset; },
    save: async (next) => { savedProject = next; return next; },
  });
  assert.equal(savedAudio.type, 'audio/flac');
  assert.match(savedAudio.name, /\.flac$/);
  assert.equal(persisted.track.remoteAssetId, 'new-remote-asset');
  assert.equal(persisted.track.remoteSha256, 'a'.repeat(64));
  assert.equal(persisted.track.source, 'pablovoice_native_music_repaint_v1');
  assert.equal(persisted.take.derivedFromTakeId, 'take-native');
  assert.equal(persisted.take.remoteAssetId, 'new-remote-asset');
  assert.equal(persisted.take.regeneration.sourceAssetId, 'native-asset-id');
  assert.equal(persisted.take.regeneration.preservedOutsideVerified, true);
  assert.equal(savedProject.songCreation.latestTakeId, persisted.take.id);
});
