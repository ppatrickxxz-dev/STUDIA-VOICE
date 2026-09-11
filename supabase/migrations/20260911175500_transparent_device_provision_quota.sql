create table if not exists public.transparent_device_provision_quota (
  network_hash text not null,
  bucket_date date not null default (timezone('utc', now()))::date,
  provision_count integer not null default 0 check (provision_count between 0 and 8),
  updated_at timestamptz not null default now(),
  primary key (network_hash, bucket_date),
  check (network_hash ~ '^[0-9a-f]{64}$')
);

alter table public.transparent_device_provision_quota enable row level security;
revoke all on table public.transparent_device_provision_quota from public, anon, authenticated;

create or replace function public.consume_transparent_device_quota(
  p_network_hash text,
  p_limit integer default 4
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_network_hash !~ '^[0-9a-f]{64}$' or p_limit < 1 or p_limit > 8 then
    return false;
  end if;

  insert into public.transparent_device_provision_quota (
    network_hash,
    bucket_date,
    provision_count,
    updated_at
  ) values (
    p_network_hash,
    (timezone('utc', now()))::date,
    1,
    now()
  )
  on conflict (network_hash, bucket_date) do update
    set provision_count = public.transparent_device_provision_quota.provision_count + 1,
        updated_at = now()
    where public.transparent_device_provision_quota.provision_count < p_limit
  returning provision_count into v_count;

  return v_count is not null;
end;
$$;

revoke all on function public.consume_transparent_device_quota(text, integer) from public, anon, authenticated;
grant execute on function public.consume_transparent_device_quota(text, integer) to service_role;
