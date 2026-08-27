import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_CORRECTION_POLICY_V1,
  classifyNoteCorrectionReadiness,
  planNoteCorrections,
} from '../../packages/audio/src/voice/note-correction.mjs';

function point(time, midi, confidence = 0.9) {
  return { time, midi, confidence, voiced: true };
}

test('B06 planner applies one constant median correction per stable note to preserve relative vibrato', () => {
  const result = planNoteCorrections({
    noteEvents: [{ start: 0, end: 0.4, midi: 60, confidence: 0.9 }],
    pitchContour: [
      point(0.00, 59.76),
      point(0.05, 59.82),
      point(0.10, 59.79),
      point(0.15, 59.84),
      point(0.20, 59.77),
      point(0.25, 59.83),
      point(0.30, 59.78),
      point(0.35, 59.81),
    ],
  });
  assert.equal(result.correctionCount, 1);
  assert.equal(result.corrections[0].targetMidi, 60);
  assert.ok(result.corrections[0].correctionCents > 15);
  assert.ok(result.corrections[0].correctionCents < 30);
  assert.equal(result.corrections[0].preserveFormants, true);
  assert.equal(result.corrections[0].preserveRelativeVibrato, true);
});

test('B06 planner leaves expressive notes inside deadband untouched', () => {
  const result = planNoteCorrections({
    noteEvents: [{ start: 0, end: 0.3, midi: 60, confidence: 0.95 }],
    pitchContour: [point(0.0, 59.94), point(0.1, 60.02), point(0.2, 59.99)],
  });
  assert.equal(result.correctionCount, 0);
  assert.equal(result.skipped[0].reason, 'within_deadband');
});

test('B06 planner refuses large correction instead of forcing a robotic jump', () => {
  const result = planNoteCorrections({
    noteEvents: [{ start: 0, end: 0.35, midi: 60, confidence: 0.95 }],
    pitchContour: [point(0.0, 59.48), point(0.1, 59.49), point(0.2, 59.47), point(0.3, 59.50)],
    explicitTargets: [{ start: 0, end: 0.35, targetMidi: 60 }],
  });
  assert.equal(result.correctionCount, 0);
  assert.equal(result.skipped[0].reason, 'correction_exceeds_guard');
});

test('B06 readiness never turns implementation into score without retained benchmark audio', () => {
  const readiness = classifyNoteCorrectionReadiness({
    analyzerPresent: true,
    plannerPresent: true,
    rendererPresent: true,
    formantPreserving: true,
  });
  assert.equal(readiness.implementationReady, true);
  assert.equal(readiness.scorable, false);
  assert.equal(readiness.state, 'implementation_ready_unexecuted');
});

test('B06 policy remains conservative', () => {
  assert.equal(NOTE_CORRECTION_POLICY_V1.preserveFormants, true);
  assert.equal(NOTE_CORRECTION_POLICY_V1.preserveRelativeVibrato, true);
  assert.ok(NOTE_CORRECTION_POLICY_V1.deadbandCents >= 10);
  assert.ok(NOTE_CORRECTION_POLICY_V1.maxCorrectionCents <= 50);
  assert.ok(NOTE_CORRECTION_POLICY_V1.minConfidence >= 0.7);
});
