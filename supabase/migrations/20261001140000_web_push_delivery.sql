-- Avisos do navegador:
-- 1. O aviso só sai da agenda (ou anda para a próxima vez) depois de
--    entregue. A send-push reserva os vencidos (claimed_at) e, depois de
--    enviar, confirma (finish_pushes): falha passageira do serviço de push
--    tenta de novo no minuto seguinte, dentro da mesma hora; se a função cair
--    no meio, a reserva vence em 5 minutos e o aviso volta para a fila.
-- 2. Quando o navegador troca de inscrição (chave nova ou inscrição vencida),
--    a agenda da inscrição anterior da mesma pessoa passa para a nova: o app
--    guarda os mesmos avisos e não os agendaria de novo.

alter table public.push_schedule add column if not exists claimed_at timestamptz;

create or replace function public.take_due_pushes(p_now timestamptz default now())
returns table (
  push_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth_secret text,
  title text,
  body text,
  data jsonb
)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select p.id, p.subscription_id, p.title, p.body, p.data, p.repeat, p.next_at
    from public.push_schedule p
    where p.next_at <= p_now and (p.claimed_at is null or p.claimed_at < p_now - interval '5 minutes')
    order by p.next_at
    limit 500
    for update skip locked
  ),
  -- Vencidos há mais de uma hora (o envio ficou parado): não vão mais.
  stale_once as (
    delete from public.push_schedule p using due
    where p.id = due.id and due.repeat = 'once' and due.next_at <= p_now - interval '1 hour'
    returning p.id
  ),
  stale_repeat as (
    update public.push_schedule p
       set next_at = public.push_next_at(p.repeat, p.fire_at, p.hour, p.minute, p.weekday, s.timezone, p_now), claimed_at = null
      from due, public.push_subscriptions s
     where p.id = due.id and due.repeat <> 'once' and due.next_at <= p_now - interval '1 hour' and s.id = p.subscription_id
    returning p.id
  ),
  claimed as (
    update public.push_schedule p set claimed_at = p_now
      from due
     where p.id = due.id and due.next_at > p_now - interval '1 hour'
    returning p.id
  )
  select due.id, due.subscription_id, s.endpoint, s.p256dh, s.auth, due.title, due.body, due.data
  from due
  join public.push_subscriptions s on s.id = due.subscription_id
  where due.next_at > p_now - interval '1 hour'
  order by due.next_at;
$$;

/**
 * Depois do envio: os entregues (ou recusados de vez) saem da agenda ou andam
 * para a próxima vez; os que falharam por um instante voltam para a fila.
 */
create function public.finish_pushes(p_done uuid[], p_retry uuid[], p_now timestamptz default now())
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_schedule p where p.id = any (coalesce(p_done, '{}')) and p.repeat = 'once';
  update public.push_schedule p
     set next_at = public.push_next_at(p.repeat, p.fire_at, p.hour, p.minute, p.weekday, s.timezone, p_now), claimed_at = null
    from public.push_subscriptions s
   where p.id = any (coalesce(p_done, '{}')) and p.repeat <> 'once' and s.id = p.subscription_id;
  update public.push_schedule p set claimed_at = null where p.id = any (coalesce(p_retry, '{}'));
$$;

create or replace function public.request_push_send()
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
  -- Os reservados estão sendo enviados agora.
  if not exists (
    select 1 from public.push_schedule p
    where p.next_at <= now() and (p.claimed_at is null or p.claimed_at < now() - interval '5 minutes')
  ) then
    return null;
  end if;
  select s.decrypted_secret into base_url from vault.decrypted_secrets s where s.name = 'project_url';
  select s.decrypted_secret into key from vault.decrypted_secrets s where s.name = 'anon_key';
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'push_cron_secret';
  if coalesce(base_url, '') = '' or coalesce(key, '') = '' or coalesce(secret, '') = '' then
    raise exception 'Faltam os segredos project_url, anon_key e push_cron_secret no Vault para enviar os avisos do navegador (ver README, "Avisos no navegador")';
  end if;
  return net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || key,
      'x-push-secret', secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;

/**
 * Inscreve este navegador para a pessoa (ou atualiza as chaves e o fuso).
 * Se o navegador era de outra conta, a inscrição e a agenda dela saem.
 * p_previous: a inscrição anterior deste navegador (o app guarda; null na
 * primeira vez); se for da mesma pessoa e o endereço mudou, a agenda dela
 * passa para esta. Sem valor padrão: com ele, a chamada de 4 argumentos
 * (que continua existindo e chama esta) ficaria ambígua.
 */
create function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_timezone text,
  p_previous uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz text := 'America/Sao_Paulo';
  sub public.push_subscriptions;
  moved int := 0;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_push_endpoint(p_endpoint) then
    raise exception 'invalid push endpoint' using errcode = '22023';
  end if;
  begin
    perform now() at time zone p_timezone;
    tz := p_timezone;
  exception when others then
    null;
  end;

  select * into sub from public.push_subscriptions s where s.endpoint = p_endpoint for update;
  if found and sub.user_id <> auth.uid() then
    delete from public.push_subscriptions s where s.id = sub.id;
    sub := null;
  end if;

  if sub.id is null then
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, timezone)
    values (auth.uid(), p_endpoint, p_p256dh, p_auth, tz)
    returning * into sub;
  else
    update public.push_subscriptions s
       set p256dh = p_p256dh, auth = p_auth, timezone = tz, updated_at = now()
     where s.id = sub.id;
  end if;

  if p_previous is not null and p_previous <> sub.id
    and exists (select 1 from public.push_subscriptions o where o.id = p_previous and o.user_id = auth.uid()) then
    update public.push_schedule p set subscription_id = sub.id, claimed_at = null where p.subscription_id = p_previous;
    get diagnostics moved = row_count;
    delete from public.push_subscriptions o where o.id = p_previous;
  end if;

  if moved > 0 or sub.timezone <> tz then
    -- Fuso novo (ou agenda que veio de outra inscrição): os diários e
    -- semanais tocam na hora local daqui.
    update public.push_schedule p
       set next_at = public.push_next_at(p.repeat, p.fire_at, p.hour, p.minute, p.weekday, tz, now())
     where p.subscription_id = sub.id and p.repeat <> 'once';
  end if;
  return sub.id;
end;
$$;

-- A versão de 4 argumentos (sem a inscrição anterior) vira atalho para esta.
create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_timezone text)
returns uuid
language sql
set search_path = ''
as $$
  select public.register_push_subscription(p_endpoint, p_p256dh, p_auth, p_timezone, null::uuid);
$$;

revoke execute on function public.finish_pushes(uuid[], uuid[], timestamptz) from public, anon, authenticated;
revoke execute on function public.register_push_subscription(text, text, text, text, uuid) from public, anon;
grant execute on function public.finish_pushes(uuid[], uuid[], timestamptz) to service_role;
grant execute on function public.register_push_subscription(text, text, text, text, uuid) to authenticated;
