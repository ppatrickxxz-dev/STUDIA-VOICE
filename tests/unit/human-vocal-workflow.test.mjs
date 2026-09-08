import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import {
  attachHumanVocalTake,
  createSectionRecordingIntent,
  GUIDE_REPLACEMENT_SOURCE,
  vocalWorkflowProgress,
} from '../../packages/core/src/human-vocal-workflow.mjs';
import { normalizeSingerProfile } from '../../packages/app/singer-profile.mjs';

test('normalizes a singer profile without requiring a cloned identity', () => {
  const profile = normalizeSingerProfile({ voiceType: 'masculina', lowMidi: 45, highMidi: 69, tone: 'quente', language: 'pt-BR' });
  assert.equal(profile.voiceType, 'masculina');
  assert.equal(profile.lowMidi, 45);
  assert.equal(profile.highMidi, 69);
  assert.equal(profile.tone, 'quente');
  assert.equal('voiceModelId' in profile, false);
});

test('aligns a human section take and non-destructively replaces its guide range', () => {
  const project = createProject('Álbum');
  const guide = createTrack({ name: 'Guia', assetId: 'guide_asset', duration: 30, kind: 'guide_melody' });
  project.tracks.push(guide);
  project.songCreation = { latestTakeId: 'take_1', takes: [{ id: 'take_1', guideTrackId: guide.id, sections: [{ id: 'verso_1', label: 'Verso 1', startSeconds: 4, endSeconds: 12 }], guideLines: [{ sectionId: 'verso_1', text: 'eu canto aqui' }] }] };
  const intent = createSectionRecordingIntent({ project, takeId: 'take_1', sectionId: 'verso_1' });
  const vocal = createTrack({ name: 'Voz', assetId: 'voice_asset', duration: 8, kind: 'recording' });
  const result = attachHumanVocalTake(project, vocal, intent, 123);
  assert.equal(vocal.role, 'human_lead_take');
  assert.equal(vocal.offset, 4);
  assert.equal(result.section.status, 'replaced');
  assert.deepEqual(guide.regionAutomation.map(({ kind, startSeconds, endSeconds, gainDb, source }) => ({ kind, startSeconds, endSeconds, gainDb, source })), [
    { kind: 'gain', startSeconds: 4, endSeconds: 12, gainDb: -60, source: GUIDE_REPLACEMENT_SOURCE },
  ]);
  assert.equal(vocalWorkflowProgress(project).percent, 100);
});

test('keeps the guide outside a partial human take', () => {
  const project = createProject('Álbum');
  const guide = createTrack({ name: 'Guia', assetId: 'guide_asset', duration: 30, kind: 'guide_melody' });
  project.tracks.push(guide);
  project.songCreation = { latestTakeId: 'take_1', takes: [{ id: 'take_1', guideTrackId: guide.id, sections: [{ id: 'refrão', label: 'Refrão', startSeconds: 10, endSeconds: 20 }], guideLines: [] }] };
  const intent = createSectionRecordingIntent({ project, takeId: 'take_1', sectionId: 'refrão' });
  const vocal = createTrack({ name: 'Voz', assetId: 'voice_asset', duration: 4, kind: 'recording' });
  const result = attachHumanVocalTake(project, vocal, intent);
  assert.equal(result.section.status, 'partial');
  assert.equal(guide.regionAutomation[0].endSeconds, 14);
  assert.equal(vocalWorkflowProgress(project).partial, 1);
});
