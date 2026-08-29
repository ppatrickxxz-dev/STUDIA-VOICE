import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import {
  parseSectionVocalDeEsserCommand,
  planSectionVocalDeEsser,
} from '../../packages/core/src/section-vocal-deesser.mjs';

function projectWithChorus() {
  const project = createProject('Adaptive de-esser', 1000);
  const vocal = createTrack({ name: 'Voz', assetId: 'voice', duration: 20, kind: 'recording' });
  project.tracks = [vocal];
  project.activeTrackId = vocal.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 4, endSeconds: 12, source: 'user_manual', confidence: 1,
  });
  return project;
}

test('adaptive mode fails closed when temporal sibilance exists but its spectral band was not measured', () => {
  const project = projectWithChorus();
  const command = parseSectionVocalDeEsserCommand('segura os esses no refrão');
  const result = planSectionVocalDeEsser(project, command, {
    adaptiveFrequencyRequired: true,
    sibilanceEvents: [{ start: 5, end: 5.12, confidence: 0.9, intensity: 0.8 }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'adaptive_sibilance_band_required');
});

test('adaptive mode uses each measured event band and reports the actual section range', () => {
  const project = projectWithChorus();
  const command = parseSectionVocalDeEsserCommand('segura os esses no refrão');
  const result = planSectionVocalDeEsser(project, command, {
    adaptiveFrequencyRequired: true,
    analysisSource: 'local-heuristic-v1',
    sibilanceEvents: [
      { start: 5, end: 5.11, confidence: 0.91, intensity: 0.8, frequencyHz: 6100, spectralConfidence: 0.84 },
      { start: 8, end: 8.12, confidence: 0.87, intensity: 0.72, frequencyHz: 9250, spectralConfidence: 0.78 },
      { start: 15, end: 15.12, confidence: 0.95, intensity: 0.9, frequencyHz: 10000, spectralConfidence: 0.9 },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.frequencyMode, 'adaptive');
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events.map((event) => event.frequencyHz), [6100, 9250]);
  assert.deepEqual(result.frequencyRangeHz, [6100, 9250]);
  assert.ok(result.frequencyHz > 6100 && result.frequencyHz < 9250);
});

test('low spectral confidence is rejected in adaptive mode instead of falling back to 7.2 kHz', () => {
  const project = projectWithChorus();
  const command = parseSectionVocalDeEsserCommand('reduz a sibilância no refrão');
  const result = planSectionVocalDeEsser(project, command, {
    adaptiveFrequencyRequired: true,
    sibilanceEvents: [
      { start: 6, end: 6.1, confidence: 0.9, intensity: 0.9, frequencyHz: 7000, spectralConfidence: 0.03 },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'adaptive_sibilance_band_required');
});
