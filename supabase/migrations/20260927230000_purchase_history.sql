-- Histórico de compras: o que saiu do carrinho quando a lista foi limpa.
-- Junto com os itens ainda no carrinho e as notas confirmadas, alimenta os
-- "Comprados recentemente" da lista, para montar a próxima sem digitar.

create table public.purchase_history (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  product_id uuid,
  name text not null check (length(trim(name)) > 0),
  category text not null default 'outros',
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit text not null default 'un' check (unit in ('un', 'kg', 'g', 'l', 'ml')),
  bought_at timestamptz not null default now(),
  foreign key (product_id, household_id)
    references public.products (id, household_id) on delete set null (product_id)
);
create index purchase_history_household_bought_idx on public.purchase_history (household_id, bought_at desc);

alter table public.purchase_history enable row level security;
create policy "household members read purchase history" on public.purchase_history for select to authenticated
  using (household_id = (select public.current_household_id()));
create policy "household members forget purchases" on public.purchase_history for delete to authenticated
  using (household_id = (select public.current_household_id()));

-- Limpar o carrinho: os itens marcados saem da lista e entram no histórico,
-- na mesma transação, só na casa de quem chama. É o único caminho de
-- inserção no histórico (a tabela não tem policy de insert).
-- Limpa o carrinho com o que a pessoa viu no toque (id e selo de cada
-- item): um item marcado depois, por outra pessoa ou antes de a fila
-- offline andar, fica na lista.
create function public.clear_checked_items(p_list_id uuid, p_ids uuid[], p_tokens uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid := public.current_household_id();
  moved integer;
begin
  if hid is null then
    raise exception 'sem casa' using errcode = '42501';
  end if;
  with gone as (
    delete from public.shopping_list_items i
    where i.list_id = p_list_id and i.household_id = hid and i.checked_at is not null
      and i.id = any(p_ids) and i.toggle_token = any(p_tokens)
    returning i.product_id, i.name, i.category, i.quantity, i.unit, i.checked_at
  )
  insert into public.purchase_history (household_id, product_id, name, category, quantity, unit, bought_at)
  select hid, product_id, name, category, quantity, unit, checked_at from gone;
  get diagnostics moved = row_count;
  return moved;
end;
$$;

revoke execute on function public.clear_checked_items(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.clear_checked_items(uuid, uuid[], uuid[]) to authenticated;
