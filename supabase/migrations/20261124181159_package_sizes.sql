-- O tamanho da embalagem nos preços: Preços e os preços de outras casas.
--
-- O mesmo produto da casa ("Arroz", "Cerveja Skol") às vezes é comprado em
-- embalagens de tamanhos diferentes, e cada uma vem "1 un" na nota. O
-- histórico de preço e o "Último preço por mercado" da tela do produto já
-- comparam pelo preço por kg, litro ou item do pacote, com o tamanho lido na
-- descrição da nota (src/domain/packageSize.ts). Dois lugares não tinham o
-- tamanho e comparavam o preço do pacote de 1 kg com o do de 5 kg:
--
-- 1. Preços (e a tela do produto sem internet), que leem latest_prices: a view
--    não trazia a descrição da linha. Ela passa a trazer (raw_description, no
--    fim, como pack_count em 20261026134101), e o desempate de duas linhas do
--    mesmo produto, mercado e unidade na mesma nota (o pacote de 1 kg e o de
--    5 kg) passa a ser sempre o mesmo: o menor preço, como no app
--    (latestByStore). A casa lê só as próprias linhas (security_invoker, RLS de
--    receipt_items): nada muda em quem vê o quê.
--
-- 2. Os preços de outras casas: a linha comum tinha só a chave normalizada da
--    descrição (normalize_alias), e ela perde o que diz o tamanho: "C/12" vira
--    "C 12" e "10,1KG" vira "10 1KG" (lida, a chave daria 350 ml para a caixa
--    de 12 latas e 1 kg para a ração de 10,1 kg). O tamanho passa a ir na
--    linha, lido pelo SERVIDOR na descrição como impressa, e só na nota do QR
--    code, na linha cuja unidade da Sefaz é de um item só (UN, GF, PT...): no
--    fardo (FD), na caixa (CX) ou no pacote (PCT) o preço é do pacote todo, e
--    a descrição muitas vezes diz só o tamanho de cada um ("CERV SKOL LT
--    350ML"); na foto, a IA não diz a unidade impressa. A função nfce grava em
--    cada linha da leitura (receipt_reads.lines) o tamanho de
--    sharedPackageSize (_shared/packageSize.ts, espelho de
--    src/domain/packageSize.ts; um teste do app falha se os dois divergirem),
--    a leitura mais estrita, que na dúvida não diz tamanho ("C12", "PC 12",
--    "SIXPACK"), e o gatilho o copia da linha lida que bate com a da nota,
--    como o código de barras.
--
-- As regras de 20261014120000_shared_prices.sql (os números são os de lá):
--
-- 1. Nada aponta de volta. O tamanho é uma leitura da descrição impressa do
--    item, que já é o item da linha: o mesmo para toda casa que compra aquele
--    item naquele mercado. Não diz quem comprou nem quanto, não separa duas
--    compras, não ordena nem conta. E é só o que o servidor leu: a quantidade
--    de ovos que a pessoa respondeu na revisão (receipt_items.pack_count) fica
--    na casa, como todo o resto que a casa grava (um número errado ali mudaria
--    o preço por ovo das outras casas).
-- 2. A chave primária NÃO muda (mercado, item, unidade, dia): o tamanho é uma
--    coluna da linha, não outra linha.
-- 4. Enquanto a linha não pode ser lida, a última gravação leva o preço, e o
--    tamanho vai com o preço: é ele que diz de que embalagem é aquele preço.
--    Com o mesmo preço, a gravação sem tamanho não apaga o que a linha tinha,
--    e duas que dizem tamanhos diferentes deixam a linha sem nenhum; com outro
--    preço, vale o tamanho de quem gravou (ou nenhum). Depois, nada muda.
-- 5. A descrição legível continua fora.
--
-- Só nas linhas em "un": no preço por kg, g, l ou ml o tamanho da embalagem
-- não muda a conta. Na dúvida, sem tamanho: duas linhas lidas que batem com a
-- da nota e não dizem o mesmo tamanho (ou uma diz e a outra não), nenhum.
--
-- Os termos de uso dizem que o tamanho vai (TERMS_VERSION de 2026-11-22). Ordem
-- de publicação, como a do código de barras: esta migração, o merge do app
-- (com os termos) e logo depois o deploy de nfce, para o tamanho só começar a
-- ir para a base comum com os termos novos no ar. parse-receipt não muda de
-- comportamento (a foto não leva tamanho) e pega o código novo no próximo
-- deploy. As funções novas com o banco de antes: o gatilho antigo lê as linhas
-- com colunas nomeadas (jsonb_to_recordset) e ignora os campos novos. O banco
-- novo com as funções de antes: as leituras vêm sem tamanho, e a linha comum
-- fica sem ele. O app funciona antes desta migração: lê latest_prices sem
-- raw_description (isMissingColumn) e shared_latest_prices sem as colunas
-- novas (vêm ausentes: tamanho desconhecido).

-- =============================================================================
-- 1. A descrição nos últimos preços da casa
-- =============================================================================

-- As duas views de 20261026134101_receipt_item_pack_count.sql, iguais, com a
-- descrição da linha no fim (create or replace só acrescenta colunas depois das
-- que existem) e o desempate de latest_prices: no mesmo instante (duas linhas
-- da mesma nota), o menor preço, depois a nota e a descrição, como
-- latestByStore no app. O filtro e as permissões ficam como estão.
create or replace view public.price_observations with (security_invoker = true) as
select
  ri.household_id,
  ri.product_id,
  r.store_id,
  r.purchased_at,
  ri.unit_price,
  ri.unit,
  ri.receipt_id,
  ri.pack_count,
  ri.raw_description
from public.receipt_items ri
join public.receipts r on r.id = ri.receipt_id
where r.status = 'confirmed'
  and ri.product_id is not null
  and r.store_id is not null
  and ri.unit_price > 0;

create or replace view public.latest_prices with (security_invoker = true) as
select distinct on (product_id, store_id, unit)
  household_id,
  product_id,
  store_id,
  unit,
  unit_price,
  purchased_at,
  pack_count,
  raw_description
from public.price_observations
order by product_id, store_id, unit, purchased_at desc, unit_price, receipt_id, raw_description;

-- =============================================================================
-- 2. O tamanho na linha comum
-- =============================================================================

-- Uma coluna nova aqui passa pelas regras acima (o teste do banco confere a
-- lista). Sem valor padrão: quem grava é o gatilho, com o que o servidor leu.
-- pack_unit: kg ou l (peso ou volume da embalagem toda) ou un (quantos itens
-- vêm nela: "OVOS C/12"). pack_amount: quanto vem, nessa unidade (12 latas de
-- 350 ml são 4,2 l; seis casas, porque "2,5G" são 0,0025 kg). pack_of: quantas
-- embalagens iguais somam isso ("12 x 350 ml": 12), só em kg e l; sem ele, uma
-- só. É o que deixa o app escrever o tamanho como na nota da casa.
-- Um check que dá null deixa a linha passar: cada parte aqui é dita por
-- inteiro (o coalesce fecha o que sobrar). "not valid": as linhas que já
-- existem têm as três colunas vazias, o que o check aceita, e conferir a tabela
-- inteira a deixaria travada enquanto lê (uma nota confirmada nesse tempo não
-- compartilharia: o gatilho espera só 200 ms). As gravações novas são
-- conferidas do mesmo jeito.
alter table public.shared_prices
  add column pack_unit text,
  add column pack_amount numeric(16, 6),
  add column pack_of smallint,
  add constraint shared_prices_pack_check check (coalesce(
    case
      when pack_unit is null then pack_amount is null and pack_of is null
      else unit = 'un'
        and pack_unit in ('kg', 'l', 'un')
        and pack_amount is not null and pack_amount > 0 and pack_amount <= 100000
        and (pack_unit <> 'un' or pack_amount = trunc(pack_amount) and pack_amount >= 2)
        and (pack_of is null or (pack_unit <> 'un' and pack_of between 2 and 1000))
    end, false)) not valid;

-- A share_receipt_prices de 20261024120000_shared_prices_gtin.sql, igual, com
-- SÓ esta mudança: as linhas lidas do QR code trazem o tamanho (o que não tem
-- a forma certa vira null ali mesmo, e a linha entra sem ele), a linha comum
-- grava o das linhas lidas que batem com ela (todas dizendo o mesmo), e o on
-- conflict o leva junto com o preço (regra 4 acima).
create or replace function public.share_receipt_prices()
returns trigger
language plpgsql
security definer
set search_path = ''
set lock_timeout = '200ms'
as $$
declare
  -- O que se compartilha. A mesma lista está em src/domain/sharedPrices.ts
  -- (SHARED_CATEGORIES), e um teste do app falha se as duas divergirem.
  -- Higiene fica de fora porque mistura xampu com item íntimo.
  v_shared constant text[] := array[
    'hortifruti', 'carnes', 'peixes', 'laticinios', 'ovos', 'padaria', 'graos',
    'congelados', 'frios', 'doces', 'snacks', 'temperos', 'oleos', 'bebidas',
    'alcoolicas', 'cafe_cha', 'limpeza', 'papel', 'bebe', 'pet'
  ];
  -- Uma linha de remédio na nota e a nota inteira fica na casa (ver a migração
  -- 20261014120000_shared_prices.sql, camada b).
  v_medicine constant text := 'medicamentos';
  -- Nome de farmácia (camada c da mesma migração).
  v_pharmacy constant text := '(DROG|FARM|PHARM|MEDICAMENT|PANVEL)';
  v_pague_menos constant text := 'PAGUE ?MENOS';
  v_market constant text := '(SUPERMERC|MERCADO|ALIMENT)';
  -- As leituras cujo código de barras vai para a base comum: a do QR code (a
  -- página da Sefaz) e a da foto (lida pela IA), por escolha do dono em
  -- 23/10/2026 (na PB, com o CAPTCHA da Sefaz, a foto é o único caminho). Só o
  -- QR code seria array['qrcode'].
  v_gtin_sources constant text[] := array['qrcode', 'ai'];
  -- As leituras cujo tamanho de embalagem vai: só a do QR code. Na foto, a IA
  -- põe "un" também no fardo e na caixa, e o tamanho escrito pode ser o de cada
  -- um. A função de hoje já não manda tamanho na foto; isto vale também para
  -- uma de outra versão.
  v_pack_sources constant text[] := array['qrcode'];
  v_read public.receipt_reads%rowtype;
  v_key text;
  v_name text;
  v_store text;
  v_own_name text;
  v_own_printed text;
  v_own_cnpj text;
  v_day date;
  v_today constant date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- Sair do bloco (exit share) é não compartilhar; a leitura é apagada do mesmo jeito.
  <<share>>
  begin
    -- Só nota lida pelo app E com a leitura do servidor (da mesma casa).
    if new.source not in ('qrcode', 'ai') or new.read_id is null then
      exit share;
    end if;
    select * into v_read
      from public.receipt_reads rr
      where rr.id = new.read_id and rr.household_id = new.household_id;
    -- Sem CNPJ lido, o mercado não tem como ser o mesmo para duas casas; sem o
    -- dia lido, a data seria a que a casa digitou.
    if v_read.id is null or v_read.store_cnpj is null or v_read.purchased_on is null then
      exit share;
    end if;
    -- A chave lida na foto só vale com o dígito verificador certo (a IA pode
    -- errar um dígito); a errada é como foto sem chave. A do QR code a página
    -- da Sefaz já mostrou.
    v_key := v_read.access_key;
    if v_read.source = 'ai' and not public.access_key_valid(v_key) then
      v_key := null;
    end if;
    -- A chave de acesso traz o CNPJ de quem emitiu (dígitos 7 a 20).
    if v_key is not null and substr(v_key, 7, 14) <> v_read.store_cnpj then
      exit share;
    end if;

    select s.name, s.printed_name, s.cnpj into v_own_name, v_own_printed, v_own_cnpj
      from public.stores s
      where s.id = new.store_id and s.household_id = new.household_id;
    -- Foto: a IA pode ter lido errado o CNPJ ou a data. Se a casa trocou o
    -- mercado ou a data na revisão, não se sabe qual dos dois vale, e nada sai.
    -- O dia da nota é o de São Paulo, como o da leitura.
    if v_read.source = 'ai' and (
      v_own_cnpj is distinct from v_read.store_cnpj
      or (new.purchased_at at time zone 'America/Sao_Paulo')::date is distinct from v_read.purchased_on
    ) then
      exit share;
    end if;

    -- O nome impresso, sem CPF (MEI); sem ele, o "CNPJ ..." do app.
    v_name := public.shared_store_name(v_read.store_name, v_read.store_cnpj);
    -- Camada (c): farmácia pelo nome impresso E pelo nome que a casa deu ao
    -- mercado da nota (na dúvida, compartilha-se menos). E pelo nome da nota
    -- que a casa trocou: a farmácia renomeada ("Pacheco") cuja leitura de
    -- agora não trouxe nome (só os itens e o rodapé) continua farmácia.
    foreach v_store in array array[public.normalize_alias(v_name), public.normalize_alias(v_own_name), public.normalize_alias(v_own_printed)] loop
      if v_store ~ v_pharmacy or (v_store ~ v_pague_menos and v_store !~ v_market) then
        exit share;
      end if;
    end loop;

    v_day := v_read.purchased_on;
    -- Data no futuro é data errada, e ficaria como "a mais recente" por meses.
    if v_day > v_today then
      exit share;
    end if;

    -- O teto de 300 linhas por nota.
    if (select count(*) from public.receipt_items ri where ri.receipt_id = new.id) > 300 then
      exit share;
    end if;

    -- Camada (b): uma linha de remédio, pela categoria do produto ou pela
    -- sugerida, e nada desta nota sai da casa.
    if exists (
      select 1
        from public.receipt_items ri
        left join public.products p on p.id = ri.product_id and p.household_id = ri.household_id
        where ri.receipt_id = new.id
          and (p.category = v_medicine or ri.suggested_category = v_medicine)
    ) then
      exit share;
    end if;

    -- A linha só entra quando a leitura do servidor tem uma linha com a mesma
    -- chave, a mesma unidade e o mesmo preço unitário. Uma leitura malformada
    -- dá erro aqui, e o bloco não grava nada. O GTIN é o da linha lida (o que
    -- não passa na gtin_key não conta, nem o de 8 ou 12 dígitos, como em
    -- sharedGtin nas funções, para uma função de antes não o deixar passar): o
    -- da casa (receipt_items.store_code) ela pode ter mexido, o lido não. O
    -- tamanho também é o da linha lida: lido em texto e conferido aqui (um
    -- número que não tem a forma certa, ou fora dos limites do check, deixa a
    -- linha lida sem tamanho, e ela vale do mesmo jeito: o check nunca é
    -- tocado, e a nota inteira nunca deixa de compartilhar por isso), juntado
    -- numa chave só ("kg|5.000000|") para as linhas lidas que batem dizerem o
    -- mesmo.
    insert into public.shared_prices (store_cnpj, store_uf, store_name, item_key, unit, seen_on, unit_price, visible_on, gtin,
                                      pack_unit, pack_amount, pack_of)
    with read_lines as materialized (
      select distinct public.normalize_alias(x.description) as item_key, x.unit, round(x.unit_price, 4) as unit_price,
          case when v_read.source = any (v_gtin_sources) and x.gtin not like '00%' and public.gtin_key(x.gtin) = x.gtin
            then x.gtin end as gtin,
          -- Primeiro a forma (o texto), depois o valor: um case por vez, porque o Postgres não promete a
          -- ordem de um "and", e o número convertido antes da forma conferida daria erro.
          case when v_read.source = any (v_pack_sources) and x.unit = 'un'
              and x.pack_unit in ('kg', 'l', 'un')
              and x.pack_amount ~ '^[0-9]{1,6}(\.[0-9]{1,6})?$'
              and (x.pack_of is null or (x.pack_unit <> 'un' and x.pack_of ~ '^[0-9]{1,4}$'))
            then case when x.pack_amount::numeric > 0 and x.pack_amount::numeric <= 100000
                and (x.pack_unit <> 'un' or (x.pack_amount::numeric = trunc(x.pack_amount::numeric) and x.pack_amount::numeric >= 2))
                and (x.pack_of is null or x.pack_of::int between 2 and 1000)
              then x.pack_unit || '|' || round(x.pack_amount::numeric, 6)::text || '|' || coalesce(x.pack_of::int::text, '')
            end
          end as pack_key
        from jsonb_to_recordset(v_read.lines)
          as x (description text, unit text, unit_price numeric, gtin text, pack_unit text, pack_amount text, pack_of text)
    )
    select v_read.store_cnpj, substr(v_key, 1, 2), v_name, l.item_key, l.unit, v_day, l.unit_price, v_today + 1, l.gtin,
        nullif(split_part(l.pack_key, '|', 1), ''),
        nullif(split_part(l.pack_key, '|', 2), '')::numeric,
        nullif(split_part(l.pack_key, '|', 3), '')::smallint
      from (
        select m.item_key, m.unit, m.unit_price,
            -- As linhas lidas que batem: um GTIN só entre elas (a que veio sem ele não conta); dois diferentes, nenhum.
            (select case when count(distinct rl.gtin) = 1 then min(rl.gtin) end
               from read_lines rl
               where rl.item_key = m.item_key and rl.unit = m.unit and rl.unit_price = m.unit_price) as gtin,
            -- O tamanho, mais estrito: todas as que batem dizem o mesmo (a que veio sem ele conta como outro).
            (select case when count(*) = count(rl.pack_key) and count(distinct rl.pack_key) = 1 then min(rl.pack_key) end
               from read_lines rl
               where rl.item_key = m.item_key and rl.unit = m.unit and rl.unit_price = m.unit_price) as pack_key
          from (
            select distinct on (k.item_key, ri.unit) k.item_key, ri.unit, ri.unit_price
              from public.receipt_items ri
              left join public.products p on p.id = ri.product_id and p.household_id = ri.household_id
              cross join lateral (select public.normalize_alias(ri.raw_description) as item_key) k
              where ri.receipt_id = new.id
                and ri.unit_price > 0
                and length(k.item_key) between 1 and 200
                and (p.id is not null or ri.suggested_category is not null)
                and (p.id is null or p.category = any (v_shared))
                and (ri.suggested_category is null or ri.suggested_category = any (v_shared))
                and exists (
                  select 1 from read_lines rl
                    where rl.item_key = k.item_key and rl.unit = ri.unit and rl.unit_price = ri.unit_price
                )
              order by k.item_key, ri.unit, ri.position desc, ri.id desc
          ) m
      ) l
      order by l.item_key, l.unit
    on conflict (store_cnpj, item_key, unit, seen_on) do update
      set unit_price = excluded.unit_price,
          store_name = case when excluded.store_name ~ '^CNPJ [0-9]{14}$' then public.shared_prices.store_name else excluded.store_name end,
          store_uf = coalesce(excluded.store_uf, public.shared_prices.store_uf),
          -- Como o estado: a gravação sem código de barras não apaga o que a linha já tinha.
          gtin = coalesce(excluded.gtin, public.shared_prices.gtin),
          -- O tamanho vai com o preço (as três colunas juntas; o set lê a linha como estava). Outro preço: o
          -- tamanho de quem gravou, ou nenhum (o fardo de "CERV 350ML" não fica com os 350 ml da lata). O mesmo
          -- preço: quem não diz tamanho não apaga o que a linha tinha, e dois tamanhos diferentes dão nenhum.
          pack_unit = case
              when excluded.unit_price is distinct from public.shared_prices.unit_price then excluded.pack_unit
              when excluded.pack_unit is null then public.shared_prices.pack_unit
              when public.shared_prices.pack_unit is null
                or (excluded.pack_unit, excluded.pack_amount, excluded.pack_of)
                  is not distinct from (public.shared_prices.pack_unit, public.shared_prices.pack_amount, public.shared_prices.pack_of)
                then excluded.pack_unit
            end,
          pack_amount = case
              when excluded.unit_price is distinct from public.shared_prices.unit_price then excluded.pack_amount
              when excluded.pack_unit is null then public.shared_prices.pack_amount
              when public.shared_prices.pack_unit is null
                or (excluded.pack_unit, excluded.pack_amount, excluded.pack_of)
                  is not distinct from (public.shared_prices.pack_unit, public.shared_prices.pack_amount, public.shared_prices.pack_of)
                then excluded.pack_amount
            end,
          pack_of = case
              when excluded.unit_price is distinct from public.shared_prices.unit_price then excluded.pack_of
              when excluded.pack_unit is null then public.shared_prices.pack_of
              when public.shared_prices.pack_unit is null
                or (excluded.pack_unit, excluded.pack_amount, excluded.pack_of)
                  is not distinct from (public.shared_prices.pack_unit, public.shared_prices.pack_amount, public.shared_prices.pack_of)
                then excluded.pack_of
            end
      where public.shared_prices.visible_on > v_today;
  exception
    when query_canceled then
      raise log 'share_receipt_prices: nada compartilhado (%)', sqlstate;
    when others then
      raise log 'share_receipt_prices: nada compartilhado (%)', sqlstate;
  end;
  -- A leitura já serviu. À parte: se apagar falhar, o que foi compartilhado
  -- fica, e a limpeza diária a leva depois.
  if new.read_id is not null then
    begin
      delete from public.receipt_reads rr where rr.id = new.read_id and rr.household_id = new.household_id;
    exception
      when query_canceled then
        raise log 'share_receipt_prices: leitura não apagada (%)', sqlstate;
      when others then
        raise log 'share_receipt_prices: leitura não apagada (%)', sqlstate;
    end;
  end if;
  return new;
end;
$$;

revoke execute on function public.share_receipt_prices() from public, anon, authenticated;

-- =============================================================================
-- 3. A leitura devolve o tamanho
-- =============================================================================

-- A shared_latest_prices de 20261024120000_shared_prices_gtin.sql, igual (os
-- dois caminhos até a linha, os 90 dias, visible_on, o estado, os 5 melhores,
-- o preço próprio da casa escondendo o compartilhado, o mesmo distinct on por
-- produto, mercado e unidade e o mesmo desempate), devolvendo também as três
-- colunas do tamanho da linha escolhida. A busca continua com as colunas de
-- antes (mais a chave do item, que já era o último desempate): o tamanho vem
-- no fim, pela chave primária da linha escolhida, e os índices que ela usa
-- ficam os mesmos (o teste do plano confere). As colunas da resposta mudam,
-- então a função é recriada (drop e create, na mesma transação desta
-- migração) e as permissões, escritas de novo.
drop function public.shared_latest_prices();

create function public.shared_latest_prices()
returns table (
  product_id uuid,
  store_cnpj text,
  store_name text,
  store_uf text,
  unit text,
  unit_price numeric,
  seen_on date,
  mine boolean,
  pack_unit text,
  pack_amount numeric,
  pack_of smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select h.id, (now() at time zone 'America/Sao_Paulo')::date as today
      from (select public.current_household_id() as id) h
      where exists (select 1 from public.receipts r where r.household_id = h.id and r.status = 'confirmed')
  ),
  my_stores as (
    select s.cnpj
      from public.stores s
      where s.household_id = (select id from me) and s.cnpj is not null
  ),
  my_states as (
    select distinct substr(r.access_key, 1, 2) as uf
      from public.receipts r
      where r.household_id = (select id from me)
        and r.status = 'confirmed' and r.source in ('qrcode', 'ai') and r.access_key is not null
  ),
  -- Nos mercados da casa: pela chave primária (mercado, item), com ou sem estado na linha; e pelo código de
  -- barras (o índice por código), também com ou sem estado.
  mine as (
    select distinct on (f.product_id, f.store_cnpj, f.unit)
      f.product_id, f.store_cnpj, f.store_name, f.store_uf, f.unit, f.unit_price, f.seen_on, f.item_key
      from (
        select a.product_id, p.store_cnpj, p.store_name, p.store_uf, p.unit, p.unit_price, p.seen_on, p.item_key
          from public.product_aliases a
          cross join my_stores m
          join public.shared_prices p on p.store_cnpj = m.cnpj and p.item_key = a.alias
          where a.household_id = (select id from me)
            and p.seen_on >= (select today from me) - 90 and p.seen_on < (select today from me)
            and p.visible_on <= (now() at time zone 'America/Sao_Paulo')::date
        union all
        select b.product_id, p.store_cnpj, p.store_name, p.store_uf, p.unit, p.unit_price, p.seen_on, p.item_key
          from public.product_barcodes b
          join public.shared_prices p on p.gtin = b.gtin
          where b.household_id = (select id from me)
            and p.gtin is not null
            and p.store_cnpj in (select cnpj from my_stores)
            and p.seen_on >= (select today from me) - 90 and p.seen_on < (select today from me)
            and p.visible_on <= (now() at time zone 'America/Sao_Paulo')::date
      ) f
      -- Duas descrições do mesmo produto no mesmo dia: a mais barata, sempre a mesma.
      order by f.product_id, f.store_cnpj, f.unit, f.seen_on desc, f.unit_price, f.item_key
  ),
  -- Nos outros: só linhas com o estado da casa (os índices são por item ou código, e estado), a mais recente
  -- de cada mercado.
  others as (
    select distinct on (f.product_id, f.store_cnpj, f.unit)
      f.product_id, f.store_cnpj, f.store_name, f.store_uf, f.unit, f.unit_price, f.seen_on, f.item_key
      from (
        select a.product_id, p.store_cnpj, p.store_name, p.store_uf, p.unit, p.unit_price, p.seen_on, p.item_key
          from public.product_aliases a
          join public.shared_prices p on p.item_key = a.alias
          where a.household_id = (select id from me)
            and p.store_uf in (select uf from my_states)
            and not exists (select 1 from my_stores m where m.cnpj = p.store_cnpj)
            and p.seen_on >= (select today from me) - 90 and p.seen_on < (select today from me)
            and p.visible_on <= (now() at time zone 'America/Sao_Paulo')::date
        union all
        select b.product_id, p.store_cnpj, p.store_name, p.store_uf, p.unit, p.unit_price, p.seen_on, p.item_key
          from public.product_barcodes b
          join public.shared_prices p on p.gtin = b.gtin
          where b.household_id = (select id from me)
            and p.gtin is not null
            and p.store_uf in (select uf from my_states)
            and not exists (select 1 from my_stores m where m.cnpj = p.store_cnpj)
            and p.seen_on >= (select today from me) - 90 and p.seen_on < (select today from me)
            and p.visible_on <= (now() at time zone 'America/Sao_Paulo')::date
      ) f
      order by f.product_id, f.store_cnpj, f.unit, f.seen_on desc, f.unit_price, f.item_key
  ),
  ranked as (
    select o.*, row_number() over (partition by o.product_id, o.unit order by o.unit_price, o.seen_on desc, o.store_cnpj) as place
      from others o
  )
  select m.product_id, m.store_cnpj,
      coalesce((select n.name from public.store_names n where n.cnpj = m.store_cnpj), m.store_name),
      m.store_uf, m.unit, m.unit_price, m.seen_on, true, z.pack_unit, z.pack_amount, z.pack_of
    from mine m
    -- O tamanho da linha escolhida, pela chave primária dela (fora da busca, que fica como era).
    join public.shared_prices z
      on z.store_cnpj = m.store_cnpj and z.item_key = m.item_key and z.unit = m.unit and z.seen_on = m.seen_on
    -- O preço próprio da casa é o de price_observations (nota confirmada, de qualquer origem, com produto e
    -- mercado), lido aqui a partir das notas DA CASA, que têm índice.
    where not exists (
      select 1
        from public.receipts r
        join public.stores s on s.id = r.store_id and s.household_id = r.household_id
        join public.receipt_items ri on ri.receipt_id = r.id and ri.household_id = r.household_id
        where r.household_id = (select id from me)
          and r.status = 'confirmed'
          and s.cnpj = m.store_cnpj
          and ri.product_id = m.product_id
          -- Zero não é preço (a compra "sem valor"): não esconde nada, como nos outros leitores de preço.
          and ri.unit_price > 0
          and (r.purchased_at at time zone 'America/Sao_Paulo')::date >= m.seen_on
    )
  union all
  select r.product_id, r.store_cnpj,
      coalesce((select n.name from public.store_names n where n.cnpj = r.store_cnpj), r.store_name),
      r.store_uf, r.unit, r.unit_price, r.seen_on, false, z.pack_unit, z.pack_amount, z.pack_of
    from ranked r
    join public.shared_prices z
      on z.store_cnpj = r.store_cnpj and z.item_key = r.item_key and z.unit = r.unit and z.seen_on = r.seen_on
    where r.place <= 5;
$$;

revoke execute on function public.shared_latest_prices() from public, anon;
grant execute on function public.shared_latest_prices() to authenticated;
