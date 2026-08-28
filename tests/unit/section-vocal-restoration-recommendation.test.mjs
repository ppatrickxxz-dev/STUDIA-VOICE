import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import {
  parseSectionVocalRestorationRecommendationCommand,
  planSectionVocalRestorationRecommendation,
  PABLO_VOCAL_RESTORATION_RECOMMENDATION_SOURCE,
} from '../../packages/core/src/section-vocal-restoration-recommendation.mjs';

function projectWithVocal() {
  const project = createProject('Restauração explicável', 1000);
  const vocal = createTrack({ name: 'Voz principal', assetId: 'voice', duration: 30, kind: 'recording' });
  project.tracks = [vocal];
  project.activeTrackId = vocal.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 8, endSeconds: 16, source: 'user_manual', confidence: 1,
  });
  return project;
}

function analysis({ guardReady = true, actionableNoise = true, actionableReverb = true } = {}) {
  return {
    voice: {
      eventDetection: { source: 'provided' },
      breathEvents: [], sibilanceEvents: [], plosiveEvents: [], clickEvents: [], peakEvents: [],
      noiseEvents: [{
        start: 8.3, end: 9.5, noiseKind: 'hum', frequencyHz: 60,
        confidence: 0.9, stationarity: 0.92, rmsDb: -48,
      }],
      restoration: {
        source: 'local-vocal-restoration-profile-v1',
        timbreGuard: {
          source: 'bounded-vocal-timbre-guard-v1',
          pitchPreserving: true,
          formantPreserving: guardReady,
          voicedMarginDb: 10,
          maxNoiseReductionDb: 5.5,
          maxDereverbAmount: 0.2,
        },
        windows: [{
          start: 8.2, end: 9.4,
          noise: {
            actionable: actionableNoise,
            confidence: 0.86,
            noiseFloorDb: -43,
            voicedLevelDb: -20,
            snrDb: 23,
            thresholdDb: -38,
            voicedMarginDb: 18,
            reductionDb: 3.2,
            quietFrameCount: 7,
            voicedFrameCount: 9,
            source: 'vocal-noise-floor-v1',
          },
          reverb: {
            actionable: actionableReverb,
            delayConsistent: actionableReverb,
            confidence: 0.84,
            reflectionDelayMs: 36,
            amount: 0.14,
            dampingHz: 5200,
            correlation: 0.49,
            prominence: 0.12,
            source: 'vocal-early-reflection-v1',
          },
        }],
      },
    },
  };
}

test('parses recommendation questions but does not hijack direct cleanup commands', () => {
  const denoise = parseSectionVocalRestorationRecommendationCommand('Pablo, vale a pena tirar o ruído do refrão?');
  assert.equal(denoise.section, 'chorus');
  assert.equal(denoise.scope, 'denoise');
  const reverb = parseSectionVocalRestorationRecommendationCommand('é seguro tirar o reverb do segundo refrão?');
  assert.equal(reverb.scope, 'dereverb');
  assert.equal(reverb.occurrence, 2);
  assert.equal(parseSectionVocalRestorationRecommendationCommand('limpa minha voz no refrão'), null);
  assert.equal(parseSectionVocalRestorationRecommendationCommand('tira o ruído do refrão'), null);
});

test('recommends only what the canonical cleanup would apply and exposes the same timbre guard', () => {
  const project = projectWithVocal();
  const command = parseSectionVocalRestorationRecommendationCommand('vale a pena restaurar a voz do refrão com ruído e reverb?');
  const result = planSectionVocalRestorationRecommendation(project, command, { analysis: analysis() });
  assert.equal(result.ok, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.source, PABLO_VOCAL_RESTORATION_RECOMMENDATION_SOURCE);
  assert.equal(result.guard.ready, true);
  assert.equal(result.denoise.status, 'recommended');
  assert.equal(result.denoise.wouldApply, true);
  assert.equal(result.denoise.snrDb, 23);
  assert.equal(result.denoise.voicedMarginDb, 18);
  assert.equal(result.dereverb.status, 'recommended');
  assert.equal(result.dereverb.wouldApply, true);
  assert.equal(result.dereverb.reflectionDelayMs, 36);
  assert.equal(result.hum.count, 1);
  assert.deepEqual(result.hum.frequenciesHz, [60]);
  assert.equal(result.hum.note, 'diagnostic_only_no_automatic_notch');
});

test('fails the recommendation closed when the canonical timbre guard is incomplete', () => {
  const project = projectWithVocal();
  const command = parseSectionVocalRestorationRecommendationCommand('é seguro restaurar minha voz no refrão?');
  const result = planSectionVocalRestorationRecommendation(project, command, { analysis: analysis({ guardReady: false }) });
  assert.equal(result.ok, true);
  assert.equal(result.guard.ready, false);
  assert.equal(result.denoise.status, 'guard_blocked');
  assert.equal(result.dereverb.status, 'guard_blocked');
  assert.equal(result.recommendation, 'not_recommended');
});

test('reports measured-but-rejected evidence without promoting it to an edit recommendation', () => {
  const project = projectWithVocal();
  const command = parseSectionVocalRestorationRecommendationCommand('recomenda denoise no refrão?');
  const result = planSectionVocalRestorationRecommendation(project, command, {
    analysis: analysis({ actionableNoise: false, actionableReverb: false }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.denoise.status, 'not_recommended');
  assert.equal(result.denoise.wouldApply, false);
  assert.equal(result.denoise.evidenceCount, 1);
  assert.equal(result.recommendation, 'not_recommended');
});

test('recommendation is pure read-only planning and missing acoustic analysis fails closed', () => {
  const project = projectWithVocal();
  const before = JSON.stringify(project);
  const command = parseSectionVocalRestorationRecommendationCommand('acha que devo tirar o ruído do refrão?');
  const result = planSectionVocalRestorationRecommendation(project, command, { analysis: analysis() });
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(project), before);
  assert.equal(project.revisions.length, JSON.parse(before).revisions.length);
  assert.equal(project.tracks[0].regionAutomation.length, 0);
  const missing = planSectionVocalRestorationRecommendation(project, command);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'restoration_analysis_required');
});
