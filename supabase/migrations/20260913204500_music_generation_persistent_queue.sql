create index if not exists render_jobs_music_generation_queue_idx
  on public.render_jobs(created_at, id)
  where job_type='music_generation'
    and status='queued'
    and finished_at is null;

do $block$
begin
  if not exists (
    select 1 from vault.secrets where name='pablovoice_music_dispatcher_token'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32),'hex'),
      'pablovoice_music_dispatcher_token',
      'Internal token used only by pg_cron to nudge the durable music-generation queue',
      null
    );
  end if;
end
$block$;

create or replace function public.validate_music_dispatch_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path to 'public','vault','pg_catalog'
as $function$
  select length(coalesce(p_token,'')) >= 32
     and exists (
       select 1
       from vault.decrypted_secrets
       where name='pablovoice_music_dispatcher_token'
         and decrypted_secret=p_token
     );
$function$;

revoke all on function public.validate_music_dispatch_token(text) from public, anon, authenticated;
grant execute on function public.validate_music_dispatch_token(text) to service_role;

create or replace function public.mark_stalled_render_jobs(p_timeout_seconds integer default 180)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n integer;
begin
  update public.render_jobs
  set status='stalled',
      current_stage='stalled',
      error_code='heartbeat_timeout',
      human_message='A GPU parou de responder. Vou tentar novamente.',
      technical_error=concat(
        'No heartbeat for more than ',
        case
          when job_type='music_generation' and status='waiting_kaggle' then greatest(900,p_timeout_seconds)
          else greatest(30,p_timeout_seconds)
        end,
        ' seconds. Last heartbeat: ',heartbeat_at
      ),
      next_retry_at=now()+interval '30 seconds'
  where finished_at is null
    -- queued music jobs are intentionally idle while another GPU job owns the lease.
    -- They must not be converted into heartbeat failures before dispatch.
    and status in ('created','waiting_gpu','waiting_kaggle','queued_kaggle','dispatched','provisioning','downloading_inputs','running','separating','converting_voice','processing_vocal','mixing','mastering','qa','uploading','finalizing')
    and coalesce(heartbeat_at,started_at,created_at) < now() - make_interval(
      secs => case
        when job_type='music_generation' and status='waiting_kaggle' then greatest(900,p_timeout_seconds)
        else greatest(30,p_timeout_seconds)
      end
    );
  get diagnostics n=row_count;
  return n;
end $function$;

do $block$
begin
  perform cron.unschedule('pablovoice-music-dispatch-queue');
exception when others then
  null;
end
$block$;

select cron.schedule(
  'pablovoice-music-dispatch-queue',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://yokmhqoncdwvxmzzybqa.supabase.co/functions/v1/compute-kaggle-v58',
      body := '{"action":"dispatch_next"}'::jsonb,
      params := '{}'::jsonb,
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-pv-dispatch-token',(
          select decrypted_secret
          from vault.decrypted_secrets
          where name='pablovoice_music_dispatcher_token'
          limit 1
        )
      ),
      timeout_milliseconds := 15000
    );
  $cron$
);
