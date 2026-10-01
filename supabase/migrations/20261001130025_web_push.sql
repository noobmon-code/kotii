-- Avisos no navegador (Web Push). O app agenda os avisos do mesmo jeito que
-- no celular (src/lib/reminders.ts); no web, a agenda fica aqui: cada
-- navegador inscrito (push_subscriptions) tem a sua (push_schedule), e a
-- função send-push, chamada pelo pg_cron a cada minuto quando há aviso
-- vencido, envia. As chaves VAPID e o segredo do agendamento ficam no Vault
-- (ver README, "Avisos no navegador").

-- Serviços de push dos navegadores: o envio só vai para eles.
create function public.is_push_endpoint(p_endpoint text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select char_length(p_endpoint) <= 1000 and p_endpoint ~ (
    '^https://('
    || 'fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com'
    || '|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com'
    || ')/'
  );
$$;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (public.is_push_endpoint(endpoint)),
  p256dh text not null check (char_length(p256dh) between 1 and 200),
  auth text not null check (char_length(auth) between 1 and 100),
  -- Fuso do navegador: os avisos diários tocam na hora local.
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
-- Inscrever e desinscrever só pelas funções abaixo.
create policy "own push subscriptions" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));

-- Cada aviso agendado: uma vez (fire_at), todo dia ou toda semana (hora
-- local; weekday como no expo-notifications: 1 = domingo). next_at é a
-- próxima vez que toca, calculada aqui.
create table public.push_schedule (
  id uuid primary key,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 500),
  data jsonb not null default '{}' check (pg_column_size(data) <= 2000),
  repeat text not null check (repeat in ('once', 'daily', 'weekly')),
  fire_at timestamptz,
  hour smallint check (hour between 0 and 23),
  minute smallint check (minute between 0 and 59),
  weekday smallint check (weekday between 1 and 7),
  next_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (
    (repeat = 'once' and fire_at is not null)
    or (repeat = 'daily' and hour is not null and minute is not null)
    or (repeat = 'weekly' and hour is not null and minute is not null and weekday is not null)
  )
);
create index push_schedule_due_idx on public.push_schedule (next_at);
create index push_schedule_subscription_idx on public.push_schedule (subscription_id);
alter table public.push_schedule enable row level security;
create policy "own push schedule read" on public.push_schedule for select to authenticated
  using (exists (select 1 from public.push_subscriptions s where s.id = subscription_id and s.user_id = (select auth.uid())));
create policy "own push schedule insert" on public.push_schedule for insert to authenticated
  with check (exists (select 1 from public.push_subscriptions s where s.id = subscription_id and s.user_id = (select auth.uid())));
create policy "own push schedule delete" on public.push_schedule for delete to authenticated
  using (exists (select 1 from public.push_subscriptions s where s.id = subscription_id and s.user_id = (select auth.uid())));

/** Próxima vez que o aviso toca depois de p_after, na hora local do fuso. */
create function public.push_next_at(
  p_repeat text,
  p_fire_at timestamptz,
  p_hour int,
  p_minute int,
  p_weekday int,
  p_timezone text,
  p_after timestamptz
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  local_now timestamp := p_after at time zone p_timezone;
  candidate timestamp;
begin
  if p_repeat = 'once' then
    return p_fire_at;
  end if;
  candidate := date_trunc('day', local_now) + make_interval(hours => p_hour, mins => p_minute);
  if p_repeat = 'weekly' then
    candidate := candidate + make_interval(days => ((p_weekday - 1) - extract(dow from local_now)::int + 7) % 7);
    if candidate <= local_now then
      candidate := candidate + interval '7 days';
    end if;
  elsif candidate <= local_now then
    candidate := candidate + interval '1 day';
  end if;
  return candidate at time zone p_timezone;
end;
$$;

-- Até quantos avisos agendados por navegador (o celular guarda 64).
create function public.max_push_schedule()
returns int
language sql
immutable
set search_path = ''
as $$ select 200 $$;

create function public.push_schedule_prepare()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  tz text;
begin
  select s.timezone into tz from public.push_subscriptions s where s.id = new.subscription_id;
  if (select count(*) from public.push_schedule p where p.subscription_id = new.subscription_id) >= public.max_push_schedule() then
    raise exception 'too many scheduled notifications' using errcode = 'NK003';
  end if;
  new.next_at := public.push_next_at(new.repeat, new.fire_at, new.hour, new.minute, new.weekday, coalesce(tz, 'America/Sao_Paulo'), now());
  return new;
end;
$$;

create trigger push_schedule_prepare
  before insert on public.push_schedule
  for each row execute function public.push_schedule_prepare();

/**
 * Inscreve este navegador para a pessoa (ou atualiza as chaves e o fuso).
 * Se o navegador era de outra conta, a inscrição e a agenda dela saem.
 */
create function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_timezone text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz text := 'America/Sao_Paulo';
  sub public.push_subscriptions;
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
    return sub.id;
  end if;

  update public.push_subscriptions s
     set p256dh = p_p256dh, auth = p_auth, timezone = tz, updated_at = now()
   where s.id = sub.id;
  if sub.timezone <> tz then
    -- Mudou de fuso: os avisos diários e semanais passam a tocar na hora de lá.
    update public.push_schedule p
       set next_at = public.push_next_at(p.repeat, p.fire_at, p.hour, p.minute, p.weekday, tz, now())
     where p.subscription_id = sub.id and p.repeat <> 'once';
  end if;
  return sub.id;
end;
$$;

/** Este navegador deixa de receber avisos (sai da conta ou desliga). */
create function public.unregister_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = auth.uid();
$$;

/**
 * Apaga da agenda deste navegador o que o app não reconhece mais (sobra de
 * uma sincronização que caiu no meio, sem internet).
 */
create function public.prune_push_schedule(p_subscription_id uuid, p_keep uuid[])
returns int
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.push_schedule p
    using public.push_subscriptions s
    where s.id = p_subscription_id and s.user_id = auth.uid()
      and p.subscription_id = s.id and not (p.id = any (coalesce(p_keep, '{}')))
    returning p.id
  )
  select count(*)::int from gone;
$$;

/** A chave pública VAPID, que o navegador usa para se inscrever (null: não configurada). */
create function public.push_public_key()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  raw text;
begin
  select s.decrypted_secret into raw from vault.decrypted_secrets s where s.name = 'push_vapid';
  return nullif(raw, '')::jsonb ->> 'applicationServerKey';
exception when others then
  return null;
end;
$$;

/** Chaves VAPID, contato e o segredo do agendamento, para a função send-push. */
create function public.push_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  vapid text;
  secret text;
begin
  select s.decrypted_secret into vapid from vault.decrypted_secrets s where s.name = 'push_vapid';
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'push_cron_secret';
  if coalesce(vapid, '') = '' or coalesce(secret, '') = '' then
    return null;
  end if;
  return vapid::jsonb || jsonb_build_object('cronSecret', secret);
end;
$$;

/**
 * Os avisos que venceram: os de uma vez saem da agenda, os diários e
 * semanais passam para a próxima vez. Vencidos há mais de uma hora (o envio
 * ficou parado) não são enviados.
 */
create function public.take_due_pushes(p_now timestamptz default now())
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
    where p.next_at <= p_now
    order by p.next_at
    limit 500
    for update skip locked
  ),
  removed as (
    delete from public.push_schedule p using due where p.id = due.id and due.repeat = 'once' returning p.id
  ),
  advanced as (
    update public.push_schedule p
       set next_at = public.push_next_at(p.repeat, p.fire_at, p.hour, p.minute, p.weekday, s.timezone, p_now)
      from due, public.push_subscriptions s
     where p.id = due.id and due.repeat <> 'once' and s.id = p.subscription_id
    returning p.id
  )
  select due.id, due.subscription_id, s.endpoint, s.p256dh, s.auth, due.title, due.body, due.data
  from due
  join public.push_subscriptions s on s.id = due.subscription_id
  where due.next_at > p_now - interval '1 hour'
  order by due.next_at;
$$;

/** Chamada pelo pg_cron: aciona a send-push só quando há aviso vencido. */
create function public.request_push_send()
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
  if not exists (select 1 from public.push_schedule p where p.next_at <= now()) then
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

revoke execute on function public.is_push_endpoint(text) from public;
revoke execute on function public.push_next_at(text, timestamptz, int, int, int, text, timestamptz) from public, anon;
revoke execute on function public.max_push_schedule() from public, anon;
revoke execute on function public.push_schedule_prepare() from public, anon, authenticated;
revoke execute on function public.register_push_subscription(text, text, text, text) from public, anon;
revoke execute on function public.unregister_push_subscription(text) from public, anon;
revoke execute on function public.prune_push_schedule(uuid, uuid[]) from public, anon;
revoke execute on function public.push_public_key() from public, anon;
revoke execute on function public.push_config() from public, anon, authenticated;
revoke execute on function public.take_due_pushes(timestamptz) from public, anon, authenticated;
revoke execute on function public.request_push_send() from public, anon, authenticated;
grant execute on function public.is_push_endpoint(text) to authenticated, service_role;
-- A agenda calcula a próxima vez no insert, como quem agenda.
grant execute on function public.push_next_at(text, timestamptz, int, int, int, text, timestamptz) to authenticated, service_role;
grant execute on function public.max_push_schedule() to authenticated, service_role;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.unregister_push_subscription(text) to authenticated;
grant execute on function public.prune_push_schedule(uuid, uuid[]) to authenticated;
grant execute on function public.push_public_key() to authenticated;
grant execute on function public.push_config() to service_role;
grant execute on function public.take_due_pushes(timestamptz) to service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  perform cron.schedule('web-push', '* * * * *', 'select public.request_push_send()');
  if to_regclass('vault.decrypted_secrets') is null
    or (select count(*) from vault.decrypted_secrets where name in ('project_url', 'anon_key', 'push_cron_secret', 'push_vapid')) < 4 then
    raise warning 'Crie os segredos push_vapid e push_cron_secret no Vault (ver README, "Avisos no navegador"): sem eles os avisos do navegador não saem';
  end if;
end;
$$;
