-- Divisão de gastos entre moradores: quem pagou cada nota (gastos e contas já
-- guardam), o peso de cada morador na divisão e os acertos entre eles.

alter table public.receipts add column paid_by uuid default auth.uid() references auth.users (id) on delete set null;
update public.receipts set paid_by = created_by where paid_by is null;

-- Sem linha, o morador pesa 1 (divisão igual). Peso 2 paga o dobro de quem tem 1.
create table public.split_weights (
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  weight numeric(6, 2) not null check (weight > 0 and weight <= 1000),
  primary key (household_id, user_id)
);

-- Acerto de um mês: `from_user` passou `amount` para `to_user` (Pix, dinheiro).
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);
create index settlements_household_month_idx on public.settlements (household_id, month);

-- Só moradores da casa entram na divisão e nos acertos.
create function public.is_household_member(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.user_id = p_user and m.household_id = public.current_household_id()
  );
$$;
revoke execute on function public.is_household_member(uuid) from public, anon;
grant execute on function public.is_household_member(uuid) to authenticated;

alter table public.split_weights enable row level security;
create policy "household members manage split weights" on public.split_weights for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()) and public.is_household_member(user_id));

alter table public.settlements enable row level security;
create policy "household members manage settlements" on public.settlements for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (
    household_id = (select public.current_household_id())
    and public.is_household_member(from_user)
    and public.is_household_member(to_user)
  );
