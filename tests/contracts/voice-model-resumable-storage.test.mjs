import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const worker = readFileSync(new URL('../../supabase/functions/kaggle-voice-train-worker-v1/index.ts', import.meta.url), 'utf8')

test('large candidate-model parts use signed TUS with exact 6 MiB chunks', () => {
  assert.match(worker, /TUS_CHUNK_SIZE=6\*1024\*1024/)
  assert.match(worker, /\.storage\.supabase\.co\/storage\/v1\/upload\/resumable\/sign/)
  assert.doesNotMatch(worker, /endpoint=f'https:\/\/{project_ref}\.storage\.supabase\.co\/storage\/v1\/upload\/resumable'/)
  assert.match(worker, /'Tus-Resumable':'1\.0\.0'/)
  assert.match(worker, /'x-signature':token/)
  assert.match(worker, /'Upload-Length':str\(size\)/)
  assert.match(worker, /'Upload-Metadata':metadata/)
  assert.match(worker, /'Content-Type':'application\/offset\+octet-stream'/)
})

test('resumable upload binds canonical bucket object and cache metadata', () => {
  assert.match(worker, /'bucketName '\+tus_meta\(bucket\)/)
  assert.match(worker, /'objectName '\+tus_meta\(path\)/)
  assert.match(worker, /'contentType '\+tus_meta\(content_type\)/)
  assert.match(worker, /'cacheControl '\+tus_meta\('3600'\)/)
})

test('every TUS chunk must advance the server offset exactly or fail closed', () => {
  assert.match(worker, /expected_offset=offset\+len\(chunk\)/)
  assert.match(worker, /if next_offset!=expected_offset:/)
  assert.match(worker, /raise RuntimeError\(f'resumable upload offset mismatch:/)
  assert.match(worker, /if offset!=size:/)
  assert.match(worker, /raise RuntimeError\(f'resumable upload incomplete:/)
})

test('existing four-part artifact contract stays unchanged and only transport route changes', () => {
  assert.match(worker, /part_size=24\*1024\*1024/)
  assert.match(worker, /if count<1 or count>len\(T\['outputs'\]\['parts'\]\):/)
  assert.match(worker, /if Path\(file_path\)\.stat\(\)\.st_size>TUS_CHUNK_SIZE:/)
  assert.match(worker, /upload_to_signed_url\(path=path,token=token,file=f/)
  assert.match(worker, /worker_version':'voice-train-v1-budget100-exact-checkpoint-recovery-applio-config-init-tus6m-signed-route(?:-index-multipart)?'/)
})
