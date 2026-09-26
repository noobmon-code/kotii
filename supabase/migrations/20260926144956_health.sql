-- Saúde: pessoas e pets da casa (com ficha), consultas, vacinas, exames,
-- planos de treino e de dieta. Remédios passam a apontar para a pessoa.

-- =============================================================================
-- Pessoas e pets
-- =============================================================================

create table public.people (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  kind text not null default 'pessoa' check (kind in ('pessoa', 'pet')),
  -- Morador com conta no app; dependentes e pets ficam sem.
  member_user_id uuid,
  birth_date date,
  blood_type text check (blood_type in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  allergies text,
  conditions text,
  health_plan text,
  health_plan_number text,
  species text,
  notes text,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, member_user_id),
  foreign key (household_id, member_user_id)
    references public.household_members (household_id, user_id) on delete set null (member_user_id)
);
create unique index people_household_name_key on public.people (household_id, lower(name));

-- Todo morador tem sua pessoa. Se já existe um dependente com o mesmo nome
-- sem conta (ex.: cadastrado pelos pais), ele passa a ser a pessoa do morador.
-- Nome já usado por outro morador ou pet ganha sufixo ("Ana 2").
create function public.ensure_member_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text := trim(new.display_name);
  candidate text := base;
  n int := 1;
begin
  update public.people
    set member_user_id = new.user_id
    where household_id = new.household_id
      and lower(name) = lower(base)
      and member_user_id is null
      and kind = 'pessoa';
  if found then
    return new;
  end if;
  loop
    insert into public.people (household_id, name, member_user_id)
    values (new.household_id, candidate, new.user_id)
    on conflict do nothing;
    exit when found or n >= 20;
    n := n + 1;
    candidate := base || ' ' || n;
  end loop;
  return new;
end;
$$;

revoke execute on function public.ensure_member_person() from public, anon, authenticated;

create trigger household_members_ensure_person
  after insert on public.household_members
  for each row execute function public.ensure_member_person();

insert into public.people (household_id, name, member_user_id)
select household_id, trim(display_name), user_id from public.household_members
on conflict do nothing;

-- Remédios: pessoa por referência (person_name fica como nome de exibição).
alter table public.medications add column person_id uuid;
alter table public.medications
  add foreign key (person_id, household_id)
  references public.people (id, household_id) on delete set null (person_id);

insert into public.people (household_id, name)
select distinct on (household_id, lower(trim(person_name))) household_id, trim(person_name)
from public.medications
order by household_id, lower(trim(person_name))
on conflict do nothing;

update public.medications m
  set person_id = p.id
  from public.people p
  where p.household_id = m.household_id
    and lower(p.name) = lower(trim(m.person_name))
    and m.person_id is null;

-- =============================================================================
-- Consultas
-- =============================================================================

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  person_id uuid not null,
  title text not null check (length(trim(title)) > 0),
  professional text,
  location text,
  starts_at timestamptz not null,
  notes text,
  status text not null default 'agendada' check (status in ('agendada', 'realizada', 'cancelada')),
  created_at timestamptz not null default now(),
  foreign key (person_id, household_id)
    references public.people (id, household_id) on delete cascade
);
create index appointments_household_starts_idx on public.appointments (household_id, starts_at);

-- =============================================================================
-- Vacinas
-- =============================================================================

create table public.vaccines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  person_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  dose text,
  applied_on date,
  next_dose_on date,
  location text,
  lot text,
  notes text,
  created_at timestamptz not null default now(),
  check (applied_on is not null or next_dose_on is not null),
  foreign key (person_id, household_id)
    references public.people (id, household_id) on delete cascade
);
create index vaccines_household_next_idx on public.vaccines (household_id, next_dose_on);

-- =============================================================================
-- Exames: fotos do pedido/laudo e resultados transcritos (sem interpretação)
-- =============================================================================

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  person_id uuid not null,
  title text not null check (length(trim(title)) > 0),
  status text not null default 'realizado' check (status in ('pedido', 'agendado', 'realizado')),
  exam_date date,
  requested_by text,
  lab text,
  notes text,
  file_paths text[] not null default '{}',
  -- [{ name, value, unit, reference, flag }] como impresso no laudo.
  results jsonb not null default '[]' check (jsonb_typeof(results) = 'array'),
  created_at timestamptz not null default now(),
  foreign key (person_id, household_id)
    references public.people (id, household_id) on delete cascade
);
create index exams_household_date_idx on public.exams (household_id, exam_date desc);

-- =============================================================================
-- Treino e dieta: planos vindos do profissional, digitalizados e revisados
-- =============================================================================

create table public.workout_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  person_id uuid not null,
  title text not null check (length(trim(title)) > 0),
  professional text,
  valid_until date,
  notes text,
  -- [{ name, weekdays: [0..6], exercises: [{ name, sets, reps, load, rest, notes }] }]
  sessions jsonb not null default '[]' check (jsonb_typeof(sessions) = 'array'),
  file_paths text[] not null default '{}',
  -- Rascunho até alguém revisar o que a IA leu.
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (person_id, household_id)
    references public.people (id, household_id) on delete cascade
);

create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  plan_id uuid not null,
  session_name text not null,
  done_on date not null default current_date,
  done_by uuid default auth.uid() references auth.users (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  unique (plan_id, session_name, done_on),
  foreign key (plan_id, household_id)
    references public.workout_plans (id, household_id) on delete cascade
);

create table public.diet_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  person_id uuid not null,
  title text not null check (length(trim(title)) > 0),
  professional text,
  valid_until date,
  notes text,
  -- [{ name, time, options: [{ label, items: [{ food, quantity, notes }] }] }]
  meals jsonb not null default '[]' check (jsonb_typeof(meals) = 'array'),
  guidelines jsonb not null default '[]' check (jsonb_typeof(guidelines) = 'array'),
  -- Compras sugeridas a partir da dieta: [{ name, category }]
  shopping_items jsonb not null default '[]' check (jsonb_typeof(shopping_items) = 'array'),
  file_paths text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  foreign key (person_id, household_id)
    references public.people (id, household_id) on delete cascade
);

-- =============================================================================
-- RLS
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'people', 'appointments', 'vaccines', 'exams', 'workout_plans', 'workout_logs', 'diet_plans'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "household members manage %1$s" on public.%1$I for all to authenticated '
      'using (household_id = (select public.current_household_id())) '
      'with check (household_id = (select public.current_household_id()))',
      t
    );
  end loop;
end;
$$;

-- =============================================================================
-- Storage: fotos de exames, fichas de treino e planos de dieta
-- em health/<household_id>/<arquivo>
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('health', 'health', false)
on conflict (id) do nothing;

create policy "household members read health files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'health'
    and (storage.foldername(name))[1] = (select public.current_household_id())::text
  );

create policy "household members upload health files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'health'
    and (storage.foldername(name))[1] = (select public.current_household_id())::text
  );

create policy "household members delete health files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'health'
    and (storage.foldername(name))[1] = (select public.current_household_id())::text
  );
