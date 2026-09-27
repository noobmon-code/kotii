-- Tarefas com pontos para as crianças (fichas sem conta no app): a tarefa pode
-- ser de uma criança e valer pontos; quem marcar como feita (um adulto) credita
-- a criança. Os pontos viram prêmios combinados em casa (sorvete, passeio).

alter table public.chores
  add column kid_id uuid,
  add column points integer not null default 0 check (points between 0 and 1000);
alter table public.chores
  add foreign key (kid_id, household_id)
  references public.people (id, household_id) on delete set null (kid_id);

alter table public.chore_completions
  add column person_id uuid,
  add column points integer not null default 0 check (points >= 0);
alter table public.chore_completions
  add foreign key (person_id, household_id)
  references public.people (id, household_id) on delete cascade;

create table public.point_redemptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  person_id uuid not null,
  title text not null check (length(trim(title)) between 1 and 120),
  points integer not null check (points > 0),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (person_id, household_id)
    references public.people (id, household_id) on delete cascade
);

alter table public.point_redemptions enable row level security;
create policy "household members manage point redemptions" on public.point_redemptions for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

-- Saldo de cada ficha: pontos ganhos menos os trocados.
create view public.kid_points with (security_invoker = true) as
  select p.id as person_id,
    coalesce((select sum(c.points) from public.chore_completions c where c.person_id = p.id), 0)
      - coalesce((select sum(r.points) from public.point_redemptions r where r.person_id = p.id), 0) as balance
  from public.people p;

-- Concluir credita a criança da tarefa com os pontos dela.
create or replace function public.complete_chore(p_chore_id uuid, p_today date)
returns public.chores
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.chores;
begin
  select * into c from public.chores where id = p_chore_id for update;
  if not found then
    raise exception 'chore not found' using errcode = 'P0002';
  end if;

  insert into public.chore_completions (household_id, chore_id, person_id, points)
  values (c.household_id, c.id, c.kid_id, case when c.kid_id is null then 0 else c.points end);

  update public.chores set
    due_on = case c.recurrence
      when 'daily' then p_today + c.interval_count
      when 'weekly' then p_today + 7 * c.interval_count
      when 'monthly' then (p_today + make_interval(months => c.interval_count))::date
      else c.due_on
    end,
    active = c.recurrence <> 'none'
  where id = c.id
  returning * into c;

  return c;
end;
$$;
