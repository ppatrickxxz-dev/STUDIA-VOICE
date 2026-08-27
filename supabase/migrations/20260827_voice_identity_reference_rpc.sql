create or replace function public.set_voice_identity_reference(
  p_voice_model_id uuid,
  p_asset_id uuid,
  p_label text default null
)
returns public.voice_identity_references
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  model_ok boolean;
  asset_sha text;
  asset_kind text;
  result public.voice_identity_references;
begin
  if uid is null then
    raise exception 'auth_required';
  end if;

  select exists(
    select 1 from public.voice_models
    where id = p_voice_model_id and user_id = uid and status = 'ready'
  ) into model_ok;

  if not model_ok then
    raise exception 'voice_model_not_owned_or_ready';
  end if;

  select lower(sha256), kind into asset_sha, asset_kind
  from public.audio_assets
  where id = p_asset_id and user_id = uid;

  if asset_kind not in ('take', 'source') then
    raise exception 'identity_reference_requires_source_or_take';
  end if;

  if asset_sha is null or asset_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'identity_reference_asset_unverified';
  end if;

  update public.voice_identity_references
  set is_active = false
  where user_id = uid
    and voice_model_id = p_voice_model_id
    and is_active;

  insert into public.voice_identity_references(
    user_id, voice_model_id, asset_id, source_sha256, label, is_active
  ) values (
    uid, p_voice_model_id, p_asset_id, asset_sha,
    nullif(left(trim(coalesce(p_label, '')), 160), ''), true
  )
  returning * into result;

  return result;
end;
$$;

create or replace function public.clear_voice_identity_reference(p_voice_model_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  affected integer;
begin
  if uid is null then
    raise exception 'auth_required';
  end if;

  update public.voice_identity_references
  set is_active = false
  where user_id = uid
    and voice_model_id = p_voice_model_id
    and is_active;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.set_voice_identity_reference(uuid, uuid, text) from public;
revoke all on function public.clear_voice_identity_reference(uuid) from public;
grant execute on function public.set_voice_identity_reference(uuid, uuid, text) to authenticated;
grant execute on function public.clear_voice_identity_reference(uuid) to authenticated;
