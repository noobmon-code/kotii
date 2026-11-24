-- Preços de outras casas: a lista aberta.
--
-- Decisão do dono (21/11/2026): "vamos compartilhar tudo. Será uma grande
-- lista aberta, assim a primeira vez que alguém for comprar não fica sem base
-- de preço nenhuma e a gente preenche mais os itens. Como a base tende a ser
-- grande, não faz diferença pra saber quem foi no mercado e comprou o que."
-- E sobre a semana: "semana serve, ainda não temos tantos usuários".
--
-- Até aqui, shared_latest_prices só devolvia o preço de uma descrição ou de um
-- código de barras que a casa já tinha (um produto dela), e nada antes da
-- primeira nota confirmada. Agora toda casa lê toda a base dos estados onde
-- compra, também o que nunca comprou: a lista acha o preço do item que a casa
-- ainda não pagou (o app decide, com o vocabulário da revisão da nota, quais
-- descrições são o mesmo item).
--
-- A salvaguarda enquanto a base é pequena é a SEMANA (de segunda a domingo, em
-- São Paulo). Num mercado com uma casa só no Kotii, mercado + item + dia diria
-- o que aquela casa comprou naquele dia. Então, em toda leitura:
--   * nenhuma função devolve um dia: o que volta é a segunda-feira da semana
--     da compra (shared_week), no lugar de seen_on;
--   * dentro de uma semana, nada é escolhido pelo dia (nem a ordem de duas
--     compras): vence o menor preço, depois a chave;
--   * a linha só passa a ser lida na segunda-feira depois da semana em que foi
--     gravada (visible_on = shared_week(hoje) + 7, igual para todas as casas);
--   * a janela é de 13 semanas inteiras (seen_on >= shared_week(hoje) - 91):
--     uma linha sai dela numa segunda-feira, nunca num dia que a dataria;
--   * a compra da própria casa esconde a linha comum da mesma semana ou de
--     antes (com o dia exato, um membro aprenderia o dia da linha).
-- A tabela continua guardando o dia (seen_on): a chave primária, a janela e a
-- regra da compra própria precisam dele. Ele só não sai do banco. E o que fica
-- antes da janela, que nenhuma leitura devolve mais, é apagado uma vez por dia
-- (forget_old_shared_prices, na seção 6).
--
-- Os estados de uma casa (shared_household_states): os das notas lidas e
-- confirmadas (os dois primeiros dígitos da chave de acesso) e, agora, o do
-- local da casa (household_location.state_code, gravado com "Onde fica a
-- casa"), para a primeira compra já ter base. Sem estado nenhum, nada de fora
-- dos mercados da casa, nunca o país inteiro.
--
-- A leitura aberta são duas funções, em jsonb (sem o teto de 1000 linhas do
-- PostgREST, então sem paginar):
--   1. shared_item_keys: as descrições (item_key) que começam pelas palavras
--      do item da lista, com a unidade, a segunda-feira da semana mais recente
--      e em quantos (mercado, semana) foram vistas. É o único lugar em que as
--      descrições saem do banco (os termos dizem); a que tem um número
--      comprido (8 dígitos ou mais seguidos: um CPF, um telefone) não sai.
--   2. shared_item_prices: para grupos de descrições que o app achou serem o
--      mesmo item, o preço da semana mais recente de cada mercado (o menor da
--      semana), dos mercados da casa e dos 5 mais baratos dos outros, com o
--      tamanho que o servidor leu na nota (pack_*). A linha por unidade só
--      vem das descrições que o app escolheu por unidade (k; as de w só
--      valem vendidas a peso), e, com o tamanho que o app escolheu para o
--      grupo (p), a linha por unidade cujo tamanho lido é outro fica de fora.
-- As regras de 20261014120000_shared_prices.sql continuam: a lista de
-- categorias, as camadas de remédio e de farmácia, o CPF fora do nome da loja,
-- nenhuma coluna de casa, pessoa ou nota, e uma linha por (mercado, item,
-- unidade, dia).
--
-- O ranking dos 5 mais baratos dos outros mercados continua por embalagem,
-- como em 20261122140000_package_sizes.sql (a decisão 3 de lá fica como está).
--
-- O app funciona antes desta migração: sem as duas funções novas, nada de
-- preço aberto (null, sem erro); sem state_code, o local se lê e grava sem
-- ele; a shared_latest_prices de antes devolve dias, e o app mostra a semana
-- deles. Ordem de publicação (com o OK do dono): o merge do app, que põe os
-- termos novos no ar, e o db push no mesmo dia.

-- =============================================================================
-- 1. A semana, o estado da casa e os índices
-- =============================================================================

-- A semana de um dia: a segunda-feira dela (semana ISO). É a única data que sai da base. Com "set search_path", como
-- toda função daqui (o Security Advisor do Supabase acusa a que não tem). Uma função com SET não é expandida dentro
-- da consulta que a chama, então as leituras, que precisam da semana em cada linha, escrevem a mesma semana com a
-- função do Postgres, date_trunc('week', dia::timestamp)::date (com shared_week linha a linha, a busca do passo 1
-- ficava quatro vezes mais lenta); shared_week fica para a semana de hoje, uma vez por chamada. O teste do banco
-- confere que as duas dão a mesma segunda-feira.
create or replace function public.shared_week(p_day date) returns date
language sql immutable parallel safe set search_path = '' as $$
  select p_day - (extract(isodow from p_day)::integer - 1);
$$;
revoke execute on function public.shared_week(date) from public, anon, authenticated;

-- O estado da casa, gravado com o local (código do IBGE, como shared_prices.store_uf). Vem do CEP (a sigla do
-- ViaCEP ou da BrasilAPI) ou da localização do celular (o ISO3166-2-lvl4 do OpenStreetMap), lido no app; o
-- local gravado antes ganha o estado uma vez, pela tela Hoje. Qualquer pessoa da casa grava (a policy de sempre).
alter table public.household_location add column if not exists state_code text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'household_location_state_code_check'
                   and conrelid = 'public.household_location'::regclass) then
    alter table public.household_location add constraint household_location_state_code_check check (state_code is null or state_code in
      ('11','12','13','14','15','16','17','21','22','23','24','25','26','27','28','29','31','32','33','35','41','42','43','50','51','52','53'));
  end if;
end $$;

-- Os estados de uma casa: os das notas lidas e confirmadas, mais o do local. Security invoker e executável por
-- nenhum cliente: só roda dentro das leituras abaixo (security definer), como o dono delas.
create or replace function public.shared_household_states(p_household uuid) returns text[]
language sql stable security invoker set search_path = '' as $$
  select coalesce(array_agg(distinct s.uf order by s.uf), '{}')
    from (
      select substr(r.access_key, 1, 2) as uf from public.receipts r
        where r.household_id = p_household and r.status = 'confirmed' and r.source in ('qrcode', 'ai') and r.access_key is not null
      union
      select l.state_code from public.household_location l where l.household_id = p_household
    ) s
    where s.uf is not null;
$$;
revoke execute on function public.shared_household_states(uuid) from public, anon, authenticated;

-- A busca aberta vai pela primeira e pela segunda palavra da chave, por estado, dentro da janela. O INCLUDE deixa
-- a busca só no índice.
create index if not exists shared_prices_first_word_idx
  on public.shared_prices (store_uf, split_part(item_key, ' ', 1), seen_on desc) include (item_key, unit, visible_on, store_cnpj);
create index if not exists shared_prices_second_word_idx
  on public.shared_prices (store_uf, split_part(item_key, ' ', 2), seen_on desc) include (item_key, unit, visible_on, store_cnpj);

-- Uma vez: o que foi gravado NESTA semana (o visible_on de antes é o dia da gravação + 1, então "depois desta
-- segunda"), já legível ou não, segue a regra nova e espera a próxima segunda. O gravado em semanas anteriores
-- continua legível: pela regra nova, já seria. Mover estas linhas não diz nada de casa nenhuma: acontece com
-- todas as linhas da semana de uma vez, na hora da migração.
update public.shared_prices
  set visible_on = public.shared_week((now() at time zone 'America/Sao_Paulo')::date) + 7
  where visible_on > public.shared_week((now() at time zone 'America/Sao_Paulo')::date);

-- =============================================================================
-- 2. A gravação: legível na segunda-feira depois da semana
-- =============================================================================

-- A share_receipt_prices de 20261122140000_package_sizes.sql, igual, com SÓ esta mudança: a linha passa a ser
-- lida na segunda-feira depois da semana da gravação (v_visible), não no dia seguinte. O on conflict continua
-- só para a linha que ninguém lê ainda (visible_on > hoje): agora, até a próxima segunda.
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
  -- A segunda-feira depois desta semana: tudo o que for gravado nesta semana, por qualquer casa, passa a ser
  -- lido junto, nesse dia (20261122150000_shared_prices_open.sql).
  v_visible constant date := public.shared_week((now() at time zone 'America/Sao_Paulo')::date) + 7;
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
    select v_read.store_cnpj, substr(v_key, 1, 2), v_name, l.item_key, l.unit, v_day, l.unit_price, v_visible, l.gtin,
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
-- 3. O caminho do produto, pela semana e sem a porta da primeira nota
-- =============================================================================

-- A shared_latest_prices de 20261122140000_package_sizes.sql, com as mesmas colunas (os apps instalados continuam
-- chamando), e só estas mudanças:
--   * sem a porta da nota confirmada: a casa lê desde a primeira vez que abre, e os estados dela são os de
--     shared_household_states (as notas lidas e o local);
--   * a janela é de 13 semanas inteiras (since), não de 90 dias;
--   * dentro de uma semana, o dia não escolhe: vence a semana mais nova, depois o menor preço e a chave;
--   * a compra própria da casa na mesma semana ou depois esconde a linha (o dia exato diria o dia dela);
--   * seen_on volta como a segunda-feira da semana da compra.
-- O tamanho continua vindo no fim, pela chave primária da linha escolhida (o seen_on de verdade dela), e a busca
-- continua com as colunas de antes, para os índices serem os mesmos (o teste do plano confere).
create or replace function public.shared_latest_prices()
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
    select h.id, (now() at time zone 'America/Sao_Paulo')::date as today,
        public.shared_week((now() at time zone 'America/Sao_Paulo')::date) - 91 as since
      from (select public.current_household_id() as id) h
      where h.id is not null
  ),
  my_stores as (
    select s.cnpj
      from public.stores s
      where s.household_id = (select id from me) and s.cnpj is not null
  ),
  my_states as (
    select unnest(public.shared_household_states((select id from me))) as uf
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
            and p.seen_on >= (select since from me) and p.seen_on < (select today from me)
            and p.visible_on <= (now() at time zone 'America/Sao_Paulo')::date
        union all
        select b.product_id, p.store_cnpj, p.store_name, p.store_uf, p.unit, p.unit_price, p.seen_on, p.item_key
          from public.product_barcodes b
          join public.shared_prices p on p.gtin = b.gtin
          where b.household_id = (select id from me)
            and p.gtin is not null
            and p.store_cnpj in (select cnpj from my_stores)
            and p.seen_on >= (select since from me) and p.seen_on < (select today from me)
            and p.visible_on <= (now() at time zone 'America/Sao_Paulo')::date
      ) f
      -- A semana mais nova; dentro dela, a descrição mais barata, sempre a mesma (o dia não escolhe).
      order by f.product_id, f.store_cnpj, f.unit, date_trunc('week', f.seen_on::timestamp)::date desc, f.unit_price, f.item_key
  ),
  -- Nos outros: só linhas com um estado da casa (os índices são por item ou código, e estado), a da semana mais
  -- recente de cada mercado.
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
            and p.seen_on >= (select since from me) and p.seen_on < (select today from me)
            and p.visible_on <= (now() at time zone 'America/Sao_Paulo')::date
        union all
        select b.product_id, p.store_cnpj, p.store_name, p.store_uf, p.unit, p.unit_price, p.seen_on, p.item_key
          from public.product_barcodes b
          join public.shared_prices p on p.gtin = b.gtin
          where b.household_id = (select id from me)
            and p.gtin is not null
            and p.store_uf in (select uf from my_states)
            and not exists (select 1 from my_stores m where m.cnpj = p.store_cnpj)
            and p.seen_on >= (select since from me) and p.seen_on < (select today from me)
            and p.visible_on <= (now() at time zone 'America/Sao_Paulo')::date
      ) f
      order by f.product_id, f.store_cnpj, f.unit, date_trunc('week', f.seen_on::timestamp)::date desc, f.unit_price, f.item_key
  ),
  ranked as (
    select o.*, row_number() over (partition by o.product_id, o.unit order by o.unit_price, date_trunc('week', o.seen_on::timestamp)::date desc, o.store_cnpj) as place
      from others o
  )
  select m.product_id, m.store_cnpj,
      coalesce((select n.name from public.store_names n where n.cnpj = m.store_cnpj), m.store_name),
      m.store_uf, m.unit, m.unit_price, date_trunc('week', m.seen_on::timestamp)::date, true, z.pack_unit, z.pack_amount, z.pack_of
    from mine m
    -- O tamanho da linha escolhida, pela chave primária dela (o dia de verdade, que não sai daqui).
    join public.shared_prices z
      on z.store_cnpj = m.store_cnpj and z.item_key = m.item_key and z.unit = m.unit and z.seen_on = m.seen_on
    -- O preço próprio da casa é o de price_observations (nota confirmada, de qualquer origem, com produto e
    -- mercado), lido aqui a partir das notas DA CASA, que têm índice. Da mesma semana em diante: comparar com o
    -- dia exato deixaria um membro descobrir o dia da linha comum.
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
          and (r.purchased_at at time zone 'America/Sao_Paulo')::date >= date_trunc('week', m.seen_on::timestamp)::date
    )
  union all
  select r.product_id, r.store_cnpj,
      coalesce((select n.name from public.store_names n where n.cnpj = r.store_cnpj), r.store_name),
      r.store_uf, r.unit, r.unit_price, date_trunc('week', r.seen_on::timestamp)::date, false, z.pack_unit, z.pack_amount, z.pack_of
    from ranked r
    join public.shared_prices z
      on z.store_cnpj = r.store_cnpj and z.item_key = r.item_key and z.unit = r.unit and z.seen_on = r.seen_on
    where r.place <= 5;
$$;

revoke execute on function public.shared_latest_prices() from public, anon;
grant execute on function public.shared_latest_prices() to authenticated;

-- =============================================================================
-- 4. A leitura aberta, passo 1: as descrições do item
-- =============================================================================

-- p_items: 1 a 40 buscas {"f": [1..24 palavras], "s": [0..24], "x": [0..12]}, cada palavra ^[A-Z0-9]{1,40}$.
-- "f" são as palavras com que a descrição pode começar (o item, no singular e no plural, e as abreviações da nota:
-- "LEITE", "LEITES", "LT", "LTE"), "s" as que podem vir em segundo ("CX LEITE"), e "x" as outras palavras do item,
-- que só ordenam ("SEM", "LACTOSE"). Volta um elemento por busca, na ordem delas: {"k": [[chave, unidade,
-- segunda-feira da semana mais recente, em quantos (mercado, semana) foi vista], ...], "more": a busca tinha mais
-- de 60}. Sem casa ou sem estado, {"k": [], "more": false} para cada uma (o app diferencia uma resposta vazia de
-- uma de forma errada).
create or replace function public.shared_item_keys(p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_household constant uuid := public.current_household_id();
  v_today constant date := (now() at time zone 'America/Sao_Paulo')::date;
  v_since constant date := public.shared_week((now() at time zone 'America/Sao_Paulo')::date) - 91;
  v_states text[];
begin
  -- A forma, em passos (o plpgsql avalia os IFs em ordem; um OR do SQL não garantiria isso).
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 40 then
    raise exception 'shared_item_keys: invalid items' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e (v)
               where jsonb_typeof(e.v) <> 'object'
                  or jsonb_typeof(e.v -> 'f') is distinct from 'array' or jsonb_typeof(e.v -> 's') is distinct from 'array'
                  or jsonb_typeof(e.v -> 'x') is distinct from 'array') then
    raise exception 'shared_item_keys: invalid items' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e (v)
               where jsonb_array_length(e.v -> 'f') not between 1 and 24 or jsonb_array_length(e.v -> 's') > 24
                  or jsonb_array_length(e.v -> 'x') > 12)
     or exists (select 1 from jsonb_array_elements(p_items) e (v)
                  cross join lateral jsonb_array_elements((e.v -> 'f') || (e.v -> 's') || (e.v -> 'x')) w (word)
                  where jsonb_typeof(w.word) <> 'string' or (w.word #>> '{}') !~ '^[A-Z0-9]{1,40}$') then
    raise exception 'shared_item_keys: invalid items' using errcode = '22023';
  end if;
  v_states := case when v_household is null then '{}'::text[] else public.shared_household_states(v_household) end;
  -- Os CTEs com as respostas de cada palavra são materialized: sem isso, o planejador leva o filtro de cada busca
  -- para dentro deles e varre o índice uma vez por busca (40 vezes a base do estado).
  return (
    with entries as materialized (
      select e.at,
          array(select jsonb_array_elements_text(e.v -> 'f')) as f,
          array(select jsonb_array_elements_text(e.v -> 's')) as s,
          array(select jsonb_array_elements_text(e.v -> 'x')) as x
        from jsonb_array_elements(p_items) with ordinality e (v, at)
    ),
    first_words as (select distinct unnest(f) as word from entries),
    second_words as (select distinct unnest(s) as word from entries),
    -- Cada palavra é procurada uma vez para a chamada toda (não uma por busca), por estado, nos dois índices.
    hits as materialized (
      select p.item_key, p.unit, p.seen_on, p.store_cnpj
        from first_words w
        cross join unnest(v_states) st (uf)
        join public.shared_prices p on p.store_uf = st.uf and split_part(p.item_key, ' ', 1) = w.word
        where p.seen_on >= v_since and p.visible_on <= v_today
      union all
      select p.item_key, p.unit, p.seen_on, p.store_cnpj
        from second_words w
        cross join unnest(v_states) st (uf)
        join public.shared_prices p on p.store_uf = st.uf and split_part(p.item_key, ' ', 2) = w.word
        where p.seen_on >= v_since and p.visible_on <= v_today
    ),
    -- Cada (chave, unidade, mercado, semana) uma vez: o dia some aqui.
    store_weeks as materialized (
      select distinct h.item_key, h.unit, h.store_cnpj, date_trunc('week', h.seen_on::timestamp)::date as week from hits h
    ),
    found as materialized (
      -- Por chave: a segunda-feira da semana mais nova e em quantos (mercado, semana) foi vista. Nunca um dia, nunca
      -- uma conta de dias.
      select h.item_key, h.unit, split_part(h.item_key, ' ', 1) as first_word, split_part(h.item_key, ' ', 2) as second_word,
          max(h.week) as week, count(*)::integer as seen
        from store_weeks h
        group by h.item_key, h.unit
        -- A descrição com um número comprido (8 dígitos ou mais seguidos, com espaços no meio: um CPF, um telefone,
        -- um documento) nunca sai da base.
        having not exists (
          select 1 from regexp_matches(h.item_key, '(?:^| )([0-9]+(?: [0-9]+)*)(?= |$)', 'g') m (g)
            where length(replace(m.g[1], ' ', '')) >= 8)
    ),
    -- As chaves de cada busca: pela primeira palavra ("f") ou pela segunda ("s"), uma vez cada.
    matched as (
      select en.at, fo.item_key, fo.unit, fo.week, fo.seen
        from entries en cross join lateral unnest(en.f) w (word) join found fo on fo.first_word = w.word
      union
      select en.at, fo.item_key, fo.unit, fo.week, fo.seen
        from entries en cross join lateral unnest(en.s) w (word) join found fo on fo.second_word = w.word
    ),
    ranked as (
      -- Por busca: primeiro as chaves cujas palavras depois da primeira soletram mais das outras palavras do item
      -- (uma palavra da nota de 3 letras ou mais pode abreviar a da lista, "DESN" de "desnatado"; nunca o
      -- contrário), depois as mais vistas, a mais nova, a chave. Nunca um corte em ordem alfabética.
      select c.*, row_number() over (partition by c.at order by c.hits desc, c.seen desc, c.week desc, c.item_key, c.unit) as place
        from (
          select m.*,
              (select count(*)::integer
                 from unnest(string_to_array(m.item_key, ' ')) with ordinality t (word, pos)
                 where t.pos > 1 and exists (
                   select 1 from unnest(en.x) x (word)
                     where x.word = t.word or (length(t.word) >= 3 and starts_with(x.word, t.word)))) as hits
            from matched m
            join entries en on en.at = m.at
        ) c
    )
    select coalesce(jsonb_agg(a.answer order by a.at), '[]'::jsonb)
      from (
        select en.at, jsonb_build_object(
            'k', coalesce(jsonb_agg(jsonb_build_array(r.item_key, r.unit, r.week, r.seen) order by r.place)
                   filter (where r.place <= 60), '[]'::jsonb),
            'more', coalesce(max(r.place) > 60, false)) as answer
          from entries en
          left join ranked r on r.at = en.at
          group by en.at
      ) a
  );
end;
$$;
revoke execute on function public.shared_item_keys(jsonb) from public, anon;
grant execute on function public.shared_item_keys(jsonb) to authenticated;

-- =============================================================================
-- 5. A leitura aberta, passo 2: os preços de cada grupo
-- =============================================================================

-- p_groups: 1 a 40 grupos {"k": [chaves], "w": [chaves], opcional, "p": tamanho esperado, opcional}, com 1 a 60
-- chaves normalizadas de 1..200 letras entre "k" e "w", nenhuma nas duas; o número do grupo é a posição dele (a
-- partir de 0). "k" são as descrições cujas linhas valem em toda unidade, e "w" as que só valem vendidas a peso (kg,
-- g, l, ml): a descrição vista a peso num mercado e por unidade em outro ("ALHO": o alho a granel e a cabeça solta)
-- entra pelo peso sem trazer a linha por unidade que o app não escolheu (ela levaria o tamanho do grupo, a bandeja de
-- 200 g). "p" é o tamanho que o app escolheu para as chaves por unidade do grupo ({"u": "kg" | "l" | "un", "a":
-- quanto, "o": de quantos, opcional}, a forma de pack_* na tabela): a linha por unidade cujo tamanho lido pelo
-- servidor é outro fica de fora (uma descrição que, padronizada, ficou igual à de outra embalagem); a que não tem
-- tamanho lido fica (vale o que a descrição diz; pode ser a do fardo vendido com a descrição da lata, que a leitura
-- do QR code nunca mede, e o app só a usa quando o preço combina com o dos outros mercados do grupo: openQuotes, em
-- src/domain/openPrices.ts). Volta uma lista de [grupo, cnpj, nome, estado, unidade, preço, segunda-feira da semana,
-- é mercado da casa, pack_unit, pack_amount, pack_of].
create or replace function public.shared_item_prices(p_groups jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_household constant uuid := public.current_household_id();
  v_today constant date := (now() at time zone 'America/Sao_Paulo')::date;
  v_since constant date := public.shared_week((now() at time zone 'America/Sao_Paulo')::date) - 91;
  v_states text[];
  v_stores text[];
begin
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) not between 1 and 40 then
    raise exception 'shared_item_prices: invalid groups' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_groups) e (v)
               where jsonb_typeof(e.v) <> 'object' or jsonb_typeof(e.v -> 'k') is distinct from 'array'
                  or jsonb_typeof(coalesce(e.v -> 'w', '[]'::jsonb)) <> 'array'
                  or jsonb_typeof(coalesce(e.v -> 'p', '{}'::jsonb)) not in ('object', 'null')) then
    raise exception 'shared_item_prices: invalid groups' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_groups) e (v)
               where jsonb_array_length(e.v -> 'k') + jsonb_array_length(coalesce(e.v -> 'w', '[]'::jsonb)) not between 1 and 60)
     or exists (select 1 from jsonb_array_elements(p_groups) e (v)
                  cross join lateral jsonb_array_elements((e.v -> 'k') || coalesce(e.v -> 'w', '[]'::jsonb)) k (key)
                  where jsonb_typeof(k.key) <> 'string' or length(k.key #>> '{}') not between 1 and 200
                     or (k.key #>> '{}') <> public.normalize_alias(k.key #>> '{}')) then
    raise exception 'shared_item_prices: invalid groups' using errcode = '22023';
  end if;
  -- Uma chave em "k" e em "w" ao mesmo tempo não diz o que vale.
  if exists (select 1 from jsonb_array_elements(p_groups) e (v)
               cross join lateral jsonb_array_elements_text(coalesce(e.v -> 'w', '[]'::jsonb)) w (key)
               where (e.v -> 'k') ? w.key) then
    raise exception 'shared_item_prices: invalid groups' using errcode = '22023';
  end if;
  -- O tamanho esperado, quando vem: a forma do check de shared_prices (primeiro os tipos, depois os valores).
  if exists (select 1 from jsonb_array_elements(p_groups) e (v)
               where jsonb_typeof(e.v -> 'p') = 'object'
                 and (jsonb_typeof(e.v -> 'p' -> 'u') is distinct from 'string' or jsonb_typeof(e.v -> 'p' -> 'a') is distinct from 'number'
                      or jsonb_typeof(coalesce(e.v -> 'p' -> 'o', 'null'::jsonb)) not in ('number', 'null'))) then
    raise exception 'shared_item_prices: invalid groups' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_groups) e (v)
               where jsonb_typeof(e.v -> 'p') = 'object'
                 and not coalesce(
                   (e.v -> 'p' ->> 'u') in ('kg', 'l', 'un')
                   and (e.v -> 'p' ->> 'a')::numeric > 0 and (e.v -> 'p' ->> 'a')::numeric <= 100000
                   and ((e.v -> 'p' ->> 'u') <> 'un' or ((e.v -> 'p' ->> 'a')::numeric = trunc((e.v -> 'p' ->> 'a')::numeric)
                                                         and (e.v -> 'p' ->> 'a')::numeric >= 2))
                   and (e.v -> 'p' -> 'o' is null or jsonb_typeof(e.v -> 'p' -> 'o') = 'null'
                        or ((e.v -> 'p' ->> 'u') <> 'un' and (e.v -> 'p' ->> 'o')::numeric = trunc((e.v -> 'p' ->> 'o')::numeric)
                            and (e.v -> 'p' ->> 'o')::numeric between 2 and 1000)), false)) then
    raise exception 'shared_item_prices: invalid groups' using errcode = '22023';
  end if;
  if v_household is null then return '[]'::jsonb; end if;
  v_states := public.shared_household_states(v_household);
  if cardinality(v_states) = 0 then return '[]'::jsonb; end if;
  v_stores := array(select s.cnpj from public.stores s where s.household_id = v_household and s.cnpj is not null);
  return coalesce((
    with groups as (
      select (e.at - 1)::integer as g, e.v -> 'k' as keys, coalesce(e.v -> 'w', '[]'::jsonb) as weight_keys,
          case when jsonb_typeof(e.v -> 'p') = 'object' then e.v -> 'p' ->> 'u' end as pu,
          case when jsonb_typeof(e.v -> 'p') = 'object' then round((e.v -> 'p' ->> 'a')::numeric, 6) end as pa,
          case when jsonb_typeof(e.v -> 'p' -> 'o') = 'number' then (e.v -> 'p' ->> 'o')::numeric::smallint end as po
        from jsonb_array_elements(p_groups) with ordinality e (v, at)
    ),
    wanted as (
      -- by_unit: a chave vale em toda unidade ("k"); senão, só vendida a peso ("w").
      select distinct gr.g, k.key, true as by_unit, gr.pu, gr.pa, gr.po
        from groups gr
        cross join lateral jsonb_array_elements_text(gr.keys) k (key)
      union all
      select distinct gr.g, w.key, false, gr.pu, gr.pa, gr.po
        from groups gr
        cross join lateral jsonb_array_elements_text(gr.weight_keys) w (key)
    ),
    seen as (
      select w.g, p.store_cnpj, p.store_name, p.store_uf, p.unit, p.unit_price, p.item_key,
          date_trunc('week', p.seen_on::timestamp)::date as week, p.store_cnpj = any (v_stores) as mine,
          p.pack_unit, p.pack_amount, p.pack_of
        from wanted w
        join public.shared_prices p on p.item_key = w.key and p.store_uf = any (v_states)   -- shared_prices_item_state_idx
        where p.seen_on >= v_since and p.visible_on <= v_today
          -- A linha por unidade só da chave que o app escolheu por unidade.
          and (w.by_unit or p.unit <> 'un')
          -- O tamanho que o servidor leu na nota, quando é outro que o do grupo: a linha é de outra embalagem.
          and (p.unit <> 'un' or w.pu is null or p.pack_unit is null
               or (p.pack_unit = w.pu and p.pack_amount = w.pa and p.pack_of is not distinct from w.po))
          -- A casa comprou esta mesma descrição (um apelido de produto dela) naquele mercado, naquela semana ou
          -- depois: a linha é a compra dela ou notícia mais velha (a regra do caminho do produto, pela semana).
          and not exists (
            select 1
              from public.product_aliases a
              join public.receipt_items ri on ri.product_id = a.product_id and ri.household_id = a.household_id
              join public.receipts r on r.id = ri.receipt_id and r.household_id = ri.household_id
              join public.stores st on st.id = r.store_id and st.household_id = r.household_id
              where a.household_id = v_household and a.alias = p.item_key
                and r.status = 'confirmed' and st.cnpj = p.store_cnpj and ri.unit_price > 0
                and (r.purchased_at at time zone 'America/Sao_Paulo')::date >= date_trunc('week', p.seen_on::timestamp)::date)
    ),
    newest as (
      -- Uma linha por grupo, mercado e unidade: a SEMANA mais nova, depois a mais barata. O dia não escolhe.
      select distinct on (x.g, x.store_cnpj, x.unit) x.*
        from seen x order by x.g, x.store_cnpj, x.unit, x.week desc, x.unit_price, x.item_key,
          x.pack_unit nulls last, x.pack_amount nulls last, x.pack_of nulls last
    ),
    ranked as (
      select n.*, row_number() over (partition by n.g, n.unit order by n.unit_price, n.week desc, n.store_cnpj) as place
        from newest n where not n.mine
    ),
    chosen as (
      select n.g, n.store_cnpj, n.store_name, n.store_uf, n.unit, n.unit_price, n.week, true as mine,
          n.pack_unit, n.pack_amount, n.pack_of
        from newest n where n.mine
      union all
      select r.g, r.store_cnpj, r.store_name, r.store_uf, r.unit, r.unit_price, r.week, false,
          r.pack_unit, r.pack_amount, r.pack_of
        from ranked r where r.place <= 5
    )
    select jsonb_agg(jsonb_build_array(c.g, c.store_cnpj,
        coalesce((select sn.name from public.store_names sn where sn.cnpj = c.store_cnpj), c.store_name),
        c.store_uf, c.unit, c.unit_price, c.week, c.mine, c.pack_unit, c.pack_amount, c.pack_of)
        order by c.g, c.mine desc, c.store_cnpj, c.unit)
      from chosen c), '[]'::jsonb);
end;
$$;
revoke execute on function public.shared_item_prices(jsonb) from public, anon;
grant execute on function public.shared_item_prices(jsonb) to authenticated;

-- =============================================================================
-- 6. A limpeza: o que nenhuma leitura devolve mais sai da base
-- =============================================================================

-- Decisão do dono (24/11/2026): as linhas que as leituras nunca mais podem devolver são apagadas. As três leituras
-- (shared_latest_prices, shared_item_keys, shared_item_prices) só aceitam as 13 semanas inteiras da janela, a
-- partir de shared_week(hoje) - 91 em São Paulo; esta função apaga, com a MESMA expressão, toda linha de antes
-- disso. A janela só anda para a frente (a semana de hoje nunca volta), então uma linha apagada nunca mais seria
-- lida; a da primeira semana da janela (seen_on = since ou depois) fica. Também sai a linha gravada hoje com uma
-- compra de mais de 13 semanas (uma nota velha confirmada agora), que nunca seria lida. Roda uma vez por dia, pelo
-- pg_cron, como dono; nenhum cliente a executa.
create or replace function public.forget_old_shared_prices()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.shared_prices p
      where p.seen_on < public.shared_week((now() at time zone 'America/Sao_Paulo')::date) - 91
      returning 1
  )
  select count(*)::integer from gone;
$$;
revoke execute on function public.forget_old_shared_prices() from public, anon, authenticated;

-- Todo dia às 4h47 UTC (1h47 em São Paulo), entre as limpezas das leituras de nota (4h41) e das marcas de item
-- apagado (4h53). Com o mesmo nome, uma segunda aplicação troca o agendamento em vez de duplicar.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'shared-prices-cleanup') then
    perform cron.unschedule('shared-prices-cleanup');
  end if;
  perform cron.schedule('shared-prices-cleanup', '47 4 * * *', 'select public.forget_old_shared_prices()');
end;
$$;
