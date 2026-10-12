-- Compromissos da família: o que não mora em outra parte do app ("Natação da
-- Ana, terça e quinta às 16h, o Beto leva, a Carla busca, levar touca e
-- toalha", "Reunião da escola", "Festa do João"). A agenda só mostrava o que
-- vinha de consultas, vacinas, contas, tarefas, documentos e garantias.
--
-- Um compromisso que se repete é uma linha só, com a regra (toda semana nos
-- dias escolhidos, todo mês, todo ano, até uma data): as datas saem da regra,
-- no app (src/domain/familyEvents.ts). O que muda num dia ("neste dia a vó
-- leva", "não vai ter neste dia") fica em family_event_days, por compromisso e
-- data. Editar o compromisso muda todas as vezes; apagar leva os dias junto.
--
-- Os aniversários não têm tabela: saem de people.birth_date.

-- Dias da semana de um compromisso semanal: de 1 a 7 dias, 0 = domingo (como
-- Date.getDay() e medications.weekdays), sem repetir.
create function public.is_weekday_set(p_days smallint[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_days is not null
    and cardinality(p_days) between 1 and 7
    and p_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
    and cardinality(p_days) = (select count(distinct d) from unnest(p_days) as d);
$$;

create table public.family_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  -- O dia do compromisso; quando repete, o primeiro dia da regra.
  starts_on date not null,
  -- Sem hora de início, é o dia todo.
  start_time time,
  end_time time,
  -- De quem é (pessoa ou pet); nulo: da família toda.
  person_id uuid,
  -- Quem leva e quem busca: fichas de gente da casa (todo morador tem a sua, e
  -- os dependentes sem conta também).
  take_by uuid,
  pick_up_by uuid,
  location text check (length(location) <= 200),
  -- O que levar ("touca e toalha", "presente").
  bring text check (length(bring) <= 300),
  notes text check (length(notes) <= 2000),
  recurrence text not null default 'none' check (recurrence in ('none', 'weekly', 'monthly', 'yearly')),
  weekdays smallint[],
  -- Último dia da repetição (inclusive); nulo: não acaba.
  until_on date,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  constraint family_events_times check (end_time is null or (start_time is not null and end_time > start_time)),
  constraint family_events_weekdays check (
    case when recurrence = 'weekly' then public.is_weekday_set(weekdays) else weekdays is null end
  ),
  constraint family_events_until check (until_on is null or (recurrence <> 'none' and until_on >= starts_on)),
  -- Ficha apagada (ou de quem saiu da casa e teve a ficha removida) não apaga o
  -- compromisso: só o nome some dele.
  foreign key (person_id, household_id)
    references public.people (id, household_id) on delete set null (person_id),
  foreign key (take_by, household_id)
    references public.people (id, household_id) on delete set null (take_by),
  foreign key (pick_up_by, household_id)
    references public.people (id, household_id) on delete set null (pick_up_by)
);
create index family_events_household_starts_idx on public.family_events (household_id, starts_on);

alter table public.family_events enable row level security;
create policy "household members manage family events" on public.family_events for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

-- O que muda num dia de um compromisso. override_take / override_pick_up
-- separam "neste dia ninguém leva" (true, com take_by nulo) de "como sempre"
-- (false). Linha sem nada mudado não fica; mudança de um dia que deixou de ser
-- do compromisso (a regra foi editada) é ignorada pelo app, que a apaga ao
-- salvar o compromisso.
create table public.family_event_days (
  event_id uuid not null,
  occurs_on date not null,
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  -- "Não vai ter neste dia".
  cancelled boolean not null default false,
  override_take boolean not null default false,
  take_by uuid,
  override_pick_up boolean not null default false,
  pick_up_by uuid,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (event_id, occurs_on),
  constraint family_event_days_changed check (cancelled or override_take or override_pick_up),
  constraint family_event_days_take check (override_take or take_by is null),
  constraint family_event_days_pick_up check (override_pick_up or pick_up_by is null),
  -- Com a casa na chave: o dia é sempre da mesma casa do compromisso.
  foreign key (event_id, household_id)
    references public.family_events (id, household_id) on delete cascade,
  -- Ficha apagada: naquele dia fica sem ninguém (a mudança continua marcada).
  foreign key (take_by, household_id)
    references public.people (id, household_id) on delete set null (take_by),
  foreign key (pick_up_by, household_id)
    references public.people (id, household_id) on delete set null (pick_up_by)
);
create index family_event_days_household_idx on public.family_event_days (household_id, occurs_on);

alter table public.family_event_days enable row level security;
create policy "household members manage family event days" on public.family_event_days for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

-- Quem leva e quem busca é gente: pet não dirige. A chave estrangeira já
-- garante que a ficha é da casa; aqui, o tipo dela. security definer: a regra
-- vale para quem quer que grave.
create function public.family_event_drivers_are_people()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.people p
    where p.id in (new.take_by, new.pick_up_by) and p.kind <> 'pessoa'
  ) then
    raise exception 'Quem leva e quem busca precisam ser pessoas, não pets.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.family_event_drivers_are_people() from public, anon, authenticated;

create trigger family_events_drivers_are_people
  before insert or update of take_by, pick_up_by on public.family_events
  for each row execute function public.family_event_drivers_are_people();

create trigger family_event_days_drivers_are_people
  before insert or update of take_by, pick_up_by on public.family_event_days
  for each row execute function public.family_event_drivers_are_people();

-- A ficha que vira pet (cadastrada como pessoa por engano) deixa de levar e
-- buscar, como se tivesse sido apagada.
create function public.pet_stops_driving()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.family_events set
    take_by = nullif(take_by, new.id),
    pick_up_by = nullif(pick_up_by, new.id)
  where household_id = new.household_id and new.id in (take_by, pick_up_by);
  update public.family_event_days set
    take_by = nullif(take_by, new.id),
    pick_up_by = nullif(pick_up_by, new.id)
  where household_id = new.household_id and new.id in (take_by, pick_up_by);
  return new;
end;
$$;
revoke execute on function public.pet_stops_driving() from public, anon, authenticated;

create trigger people_pet_stops_driving
  after update of kind on public.people
  for each row
  when (old.kind = 'pessoa' and new.kind <> 'pessoa')
  execute function public.pet_stops_driving();
