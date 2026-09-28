-- Despensa pelo carrinho: ao limpar o carrinho (todo ou um item só), o que a
-- pessoa confirmou vai também para a despensa, com a quantidade comprada. Na
-- mesma transação da limpeza: só entra o que saiu de fato do carrinho (id e
-- selo batendo), e a limpeza que ficou na fila offline leva a despensa junto.
--
-- p_pantry: [{ id, quantity, unit?, purchased_on, expires_on?, expiry_source? }]
-- (id do item do carrinho; o resto do item vem da própria lista).

drop function public.clear_checked_items(uuid, uuid[], uuid[]);

create function public.clear_checked_items(
  p_list_id uuid,
  p_ids uuid[],
  p_tokens uuid[],
  p_pantry jsonb default '[]'::jsonb
)
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
  if jsonb_typeof(coalesce(p_pantry, '[]'::jsonb)) <> 'array' then
    raise exception 'p_pantry deve ser uma lista' using errcode = '22023';
  end if;
  with gone as (
    delete from public.shopping_list_items i
    where i.list_id = p_list_id and i.household_id = hid and i.checked_at is not null
      and i.id = any(p_ids) and i.toggle_token = any(p_tokens)
    returning i.id, i.product_id, i.name, i.category, i.quantity, i.unit, i.checked_at
  ),
  history as (
    insert into public.purchase_history (household_id, product_id, name, category, quantity, unit, bought_at)
    select hid, product_id, name, category, quantity, unit, checked_at from gone
    returning 1
  ),
  pantry as (
    insert into public.pantry_items (
      household_id, product_id, name, category, quantity, unit, purchased_on, expires_on, expiry_source
    )
    select distinct on (g.id)
      hid,
      g.product_id,
      g.name,
      g.category,
      coalesce(p.quantity, g.quantity),
      coalesce(nullif(p.unit, ''), g.unit),
      coalesce(p.purchased_on, current_date),
      p.expires_on,
      case when p.expires_on is null then null else nullif(p.expiry_source, '') end
    from gone g
    join jsonb_to_recordset(coalesce(p_pantry, '[]'::jsonb))
      as p (id uuid, quantity numeric, unit text, purchased_on date, expires_on date, expiry_source text)
      on p.id = g.id
    returning 1
  )
  select count(*) into moved from history;
  return moved;
end;
$$;

revoke execute on function public.clear_checked_items(uuid, uuid[], uuid[], jsonb) from public, anon;
grant execute on function public.clear_checked_items(uuid, uuid[], uuid[], jsonb) to authenticated;
