import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildHarmonyPairPlan, classifyHarmonyPairReadiness } from '../../packages/providers/src/kaggle-harmony-client.mjs';

const benchmark = JSON.parse(await readFile(new URL('../../benchmarks/assets/harmony-generation-v2.json', import.meta.url), 'utf8'));

test('B07 v2 benchmark is frozen to the canonical high-low pair plan', () => {
  assert.equal(benchmark.frozen, true);
  assert.deepEqual(benchmark.layers, buildHarmonyPairPlan());
  assert.equal(benchmark.requirements.both_layers_required, true);
  assert.equal(benchmark.requirements.each_layer_requires_acoustic_evidence, true);
  assert.equal(benchmark.requirements.lead_must_remain_unmodified, true);
});

test('B07 v2 starts honestly unvalidated until current high and low evidence exists', () => {
  assert.equal(benchmark.execution_evidence.high, null);
  assert.equal(benchmark.execution_evidence.low, null);
  const readiness = classifyHarmonyPairReadiness();
  assert.equal(readiness.pairValidated, false);
  assert.equal(readiness.promotable, false);
  assert.equal(readiness.state, 'pair_evidence_pending');
});
