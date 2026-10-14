-- Remédios de uso contínuo: quanto ainda tem e até quando a receita vale, para
-- o app avisar antes de a caixa acabar ("Losartana (Ana) acaba em 7 dias") e de
-- a receita vencer. É opcional, por remédio.
--
-- O banco guarda só a contagem (quantas unidades havia e em que dia foram
-- contadas); o que sobra hoje é uma conta do app pelas doses previstas desde
-- então (src/domain/medicationStock.ts), não pelas doses marcadas. Sem tabela
-- nova: as colunas ficam sob a regra de acesso que a tabela já tem
-- (household_id = current_household_id()). Duas funções novas, para "Pôr na
-- lista da farmácia": open_pharmacy_list acha ou cria a lista da farmácia, e
-- add_to_pharmacy_list põe o remédio nela sem repetir. E um gatilho para o
-- app de antes do estoque, que não sabe refazer a contagem quando a regra das
-- doses muda (medication_rule_without_recount).
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

-- "Pôr na lista da farmácia" numa transação só: a lista (a de
-- open_pharmacy_list) e o item, sob a mesma trava por casa. Duas pessoas que
-- tocam ao mesmo tempo no mesmo remédio não o põem duas vezes: a segunda
-- espera a primeira e acha o item dela. Pendente (não riscado) em qualquer
-- lista de farmácia aberta da casa, o item não entra de novo: com o nome que
-- vai para a lista (`p_item`) ou com o nome de quem toma (`p_alt_item`,
-- "Losartana — Ana"), os dois que a tela confere para dizer "Na lista da
-- farmácia", sem diferença de maiúsculas e de espaços nas pontas. A linha da
-- lista fica travada até o fim: arquivar a lista em outro aparelho espera o
-- item entrar (pôs, depois arquivou), em vez de o item ir para uma lista que
-- já não aparece. `added` diz se o item entrou agora; se já estava, volta o
-- que estava, com a lista dele.
create function public.add_to_pharmacy_list(p_item text, p_alt_item text default null, p_list_name text default 'Farmácia')
returns table (list_id uuid, list_name text, item_id uuid, added boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  hid uuid := public.current_household_id();
  v_list_id uuid;
  v_list_name text;
  v_pending record;
begin
  if hid is null then
    raise exception 'sem casa' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('open_pharmacy_list:' || hid::text, 0));
  -- A lista é a de open_pharmacy_list (que pega a mesma trava de novo, livre
  -- nesta transação). Arquivada em outro aparelho entre achar e travar: a
  -- próxima aberta, ou uma nova (esta nenhum outro aparelho vê até o fim).
  loop
    select o.id, o.name into v_list_id, v_list_name from public.open_pharmacy_list(p_list_name) o;
    perform 1 from public.shopping_lists l where l.id = v_list_id and l.archived_at is null for update;
    exit when found;
  end loop;
  select i.id, i.list_id, l.name as list_name into v_pending
  from public.shopping_list_items i
  join public.shopping_lists l on l.id = i.list_id
  where l.household_id = hid
    and l.kind = 'farmacia'
    and l.archived_at is null
    and i.checked_at is null
    and lower(trim(i.name)) in (lower(trim(p_item)), lower(trim(p_alt_item)))
  order by i.list_id = v_list_id desc, i.created_at
  limit 1;
  if found then
    return query select v_pending.list_id, v_pending.list_name, v_pending.id, false;
    return;
  end if;
  -- Uma unidade, como o app pede: repetir o toque não pede outra caixa.
  return query
    insert into public.shopping_list_items as i (list_id, name, category, quantity, unit)
    values (v_list_id, trim(p_item), 'medicamentos', 1, 'un')
    returning v_list_id, v_list_name, i.id, true;
end;
$$;

revoke execute on function public.add_to_pharmacy_list(text, text, text) from public, anon;
grant execute on function public.add_to_pharmacy_list(text, text, text) to authenticated;

-- O app de antes do estoque salva o remédio sem as colunas dele. Se ele muda
-- a regra das doses de um remédio com o estoque acompanhado (quantas vezes
-- por dia, regularidade, início, fim, número de doses), a contagem antiga
-- seria lida com a regra nova desde o dia em que foi feita, e o estoque
-- pularia sem ninguém ter contado nada. O app de agora sempre grava a
-- contagem refeita quando muda a regra (keepStockOnRuleChange); o de antes não
-- sabe. Então, quando a regra muda e a contagem volta igual, o banco para de
-- acompanhar o estoque desse remédio: ele fica "sem estoque acompanhado" até
-- alguém escrever quanto tem agora. A regra é a de ruleKey no app (o horário
-- em si não conta, nem a ordem dos dias da semana), mais quanto cada dose usa.
-- Ficam de fora a contagem zerada (não há o que pular) e a de hoje ou de
-- ontem: o app de agora refaz a contagem de hoje com os mesmos valores, e o
-- dia do servidor (UTC) já é o seguinte na noite do Brasil. Só para quem usa a
-- API (authenticated, anon): as funções do banco que rodam como o dono
-- (security definer) e a service role ficam como estão.
create function public.medication_rule_without_recount()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
    and old.stock_count > 0
    and new.stock_count is not distinct from old.stock_count
    and new.stock_counted_on is not distinct from old.stock_counted_on
    and old.stock_counted_on < current_date - 1
    and (
      cardinality(new.times) is distinct from cardinality(old.times)
      or new.frequency is distinct from old.frequency
      or array(select d from unnest(new.weekdays) d order by d) is distinct from array(select d from unnest(old.weekdays) d order by d)
      or new.interval_days is distinct from old.interval_days
      or new.start_on is distinct from old.start_on
      or new.end_on is distinct from old.end_on
      or new.total_doses is distinct from old.total_doses
      or new.dose_units is distinct from old.dose_units
    ) then
    new.stock_count := null;
    new.stock_counted_on := null;
  end if;
  return new;
end;
$$;
-- O gatilho dispara sem esse direito: ninguém precisa chamar a função.
revoke execute on function public.medication_rule_without_recount() from public, anon, authenticated;

create trigger medications_rule_without_recount
  before update of times, frequency, weekdays, interval_days, start_on, end_on, total_doses, dose_units on public.medications
  for each row
  when (old.stock_count > 0)
  execute function public.medication_rule_without_recount();
