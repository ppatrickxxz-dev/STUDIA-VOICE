import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import {
  applySectionVocalCleanup,
  parseSectionVocalCleanupCommand,
  planSectionVocalCleanup,
  PABLO_SECTION_VOCAL_CLEANUP_SOURCES,
  PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST,
} from '../../packages/core/src/section-vocal-cleanup.mjs';

function projectWithVocal() {
  const project = createProject('Cleanup', 1000);
  const vocal = createTrack({ name: 'Voz principal', assetId: 'voice', duration: 30, kind: 'recording' });
  const support = createTrack({ name: 'Instrumental', assetId: 'base', duration: 30, kind: 'audio' });
  project.tracks = [vocal, support];
  project.activeTrackId = support.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 8, endSeconds: 16, source: 'user_manual', confidence: 1,
  });
  return { project, vocal, support };
}

function richAnalysis() {
  return {
    voice: {
      eventDetection: { source: 'local-heuristic-v1' },
      breathEvents: [
        { start: 9, end: 9.18, confidence: 0.9, intensity: 0.9 },
        { start: 20, end: 20.2, confidence: 0.95, intensity: 1 },
      ],
      sibilanceEvents: [
        { start: 10, end: 10.1, confidence: 0.88, intensity: 0.85, frequencyHz: 9100, spectralConfidence: 0.62, spectralSource: 'local-sibilance-spectrum-v1' },
      ],
      plosiveEvents: [
        { start: 11, end: 11.06, confidence: 0.91, intensity: 0.9, frequencyHz: 120, spectralConfidence: 0.72, spectralSource: 'plosive-lowband-goertzel-refined-v1' },
      ],
      clickEvents: [
        { start: 11.7, end: 11.712, confidence: 0.91, intensity: 0.82, differenceRatio: 1.3, lowFrequencyRatio: 0.2, source: 'vocal-click-impulse-v1' },
      ],
      peakEvents: [
        { start: 12, end: 12.05, confidence: 0.9, intensity: 0.92, peak: 0.7, transientRise: 2.7, source: 'vocal-peak-transient-v1' },
        { start: 13, end: 13.05, confidence: 0.83, intensity: 0.8, peak: 0.61, transientRise: 2.3, source: 'vocal-peak-transient-v1' },
      ],
    },
  };
}

test('parses simple cleanup language but requires a named section', () => {
  const parsed = parseSectionVocalCleanupCommand('Pablo, limpa minha voz só no refrão');
  assert.equal(parsed.section, 'chorus');
  assert.equal(parsed.intensity, 'balanced');
  const light = parseSectionVocalCleanupCommand('faz uma limpeza leve na voz no verso');
  assert.equal(light.section, 'verse');
  assert.equal(light.intensity, 'light');
  assert.equal(parseSectionVocalCleanupCommand('melhora minha voz'), null);
});

test('orchestrates only evidence-backed cleanup modules in the confirmed section', () => {
  const { project } = projectWithVocal();
  const command = parseSectionVocalCleanupCommand('limpa minha voz no refrão');
  const plan = planSectionVocalCleanup(project, command, { analysis: richAnalysis() });
  assert.equal(plan.ok, true);
  assert.equal(plan.appliedModuleCount, 5);
  assert.equal(plan.modules.breath.applied, true);
  assert.equal(plan.modules.deesser.applied, true);
  assert.equal(plan.modules.plosive.applied, true);
  assert.equal(plan.modules.click.applied, true);
  assert.equal(plan.modules.dynamics.applied, true);
  const sources = new Set(plan.events.map((event) => event.source));
  for (const source of PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST) assert.ok(sources.has(source), `missing cleanup source ${source}`);
  assert.ok(plan.events.every((event) => event.startSeconds >= 8 && event.endSeconds <= 16));
  assert.ok(plan.events.some((event) => event.source === PABLO_SECTION_VOCAL_CLEANUP_SOURCES.BREATH && event.kind === 'gain' && event.gainDb === -5));
  assert.ok(plan.events.some((event) => event.source === PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DEESSER && event.kind === 'peaking_eq' && event.frequencyHz === 9100));
  assert.ok(plan.events.some((event) => event.source === PABLO_SECTION_VOCAL_CLEANUP_SOURCES.PLOSIVE && event.kind === 'peaking_eq' && event.frequencyHz === 120));
  assert.ok(plan.events.some((event) => event.source === PABLO_SECTION_VOCAL_CLEANUP_SOURCES.CLICK && event.kind === 'gain' && event.gainDb < 0));
  assert.ok(plan.events.some((event) => event.source === PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DYNAMICS && event.kind === 'compressor' && event.ratio === 2));
});

test('skips unsupported modules and fails closed when there is no cleanup evidence at all', () => {
  const { project } = projectWithVocal();
  const command = parseSectionVocalCleanupCommand('limpa minha voz no refrão');
  const noEvidence = {
    voice: {
      eventDetection: { source: 'provided' },
      breathEvents: [], sibilanceEvents: [], plosiveEvents: [], clickEvents: [], peakEvents: [],
    },
  };
  const plan = planSectionVocalCleanup(project, command, { analysis: noEvidence });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, 'no_cleanup_evidence');
  assert.equal(plan.modules.breath.applied, false);
  assert.equal(plan.modules.deesser.applied, false);
  assert.equal(plan.modules.plosive.applied, false);
  assert.equal(plan.modules.click.applied, false);
  assert.equal(plan.modules.dynamics.applied, false);
});

test('cleanup remains idempotent and preserves independent Pablo/manual edits', () => {
  const { project, vocal, support } = projectWithVocal();
  const sectionId = project.arrangementMap.sections[0].id;
  vocal.regionAutomation.push(
    { id: `manual:${sectionId}`, kind: 'peaking_eq', startSeconds: 8, endSeconds: 16, gainDb: 1, frequencyHz: 900, q: 1, source: 'user_manual', enabled: true },
    { id: `pablo_section_vocal_deesser:${vocal.id}:legacy:${sectionId}`, kind: 'peaking_eq', startSeconds: 10, endSeconds: 10.1, gainDb: -2, frequencyHz: 8500, q: 1.5, source: 'pablo_section_vocal_deesser', enabled: true },
    { id: `pablo_section_vocal_click:${vocal.id}:legacy:${sectionId}`, kind: 'gain', startSeconds: 11.7, endSeconds: 11.72, gainDb: -4, source: 'pablo_section_vocal_click', enabled: true },
  );
  const command = parseSectionVocalCleanupCommand('limpa minha voz no refrão');
  const first = applySectionVocalCleanup(project, command, { analysis: richAnalysis(), now: 2000 });
  assert.equal(first.ok, true);
  assert.equal(first.project.tracks.find((track) => track.id === support.id).regionAutomation.length, 0);
  const second = applySectionVocalCleanup(first.project, command, { analysis: richAnalysis(), now: 3000 });
  const events = second.project.tracks.find((track) => track.id === vocal.id).regionAutomation;
  assert.equal(events.filter((event) => event.source === 'user_manual').length, 1);
  assert.equal(events.filter((event) => event.source === 'pablo_section_vocal_deesser').length, 1);
  assert.equal(events.filter((event) => event.source === 'pablo_section_vocal_click').length, 1);
  const cleanup = events.filter((event) => PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST.includes(event.source));
  assert.equal(cleanup.length, second.events.length);
  assert.equal(second.replacedExisting, true);
  assert.equal(second.replacedCount, first.events.length);
});

test('light cleanup reduces intervention without changing evidence gates', () => {
  const { project } = projectWithVocal();
  const command = parseSectionVocalCleanupCommand('faz uma limpeza leve na voz no refrão');
  const plan = planSectionVocalCleanup(project, command, { analysis: richAnalysis() });
  assert.equal(plan.ok, true);
  const breath = plan.events.find((event) => event.source === PABLO_SECTION_VOCAL_CLEANUP_SOURCES.BREATH);
  const click = plan.events.find((event) => event.source === PABLO_SECTION_VOCAL_CLEANUP_SOURCES.CLICK);
  const dynamics = plan.events.find((event) => event.source === PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DYNAMICS);
  assert.equal(breath.gainDb, -3.5);
  assert.ok(click.gainDb >= -3);
  assert.equal(dynamics.ratio, 1.7);
  assert.equal(dynamics.thresholdDb, -15);
});
