-- O modo "drain" da função leave-household (limpar as fotos das casas
-- apagadas) roda com a chave de serviço e era aceito de qualquer um com a
-- chave anon, que é pública. Agora o agendamento manda um segredo
-- (x-cleanup-secret), guardado no Vault como cleanup_cron_secret, e a função
-- só limpa quem o traz, como a send-push faz com push_cron_secret. O segredo
-- nasce nesta migração (onde há Vault); a função o lê por cleanup_config().

/** O segredo do agendamento da limpeza, para a função leave-household. */
create function public.cleanup_config()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'cleanup_cron_secret';
  return nullif(secret, '');
end;
$$;

revoke execute on function public.cleanup_config() from public, anon, authenticated;
grant execute on function public.cleanup_config() to service_role;

create or replace function public.request_household_file_cleanup()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  key text;
  secret text;
begin
  if not exists (select 1 from public.household_file_cleanup) then
    return null;
  end if;
  select s.decrypted_secret into base_url from vault.decrypted_secrets s where s.name = 'project_url';
  select s.decrypted_secret into key from vault.decrypted_secrets s where s.name = 'anon_key';
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'cleanup_cron_secret';
  if coalesce(base_url, '') = '' or coalesce(key, '') = '' or coalesce(secret, '') = '' then
    raise exception 'Faltam os segredos project_url, anon_key e cleanup_cron_secret no Vault para limpar as fotos das casas apagadas (ver README, "Limpeza das fotos")';
  end if;
  return net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/leave-household',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || key,
      'x-cleanup-secret', secret
    ),
    body := '{"drain": true}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;

-- Gera o segredo onde há Vault (no Postgres dos testes não há). Dois uuids
-- aleatórios sem os hífens: 64 caracteres, sem depender do pgcrypto.
do $$
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'cleanup_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'cleanup_cron_secret');
  end if;
end;
$$;
