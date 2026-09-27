-- Cardápio da semana: um prato por refeição (almoço e jantar) por dia. O
-- Nuke sugere a semana; a casa ajusta à mão.

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  day date not null,
  meal text not null check (meal in ('almoco', 'jantar')),
  dish text not null check (length(trim(dish)) between 1 and 200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (household_id, day, meal)
);

alter table public.menu_items enable row level security;
create policy "household members manage the menu" on public.menu_items for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));
