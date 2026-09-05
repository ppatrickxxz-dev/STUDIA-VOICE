import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const fnPath = path.join(root, 'supabase/functions/diagnose-once-v56/index.ts')
const workflowPath = path.join(root, '.github/workflows/materialize-frozen-release-evidence.yml')

const fn = fs.readFileSync(fnPath, 'utf8')
const workflow = fs.readFileSync(workflowPath, 'utf8')

const SOURCE_SHA = '852890854c128a4ee222505a910c3dc01465579d34ed6b49b5019aec8f16ad83'
const PROVIDER_SHA = '85b6341bac253f85a48506400baed3dd2bbf212ac172af6d0fa8e47d35642b95'

test('release evidence ingest is GitHub OIDC fail-closed on main and exact workflow', () => {
  assert.match(fn, /OIDC_AUDIENCE\s*=\s*'pablovoice-signing'/)
  assert.match(fn, /OIDC_REPOSITORY\s*=\s*'ppatrickxxz-dev\/STUDIA-VOICE'/)
  assert.match(fn, /OIDC_REF\s*=\s*'refs\/heads\/main'/)
  assert.match(fn, /materialize-frozen-release-evidence\.yml@refs\/heads\/main/)
  assert.match(fn, /payload\.workflow_ref !== OIDC_WORKFLOW_REF/)
  assert.match(fn, /crypto\.subtle\.verify/)
  assert.doesNotMatch(fn, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][^'"]+['"]/)
})

test('only the two frozen vocal artifacts are allowlisted', () => {
  assert.match(fn, new RegExp(SOURCE_SHA))
  assert.match(fn, new RegExp(PROVIDER_SHA))
  assert.match(fn, /expected_size:\s*13_909_412/)
  assert.match(fn, /expected_size:\s*15_335_120/)
  assert.match(fn, /sha256_not_release_frozen/)
})

test('materialization verifies ordered chunks, exact byte count and integral sha before storage upload', () => {
  const chunkCheck = fn.indexOf('transport_chunk_count_mismatch')
  const indexCheck = fn.indexOf('transport_chunk_index_gap')
  const sizeCheck = fn.indexOf('materialized_size_mismatch')
  const hashCheck = fn.indexOf('materialized_sha256_mismatch')
  const upload = fn.indexOf('.upload(spec.storage_path, bytes')
  assert.ok(chunkCheck > -1)
  assert.ok(indexCheck > chunkCheck)
  assert.ok(sizeCheck > indexCheck)
  assert.ok(hashCheck > sizeCheck)
  assert.ok(upload > hashCheck)
})

test('asset persistence is idempotent and records runtime-addressable provenance', () => {
  assert.match(fn, /\.eq\('sha256', expectedSha256\)/)
  assert.match(fn, /idempotent: true/)
  assert.match(fn, /runtime_addressable: true/)
  assert.match(fn, /verified_sha256: true/)
  assert.match(fn, /binary_transport_session_id/)
  assert.match(fn, /source_commit_sha/)
  assert.match(fn, /benchmark_role/)
})

test('frozen provider input remains bound to canonical source and deterministic derivation', () => {
  assert.match(fn, /canonical_source_sha256 = '852890854c128a4ee222505a910c3dc01465579d34ed6b49b5019aec8f16ad83'/)
  assert.match(fn, /ffmpeg -hide_banner -loglevel error -i voz\.wav -vn -ac 1 -ar 44100 -c:a pcm_s16le/)
})

test('workflow requests OIDC and asserts both exact hashes and byte sizes', () => {
  assert.match(workflow, /id-token:\s*write/)
  assert.match(workflow, /audience=pablovoice-signing/)
  assert.match(workflow, new RegExp(SOURCE_SHA))
  assert.match(workflow, new RegExp(PROVIDER_SHA))
  assert.match(workflow, /13909412/)
  assert.match(workflow, /15335120/)
  assert.match(workflow, /diagnose-once-v56/)
})
