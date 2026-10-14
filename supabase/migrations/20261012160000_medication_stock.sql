-- Remédios de uso contínuo: quanto ainda tem e até quando a receita vale, para
-- o app avisar antes de a caixa acabar ("Losartana (Ana) acaba em 7 dias") e de
-- a receita vencer. É opcional, por remédio.
--
-- O banco guarda só a contagem (quantas unidades havia e em que dia foram
-- contadas); o que sobra hoje é uma conta do app pelas doses previstas desde
-- então (src/domain/medicationStock.ts), não pelas doses marcadas. Sem tabela
-- nova: as colunas ficam sob a regra de acesso que a tabela já tem
-- (household_id = current_household_id()). A única função nova,
-- open_pharmacy_list, acha ou cria a lista da farmácia ("Pôr na lista da
-- farmácia").
--
-- As quantidades têm teto, e não só piso: num numeric sem tamanho, NaN é maior
-- que qualquer número e passaria num ">= 0" sozinho (Infinity também). O teto
-- fica acima do que o app grava (até 99999 por contagem, duas somadas em
-- "Comprei mais", e até 1000 por dose).
--
-- As duas datas ficam entre 2000 e 2100 (o mesmo intervalo que o formulário
-- aceita, MIN_STOCK_DATE e MAX_STOCK_DATE): a conta do app anda dia a dia a
-- partir do dia da contagem, e um date aceita 'infinity' e o ano 9999, com os
-- quais ela não terminaria.

alter table public.medications
  -- Unidades (comprimidos, cápsulas, doses, ml) na última contagem; nulo: o app não acompanha o estoque.
  add column stock_count numeric check (stock_count is null or (stock_count >= 0 and stock_count < 1000000)),
  -- O dia da contagem (data local de quem contou).
  add column stock_counted_on date
    check (stock_counted_on is null or stock_counted_on between date '2000-01-01' and date '2100-12-31'),
  -- Unidades que cada dose usa (0,5 = meio comprimido).
  add column dose_units numeric not null default 1 check (dose_units > 0 and dose_units <= 1000),
  -- Com quantos dias de antecedência avisar que está acabando.
  add column stock_warn_days integer not null default 7 check (stock_warn_days between 1 and 60),
  -- Até quando a receita vale; não depende do estoque.
  add column prescription_until date
    check (prescription_until is null or prescription_until between date '2000-01-01' and date '2100-12-31'),
  -- A contagem e o dia dela andam juntos.
  add constraint medications_stock_counted check ((stock_count is null) = (stock_counted_on is null));

-- A lista de farmácia aberta mais recente da casa; sem nenhuma, cria uma.
-- Como open_market_list: procurar e criar numa transação só, com trava por
-- casa, para duas pessoas pondo remédio na lista ao mesmo tempo, sem lista de
-- farmácia aberta, não criarem duas "Farmácia" (cada item numa).
create function public.open_pharmacy_list(p_name text default 'Farmácia')
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
  perform pg_advisory_xact_lock(hashtextextended('open_pharmacy_list:' || hid::text, 0));
  return query
    select l.id, l.name from public.shopping_lists l
    where l.household_id = hid and l.kind = 'farmacia' and l.archived_at is null
    order by l.created_at desc
    limit 1;
  if found then
    return;
  end if;
  return query
    insert into public.shopping_lists as l (name, kind)
    values (coalesce(nullif(trim(p_name), ''), 'Farmácia'), 'farmacia')
    returning l.id, l.name;
end;
$$;

revoke execute on function public.open_pharmacy_list(text) from public, anon;
grant execute on function public.open_pharmacy_list(text) to authenticated;
