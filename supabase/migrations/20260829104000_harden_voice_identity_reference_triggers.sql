alter function public.touch_voice_identity_reference() set search_path = public, pg_temp;

revoke execute on function public.validate_voice_identity_reference() from public;
revoke execute on function public.validate_voice_identity_reference() from anon;
revoke execute on function public.validate_voice_identity_reference() from authenticated;
