-- O que acaba sem passar por nota fiscal: gás de cozinha, galão de água,
-- ração, areia do gato, refil do filtro. Chegam por entrega ou sem nota, duram
-- semanas e ninguém lembra quando o atual começou. A casa cadastra essas
-- poucas coisas ("reposições") e anota cada troca; o app calcula, só pelas
-- trocas, quando a atual deve acabar (src/domain/supplies.ts) e avisa uns
-- dias antes.

create table public.supplies (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  -- Para o ícone e a estimativa de partida (SUPPLY_KINDS no app).
  kind text not null default 'outros' check (kind in ('gas', 'agua', 'racao', 'areia', 'filtro', 'outros')),
  -- Quanto a pessoa acha que dura, em dias. Pesa só nos primeiros ciclos, até a
  -- casa ter as próprias trocas.
  typical_days integer check (typical_days between 1 and 730),
  notes text check (length(notes) <= 200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, household_id)
);
create index supplies_household_idx on public.supplies (household_id);

-- Uma troca: o dia em que um novo começou. É a única fonte da previsão.
create table public.supply_refills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  supply_id uuid not null,
  -- Dia local de quem anotou. "Não depois de hoje" quem confere é o app: um
  -- check com a data de hoje não seria imutável (e o dia depende do fuso).
  -- Aqui ficam só limites fixos, contra erro de digitação no ano.
  refilled_on date not null check (refilled_on between date '2000-01-01' and date '2100-12-31'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Uma troca por dia: o segundo toque em "Troquei hoje" é a mesma troca (o
  -- app grava com on conflict do nothing).
  unique (supply_id, refilled_on),
  -- Com a casa na chave: a troca não aponta para a reposição de outra casa.
  foreign key (supply_id, household_id)
    references public.supplies (id, household_id) on delete cascade
);
create index supply_refills_household_idx on public.supply_refills (household_id);

-- Privilégios explícitos: a partir de 30/10/2026 o Supabase não expõe mais tabela
-- nova do schema public à Data API por padrão, e esta migração pode ser
-- aplicada depois dessa data (as tabelas que já existem ficam com os delas).
-- Sem isto, o app receberia "permission denied" (42501) nas duas. As políticas
-- abaixo são só para quem está logado: anon não ganha nada.
revoke all on public.supplies, public.supply_refills from anon, authenticated;
grant select, insert, update, delete on public.supplies, public.supply_refills to authenticated;
grant all on public.supplies, public.supply_refills to service_role;

alter table public.supplies enable row level security;
create policy "household members manage supplies" on public.supplies for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

alter table public.supply_refills enable row level security;
create policy "household members manage supply_refills" on public.supply_refills for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));
