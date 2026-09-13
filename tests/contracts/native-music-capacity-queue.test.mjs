import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../../supabase/migrations/20260913211000_music_generation_capacity_queue.sql', import.meta.url), 'utf8');

test('music capacity queue claims one durable queued job before reserving shared GPU', () => {
  assert.match(migration, /claim_music_generation_capacity_job/);
  assert.match(migration, /job_type='music_generation'/);
  assert.match(migration, /status='queued_capacity'/);
  assert.match(migration, /for update/);
  assert.match(migration, /private\.music_generation_dispatch_lease/);
  assert.match(migration, /expires_at <= now\(\)/);
  assert.match(migration, /status='dispatched'/);
  assert.match(migration, /current_stage='gpu_dispatch'/);
  assert.match(migration, /next_retry_at=null/);
});

test('music capacity queue claim is service-role only and cannot become a public job mutation RPC', () => {
  assert.match(migration, /auth\.role\(\).*service_role/s);
  assert.match(migration, /service_role_required/);
  assert.match(migration, /revoke all on function public\.claim_music_generation_capacity_job\(uuid,integer\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.claim_music_generation_capacity_job\(uuid,integer\) to service_role/);
  assert.doesNotMatch(migration, /grant execute[^\n]+authenticated/);
});

test('queued music gets a dedicated partial index without weakening the existing lease serialization', () => {
  assert.match(migration, /render_jobs_music_capacity_queue_idx/);
  assert.match(migration, /on public\.render_jobs\(created_at,id\)/);
  assert.match(migration, /where job_type='music_generation'[\s\S]*status='queued_capacity'[\s\S]*finished_at is null/);
  assert.doesNotMatch(migration, /delete from private\.music_generation_dispatch_lease/);
});
