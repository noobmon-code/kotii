-- O código de barras nos preços entre casas (pedido do dono em 21/10/2026:
-- "Código de barras será muito útil").
--
-- Até aqui, "Visto em outras casas" achava o produto só pela descrição da nota
-- (shared_prices.item_key = product_aliases.alias da casa). O mesmo produto com
-- outra abreviação em outra rede ("LT INTEG PIRACANJUBA 1L" e "LEITE PIRAC INT
-- 1L") não se achava, mesmo com o mesmo código de barras impresso na nota. Agora
-- a linha comum guarda também o código de barras (GTIN) do produto, e a casa
-- que tem o código ligado a um produto (product_barcodes: aprendido numa nota
-- confirmada ou lido pela câmera) acha o preço por ele.
--
-- O GTIN e as regras de 20261014120000_shared_prices.sql (os números são os de lá):
--
-- 1. Nada aponta de volta. O GTIN é o número do produto impresso na embalagem,
--    o mesmo em toda loja e para toda casa que compra aquele produto: não diz
--    nada de quem comprou, não separa duas compras do mesmo item, não ordena
--    nem conta linhas. É mais um jeito de dizer QUAL é o item, como a
--    descrição. Só os 14 dígitos de gtin_key (a regra de
--    20261021150000_store_codes.sql), fora das faixas de uso restrito: o código
--    da balança (com o peso ou o preço) e o código interno do mercado nunca
--    entram, nem o cProd que não é GTIN (ele continua só na linha da casa,
--    receipt_items.store_code). E só o impresso com 13 ou 14 dígitos (os 14
--    sem "00" à frente): o código interno de 8 ou 12 dígitos passa na conta do
--    verificador em 1 de cada 10, e daria a outra casa o preço de outro
--    produto. Os de 8 e 12 dígitos de verdade ficam de fora junto; a casa
--    continua os aprendendo (product_barcodes, só dela).
-- 2. A chave primária NÃO muda (mercado, item, unidade, dia): o GTIN é uma
--    coluna da linha, não outra linha. Duas casas que compram a mesma coisa no
--    mesmo mercado e dia continuam caindo na mesma linha.
-- 4. Enquanto a linha não pode ser lida, vale a última gravação também para o
--    GTIN (a que veio sem ele não apaga o que já havia); depois, nada muda.
-- 5. A descrição legível continua fora. Agora a casa recebe preço de uma
--    descrição que ela mesma já tem OU de um código de barras que ela mesma já
--    ligou a um produto. O que ela recebe continua sendo só preço de loja.
-- O GTIN vem da LEITURA DO SERVIDOR (receipt_reads.lines, campo gtin, gravado
-- pelas funções nfce e parse-receipt), nunca do que a casa grava na nota: a
-- linha comum leva o GTIN da linha lida que bate com ela (chave, unidade e
-- preço). Duas linhas lidas que batem com GTINs diferentes: nenhum.
--
-- Ordem de publicação: a recomendada é esta migração, o merge (o app com os
-- termos de 24/10/2026) e logo depois o deploy de nfce e parse-receipt, para o
-- código só ir para a base comum com os termos novos no ar. Mas qualquer uma
-- funciona. As funções novas com o banco de antes: o gatilho antigo lê as
-- linhas com colunas nomeadas (jsonb_to_recordset) e ignora o campo gtin. O
-- banco novo com as funções de antes: as leituras vêm sem gtin, e a linha
-- comum fica com null. O app não muda: shared_latest_prices devolve as mesmas
-- colunas.

-- =============================================================================
-- A coluna e o índice
-- =============================================================================

-- Uma coluna nova aqui passa pelas regras acima (o teste do banco confere a
-- lista). Sem valor padrão: quem grava é o gatilho, com o que o servidor leu.
-- "is not distinct from", e não "=": com o código que não serve, a gtin_key dá
-- null, e um check que dá null deixa a linha passar.
alter table public.shared_prices
  add column gtin text
    constraint shared_prices_gtin_check check (gtin is null or gtin is not distinct from public.gtin_key(gtin));

-- A leitura pelo código de barras, no molde de shared_prices_item_state_idx:
-- de cada código da casa, as linhas mais novas do estado dela. Só as linhas com
-- código (a maioria das de hortifruti e de padaria não tem).
create index shared_prices_gtin_state_idx on public.shared_prices (gtin, store_uf, seen_on desc) where gtin is not null;

-- =============================================================================
-- Gravação: o GTIN da leitura do servidor
-- =============================================================================

-- A share_receipt_prices de 20261022170000_store_printed_name.sql, igual, com
-- SÓ esta mudança: as linhas lidas trazem o gtin (o que não passa na gtin_key
-- vira null ali mesmo, e a linha entra sem ele), a linha comum grava o da
-- linha lida que bate com ela, e o on conflict o mantém (ver acima).
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
    -- da casa (receipt_items.store_code) ela pode ter mexido, o lido não.
    insert into public.shared_prices (store_cnpj, store_uf, store_name, item_key, unit, seen_on, unit_price, visible_on, gtin)
    with read_lines as materialized (
      select distinct public.normalize_alias(x.description) as item_key, x.unit, round(x.unit_price, 4) as unit_price,
          case when v_read.source = any (v_gtin_sources) and x.gtin not like '00%' and public.gtin_key(x.gtin) = x.gtin
            then x.gtin end as gtin
        from jsonb_to_recordset(v_read.lines) as x (description text, unit text, unit_price numeric, gtin text)
    )
    select v_read.store_cnpj, substr(v_key, 1, 2), v_name, l.item_key, l.unit, v_day, l.unit_price, v_today + 1,
        -- As linhas lidas que batem: um GTIN só entre elas (a que veio sem ele não conta); dois diferentes, nenhum.
        (select case when count(distinct rl.gtin) = 1 then min(rl.gtin) end
           from read_lines rl
           where rl.item_key = l.item_key and rl.unit = l.unit and rl.unit_price = l.unit_price)
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
      ) l
      order by l.item_key, l.unit
    on conflict (store_cnpj, item_key, unit, seen_on) do update
      set unit_price = excluded.unit_price,
          store_name = case when excluded.store_name ~ '^CNPJ [0-9]{14}$' then public.shared_prices.store_name else excluded.store_name end,
          store_uf = coalesce(excluded.store_uf, public.shared_prices.store_uf),
          -- Como o estado: a gravação sem código de barras não apaga o que a linha já tinha.
          gtin = coalesce(excluded.gtin, public.shared_prices.gtin)
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
-- Leitura: o produto da casa acha a linha também pelo código de barras
-- =============================================================================

-- A shared_latest_prices de 20261023120000_store_standard_names.sql, igual (o
-- nome padrão do mercado, os 90 dias, visible_on, o estado, os 5 melhores, o
-- preço próprio da casa escondendo o compartilhado, as mesmas colunas), com um
-- segundo caminho do produto à linha: além do apelido (product_aliases.alias =
-- item_key), o código de barras que a casa ligou ao produto
-- (product_barcodes.gtin = shared_prices.gtin, só os da casa). Nos dois lados
-- (mine e others), cada caminho parte do seu índice: o apelido pela chave
-- primária (mine) ou por item e estado (others), o código pelo índice por
-- código e estado. O mesmo produto pelos dois caminhos até a mesma linha, ou
-- até duas descrições do mesmo mercado e unidade, sai uma vez só: o
-- distinct on por (produto, mercado, unidade) vem depois de juntar os dois, com
-- o mesmo desempate de antes (o dia mais novo, o preço mais baixo, a chave).
create or replace function public.shared_latest_prices()
returns table (
  product_id uuid,
  store_cnpj text,
  store_name text,
  store_uf text,
  unit text,
  unit_price numeric,
  seen_on date,
  mine boolean
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
      f.product_id, f.store_cnpj, f.store_name, f.store_uf, f.unit, f.unit_price, f.seen_on
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
      f.product_id, f.store_cnpj, f.store_name, f.store_uf, f.unit, f.unit_price, f.seen_on
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
      m.store_uf, m.unit, m.unit_price, m.seen_on, true
    from mine m
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
      r.store_uf, r.unit, r.unit_price, r.seen_on, false
    from ranked r
    where r.place <= 5;
$$;

revoke execute on function public.shared_latest_prices() from public, anon;
grant execute on function public.shared_latest_prices() to authenticated;
