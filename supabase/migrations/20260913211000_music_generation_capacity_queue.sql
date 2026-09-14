create or replace function public.claim_music_generation_capacity_job(
  p_job_id uuid,
  p_ttl_seconds integer default 1800
) returns boolean
language plpgsql
security definer
set search_path to 'public','private','pg_catalog'
as $function$
declare
  v_status text;
  v_holder uuid;
  v_ttl integer := greatest(120, least(coalesce(p_ttl_seconds,1800),3600));
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  select status
    into v_status
    from public.render_jobs
   where id=p_job_id
     and job_type='music_generation'
     and finished_at is null
   for update;

  if v_status is distinct from 'queued_capacity' then
    return false;
  end if;

  insert into private.music_generation_dispatch_lease(
    lease_key,holder_job_id,acquired_at,heartbeat_at,expires_at
  )
  values(
    'kaggle_shared_music',p_job_id,now(),now(),now()+make_interval(secs=>v_ttl)
  )
  on conflict(lease_key) do update
    set holder_job_id=excluded.holder_job_id,
        acquired_at=case
          when private.music_generation_dispatch_lease.holder_job_id=excluded.holder_job_id
            then private.music_generation_dispatch_lease.acquired_at
          else now()
        end,
        heartbeat_at=now(),
        expires_at=now()+make_interval(secs=>v_ttl)
    where private.music_generation_dispatch_lease.holder_job_id=excluded.holder_job_id
       or private.music_generation_dispatch_lease.expires_at <= now()
  returning holder_job_id into v_holder;

  if v_holder is distinct from p_job_id then
    return false;
  end if;

  update public.render_jobs
     set status='dispatched',
         progress=greatest(progress,12),
         current_stage='gpu_dispatch',
         heartbeat_at=now(),
         next_retry_at=null,
         error_code=null,
         error_message=null,
         technical_error=null,
         human_message='A vaga da GPU foi reservada. Iniciando a criação musical.'
   where id=p_job_id
     and job_type='music_generation'
     and status='queued_capacity'
     and finished_at is null;

  return found;
end $function$;

revoke all on function public.claim_music_generation_capacity_job(uuid,integer) from public, anon, authenticated;
grant execute on function public.claim_music_generation_capacity_job(uuid,integer) to service_role;

create index if not exists render_jobs_music_capacity_queue_idx
  on public.render_jobs(created_at,id)
  where job_type='music_generation'
    and status='queued_capacity'
    and finished_at is null;
