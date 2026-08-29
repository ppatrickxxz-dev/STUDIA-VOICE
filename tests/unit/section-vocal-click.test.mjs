import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';
import {
  applySectionVocalClick,
  parseSectionVocalClickCommand,
  planSectionVocalClick,
  PABLO_SECTION_VOCAL_CLICK_SOURCE,
} from '../../packages/core/src/section-vocal-click.mjs';

function projectWithVocal() {
  const project = createProject('Clicks', 1000);
  const vocal = createTrack({ name: 'Voz principal', assetId: 'voice', duration: 30, kind: 'recording' });
  const support = createTrack({ name: 'Instrumental', assetId: 'base', duration: 30, kind: 'audio' });
  project.tracks = [vocal, support];
  project.activeTrackId = support.id;
  project.arrangementMap = upsertConfirmedSection(project.arrangementMap, {
    kind: 'chorus', startSeconds: 8, endSeconds: 16, source: 'user_manual', confidence: 1,
  });
  return { project, vocal, support };
}

const evidence = [
  { start: 9, end: 9.012, confidence: 0.91, intensity: 0.85, differenceRatio: 1.3, lowFrequencyRatio: 0.22, source: 'vocal-click-impulse-v1' },
  { start: 20, end: 20.01, confidence: 0.96, intensity: 1, differenceRatio: 1.5, lowFrequencyRatio: 0.18, source: 'vocal-click-impulse-v1' },
];

test('parses everyday PT-BR click language and blocks unsafe reduction', () => {
  const parsed = parseSectionVocalClickCommand('tira os estalos de boca da minha voz só no refrão');
  assert.equal(parsed.section, 'chorus');
  assert.equal(parsed.blocked, false);
  const click = parseSectionVocalClickCommand('segura os clicks da minha voz no refrão');
  assert.equal(click.section, 'chorus');
  const unsafe = parseSectionVocalClickCommand('tira os cliques da minha voz 10 dB no refrão');
  assert.equal(unsafe.blocked, true);
  assert.equal(unsafe.reason, 'click_out_of_safe_range');
});

test('creates only short in-section gain micro-windows from measured click evidence', () => {
  const { project } = projectWithVocal();
  const command = parseSectionVocalClickCommand('tira os estalos de boca da minha voz só no refrão');
  const plan = planSectionVocalClick(project, command, { clickEvents: evidence, analysisSource: 'local-heuristic-v1' });
  assert.equal(plan.ok, true);
  assert.equal(plan.events.length, 1);
  const event = plan.events[0];
  assert.equal(event.kind, 'gain');
  assert.equal(event.source, PABLO_SECTION_VOCAL_CLICK_SOURCE);
  assert.ok(event.gainDb < 0);
  assert.ok(event.startSeconds >= 8 && event.endSeconds <= 16);
  assert.ok(event.endSeconds - event.startSeconds < 0.06);
});

test('rejects weak, low-frequency, long, or missing click evidence instead of attenuating whole section', () => {
  const { project } = projectWithVocal();
  const command = parseSectionVocalClickCommand('tira os estalos de boca da minha voz no refrão');
  const weak = planSectionVocalClick(project, command, {
    clickEvents: [
      { start: 9, end: 9.01, confidence: 0.5, intensity: 0.9, differenceRatio: 1.2, lowFrequencyRatio: 0.2 },
      { start: 10, end: 10.01, confidence: 0.9, intensity: 0.9, differenceRatio: 1.2, lowFrequencyRatio: 0.8 },
      { start: 11, end: 11.2, confidence: 0.9, intensity: 0.9, differenceRatio: 1.2, lowFrequencyRatio: 0.2 },
    ],
  });
  assert.equal(weak.ok, false);
  assert.equal(weak.reason, 'no_click_evidence');
  const missing = planSectionVocalClick(project, command, { clickEvents: null });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'click_analysis_required');
});

test('click treatment is idempotent and preserves manual/support automation', () => {
  const { project, vocal, support } = projectWithVocal();
  const sectionId = project.arrangementMap.sections[0].id;
  vocal.regionAutomation.push({ id: `manual:${sectionId}`, kind: 'gain', startSeconds: 8, endSeconds: 16, gainDb: 1, source: 'user_manual', enabled: true });
  support.regionAutomation.push({ id: `support:${sectionId}`, kind: 'gain', startSeconds: 8, endSeconds: 16, gainDb: -1, source: 'user_manual', enabled: true });
  const command = parseSectionVocalClickCommand('tira os estalos de boca da minha voz no refrão');
  const first = applySectionVocalClick(project, command, { clickEvents: evidence, now: 2000 });
  const second = applySectionVocalClick(first.project, command, { clickEvents: evidence, now: 3000 });
  const savedVocal = second.project.tracks.find((track) => track.id === vocal.id);
  assert.equal(savedVocal.regionAutomation.filter((event) => event.source === PABLO_SECTION_VOCAL_CLICK_SOURCE).length, 1);
  assert.equal(savedVocal.regionAutomation.filter((event) => event.source === 'user_manual').length, 1);
  assert.equal(second.project.tracks.find((track) => track.id === support.id).regionAutomation.length, 1);
  assert.equal(second.replacedExisting, true);
});
