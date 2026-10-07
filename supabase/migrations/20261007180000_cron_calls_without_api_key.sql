-- As chamadas do pg_cron às funções (send-push e o drain da leave-household)
-- mandavam a chave anon do Vault (anon_key) como token, só para passar pela
-- conferência de token da plataforma. Com as chaves novas do Supabase isso
-- deixa de servir: a chave pública nova (sb_publishable_…) não é um JWT, e a
-- anon antiga para de valer quando o projeto desligar as chaves antigas.
-- Quem autoriza essas chamadas sempre foi o segredo do agendamento
-- (x-push-secret, x-cleanup-secret), que a função confere; agora as duas
-- funções rodam com verify_jwt = false (supabase/config.toml) e a chamada só
-- leva o segredo. O Vault não precisa mais de anon_key.
--
-- Publique a send-push e a leave-household (com o config.toml novo) antes de
-- aplicar esta migração: sem o token, a versão antiga das funções recusa a
-- chamada, e os avisos vencidos esperam até a função nova entrar.

create or replace function public.request_push_send()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  secret text;
begin
  -- Os reservados estão sendo enviados agora.
  if not exists (
    select 1 from public.push_schedule p
    where p.next_at <= now() and (p.claimed_at is null or p.claimed_at < now() - interval '5 minutes')
  ) then
    return null;
  end if;
  select s.decrypted_secret into base_url from vault.decrypted_secrets s where s.name = 'project_url';
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'push_cron_secret';
  if coalesce(base_url, '') = '' or coalesce(secret, '') = '' then
    raise exception 'Faltam os segredos project_url e push_cron_secret no Vault para enviar os avisos do navegador (ver README, "Avisos no navegador")';
  end if;
  return net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;

create or replace function public.request_household_file_cleanup()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  secret text;
begin
  if not exists (select 1 from public.household_file_cleanup) then
    return null;
  end if;
  select s.decrypted_secret into base_url from vault.decrypted_secrets s where s.name = 'project_url';
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'cleanup_cron_secret';
  if coalesce(base_url, '') = '' or coalesce(secret, '') = '' then
    raise exception 'Faltam os segredos project_url e cleanup_cron_secret no Vault para limpar as fotos das casas apagadas (ver README, "Limpeza das fotos")';
  end if;
  return net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/leave-household',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cleanup-secret', secret),
    body := '{"drain": true}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;
