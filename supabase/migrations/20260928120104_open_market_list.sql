-- A lista de mercado aberta mais recente da casa; sem nenhuma, cria uma.
-- Procurar e criar numa transação só, com trava por casa: duas pessoas
-- pondo itens ao mesmo tempo, sem lista aberta, não criam duas "Mercado".
create function public.open_market_list(p_name text default 'Mercado')
returns table (id uuid, name text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  hid uuid := public.current_household_id();
begin
  if hid is null then
    raise exception 'sem casa' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('open_market_list:' || hid::text, 0));
  return query
    select l.id, l.name from public.shopping_lists l
    where l.household_id = hid and l.kind = 'mercado' and l.archived_at is null
    order by l.created_at desc
    limit 1;
  if found then
    return;
  end if;
  return query
    insert into public.shopping_lists as l (name, kind)
    values (coalesce(nullif(trim(p_name), ''), 'Mercado'), 'mercado')
    returning l.id, l.name;
end;
$$;

revoke execute on function public.open_market_list(text) from public, anon;
grant execute on function public.open_market_list(text) to authenticated;
