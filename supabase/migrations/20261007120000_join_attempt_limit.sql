-- Limite de tentativas de entrar numa casa pelo código. O código tem 6
-- caracteres de um alfabeto de 32 (um bilhão de combinações), e nada
-- impedia uma conta de tentar sem parar. Agora cada conta tem até
-- max_join_attempts() erros na mesma hora (contada do primeiro erro);
-- depois disso, join_household recusa (NK004) até essa hora passar, e só
-- ela: entrar numa casa não zera a contagem.
--
-- Para o erro ficar registrado, join_household deixa de lançar exceção no
-- código errado (a exceção desfaria a gravação): devolve nulo, e o app
-- mostra "código não encontrado".

create table public.join_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Erros desde o começo da hora corrente (window_started_at): uma hora
  -- depois do primeiro erro a contagem recomeça, erre quando errar.
  failed integer not null default 0 check (failed >= 0),
  window_started_at timestamptz not null default now()
);
-- Só join_household lê e grava.
alter table public.join_attempts enable row level security;
revoke all on public.join_attempts from anon, authenticated;

create function public.max_join_attempts()
returns int
language sql
immutable
set search_path = ''
as $$ select 10 $$;
revoke execute on function public.max_join_attempts() from public, anon;
grant execute on function public.max_join_attempts() to authenticated;

create or replace function public.join_household(p_invite_code text, p_display_name text)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.households;
  attempts public.join_attempts;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('households:' || auth.uid()::text, 0));

  select * into attempts from public.join_attempts a where a.user_id = auth.uid() for update;
  if found and attempts.failed >= public.max_join_attempts() and attempts.window_started_at > now() - interval '1 hour' then
    raise exception 'too many invite attempts' using errcode = 'NK004';
  end if;

  -- FOR UPDATE: quem chega com o código antigo enquanto o dono o troca
  -- (regenerate_invite_code) espera a troca e, aí, não acha mais a casa.
  select * into h from public.households where invite_code = upper(trim(p_invite_code)) for update;
  if not found then
    insert into public.join_attempts as a (user_id, failed, window_started_at)
    values (auth.uid(), 1, now())
    on conflict (user_id) do update
      set failed = case when a.window_started_at > now() - interval '1 hour' then a.failed + 1 else 1 end,
          window_started_at = case when a.window_started_at > now() - interval '1 hour' then a.window_started_at else now() end;
    return null;
  end if;
  if exists (select 1 from public.household_members m where m.user_id = auth.uid() and m.household_id = h.id) then
    raise exception 'already a member of this household' using errcode = '23505';
  end if;
  if (select count(*) from public.household_members m where m.user_id = auth.uid()) >= public.max_households_per_user() then
    raise exception 'household limit reached' using errcode = 'NK002';
  end if;

  insert into public.household_members (household_id, user_id, display_name, role, selected_at)
  values (h.id, auth.uid(), trim(p_display_name), 'member', now());
  -- Entrar não zera os erros: senão bastaria entrar numa casa conhecida (e
  -- sair) a cada nove erros para tentar sem parar.

  return h;
end;
$$;
