create table if not exists private.music_generation_dispatch_lease (
  lease_key text primary key,
  holder_job_id uuid not null,
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null
);

revoke all on private.music_generation_dispatch_lease from public, anon, authenticated;

create or replace function public.acquire_music_generation_dispatch_lease(
  p_job_id uuid,
  p_ttl_seconds integer default 1800
) returns boolean
language plpgsql
security definer
set search_path to 'public','private','pg_catalog'
as $function$
declare
  v_holder uuid;
  v_ttl integer := greatest(120, least(coalesce(p_ttl_seconds,1800),3600));
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  insert into private.music_generation_dispatch_lease(lease_key,holder_job_id,acquired_at,heartbeat_at,expires_at)
  values('kaggle_shared_music',p_job_id,now(),now(),now()+make_interval(secs=>v_ttl))
  on conflict(lease_key) do update
    set holder_job_id=excluded.holder_job_id,
        acquired_at=case when private.music_generation_dispatch_lease.holder_job_id=excluded.holder_job_id then private.music_generation_dispatch_lease.acquired_at else now() end,
        heartbeat_at=now(),
        expires_at=now()+make_interval(secs=>v_ttl)
    where private.music_generation_dispatch_lease.holder_job_id=excluded.holder_job_id
       or private.music_generation_dispatch_lease.expires_at <= now()
  returning holder_job_id into v_holder;

  return v_holder=p_job_id;
end $function$;

create or replace function public.touch_music_generation_dispatch_lease(
  p_job_id uuid,
  p_ttl_seconds integer default 1800
) returns boolean
language plpgsql
security definer
set search_path to 'public','private','pg_catalog'
as $function$
declare
  v_count integer;
  v_ttl integer := greatest(120, least(coalesce(p_ttl_seconds,1800),3600));
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'service_role_required';
  end if;
  update private.music_generation_dispatch_lease
     set heartbeat_at=now(), expires_at=now()+make_interval(secs=>v_ttl)
   where lease_key='kaggle_shared_music' and holder_job_id=p_job_id;
  get diagnostics v_count=row_count;
  return v_count=1;
end $function$;

create or replace function public.release_music_generation_dispatch_lease(
  p_job_id uuid
) returns boolean
language plpgsql
security definer
set search_path to 'public','private','pg_catalog'
as $function$
declare
  v_count integer;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'service_role_required';
  end if;
  delete from private.music_generation_dispatch_lease
   where lease_key='kaggle_shared_music' and holder_job_id=p_job_id;
  get diagnostics v_count=row_count;
  return v_count=1;
end $function$;

revoke all on function public.acquire_music_generation_dispatch_lease(uuid,integer) from public, anon, authenticated;
revoke all on function public.touch_music_generation_dispatch_lease(uuid,integer) from public, anon, authenticated;
revoke all on function public.release_music_generation_dispatch_lease(uuid) from public, anon, authenticated;
grant execute on function public.acquire_music_generation_dispatch_lease(uuid,integer) to service_role;
grant execute on function public.touch_music_generation_dispatch_lease(uuid,integer) to service_role;
grant execute on function public.release_music_generation_dispatch_lease(uuid) to service_role;
