import test from 'node:test';
import assert from 'node:assert/strict';
import { planBreathEdits, summarizeBreathPlan } from '../packages/audio/src/voice/breath-intelligence.mjs';
import { analyzeAlignment } from '../packages/audio/src/voice/alignment-intelligence.mjs';

function analysis(assetId, onsetTimes = [], phase = 0.9) {
  return {
    assetId,
    voice: { breathEvents: [] },
    signal: {
      onsets: onsetTimes.map(timeSeconds => ({ timeSeconds })),
      phaseCorrelation: { value: phase }
    }
  };
}

test('breath plan keeps low-confidence events manual and high-confidence events automatic', () => {
  const source = analysis('voice');
  source.voice.breathEvents = [
    { id: 'b1', startSeconds: 1, endSeconds: 1.2, confidence: 0.92 },
    { id: 'b2', startSeconds: 2, endSeconds: 2.2, confidence: 0.6 },
    { id: 'b3', startSeconds: 3, endSeconds: 3.2, confidence: 0.2 },
  ];
  const plan = planBreathEdits(source, { mode: 'soften' });
  assert.equal(plan[0].automatic, true);
  assert.equal(plan[0].reductionDb, -6);
  assert.equal(plan[1].decision, 'suggest');
  assert.equal(plan[2].decision, 'manual');
  assert.deepEqual(summarizeBreathPlan(plan), { total: 3, automatic: 1, auto: 1, suggest: 1, manual: 1, unknown: 0 });
});

test('alignment detects a small stable offset and recommends inverse correction', () => {
  const reference = analysis('main', [0.5, 1.0, 1.5, 2.0], 0.95);
  const target = analysis('double', [0.53, 1.03, 1.53, 2.03], 0.95);
  const result = analyzeAlignment(reference, target);
  assert.ok(Math.abs(result.offsetMs - 30) < 0.001);
  assert.ok(Math.abs(result.correctionMs + 30) < 0.001);
  assert.equal(result.decision, 'auto');
  assert.equal(result.recommendedAction, 'shift');
});

test('alignment does not auto-apply weak evidence', () => {
  const reference = analysis('main', [1.0], 0.2);
  const target = analysis('double', [], 0.2);
  const result = analyzeAlignment(reference, target);
  assert.equal(result.automatic, false);
  assert.equal(result.recommendedAction, 'inspect');
});
