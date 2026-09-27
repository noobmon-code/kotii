-- Orçamento do mês por categoria de gasto: um limite por categoria, que
-- vale para todo mês até ser mudado. O gasto do mês vem do resumo do app
-- (notas, contas pagas e gastos avulsos).

create table public.budgets (
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  category public.finance_category not null,
  monthly_limit numeric(12, 2) not null check (monthly_limit > 0),
  updated_at timestamptz not null default now(),
  primary key (household_id, category)
);

alter table public.budgets enable row level security;
create policy "household members manage budgets" on public.budgets for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));
