-- Painel do app (Configurações → Painel): os números de uso do Kotii para quem mantém o app. Quantas contas,
-- quantas pessoas abriram o app nos últimos dias e de que tipo de aparelho, quanto a IA e o Nuke foram usados,
-- quantas casas usam cada função.
--
-- 1. Só totais. A app_dashboard nunca devolve id, e-mail ou nome de pessoa, nem id ou nome de casa, e nada por
--    pessoa ou por casa. Não lê profiles, o conteúdo de fin_*, nem nada por mercado ou por dia de shared_prices
--    (só a contagem de linhas). As conversas do Nuke não ficam guardadas em lugar nenhum.
-- 2. Só quem está em app_admins vê; os outros recebem 42501. Liberar é manual, pelo editor SQL do Supabase (o
--    select tem de devolver uma linha):
--      insert into public.app_admins (user_id)
--      select id from auth.users where email = '<e-mail de quem mantém o app>'
--      on conflict do nothing;
--    Tirar:
--      delete from public.app_admins
--      where user_id = (select id from auth.users where email = '<e-mail>');
-- 3. "Ativa" é quem deu algum sinal do Auth ou abriu uma casa: entrou na conta (last_sign_in_at), uma sessão
--    criada ou renovada (o token vale uma hora: abrir o app depois disso renova), ou uma casa aberta
--    (household_sessions). Sair da conta apaga as linhas da sessão, e com elas os sinais. Por isso o número de
--    cada dia fica guardado (app_daily_stats) pela tarefa app-daily-stats, de hora em hora, e só sobe: fica
--    de fora só quem entra e sai entre duas fotos. Os 30 dias antes desta migração são um piso: contam só quem
--    ainda está com a sessão (ou o último login) daquele dia.
-- 4. Contas são as que existem: sem as apagadas (deleted_at) e sem as anônimas.

-- =============================================================================
-- Quem vê o painel
-- =============================================================================

-- Sem policy e sem grant para o app: ninguém lê pela API. Só as funções abaixo (como dono) consultam.
create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;
grant all on public.app_admins to service_role;

-- =============================================================================
-- O número de cada dia
-- =============================================================================

-- Uma linha por dia de São Paulo, só com totais (nenhum id de pessoa ou casa). ai_month é o uso de IA do mês
-- daquele dia, somado entre as casas, como estava na hora da foto ({"chat": 4, "photo": 8}; '{}' = não se
-- sabe). backfilled: o dia veio da migração, não da foto de hora em hora.
create table public.app_daily_stats (
  day date primary key,
  accounts integer not null check (accounts >= 0),
  active_users integer not null check (active_users >= 0),
  households integer not null check (households >= 0),
  ai_month jsonb not null default '{}'::jsonb,
  backfilled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.app_daily_stats enable row level security;
revoke all on public.app_daily_stats from anon, authenticated;
grant all on public.app_daily_stats to service_role;

-- =============================================================================
-- Peças internas (sem permissão para o app: rodam dentro das funções abaixo, como dono)
-- =============================================================================

-- Os sinais de que alguém abriu o app: (pessoa, quando), só de contas que existem, não apagadas e não anônimas.
-- refreshed_at é timestamp sem fuso, com a hora de UTC; o user_id de refresh_tokens é texto.
create function public.app_signals()
returns table (user_id uuid, seen_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with accounts as (
    select u.id, u.last_sign_in_at
    from auth.users u
    where u.deleted_at is null and not u.is_anonymous
  ),
  signals (user_id, seen_at) as (
    select a.id, a.last_sign_in_at from accounts a
    union all
    select s.user_id, x.seen_at
      from auth.sessions s
      cross join lateral (values (s.created_at), (s.updated_at), (s.refreshed_at at time zone 'UTC')) as x (seen_at)
    union all
    select a.id, rt.created_at from auth.refresh_tokens rt join accounts a on a.id::text = rt.user_id
    union all
    select hs.user_id, hs.updated_at from public.household_sessions hs
  )
  select g.user_id, g.seen_at
  from signals g
  where g.seen_at is not null
    and exists (select 1 from accounts a where a.id = g.user_id);
$$;

revoke execute on function public.app_signals() from public, anon, authenticated;

-- Quem deu algum sinal em [p_from, p_to): uma linha por pessoa.
create function public.app_activity_users(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct g.user_id
  from public.app_signals() g
  where g.seen_at >= p_from and g.seen_at < p_to;
$$;

revoke execute on function public.app_activity_users(timestamptz, timestamptz) from public, anon, authenticated;

-- Cada conta, quando foi criada (não é um sinal) e o último sinal dela (nulo quando não há nenhum).
create function public.app_last_seen()
returns table (user_id uuid, created_at timestamptz, last_seen timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.created_at, max(g.seen_at)
  from auth.users u
  left join public.app_signals() g on g.user_id = u.id
  where u.deleted_at is null and not u.is_anonymous
  group by u.id, u.created_at;
$$;

revoke execute on function public.app_last_seen() from public, anon, authenticated;

-- O aparelho, pelo user agent da sessão: o navegador diz o sistema; o app instalado (quando sair) manda o da
-- rede do sistema (CFNetwork/Darwin no iPhone, okhttp no Android). O iPad que pede o site de computador diz
-- "Macintosh" e conta como computador.
create function public.app_platform(p_user_agent text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_user_agent ~* '(iphone|ipad|ipod)' then 'ios'
    when p_user_agent ~* 'android' then 'android'
    when p_user_agent ~* '(cfnetwork|darwin)' then 'ios'
    when p_user_agent ~* 'okhttp' then 'android'
    when p_user_agent ~* '(windows|macintosh|x11|\mcros\M|linux)' then 'computador'
    else 'outro'
  end;
$$;

revoke execute on function public.app_platform(text) from public, anon, authenticated;

-- Pelo navegador (o user agent começa com "Mozilla/") ou pelo app instalado; sem user agent, outro.
create function public.app_client(p_user_agent text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(btrim(p_user_agent), '') = '' then 'outro'
    when p_user_agent ~* '^mozilla/' then 'navegador'
    else 'app'
  end;
$$;

revoke execute on function public.app_client(text) from public, anon, authenticated;

-- =============================================================================
-- A foto do dia, de hora em hora
-- =============================================================================

-- Grava (ou atualiza) a linha de hoje, no dia de São Paulo. As pessoas ativas só sobem: quem sai da conta mais
-- tarde perde as linhas da sessão, e o dia não pode descer por isso.
create function public.snapshot_app_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_start timestamptz := v_today::timestamp at time zone 'America/Sao_Paulo';
  v_end timestamptz := (v_today + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  insert into public.app_daily_stats as s (day, accounts, active_users, households, ai_month, backfilled, updated_at)
  values (
    v_today,
    (select count(*) from public.app_last_seen() l where l.created_at < v_end),
    (select count(*) from public.app_activity_users(v_start, v_end)),
    (select count(*) from public.households h where h.created_at < v_end),
    coalesce(
      (select jsonb_object_agg(m.kind, m.uses)
       from (select u.kind, sum(u.count) as uses from public.ai_usage u where u.month = public.ai_month() group by u.kind) m),
      '{}'::jsonb
    ),
    false,
    now()
  )
  on conflict (day) do update set
    accounts = excluded.accounts,
    active_users = greatest(s.active_users, excluded.active_users),
    households = excluded.households,
    ai_month = excluded.ai_month,
    backfilled = false,
    updated_at = now();
end;
$$;

revoke execute on function public.snapshot_app_stats() from public, anon, authenticated;
grant execute on function public.snapshot_app_stats() to service_role;

-- Toda hora aos 59 minutos (UTC; São Paulo está a horas inteiras de UTC, então também aos 59 lá): a das 23h59
-- fecha o dia, e uma que falhar a próxima cobre.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  perform cron.schedule('app-daily-stats', '59 * * * *', 'select public.snapshot_app_stats()');
end;
$$;

-- =============================================================================
-- O painel
-- =============================================================================

create function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins a where a.user_id = (select auth.uid()));
$$;

revoke execute on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

-- Tudo o que a tela mostra, só em totais. "30 dias" é de agora para trás; os dias e os meses são de São Paulo.
create function public.app_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_month text := public.ai_month();
  v_since timestamptz := now() - interval '30 days';
begin
  if not public.is_app_admin() then
    raise exception 'Este painel é só para quem mantém o app.' using errcode = '42501';
  end if;

  return (
    with accounts as (
      select l.user_id, l.created_at, l.last_seen, u.email_confirmed_at
      from public.app_last_seen() l
      join auth.users u on u.id = l.user_id
    ),
    account_totals as (
      select
        count(*) as total,
        count(*) filter (where a.created_at >= now() - interval '7 days') as new_7d,
        count(*) filter (where a.created_at >= v_since) as new_30d,
        count(*) filter (where a.email_confirmed_at is not null) as confirmed,
        count(*) filter (where exists (select 1 from public.household_members m where m.user_id = a.user_id)) as in_household,
        count(*) filter (where a.last_seen >= now() - interval '1 day') as active_d1,
        count(*) filter (where a.last_seen >= now() - interval '7 days') as active_d7,
        count(*) filter (where a.last_seen >= v_since) as active_d30,
        -- Voltou: algum sinal num dia depois do dia em que criou a conta.
        count(*) filter (where a.created_at < now() - interval '7 days') as eligible,
        count(*) filter (
          where a.created_at < now() - interval '7 days'
            and (a.last_seen at time zone 'America/Sao_Paulo')::date > (a.created_at at time zone 'America/Sao_Paulo')::date
        ) as returned
      from accounts a
    ),
    household_totals as (
      select
        (select count(*) from public.households) as total,
        (select count(*) from (
          select 1 from public.household_members m group by m.household_id having count(*) >= 2
        ) as two_or_more) as shared,
        (select count(*) from public.household_members) as members,
        (select count(*) from public.people p where p.kind = 'pessoa' and p.member_user_id is null) as without_app,
        (select count(*) from public.people p where p.kind = 'pet') as pets,
        (select count(*) from public.households h where h.created_at >= v_since) as new_30d
    ),
    -- Os 30 dias que terminam hoje, todos, também os sem conta nova.
    signups as (
      select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'count', d.created) order by d.day) as list
      from (
        select v_today - n as day,
          (select count(*) from accounts a where (a.created_at at time zone 'America/Sao_Paulo')::date = v_today - n) as created
        from generate_series(0, 29) as n
      ) d
    ),
    daily as (
      select coalesce(jsonb_agg(jsonb_build_object(
          'day', to_char(s.day, 'YYYY-MM-DD'),
          'accounts', s.accounts,
          'active_users', s.active_users,
          'households', s.households,
          'ai', s.ai_month,
          'backfilled', s.backfilled
        ) order by s.day), '[]'::jsonb) as list
      from public.app_daily_stats s
      where s.day > v_today - 30 and s.day <= v_today
    ),
    -- Os 6 meses que terminam no de agora: uma linha por mês e tipo que tem uso registrado.
    ai_months as (
      select coalesce(jsonb_agg(jsonb_build_object('month', m.month, 'kind', m.kind, 'uses', m.uses, 'households', m.households)
          order by m.month, m.kind), '[]'::jsonb) as list
      from (
        select u.month, u.kind, sum(u.count) as uses, count(*) filter (where u.count > 0) as households
        from public.ai_usage u
        where u.month >= to_char(date_trunc('month', v_today::timestamp) - interval '5 months', 'YYYY-MM')
          and u.month <= v_month
        group by u.month, u.kind
      ) m
    ),
    -- Os tipos de IA na ordem da tela, com o limite de cada casa no mês.
    ai_kinds as (
      select k.pos, k.kind, public.ai_limit(k.kind) as monthly_limit
      from unnest(array['chat', 'photo', 'menu', 'nfce', 'finance']) with ordinality as k (kind, pos)
    ),
    ai_limits as (
      select
        jsonb_object_agg(k.kind, k.monthly_limit) as limits,
        jsonb_agg(jsonb_build_object('kind', k.kind, 'households', (
          select count(*) from public.ai_usage u
          where u.month = v_month and u.kind = k.kind and u.count >= ceil(0.8 * k.monthly_limit) and u.count < k.monthly_limit
        )) order by k.pos) as near,
        jsonb_agg(jsonb_build_object('kind', k.kind, 'households', (
          select count(*) from public.ai_usage u
          where u.month = v_month and u.kind = k.kind and u.count >= k.monthly_limit
        )) order by k.pos) as reached
      from ai_kinds k
    ),
    -- Cada função: as casas que já usaram (a tabela do que fica) e o uso dos 30 dias (a tabela do que acontece).
    ever (key, household_id) as (
      select distinct 'lista'::text, i.household_id from public.shopping_list_items i
      union all select distinct 'notas', r.household_id from public.receipts r where r.status = 'confirmed'
      union all select distinct 'despensa', p.household_id from public.pantry_items p
      union all select distinct 'gastos', e.household_id from public.expenses e
      union all select distinct 'contas', b.household_id from public.bills b
      union all select distinct 'orcamento', b.household_id from public.budgets b
      union all select distinct 'remedios', m.household_id from public.medications m
      union all select distinct 'consultas', a.household_id from public.appointments a
      union all select distinct 'exames', e.household_id from public.exams e
      union all select distinct 'vacinas', v.household_id from public.vaccines v
      union all select distinct 'tarefas', c.household_id from public.chores c
      union all select distinct 'compromissos', f.household_id from public.family_events f
      union all select distinct 'cardapio', m.household_id from public.menu_items m
      union all select distinct 'suprimentos', s.household_id from public.supplies s
      union all select distinct 'aparelhos', e.household_id from public.equipment e
      union all select distinct 'documentos', d.household_id from public.documents d
      union all select distinct 'prestadores', s.household_id from public.service_providers s
      union all select distinct 'treinos', w.household_id from public.workout_plans w
      union all select distinct 'dieta', d.household_id from public.diet_plans d
    ),
    recent (key, household_id) as (
      select 'lista'::text, i.household_id from public.shopping_list_items i where i.created_at >= v_since
      union all select 'notas', r.household_id from public.receipts r where r.status = 'confirmed' and r.created_at >= v_since
      union all select 'despensa', p.household_id from public.pantry_items p where p.created_at >= v_since
      union all select 'gastos', e.household_id from public.expenses e where e.created_at >= v_since
      union all select 'contas', b.household_id from public.bill_payments b where b.created_at >= v_since
      union all select 'orcamento', b.household_id from public.budgets b where b.updated_at >= v_since
      union all select 'remedios', d.household_id from public.medication_doses d where d.taken_at >= v_since
      union all select 'consultas', a.household_id from public.appointments a where a.created_at >= v_since
      union all select 'exames', e.household_id from public.exams e where e.created_at >= v_since
      union all select 'vacinas', v.household_id from public.vaccines v where v.created_at >= v_since
      union all select 'tarefas', c.household_id from public.chore_completions c where c.completed_at >= v_since
      union all select 'compromissos', f.household_id from public.family_events f where f.created_at >= v_since
      union all select 'cardapio', m.household_id from public.menu_items m where m.created_at >= v_since
      union all select 'suprimentos', s.household_id from public.supply_refills s where s.created_at >= v_since
      union all select 'aparelhos', e.household_id from public.equipment e where e.created_at >= v_since
      union all select 'documentos', d.household_id from public.documents d where d.created_at >= v_since
      union all select 'prestadores', j.household_id from public.service_jobs j where j.created_at >= v_since
      union all select 'treinos', w.household_id from public.workout_logs w where w.created_at >= v_since
      union all select 'dieta', d.household_id from public.diet_plans d where d.created_at >= v_since
    ),
    features as (
      select jsonb_agg(jsonb_build_object(
          'key', f.key,
          'households', (select count(distinct e.household_id) from ever e where e.key = f.key),
          'households_30d', (select count(distinct r.household_id) from recent r where r.key = f.key),
          'events_30d', (select count(*) from recent r where r.key = f.key)
        ) order by f.pos) as list
      from unnest(array[
        'lista', 'notas', 'despensa', 'gastos', 'contas', 'orcamento', 'remedios', 'consultas', 'exames', 'vacinas',
        'tarefas', 'compromissos', 'cardapio', 'suprimentos', 'aparelhos', 'documentos', 'prestadores', 'treinos', 'dieta'
      ]) with ordinality as f (key, pos)
    ),
    receipt_sources as (
      select jsonb_agg(jsonb_build_object('source', s.source, 'receipts_30d', (
          select count(*) from public.receipts r
          where r.status = 'confirmed' and r.source = s.source and r.created_at >= v_since
        )) order by s.pos) as list
      from unnest(array['qrcode', 'ai', 'manual']) with ordinality as s (source, pos)
    ),
    -- As sessões vivas com uso nos 30 dias. Quem usa em dois aparelhos conta nos dois.
    live_sessions as (
      select s.user_id, s.user_agent
      from auth.sessions s
      where greatest(s.created_at, s.updated_at, s.refreshed_at at time zone 'UTC') >= v_since
        and exists (select 1 from accounts a where a.user_id = s.user_id)
    ),
    platforms as (
      select coalesce(jsonb_agg(jsonb_build_object('platform', p.platform, 'users', p.users) order by p.users desc, p.platform), '[]'::jsonb) as list
      from (
        select public.app_platform(l.user_agent) as platform, count(distinct l.user_id) as users
        from live_sessions l
        group by 1
      ) p
    ),
    clients as (
      select coalesce(jsonb_agg(jsonb_build_object('client', c.client, 'users', c.users) order by c.users desc, c.client), '[]'::jsonb) as list
      from (
        select public.app_client(l.user_agent) as client, count(distinct l.user_id) as users
        from live_sessions l
        group by 1
      ) c
    ),
    terms as (
      select coalesce(jsonb_agg(jsonb_build_object('version', t.version, 'users', t.users) order by t.version desc), '[]'::jsonb) as list
      from (select a.version, count(distinct a.user_id) as users from public.terms_acceptances a group by a.version) t
    ),
    beta as (
      select coalesce(jsonb_agg(jsonb_build_object('feature', b.feature, 'users', b.users) order by b.feature), '[]'::jsonb) as list
      from (select a.feature, count(distinct a.user_id) as users from public.beta_access a group by a.feature) b
    )
    select jsonb_build_object(
      'generated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'today', to_char(v_today, 'YYYY-MM-DD'),
      'accounts', jsonb_build_object(
        'total', t.total, 'new_7d', t.new_7d, 'new_30d', t.new_30d, 'confirmed', t.confirmed, 'in_household', t.in_household
      ),
      'active', jsonb_build_object('d1', t.active_d1, 'd7', t.active_d7, 'd30', t.active_d30),
      'retention', jsonb_build_object('eligible', t.eligible, 'returned', t.returned),
      'households', jsonb_build_object(
        'total', h.total, 'shared', h.shared, 'members', h.members,
        'people_without_app', h.without_app, 'pets', h.pets, 'new_30d', h.new_30d
      ),
      'signups', (select list from signups),
      'daily', (select list from daily),
      'ai', jsonb_build_object(
        'month', v_month,
        'limits', (select limits from ai_limits),
        'months', (select list from ai_months),
        'near_limit', (select near from ai_limits),
        'at_limit', (select reached from ai_limits)
      ),
      'features', (select list from features),
      'receipt_sources', (select list from receipt_sources),
      'platforms', (select list from platforms),
      'clients', (select list from clients),
      'push', (
        select jsonb_build_object('subscriptions', count(*), 'users', count(distinct s.user_id))
        from public.push_subscriptions s
      ),
      'terms', (select list from terms),
      'beta', (select list from beta),
      'shared_prices', jsonb_build_object('rows', (select count(*) from public.shared_prices))
    )
    from account_totals t, household_totals h
  );
end;
$$;

revoke execute on function public.app_dashboard() from public, anon;
grant execute on function public.app_dashboard() to authenticated;

-- =============================================================================
-- Os 30 dias antes de hoje, pelo que o Auth ainda guarda, e a foto de hoje
-- =============================================================================

-- Um piso: as pessoas ativas de cada dia são só as que ainda têm a sessão (ou o último login) daquele dia, e as
-- contas, as que ainda existem. O uso de IA de cada dia não se sabe ('{}').
do $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  insert into public.app_daily_stats (day, accounts, active_users, households, ai_month, backfilled)
  select
    d.day,
    (select count(*) from public.app_last_seen() l where l.created_at < d.day_end),
    (select count(*) from public.app_activity_users(d.day_start, d.day_end)),
    (select count(*) from public.households h where h.created_at < d.day_end),
    '{}'::jsonb,
    true
  from (
    select
      v_today - n as day,
      (v_today - n)::timestamp at time zone 'America/Sao_Paulo' as day_start,
      (v_today - n + 1)::timestamp at time zone 'America/Sao_Paulo' as day_end
    from generate_series(1, 30) as n
  ) d
  on conflict (day) do nothing;

  perform public.snapshot_app_stats();
end;
$$;
