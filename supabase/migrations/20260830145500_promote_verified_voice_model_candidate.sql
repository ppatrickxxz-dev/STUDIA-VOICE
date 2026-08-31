create or replace function public.promote_verified_voice_model_candidate(
  p_training_job_id uuid,
  p_attestation_job_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_training public.render_jobs%rowtype;
  v_attestation public.render_jobs%rowtype;
  v_model public.voice_models%rowtype;
  v_candidate_model_id uuid;
  v_validation_asset_id uuid;
  v_validation_sha text;
  v_score numeric;
  v_threshold numeric;
begin
  select * into v_training
  from public.render_jobs
  where id = p_training_job_id
    and job_type = 'voice_model_training'
  for update;

  if not found then
    raise exception 'training_job_not_found';
  end if;
  if v_training.status <> 'completed' or coalesce((v_training.proof->>'verified')::boolean, false) is not true then
    raise exception 'training_job_not_verified';
  end if;

  v_candidate_model_id := nullif(v_training.proof->>'candidate_model_id','')::uuid;
  v_validation_asset_id := nullif(v_training.proof->>'validation_asset_id','')::uuid;
  v_validation_sha := lower(coalesce(v_training.proof->>'validation_sha256',''));
  if v_candidate_model_id is null or v_validation_asset_id is null or v_validation_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'training_proof_binding_invalid';
  end if;
  if coalesce((v_training.proof->>'candidate_active')::boolean, true) is not false
     or coalesce((v_training.proof->>'activation_forbidden_before_identity_gate')::boolean, false) is not true
     or (v_training.proof->>'identity_threshold')::numeric <> 0.8 then
    raise exception 'training_activation_contract_invalid';
  end if;

  select * into v_attestation
  from public.render_jobs
  where id = p_attestation_job_id
    and job_type = 'speaker_identity_attestation'
  for update;

  if not found then
    raise exception 'attestation_job_not_found';
  end if;
  if v_attestation.user_id <> v_training.user_id or v_attestation.project_id <> v_training.project_id then
    raise exception 'attestation_owner_binding_mismatch';
  end if;
  if v_attestation.status <> 'completed'
     or coalesce((v_attestation.proof->>'verified')::boolean, false) is not true
     or coalesce((v_attestation.proof->>'passed')::boolean, false) is not true
     or v_attestation.proof->>'authority' <> 'github_repository_oidc'
     or v_attestation.proof->>'issuer' <> 'pablovoice-github-oidc-speaker-identity-v2'
     or v_attestation.proof->>'trusted_repository' <> 'ppatrickxxz-dev/STUDIA-VOICE'
     or v_attestation.proof->>'engine' <> 'speechbrain/spkrec-ecapa-voxceleb'
     or v_attestation.proof->>'engine_version' <> 'speechbrain-1.1.0'
     or v_attestation.proof->>'model_revision' <> 'b8937e0343bf9fc9741ab12b445b86a93a6e3e25' then
    raise exception 'attestation_not_trusted';
  end if;

  v_score := (v_attestation.proof->>'score')::numeric;
  v_threshold := (v_attestation.proof->>'threshold')::numeric;
  if v_score is null
     or v_threshold is null
     or v_score::text in ('NaN', 'Infinity', '-Infinity')
     or v_threshold::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'identity_evidence_invalid';
  end if;
  if v_threshold <> 0.8 or v_score < v_threshold then
    raise exception 'identity_gate_not_passed';
  end if;
  if nullif(v_attestation.proof->>'voice_model_id','')::uuid <> v_candidate_model_id
     or nullif(v_attestation.proof->>'candidate_asset_id','')::uuid <> v_validation_asset_id
     or lower(coalesce(v_attestation.proof->>'candidate_sha256','')) <> v_validation_sha
     or nullif(v_attestation.parameters->>'training_job_id','')::uuid <> p_training_job_id then
    raise exception 'attestation_training_binding_mismatch';
  end if;

  if nullif(v_training.proof->>'speaker_identity_attestation_job_id','')::uuid <> p_attestation_job_id then
    raise exception 'training_attestation_binding_mismatch';
  end if;

  select * into v_model
  from public.voice_models
  where id = v_candidate_model_id
    and user_id = v_training.user_id
  for update;

  if not found then
    raise exception 'candidate_model_not_found';
  end if;
  if v_model.status <> 'ready'
     or coalesce(v_model.metadata->>'candidate','false')::boolean is not true
     or v_model.metadata->>'activation_policy' <> 'inactive_until_verified_ecapa_gte_0_8'
     or (v_model.metadata->>'identity_threshold')::numeric <> 0.8
     or nullif(v_model.metadata->>'training_job_id','')::uuid <> p_training_job_id then
    raise exception 'candidate_model_contract_invalid';
  end if;

  update public.voice_models
  set is_active = false,
      updated_at = now()
  where user_id = v_training.user_id
    and id <> v_candidate_model_id
    and is_active = true;

  update public.voice_models
  set is_active = true,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'candidate', false,
        'activation_policy', 'verified_ecapa_gte_0_8',
        'activated_by', 'github_oidc_ecapa_gate',
        'identity_attestation_job_id', p_attestation_job_id,
        'identity_score', v_score,
        'identity_threshold', v_threshold,
        'identity_model_revision', v_attestation.proof->>'model_revision',
        'identity_trusted_run_id', v_attestation.proof->>'trusted_run_id',
        'activated_at', now()
      ),
      updated_at = now()
  where id = v_candidate_model_id
    and user_id = v_training.user_id;

  return jsonb_build_object(
    'ok', true,
    'candidate_model_id', v_candidate_model_id,
    'training_job_id', p_training_job_id,
    'attestation_job_id', p_attestation_job_id,
    'score', v_score,
    'threshold', v_threshold,
    'is_active', true
  );
end;
$$;

revoke all on function public.promote_verified_voice_model_candidate(uuid, uuid) from public;
revoke all on function public.promote_verified_voice_model_candidate(uuid, uuid) from anon;
revoke all on function public.promote_verified_voice_model_candidate(uuid, uuid) from authenticated;
grant execute on function public.promote_verified_voice_model_candidate(uuid, uuid) to service_role;
