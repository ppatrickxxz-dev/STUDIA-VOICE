import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PABLOVOICE_SONG_MODEL_SCHEMA,
  VOICE_REPLACEMENT_LOCK,
  attachAuthorizedPersonalVoice,
  attachMasterVocalPerformance,
  ensureSongModelV3,
  songModelReadiness,
  validateVoiceReplacementDelta,
} from '../../packages/app/song-model-v3.mjs';

function generatedProject() {
  return {
    id: 'song-1',
    name: 'Tão eu',
    lyrics: 'Jurando que já me esqueceu',
    activeTrackId: 'master-1',
    tracks: [
      { id: 'master-1', kind: 'ai_music_demo', role: 'reference_mix' },
      { id: 'guide-1', kind: 'guide_melody', role: 'guide_vocal_target' },
    ],
    arrangementMap: { schema: 'test-map' },
    songCreation: {
      latestTakeId: 'take-1',
      takes: [{
        id: 'take-1',
        bpm: 108,
        key: 'F#m',
        genre: 'rnb',
        mood: 'íntimo',
        durationSeconds: 190,
        referenceTrackId: 'master-1',
        guideTrackId: 'guide-1',
        guideType: 'synth_melody',
        sections: [{ id: 'verso_1', label: 'Verso 1', startSeconds: 8, endSeconds: 36 }],
        lyricsSnapshot: 'Jurando que já me esqueceu',
      }],
    },
  };
}

test('v3 song model separates composition, vocal performance, voice identity and mix', () => {
  const project = ensureSongModelV3(generatedProject());
  assert.equal(project.songModel.schema, PABLOVOICE_SONG_MODEL_SCHEMA);
  assert.equal(project.songModel.composition.bpm, 108);
  assert.equal(project.songModel.composition.key, 'F#m');
  assert.equal(project.songModel.composition.lyrics, 'Jurando que já me esqueceu');
  assert.equal(project.songModel.mix.masterTrackId, 'master-1');
  assert.equal(project.songModel.vocalPerformance.guideTrackId, 'guide-1');
  assert.equal(project.songModel.vocalPerformance.status, 'capture_required');
  assert.equal(project.songModel.vocalPerformance.authority, 'legacy_guide_not_authoritative');
  assert.equal(project.songModel.voice.activeProfileId, 'guide');
  assert.equal(project.songModel.voice.replacementStatus, 'needs_master_vocal_performance');
});

test('first song remains usable even while voice replacement still needs the master performance', () => {
  const readiness = songModelReadiness(generatedProject());
  assert.equal(readiness.compositionReady, true);
  assert.equal(readiness.mixReady, true);
  assert.equal(readiness.firstSongReady, true);
  assert.equal(readiness.vocalPerformanceReady, false);
  assert.equal(readiness.voiceReplacementReady, false);
});

test('native performance plus authorized personal voice unlocks identity-only replacement', () => {
  const project = generatedProject();
  attachMasterVocalPerformance(project, {
    sourceTakeId: 'take-1',
    guideTrackId: 'guide-1',
    source: 'native_sung_performance',
    performance: {
      phonemes: ['ʒ', 'u', 'ɾ'],
      notes: [61, 64, 66],
      timing: [0, 0.42, 0.91],
      dynamics: [0.52, 0.68, 0.61],
    },
  });
  attachAuthorizedPersonalVoice(project, { id: 'pablo-main', label: 'Minha voz', authorized: true });
  const readiness = songModelReadiness(project);
  assert.equal(readiness.vocalPerformanceReady, true);
  assert.equal(readiness.voiceReplacementReady, true);
  assert.equal(readiness.firstSongReady, true);
  assert.equal(project.songModel.voice.replacementStatus, 'ready');
});

test('voice replacement lock rejects musical drift and permits only vocal identity changes', () => {
  assert.ok(VOICE_REPLACEMENT_LOCK.immutable.includes('lyrics'));
  assert.ok(VOICE_REPLACEMENT_LOCK.immutable.includes('vocalMelody'));
  assert.ok(VOICE_REPLACEMENT_LOCK.immutable.includes('timing'));
  assert.ok(VOICE_REPLACEMENT_LOCK.immutable.includes('instrumental'));

  const safe = validateVoiceReplacementDelta({ timbre: 'Pablo', resonance: 'natural' });
  assert.equal(safe.ok, true);
  assert.equal(safe.action, 'allow_voice_render');

  const unsafe = validateVoiceReplacementDelta({ timbre: 'Pablo', timing: 'shifted', lyrics: 'changed' });
  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.action, 'reject_render');
  assert.deepEqual(unsafe.violations.sort(), ['lyrics', 'timing']);
});