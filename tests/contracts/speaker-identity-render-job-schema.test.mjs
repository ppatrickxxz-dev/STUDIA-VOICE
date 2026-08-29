import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtime = await readFile(new URL('../../supabase/functions/test-voice-v71-identity-once/index.ts', import.meta.url), 'utf8');

test('speaker identity dispatch only writes columns present in the canonical render_jobs schema', () => {
  assert.match(runtime, /job_type:\s*'speaker_identity_attestation'/);
  assert.match(runtime, /status:\s*'waiting_trusted_worker'/);
  assert.match(runtime, /input_asset_ids:\s*\[candidate\.id, ref\.asset_id\]/);
  assert.match(runtime, /output_asset_ids:\s*\[\]/);
  assert.doesNotMatch(runtime, /\bretry_count\s*:/);
  assert.doesNotMatch(runtime, /\bmax_retries\s*:/);
});
