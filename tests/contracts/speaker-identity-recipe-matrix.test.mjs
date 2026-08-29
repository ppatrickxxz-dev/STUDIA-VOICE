import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workflow = readFileSync('.github/workflows/speaker-identity-recipe-matrix.yml', 'utf8')

test('recipe matrix compares preserved RVC variants under one frozen identity binding', () => {
  assert.match(workflow, /identity=bad6d443-9ec0-44a6-991a-8044830bae84/)
  assert.match(workflow, /natural=45f2cf70-a2ff-40c6-b544-9e3fc6ad4bae/)
  assert.match(workflow, /smooth=dd9a5bca-37ff-4fe4-ad78-df25b3eea8a9/)
  assert.match(workflow, /THRESHOLD: '0\.8'/)
  assert.match(workflow, /MODEL_REVISION: b8937e0343bf9fc9741ab12b445b86a93a6e3e25/)
  assert.match(workflow, /Freeze one model and reference binding/)
  assert.match(workflow, /PV_REFERENCE_SHA/)
  assert.match(workflow, /PV_VOICE_MODEL_ID/)
  assert.match(workflow, /test "\$CANDIDATE_SHA" != "\$PV_REFERENCE_SHA"/)
  assert.match(workflow, /diagnostic_only:true/)
  assert.doesNotMatch(workflow, /worker_claim/)
  assert.doesNotMatch(workflow, /action:\$action,job_id/)
  assert.doesNotMatch(workflow, /THRESHOLD: '0\.[0-7]/)
})
