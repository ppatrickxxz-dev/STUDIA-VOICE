import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workflow = readFileSync('.github/workflows/speaker-identity-trusted-worker.yml', 'utf8')

test('trusted speaker identity persists a legitimate false result without weakening the gate', () => {
  assert.doesNotMatch(workflow, /jq -er '\.passed'/)
  assert.match(workflow, /PASSED="\$\(jq -r '\.passed'/)
  assert.match(workflow, /true\|false\) ;;/)
  assert.match(workflow, /THRESHOLD: '0\.8'/)
  assert.match(workflow, /MODEL_REVISION: b8937e0343bf9fc9741ab12b445b86a93a6e3e25/)
  assert.match(workflow, /--argjson passed "\$PASSED"/)
})
