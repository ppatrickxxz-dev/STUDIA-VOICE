import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workflow = readFileSync('.github/workflows/speaker-identity-trusted-worker.yml', 'utf8')

test('trusted ECAPA scorer loads normalized wavs without TorchCodec-dependent torchaudio.load', () => {
  assert.match(workflow, /import soundfile as sf/)
  assert.match(workflow, /sf\.read\('\/tmp\/pv-candidate\.wav'/)
  assert.match(workflow, /sf\.read\('\/tmp\/pv-reference\.wav'/)
  assert.doesNotMatch(workflow, /torchaudio\.load\(/)
  assert.match(workflow, /THRESHOLD: '0\.8'/)
  assert.match(workflow, /MODEL_REVISION: b8937e0343bf9fc9741ab12b445b86a93a6e3e25/)
})
