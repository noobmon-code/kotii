-- A casa aberta em cada sessão (cada aparelho logado). O tempo real (a lista
-- de compras ao vivo) confere as regras de acesso só com o token, sem os
-- cabeçalhos do pedido: sem x-household-id, current_household_id() usa a casa
-- que esta sessão abriu por último (o token traz o session_id). Sessão que
-- nunca escolheu (app antigo) segue na primeira casa, como antes.

create table public.household_sessions (
  session_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  updated_at timestamptz not null default now()
);
create index household_sessions_user_idx on public.household_sessions (user_id, updated_at);
create index household_sessions_household_idx on public.household_sessions (household_id);

-- Só as funções abaixo leem e gravam.
alter table public.household_sessions enable row level security;
revoke all on public.household_sessions from anon, authenticated;

create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with wanted as (
    select nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-household-id', '') as id
  ),
  here as (
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'session_id', '') as session_id
  )
  select case
    when (select id from wanted) is not null then (
      select m.household_id from public.household_members m
      where m.user_id = auth.uid() and m.household_id::text = (select id from wanted)
    )
    else coalesce(
      (
        select s.household_id from public.household_sessions s
        join public.household_members m on m.household_id = s.household_id and m.user_id = s.user_id
        where s.session_id = (select session_id from here) and s.user_id = auth.uid()
      ),
      (
        select m.household_id from public.household_members m
        where m.user_id = auth.uid()
        order by m.joined_at, m.household_id
        limit 1
      )
    )
  end;
$$;

-- Abrir uma casa: sobe na lista da pessoa e vale para esta sessão.
create or replace function public.select_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid text := nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'session_id', '');
begin
  update public.household_members m set selected_at = now()
    where m.user_id = auth.uid() and m.household_id = p_household_id;
  if not found then
    raise exception 'user does not belong to this household' using errcode = 'P0002';
  end if;
  if sid is not null then
    insert into public.household_sessions as s (session_id, user_id, household_id)
    values (sid, auth.uid(), p_household_id)
    on conflict (session_id) do update set household_id = excluded.household_id, updated_at = now()
      where s.user_id = excluded.user_id;
    -- Sessões esquecidas (meses sem abrir o app) saem.
    delete from public.household_sessions s
      where s.user_id = auth.uid() and s.updated_at < now() - interval '90 days';
  end if;
end;
$$;
