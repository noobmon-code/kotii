-- "Estou indo ao mercado": quem está saindo para as compras avisa a casa com
-- um toque, para os outros porem na lista o que falta enquanto dá tempo.
--
-- O aviso vira uma "ida" (market_trips), que o app mostra por 2 horas na
-- tela Hoje e na lista (no celular também), e um aviso na hora nos
-- navegadores dos outros moradores: uma linha 'once' na agenda de cada
-- navegador inscrito (push_schedule), com fire_at = agora, que a send-push
-- entrega no minuto seguinte, do jeito que já entrega os lembretes. No
-- celular não há push remoto: lá só o aviso dentro do app.
--
-- O título e o texto do aviso são montados aqui, com o nome do morador e o
-- nome da lista que estão no banco: quem avisa não manda texto nenhum que
-- vá parar na tela bloqueada de outra pessoa.

-- Cada navegador escolhe se recebe (Família → "Avisos neste navegador").
-- Quem já recebe avisos do Kotii começa recebendo.
alter table public.push_subscriptions add column market_trips boolean not null default true;

create table public.market_trips (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  list_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- O nome que foi no aviso, para a faixa do app dizer o mesmo.
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now(),
  -- Até quando a faixa aparece (2 horas), se a pessoa não encerrar antes.
  ends_at timestamptz not null,
  ended_at timestamptz,
  foreign key (list_id, household_id)
    references public.shopping_lists (id, household_id) on delete cascade
);
create index market_trips_household_idx on public.market_trips (household_id, created_at desc);

-- A casa lê as idas dela; criar e encerrar, só pelas funções abaixo (sem
-- policy nem permissão de escrita: nem o próprio autor mexe direto).
alter table public.market_trips enable row level security;
revoke all on public.market_trips from anon, authenticated;
grant select on public.market_trips to authenticated;
create policy "household members read market trips" on public.market_trips
  for select to authenticated
  using (household_id = (select public.current_household_id()));

/**
 * Um nome guardado no banco, pronto para ir num aviso: numa linha só, sem
 * caracteres de controle nem os que invertem a direção do texto, e cortado.
 */
create function public.push_text(p_text text, p_max int)
returns text
language sql
immutable
set search_path = ''
as $$
  select rtrim(left(btrim(regexp_replace(
    regexp_replace(coalesce(p_text, ''), '[\u0001-\u001F\u007F-\u009F  ‪-‮⁦-⁩]+', ' ', 'g'),
    '\s+', ' ', 'g'
  )), p_max));
$$;
revoke execute on function public.push_text(text, int) from public, anon, authenticated;

-- Até quantas idas novas uma pessoa avisa por casa em 24 horas.
create function public.max_market_trips()
returns int
language sql
immutable
set search_path = ''
as $$ select 5 $$;
revoke execute on function public.max_market_trips() from public, anon;
grant execute on function public.max_market_trips() to authenticated;

/**
 * Avisa a casa aberta que a pessoa está saindo para as compras da lista.
 * Devolve a ida (trip_id, created_at), quantos dos outros moradores tiveram
 * aviso posto na fila (notified), quantos outros moradores a casa tem
 * (members) e se a casa já tinha sido avisada (repeated).
 *
 * Contra barulho: a mesma pessoa e a mesma lista, com a ida ainda valendo e
 * avisada há menos de 30 minutos, devolve a ida que existe e não manda nada;
 * e cada pessoa avisa até max_market_trips() idas novas por casa em 24 horas
 * (depois disso, NK005).
 */
create function public.announce_market_trip(p_list_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid := public.current_household_id();
  list public.shopping_lists;
  trip public.market_trips;
  sub record;
  others int;
  notified uuid[] := '{}';
  who text;
  house text;
  title text;
  body text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if hid is null then
    raise exception 'sem casa' using errcode = '42501';
  end if;
  -- A lista é da casa aberta (a de outra casa da pessoa também não serve).
  select * into list from public.shopping_lists l
    where l.id = p_list_id and l.household_id = hid and l.archived_at is null;
  if not found then
    raise exception 'list not found' using errcode = 'P0002';
  end if;
  -- Um aviso por vez por pessoa: dois toques juntos não criam duas idas nem passam do limite.
  perform pg_advisory_xact_lock(hashtextextended('market_trips:' || auth.uid()::text, 0));

  select count(*) into others from public.household_members m
    where m.household_id = hid and m.user_id <> auth.uid();
  -- Sozinha na casa (o app nem mostra o botão): não há quem avisar.
  if others = 0 then
    return jsonb_build_object('trip_id', null, 'created_at', null, 'notified', 0, 'members', 0, 'repeated', false);
  end if;

  select * into trip from public.market_trips t
    where t.household_id = hid and t.list_id = p_list_id and t.user_id = auth.uid()
      and t.ended_at is null and t.created_at > now() - interval '30 minutes'
    order by t.created_at desc
    limit 1;
  if found then
    return jsonb_build_object('trip_id', trip.id, 'created_at', trip.created_at, 'notified', 0, 'members', others, 'repeated', true);
  end if;

  if (
    select count(*) from public.market_trips t
    where t.household_id = hid and t.user_id = auth.uid() and t.created_at > now() - interval '24 hours'
  ) >= public.max_market_trips() then
    raise exception 'too many market trips' using errcode = 'NK005';
  end if;

  -- Não há histórico de idas: as antigas da casa saem (o limite olha 24 horas).
  delete from public.market_trips t where t.household_id = hid and t.created_at < now() - interval '7 days';

  select coalesce(nullif(public.push_text(m.display_name, 40), ''), 'Alguém') into who
    from public.household_members m
    where m.household_id = hid and m.user_id = auth.uid();
  insert into public.market_trips (household_id, list_id, user_id, display_name, ends_at)
  values (hid, p_list_id, auth.uid(), who, now() + interval '2 hours')
  returning * into trip;

  title := who || case when list.kind = 'mercado' then ' está indo ao mercado' else ' está indo às compras' end;
  body := 'Falta alguma coisa? Ponha na lista “' || coalesce(nullif(public.push_text(list.name, 60), ''), 'Compras') || '” agora.';
  select coalesce(nullif(public.push_text(h.name, 40), ''), 'Casa') into house from public.households h where h.id = hid;

  -- Só quem mora na casa agora, menos quem avisou, nos navegadores que
  -- querem este aviso. A casa vai na linha (householdId), como nos lembretes:
  -- quem é tirado da casa perde na hora o que ainda não saiu (remove_member).
  -- Para quem mora em mais de uma casa, o título diz de qual é, também como
  -- nos lembretes.
  for sub in
    select s.id, s.user_id,
      (select count(*) from public.household_members o where o.user_id = s.user_id) > 1 as several
    from public.push_subscriptions s
    join public.household_members m on m.user_id = s.user_id
    where m.household_id = hid and s.user_id <> auth.uid() and s.market_trips
  loop
    begin
      insert into public.push_schedule (id, subscription_id, title, body, data, repeat, fire_at)
      values (
        gen_random_uuid(), sub.id, case when sub.several then title || ' · ' || house else title end, body,
        jsonb_build_object('reminder', 'ida:' || trip.id::text, 'server', true, 'householdId', hid),
        'once', now()
      );
      if not (sub.user_id = any (notified)) then
        notified := notified || sub.user_id;
      end if;
    exception when sqlstate 'NK003' then
      -- A agenda deste navegador está cheia: fica sem este aviso, os outros recebem.
      null;
    end;
  end loop;

  return jsonb_build_object(
    'trip_id', trip.id, 'created_at', trip.created_at,
    'notified', coalesce(array_length(notified, 1), 0), 'members', others, 'repeated', false
  );
end;
$$;

/**
 * Encerra a ida para a casa toda. Só quem avisou; devolve se encerrou. Os
 * avisos dela que ainda não saíram deixam a fila.
 */
create function public.end_market_trip(p_trip_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.market_trips t set ended_at = now()
    where t.id = p_trip_id and t.user_id = auth.uid() and t.ended_at is null;
  if not found then
    return false;
  end if;
  delete from public.push_schedule p
    where p.data ? 'server' and p.data ->> 'reminder' = 'ida:' || p_trip_id::text;
  return true;
end;
$$;

/**
 * Liga ou desliga "Alguém indo ao mercado" num navegador da própria pessoa
 * (o endereço de outra conta não muda nada). Devolve se mudou algum.
 * Desligando, o aviso de ida que estava na fila deste navegador sai.
 */
create function public.set_push_market_trips(p_endpoint text, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub uuid;
begin
  update public.push_subscriptions s set market_trips = coalesce(p_enabled, true)
    where s.endpoint = p_endpoint and s.user_id = auth.uid()
    returning s.id into sub;
  if sub is null then
    return false;
  end if;
  if not coalesce(p_enabled, true) then
    delete from public.push_schedule p
      where p.subscription_id = sub and p.data ? 'server' and p.data ->> 'reminder' like 'ida:%';
  end if;
  return true;
end;
$$;

-- Cada navegador tira da agenda dele, ao abrir o app, o que não conhece
-- (prune_push_schedule, chamada por reconcileReminders): o aviso de ida, que
-- o servidor pôs ali e o navegador nunca viu, sairia antes de ser enviado.
-- As linhas postas pelo servidor (data.server) ficam de fora da poda. O
-- próprio navegador também pode gravar uma linha com data.server (a policy
-- de insert aceita qualquer data): isso só mexe na agenda dele mesmo, e a
-- linha continua contando para o teto de max_push_schedule().
create or replace function public.prune_push_schedule(p_subscription_id uuid, p_keep uuid[])
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
      and not (p.data ? 'server')
    returning p.id
  )
  select count(*)::int from gone;
$$;

revoke execute on function public.announce_market_trip(uuid) from public, anon;
revoke execute on function public.end_market_trip(uuid) from public, anon;
revoke execute on function public.set_push_market_trips(text, boolean) from public, anon;
grant execute on function public.announce_market_trip(uuid) to authenticated;
grant execute on function public.end_market_trip(uuid) to authenticated;
grant execute on function public.set_push_market_trips(text, boolean) to authenticated;
