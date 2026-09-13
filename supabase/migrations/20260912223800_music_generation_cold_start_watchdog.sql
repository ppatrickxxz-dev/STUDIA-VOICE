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
    and status in ('created','waiting_gpu','waiting_kaggle','queued','queued_kaggle','dispatched','provisioning','downloading_inputs','running','separating','converting_voice','processing_vocal','mixing','mastering','qa','uploading','finalizing')
    and coalesce(heartbeat_at,started_at,created_at) < now() - make_interval(
      secs => case
        when job_type='music_generation' and status='waiting_kaggle' then greatest(900,p_timeout_seconds)
        else greatest(30,p_timeout_seconds)
      end
    );
  get diagnostics n=row_count;
  return n;
end $function$;
