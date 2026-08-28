import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import { PABLO_SECTION_VOCAL_CLEANUP_SOURCES } from '../../packages/core/src/section-vocal-cleanup.mjs';
import {
  applySelectiveVocalRestoration,
  parseSelectiveVocalRestorationCommand,
  planSelectiveVocalRestoration,
  SELECTIVE_VOCAL_RESTORATION_MODES,
} from '../../packages/core/src/section-vocal-restoration-selective.mjs';

function projectWithVocal() {
  const project = createProject('Selective restoration', 1000);
  const vocal = createTrack({ name: 'Voz principal', assetId: 'voice', duration: 30, kind: 'recording' });
  project.tracks = [vocal];
  project.activeTrackId = vocal.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 8, endSeconds: 16, source: 'user_manual', confidence: 1,
  });
  return { project, vocal, section: project.arrangementMap.sections[0] };
}

function restorationAnalysis() {
  return {
    voice: {
      eventDetection: { source: 'provided' },
      breathEvents: [], sibilanceEvents: [], plosiveEvents: [], clickEvents: [], peakEvents: [],
      restoration: {
        source: 'local-vocal-restoration-profile-v1',
        timbreGuard: {
          pitchPreserving: true, formantPreserving: true, voicedMarginDb: 10,
          maxNoiseReductionDb: 5.5, maxDereverbAmount: 0.2, source: 'bounded-vocal-timbre-guard-v1',
        },
        windows: [{
          start: 8.2, end: 9.4,
          noise: {
            actionable: true, confidence: 0.86, noiseFloorDb: -43, voicedLevelDb: -20,
            snrDb: 23, thresholdDb: -38, voicedMarginDb: 18, reductionDb: 3.2,
            quietFrameCount: 7, voicedFrameCount: 9, source: 'vocal-noise-floor-v1',
          },
          reverb: {
            actionable: true, delayConsistent: true, confidence: 0.84, reflectionDelayMs: 36,
            amount: 0.14, dampingHz: 5200, correlation: 0.49, prominence: 0.12,
            source: 'vocal-early-reflection-v1',
          },
        }],
      },
    },
  };
}

test('parses direct denoise and de-reverb commands but yields recommendation questions to read-only flow', () => {
  const denoise = parseSelectiveVocalRestorationCommand('aplica só o denoise no refrão');
  assert.equal(denoise.mode, SELECTIVE_VOCAL_RESTORATION_MODES.DENOISE);
  const dereverb = parseSelectiveVocalRestorationCommand('faz só o de-reverb no segundo refrão');
  assert.equal(dereverb.mode, SELECTIVE_VOCAL_RESTORATION_MODES.DEREVERB);
  assert.equal(dereverb.occurrence, 2);
  assert.equal(parseSelectiveVocalRestorationCommand('vale a pena tirar o ruído do refrão?'), null);
  assert.equal(parseSelectiveVocalRestorationCommand('limpa minha voz no refrão'), null);
});

test('denoise planning reuses the canonical v9 cleanup event and excludes de-reverb', () => {
  const { project } = projectWithVocal();
  const command = parseSelectiveVocalRestorationCommand('aplica só o denoise no refrão');
  const result = planSelectiveVocalRestoration(project, command, { analysis: restorationAnalysis() });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'denoise');
  assert.equal(result.source, PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DENOISE);
  assert.ok(result.events.length >= 1);
  assert.ok(result.events.every((event) => event.kind === 'vocal_denoise' && event.timbreProtected === true));
  assert.equal(result.events.some((event) => event.kind === 'vocal_dereverb'), false);
});

test('selective denoise replaces only denoise for that section and preserves de-reverb plus manual edits', () => {
  const { project, vocal, section } = projectWithVocal();
  vocal.regionAutomation.push(
    { id: `manual:${section.id}`, kind: 'gain', startSeconds: 8, endSeconds: 16, gainDb: 0.3, confidence: 1, source: 'user_manual', enabled: true },
    { id: `${PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DEREVERB}:${vocal.id}:1:${section.id}`, kind: 'vocal_dereverb', startSeconds: 8.2, endSeconds: 9.4, reflectionDelayMs: 30, amount: 0.1, dampingHz: 5200, correlation: 0.4, prominence: 0.1, confidence: 0.8, timbreProtected: true, guardSource: 'bounded-vocal-timbre-guard-v1', source: PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DEREVERB, enabled: true },
  );
  const command = parseSelectiveVocalRestorationCommand('reduz só o ruído no refrão');
  const result = applySelectiveVocalRestoration(project, command, { analysis: restorationAnalysis(), now: 2000 });
  assert.equal(result.ok, true);
  assert.equal(result.mutated, true);
  const sources = result.track.regionAutomation.map((event) => event.source);
  assert.ok(sources.includes('user_manual'));
  assert.ok(sources.includes(PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DEREVERB));
  assert.ok(sources.includes(PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DENOISE));
});

test('de-reverb selective path refuses weak reflection evidence without falling back to another module', () => {
  const { project } = projectWithVocal();
  const weak = restorationAnalysis();
  weak.voice.restoration.windows[0].reverb.actionable = false;
  weak.voice.restoration.windows[0].reverb.delayConsistent = false;
  const command = parseSelectiveVocalRestorationCommand('tira só o reverb no refrão');
  const result = planSelectiveVocalRestoration(project, command, { analysis: weak });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_safe_reverb_profile');
});
