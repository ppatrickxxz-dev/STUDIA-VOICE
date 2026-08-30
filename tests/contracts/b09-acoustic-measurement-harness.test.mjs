import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const harness = await readFile(new URL('../../benchmarks/validate_b09.py', import.meta.url), 'utf8');

test('B09 harness measures the frozen metric families without inventing thresholds', () => {
  assert.match(harness, /stem_isolation/);
  assert.match(harness, /leakage/);
  assert.match(harness, /phase_integrity/);
  assert.match(harness, /reconstruction_similarity/);
  assert.match(harness, /duration_divergence_seconds/);
  assert.match(harness, /clipping/);
  assert.match(harness, /silence_ratio/);
  assert.doesNotMatch(harness, /hard_gate_pass\s*[=:]\s*True/);
  assert.doesNotMatch(harness, /B09_STANDALONE_STEMS_PASSED/);
  assert.match(harness, /promotion_state.*not_decided_by_this_tool/);
});

test('B09 harness verifies retained byte identity before measurement', () => {
  assert.match(harness, /sha256_file/);
  assert.match(harness, /source_sha256_mismatch/);
  assert.match(harness, /vocal_sha256_mismatch/);
  assert.match(harness, /instrumental_sha256_mismatch/);
});

test('leakage remains explicitly unmeasured without independent ground truth', () => {
  assert.match(harness, /independent_ground_truth_reference_not_supplied/);
  assert.match(harness, /status.*not_measured/);
});

test('private audio is consumed by runtime path and only JSON evidence is emitted', () => {
  assert.match(harness, /--source/);
  assert.match(harness, /--vocal/);
  assert.match(harness, /--instrumental/);
  assert.match(harness, /--output/);
  assert.match(harness, /write_text\(json\.dumps/);
});
