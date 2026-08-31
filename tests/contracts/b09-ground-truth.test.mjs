import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const workflow = read('.github/workflows/b09-ground-truth.yml')
const validator = read('benchmarks/validate_b09_ground_truth.py')

test('B09 prospective gate uses controlled independent references and the real standalone provider', () => {
  assert.match(workflow, /CLEAN_VOCAL_SHA256: 071274b45b51f40bb3a23fdda839bcf95cb9641edf060b69d343b43324430969/)
  assert.match(workflow, /SYNTHETIC_INSTRUMENT_SEED: '20260831'/)
  assert.match(workflow, /compute-kaggle-v54/)
  assert.match(workflow, /controlled-mixture\.wav/)
  assert.match(workflow, /reference-vocal\.wav/)
  assert.match(workflow, /reference-instrumental\.wav/)
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY|service_role/i)
  assert.doesNotMatch(workflow, /1148fc38-e2ed-4925-9dec-f843c02163d2|9bef8c45-40af-4134-b816-4d135cb574e8/)
})

test('B09 promotion thresholds are frozen prospectively and include leakage, SI-SDR, reconstruction, polarity and duration', () => {
  assert.match(validator, /frozen \*before the first physical execution\*/)
  assert.match(validator, /"min_vocal_si_sdr_db": 6\.0/)
  assert.match(validator, /"min_instrumental_si_sdr_db": 6\.0/)
  assert.match(validator, /"min_vocal_target_to_interference_db": 10\.0/)
  assert.match(validator, /"min_instrumental_target_to_interference_db": 10\.0/)
  assert.match(validator, /"min_reconstruction_snr_db": 20\.0/)
  assert.match(validator, /"min_reconstruction_polarity_correlation": 0\.95/)
  assert.match(validator, /"max_duration_divergence_seconds": 0\.15/)
  assert.match(validator, /never_lower_after_observing_result/)
})

test('historical B09 evidence is not retroactively promoted', () => {
  assert.match(validator, /historical B09 run had no[\s\S]*independent ground truth/)
  assert.match(validator, /prospective_controlled_ground_truth_v1/)
  assert.doesNotMatch(validator, /not_decided_by_this_tool[\s\S]*pass/)
})
