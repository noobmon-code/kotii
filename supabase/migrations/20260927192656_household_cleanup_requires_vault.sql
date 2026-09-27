-- A limpeza agendada das fotos (household-file-cleanup) chama a função
-- leave-household com a URL do projeto e a chave anon guardadas no Vault.
-- Sem esses segredos a chamada saía com URL nula e falhava em silêncio;
-- agora o job passa por esta função, que falha com a instrução (visível em
-- cron.job_run_details) enquanto os segredos não existirem.
create or replace function public.request_household_file_cleanup()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  key text;
begin
  if not exists (select 1 from public.household_file_cleanup) then
    return null;
  end if;
  select s.decrypted_secret into base_url from vault.decrypted_secrets s where s.name = 'project_url';
  select s.decrypted_secret into key from vault.decrypted_secrets s where s.name = 'anon_key';
  if coalesce(base_url, '') = '' or coalesce(key, '') = '' then
    raise exception 'Faltam os segredos project_url e anon_key no Vault para limpar as fotos das casas apagadas (ver README, "Limpeza das fotos")';
  end if;
  return net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/leave-household',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
    body := '{"drain": true}'::jsonb
  );
end;
$$;

revoke all on function public.request_household_file_cleanup() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  perform cron.schedule('household-file-cleanup', '17 * * * *', 'select public.request_household_file_cleanup()');
  if to_regclass('vault.decrypted_secrets') is null
    or (select count(*) from vault.decrypted_secrets where name in ('project_url', 'anon_key')) < 2 then
    raise warning 'Crie os segredos project_url e anon_key no Vault (ver README, "Limpeza das fotos"): sem eles a limpeza agendada não roda';
  end if;
end;
$$;
