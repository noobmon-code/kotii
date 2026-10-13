-- Preços vistos em outras casas. Toda casa contribui: ao confirmar uma nota
-- LIDA pelo app (QR code ou foto), o mercado, o item, o preço e o dia entram
-- numa base comum, e cada casa vê ali quanto os produtos que ela mesma já
-- comprou custaram em cada mercado. É a primeira coisa do banco que se lê de
-- uma casa para outra, então as regras abaixo são o centro desta migração:
--
-- 1. Nada aponta de volta. As duas tabelas não têm casa, pessoa, nota, id de
--    linha, sequência nem hora de gravação: com qualquer um deles daria para
--    juntar as linhas de uma mesma compra, ordená-las ou contá-las, e daí
--    chegar a quem comprou. Uma linha diz só "este mercado cobrou tanto por
--    este item neste dia".
-- 2. Uma linha por (mercado, item, unidade, dia). A segunda casa que compra a
--    mesma coisa no mesmo mercado no mesmo dia cai NA MESMA linha (o preço
--    fica o da última gravação): assim não dá para contar quantas casas
--    viram um preço, nem saber se há mais de uma.
-- 3. Só o dia da compra (em São Paulo), sem hora: a hora de uma nota, junto do
--    mercado, já seria quase um nome.
-- 4. O item é só a descrição da nota normalizada (normalize_alias, a mesma
--    chave dos apelidos) mais a unidade. A descrição legível NÃO é guardada:
--    uma linha pode ter sido redigitada na revisão, e não há marca disso por
--    linha. Só com a chave, uma casa só recebe preço de uma descrição que ela
--    mesma já tem. Sem nome de produto, categoria, quantidade ou total.
-- 5. Só nota lida (source 'qrcode' ou 'ai'), de mercado com CNPJ, e, quando a
--    nota tem chave de acesso, com o CNPJ do emissor que está dentro da chave
--    igual ao do mercado. Nota digitada à mão nunca entra. Linha de remédio
--    nunca entra (compra de saúde fica na casa), nem linha com valor zero
--    (brinde) ou sem descrição.
-- 6. O app nunca toca nas tabelas: sem policy e sem grant, nem para ler. Só
--    as duas funções daqui leem e gravam.
-- 7. Não há carga do passado: notas confirmadas antes desta migração não
--    entram. E excluir uma nota não retira o que ela deu: nada liga uma coisa
--    à outra, de propósito.
--
-- confirm_receipt não muda: quem grava é um gatilho na confirmação, que nunca
-- faz a confirmação falhar.

-- O nome impresso de cada mercado, pelo CNPJ (vale o da última gravação).
-- Mercado com CNPJ é sempre criado por uma leitura (QR code ou foto), com o
-- nome como veio na nota; o criado à mão na revisão não tem CNPJ.
create table public.shared_stores (
  cnpj text primary key check (cnpj ~ '^[0-9]{14}$'),
  name text not null check (length(trim(name)) > 0)
);

-- Sem id, sem casa, sem nota, sem hora: ver as regras 1 a 4 acima. Uma coluna
-- nova aqui precisa passar por elas (o teste do banco confere a lista).
create table public.shared_prices (
  store_cnpj text not null references public.shared_stores (cnpj),
  -- normalize_alias(raw_description): a chave de product_aliases.alias.
  item_key text not null check (item_key = public.normalize_alias(item_key) and length(item_key) between 1 and 200),
  unit text not null check (unit in ('un', 'kg', 'g', 'l', 'ml')),
  -- O dia da compra em São Paulo.
  seen_on date not null,
  unit_price numeric(12, 4) not null check (unit_price > 0),
  primary key (store_cnpj, item_key, unit, seen_on)
);
-- A leitura parte das descrições da casa e quer as linhas mais novas de cada uma.
create index shared_prices_item_key_idx on public.shared_prices (item_key, seen_on desc);

-- Ninguém entra pela API: RLS ligada sem policy nenhuma, e sem permissão de
-- tabela para quem usa o app (nem leitura). As funções abaixo rodam como dono.
alter table public.shared_stores enable row level security;
alter table public.shared_prices enable row level security;
revoke all on public.shared_stores, public.shared_prices from anon, authenticated;
grant all on public.shared_stores, public.shared_prices to service_role;

-- =============================================================================
-- Gravação: na confirmação da nota (rascunho -> confirmada)
-- =============================================================================

-- security definer: a pessoa que confirma não tem acesso às tabelas. Lê só as
-- linhas DESTA nota e grava o que as regras deixam. Tudo dentro de um bloco
-- com exception: um erro aqui (qualquer um) desfaz só o que este gatilho
-- gravou e a nota fica confirmada do mesmo jeito. O erro vai para o log do
-- servidor só com o código, sem dado nenhum da nota.
create function public.share_receipt_prices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cnpj text;
  v_name text;
  v_day date;
begin
  begin
    -- Só nota lida pelo app.
    if new.source not in ('qrcode', 'ai') or new.store_id is null then
      return new;
    end if;

    select s.cnpj, s.name into v_cnpj, v_name
      from public.stores s
      where s.id = new.store_id and s.household_id = new.household_id;
    -- Mercado sem CNPJ não tem como ser o mesmo para duas casas.
    if v_cnpj is null then
      return new;
    end if;
    -- A chave de acesso traz o CNPJ de quem emitiu (dígitos 7 a 20): nota que
    -- a pessoa apontou para outro mercado não diz nada sobre ele.
    if new.access_key is not null and substr(new.access_key, 7, 14) <> v_cnpj then
      return new;
    end if;

    v_day := (new.purchased_at at time zone 'America/Sao_Paulo')::date;
    -- Data no futuro é data errada, e ficaria como "a mais recente" por meses.
    if v_day > (now() at time zone 'America/Sao_Paulo')::date then
      return new;
    end if;

    -- Uma instrução só: o mercado só entra se alguma linha entrar. A mesma
    -- descrição duas vezes na nota vira uma linha (a última impressa), e a
    -- ordem fixa evita que duas confirmações ao mesmo tempo se travem. O que
    -- já está igual não é regravado, e o nome que o app inventa quando a
    -- leitura não trouxe nenhum ("CNPJ 12345678000199") não troca um nome de
    -- verdade.
    with lines as (
      select distinct on (k.item_key, ri.unit) k.item_key, ri.unit, ri.unit_price
        from public.receipt_items ri
        left join public.products p on p.id = ri.product_id and p.household_id = ri.household_id
        cross join lateral (select public.normalize_alias(ri.raw_description) as item_key) k
        where ri.receipt_id = new.id
          and ri.unit_price > 0
          and length(k.item_key) between 1 and 200
          -- Remédio fica de fora pela categoria do produto e pela sugerida na
          -- leitura: basta uma das duas dizer.
          and p.category is distinct from 'medicamentos'
          and ri.suggested_category is distinct from 'medicamentos'
        order by k.item_key, ri.unit, ri.position desc, ri.id desc
    ),
    store as (
      insert into public.shared_stores (cnpj, name)
      select v_cnpj, left(trim(v_name), 120)
        where exists (select 1 from lines)
      on conflict (cnpj) do update set name = excluded.name
        where public.shared_stores.name is distinct from excluded.name
          and excluded.name !~ '^CNPJ [0-9]{14}$'
    )
    insert into public.shared_prices (store_cnpj, item_key, unit, seen_on, unit_price)
    select v_cnpj, l.item_key, l.unit, v_day, l.unit_price
      from lines l
      order by l.item_key, l.unit
    on conflict (store_cnpj, item_key, unit, seen_on) do update set unit_price = excluded.unit_price
      where public.shared_prices.unit_price is distinct from excluded.unit_price;
  exception when others then
    raise log 'share_receipt_prices: nada compartilhado (%)', sqlstate;
  end;
  return new;
end;
$$;

-- Gatilho não se chama pela API; ainda assim, ninguém ganha o execute.
revoke execute on function public.share_receipt_prices() from public, anon, authenticated;

create trigger receipts_share_prices
  after update of status on public.receipts
  for each row
  when (old.status = 'draft' and new.status = 'confirmed')
  execute function public.share_receipt_prices();

-- =============================================================================
-- Leitura: os preços mais recentes para os produtos da casa
-- =============================================================================

-- security definer: a única porta de leitura. Parte dos apelidos da própria
-- casa (descrição de nota -> produto): a casa só recebe preço de descrição que
-- ela mesma já confirmou numa nota. Para cada (produto, mercado, unidade), a
-- linha mais recente dos últimos 90 dias; nada que diga de quem veio, nem
-- quantas vezes foi vista. Sem casa aberta, nada.
create function public.shared_latest_prices()
returns table (product_id uuid, store_cnpj text, store_name text, unit text, unit_price numeric, seen_on date)
language sql
stable
security definer
set search_path = ''
as $$
  with today as (
    select (now() at time zone 'America/Sao_Paulo')::date as day
  )
  select distinct on (a.product_id, p.store_cnpj, p.unit)
    a.product_id, p.store_cnpj, s.name, p.unit, p.unit_price, p.seen_on
  from public.product_aliases a
  join public.shared_prices p on p.item_key = a.alias
  join public.shared_stores s on s.cnpj = p.store_cnpj
  cross join today t
  where a.household_id = public.current_household_id()
    and p.seen_on between t.day - 90 and t.day
  -- Duas descrições do mesmo produto no mesmo dia: a mais barata, sempre a mesma.
  order by a.product_id, p.store_cnpj, p.unit, p.seen_on desc, p.unit_price, p.item_key;
$$;

revoke execute on function public.shared_latest_prices() from public, anon;
grant execute on function public.shared_latest_prices() to authenticated;
