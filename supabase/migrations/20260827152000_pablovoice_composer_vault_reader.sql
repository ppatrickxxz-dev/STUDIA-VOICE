-- Canonical server-only reader for the PabloVoice Composer provider credential.
-- The credential value itself is provisioned into Supabase Vault at runtime and is never committed.

create or replace function public.get_pablovoice_openai_api_key()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'pablovoice_openai_api_key'
  order by created_at desc
  limit 1
$$;

revoke all on function public.get_pablovoice_openai_api_key() from public, anon, authenticated;
grant execute on function public.get_pablovoice_openai_api_key() to service_role;
