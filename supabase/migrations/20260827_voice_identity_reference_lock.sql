create table if not exists public.voice_identity_references (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  voice_model_id uuid not null references public.voice_models(id) on delete cascade,
  asset_id uuid not null references public.audio_assets(id) on delete cascade,
  source_sha256 text not null,
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_identity_reference_sha256 check (source_sha256 ~ '^[0-9a-f]{64}$')
);

create unique index if not exists voice_identity_reference_one_active_per_model
  on public.voice_identity_references(user_id, voice_model_id)
  where is_active;

create index if not exists voice_identity_reference_asset_idx
  on public.voice_identity_references(asset_id);

alter table public.voice_identity_references enable row level security;

create or replace function public.validate_voice_identity_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  model_owner uuid;
  asset_owner uuid;
  asset_kind text;
  asset_sha text;
begin
  select user_id into model_owner
  from public.voice_models
  where id = new.voice_model_id;

  select user_id, kind, lower(sha256)
    into asset_owner, asset_kind, asset_sha
  from public.audio_assets
  where id = new.asset_id;

  if model_owner is null or model_owner <> new.user_id then
    raise exception 'voice_model_not_owned';
  end if;

  if asset_owner is null or asset_owner <> new.user_id then
    raise exception 'identity_reference_asset_not_owned';
  end if;

  if asset_kind not in ('take', 'source') then
    raise exception 'identity_reference_requires_source_or_take';
  end if;

  if asset_sha is null or asset_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'identity_reference_asset_unverified';
  end if;

  new.source_sha256 := asset_sha;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validate_voice_identity_reference() from public;

create or replace function public.touch_voice_identity_reference()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.touch_voice_identity_reference() from public;

drop trigger if exists validate_voice_identity_reference_before_write on public.voice_identity_references;
create trigger validate_voice_identity_reference_before_write
before insert or update of user_id, voice_model_id, asset_id, source_sha256
on public.voice_identity_references
for each row execute function public.validate_voice_identity_reference();

drop trigger if exists touch_voice_identity_reference_before_update on public.voice_identity_references;
create trigger touch_voice_identity_reference_before_update
before update on public.voice_identity_references
for each row execute function public.touch_voice_identity_reference();

drop policy if exists voice_identity_references_select_own on public.voice_identity_references;
create policy voice_identity_references_select_own
on public.voice_identity_references for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists voice_identity_references_insert_own on public.voice_identity_references;
create policy voice_identity_references_insert_own
on public.voice_identity_references for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists voice_identity_references_update_own on public.voice_identity_references;
create policy voice_identity_references_update_own
on public.voice_identity_references for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists voice_identity_references_delete_own on public.voice_identity_references;
create policy voice_identity_references_delete_own
on public.voice_identity_references for delete
to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.voice_identity_references to authenticated;
