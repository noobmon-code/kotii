-- "Acabou" na despensa: o item vai para uma lista que a pessoa escolheu (ou a
-- mais nova, que o app escolheu), e só se ela ainda está aberta. Numa
-- transação só: a linha da lista fica travada até o item entrar, então
-- arquivar ou apagar a lista em outro aparelho espera (pôs, depois arquivou),
-- em vez de o item ir para uma lista que já não aparece enquanto a despensa
-- dá baixa nele. Lista que não está aberta (ou não é da casa): P0002, e nada
-- é gravado. Pendente (não riscado) nesta lista com o mesmo nome, sem
-- diferença de maiúsculas e de espaços nas pontas, não entra de novo: duas
-- pessoas tocando ao mesmo tempo esperam a mesma trava, e a segunda acha o
-- item da primeira. `added` diz se o item entrou agora.
create function public.add_to_list(
  p_list_id uuid,
  p_name text,
  p_category text default 'outros',
  p_product_id uuid default null,
  p_quantity numeric default 1,
  p_unit text default 'un'
)
returns table (list_id uuid, list_name text, item_id uuid, added boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_list_name text;
  v_item_id uuid;
begin
  if public.current_household_id() is null then
    raise exception 'sem casa' using errcode = '42501';
  end if;
  select l.name into v_list_name
  from public.shopping_lists l
  where l.id = p_list_id and l.archived_at is null
  for update;
  if not found then
    raise exception 'list is not open' using errcode = 'P0002';
  end if;
  select i.id into v_item_id
  from public.shopping_list_items i
  where i.list_id = p_list_id
    and i.checked_at is null
    and lower(trim(i.name)) = lower(trim(p_name))
  order by i.created_at
  limit 1;
  if found then
    return query select p_list_id, v_list_name, v_item_id, false;
    return;
  end if;
  return query
    insert into public.shopping_list_items as i (list_id, name, category, product_id, quantity, unit)
    values (p_list_id, trim(p_name), coalesce(p_category, 'outros'), p_product_id, coalesce(p_quantity, 1), coalesce(p_unit, 'un'))
    returning p_list_id, v_list_name, i.id, true;
end;
$$;

revoke execute on function public.add_to_list(uuid, text, text, uuid, numeric, text) from public, anon;
grant execute on function public.add_to_list(uuid, text, text, uuid, numeric, text) to authenticated;
