-- Preços vistos em outras casas. Toda casa contribui: ao confirmar uma nota
-- LIDA pelo app (QR code ou foto), o mercado, o item, o preço e o dia entram
-- numa base comum, e cada casa vê ali quanto os produtos que ela mesma já
-- comprou custaram nos mercados dela e em outros do mesmo estado. É a
-- primeira coisa do banco que se lê de uma casa para outra, então as regras
-- abaixo são o centro desta migração. Na dúvida, compartilha-se menos.
--
-- 1. Nada aponta de volta. A tabela não tem casa, pessoa, nota, id de linha,
--    sequência nem hora de gravação: com qualquer um deles daria para juntar
--    as linhas de uma mesma compra, ordená-las ou contá-las, e daí chegar a
--    quem comprou. Uma linha diz só "este mercado cobrou tanto por este item
--    neste dia".
-- 2. Uma linha por (mercado, item, unidade, dia). A segunda casa que compra a
--    mesma coisa no mesmo mercado no mesmo dia cai NA MESMA linha: assim não
--    dá para contar quantas casas viram um preço, nem saber se há mais de uma.
-- 3. Só o dia da compra (em São Paulo), sem hora: a hora de uma nota, junto do
--    mercado, já seria quase um nome.
-- 4. Nada aparece no dia em que acontece. A leitura só devolve linhas de dias
--    ANTERIORES a hoje: a compra de hoje aparece para as outras casas a partir
--    de amanhã, e quem fica perguntando ao longo do dia não vê ninguém
--    confirmando nota. Por isso a linha de hoje pode ser regravada (vale a
--    última gravação: ninguém viu a anterior, e uma confirmação honesta
--    conserta uma falsa), e a linha de um dia que já passou NÃO muda mais: ela
--    já pode ter sido lida, e uma mudança nela avisaria quem a observa de que
--    outra casa acabou de confirmar uma nota. (O dia é o da COMPRA: a nota de
--    ontem confirmada hoje entra como linha nova e aparece na hora. Atrasar
--    também essa pediria guardar o dia da gravação, que a regra 1 não deixa.)
-- 5. O item é só a descrição da nota normalizada (normalize_alias, a mesma
--    chave dos apelidos) mais a unidade. A descrição legível NÃO é guardada:
--    uma linha pode ter sido redigitada na revisão, e não há marca disso por
--    linha. Só com a chave, uma casa só recebe preço de uma descrição que ela
--    mesma já tem. Sem nome de produto, categoria, quantidade ou total.
-- 6. Só nota lida (source 'qrcode' ou 'ai'), de mercado com CNPJ, e, quando a
--    nota tem chave de acesso, com o CNPJ do emissor que está dentro da chave
--    igual ao do mercado. Nota digitada à mão nunca entra, nem linha com valor
--    zero (brinde) ou sem descrição.
-- 7. Saúde fica na casa, em três camadas (cada uma cobre o que a outra deixa
--    passar; nenhuma delas é erro, a linha só não entra):
--    a) a linha só entra se a categoria dela estiver na LISTA do que se
--       compartilha (comida, bebida, limpeza, papel, bebê e pet). Remédio,
--       suplemento, primeiros socorros, higiene pessoal e "outros" nunca
--       entram. "Outros" é onde cai, na nota do QR code, o remédio que o app
--       não reconheceu (ele só conhece meia dúzia de nomes); o preço é que o
--       item de mercado não reconhecido também fica de fora;
--    b) nota com QUALQUER linha de saúde não compartilha nada: é compra de
--       farmácia, e as outras linhas podem ser itens de saúde que caíram
--       noutra categoria ("SAL DE FRUTA" vira tempero, "AGUA OXIGENADA",
--       bebida);
--    c) loja com nome de farmácia não compartilha nada.
-- 8. O app nunca toca na tabela: sem policy e sem grant, nem para ler. Só as
--    duas funções daqui leem e gravam.
-- 9. Não há carga do passado: notas confirmadas antes desta migração não
--    entram. E excluir uma nota não retira o que ela deu: nada liga uma coisa
--    à outra, de propósito.
--
-- confirm_receipt não muda: quem grava é um gatilho na confirmação, que nunca
-- faz a confirmação esperar nem falhar.

-- Sem id, sem casa, sem nota, sem hora: ver as regras 1 a 3 acima. Uma coluna
-- nova aqui precisa passar por elas (o teste do banco confere a lista).
create table public.shared_prices (
  store_cnpj text not null check (store_cnpj ~ '^[0-9]{14}$'),
  -- O estado da loja: os dois primeiros dígitos da chave de acesso da nota
  -- (código do IBGE). Vazio quando a nota não tinha chave (foto).
  store_uf text check (store_uf ~ '^[0-9]{2}$'),
  -- O nome impresso do mercado viaja na própria linha (não há tabela de
  -- mercados): assim o nome gravado hoje também só aparece amanhã. Mercado com
  -- CNPJ é sempre criado por uma leitura (QR code ou foto), com o nome como
  -- veio na nota; o criado à mão na revisão não tem CNPJ.
  store_name text not null check (store_name = trim(store_name) and length(store_name) between 1 and 120),
  -- normalize_alias(raw_description): a chave de product_aliases.alias.
  item_key text not null check (item_key = public.normalize_alias(item_key) and length(item_key) between 1 and 200),
  unit text not null check (unit in ('un', 'kg', 'g', 'l', 'ml')),
  -- O dia da compra em São Paulo.
  seen_on date not null,
  unit_price numeric(12, 4) not null check (unit_price > 0),
  primary key (store_cnpj, item_key, unit, seen_on)
);
-- A leitura parte das descrições da casa e quer, de cada uma, as linhas mais
-- novas do estado dela (as dos mercados da própria casa vêm pela chave
-- primária, que começa pelo mercado).
create index shared_prices_item_state_idx on public.shared_prices (item_key, store_uf, seen_on desc);

-- Ninguém entra pela API: RLS ligada sem policy nenhuma, e sem permissão de
-- tabela para quem usa o app (nem leitura). As funções abaixo rodam como dono.
-- O revoke só faz diferença num projeto que ainda dá permissão padrão às
-- tabelas novas (antes de 30/10/2026); depois disso não há o que tirar.
alter table public.shared_prices enable row level security;
revoke all on public.shared_prices from anon, authenticated;
grant all on public.shared_prices to service_role;

-- =============================================================================
-- Gravação: na confirmação da nota (rascunho -> confirmada)
-- =============================================================================

-- security definer: a pessoa que confirma não tem acesso à tabela. Lê só as
-- linhas DESTA nota e grava o que as regras deixam. Tudo dentro de um bloco
-- com exception: um erro aqui (qualquer um) desfaz só o que este gatilho
-- gravou e a nota fica confirmada do mesmo jeito. O erro vai para o log do
-- servidor só com o código, sem dado nenhum da nota.
--
-- lock_timeout: duas confirmações que gravam a mesma linha esperam uma pela
-- outra, e a espera que passa do tempo da instrução (statement timeout) NÃO
-- pode ser apanhada pelo exception: derrubaria a confirmação de quem não tem
-- nada com isso. Com 200 ms a espera vira um erro comum (lock_not_available),
-- o bloco apanha, e só este compartilhamento é pulado.
create function public.share_receipt_prices()
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
  -- Uma linha destas na nota e a nota inteira fica na casa.
  v_health constant text[] := array['medicamentos', 'suplementos', 'primeiros_socorros'];
  -- Pedaços de nome de farmácia, procurados no nome sem acento e em maiúsculas
  -- (normalize_alias): DROG (Raia Drogasil, Drogaria São Paulo, Drogarias
  -- Pacheco, Drogaria Araujo), FARM (Farmácia e Drogaria Nissei, Imifarma, que
  -- é a Extrafarma, São João Farmácias), PHARM (as de manipulação), MEDICAMENT
  -- (Dimed Distribuidora de Medicamentos, que é a Panvel; Comércio de
  -- Medicamentos Brair, a São João; Cia Latino Americana de Medicamentos, a
  -- Catarinense), e as duas redes cujo nome de fachada não tem nada disso.
  v_pharmacy constant text := '(DROG|FARM|PHARM|MEDICAMENT|PAGUE ?MENOS|PANVEL)';
  v_cnpj text;
  v_name text;
  v_day date;
  v_today constant date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  begin
    -- Só nota lida pelo app.
    if new.source not in ('qrcode', 'ai') or new.store_id is null then
      return new;
    end if;

    select s.cnpj, trim(left(trim(s.name), 120)) into v_cnpj, v_name
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
    -- Camada (c): farmácia pelo nome da loja.
    if public.normalize_alias(v_name) ~ v_pharmacy then
      return new;
    end if;

    v_day := (new.purchased_at at time zone 'America/Sao_Paulo')::date;
    -- Data no futuro é data errada, e ficaria como "a mais recente" por meses.
    if v_day > v_today then
      return new;
    end if;

    -- Uma nota comum fica muito abaixo de 300 linhas: o teto limita o que uma
    -- confirmação sozinha consegue gravar na base de todos.
    if (select count(*) from public.receipt_items ri where ri.receipt_id = new.id) > 300 then
      return new;
    end if;

    -- Camada (b): uma linha de saúde, pela categoria do produto ou pela
    -- sugerida na leitura, e nada desta nota sai da casa.
    if exists (
      select 1
        from public.receipt_items ri
        left join public.products p on p.id = ri.product_id and p.household_id = ri.household_id
        where ri.receipt_id = new.id
          and (p.category = any (v_health) or ri.suggested_category = any (v_health))
    ) then
      return new;
    end if;

    -- A mesma descrição duas vezes na nota vira uma linha (a última impressa),
    -- e a ordem fixa evita que duas confirmações ao mesmo tempo se travem.
    insert into public.shared_prices (store_cnpj, store_uf, store_name, item_key, unit, seen_on, unit_price)
    select v_cnpj, substr(new.access_key, 1, 2), v_name, l.item_key, l.unit, v_day, l.unit_price
      from (
        select distinct on (k.item_key, ri.unit) k.item_key, ri.unit, ri.unit_price
          from public.receipt_items ri
          left join public.products p on p.id = ri.product_id and p.household_id = ri.household_id
          cross join lateral (select public.normalize_alias(ri.raw_description) as item_key) k
          where ri.receipt_id = new.id
            and ri.unit_price > 0
            -- Chave vazia não é item; a comprida demais só deixa de fora a própria linha.
            and length(k.item_key) between 1 and 200
            -- Camada (a): a categoria do produto (quando a linha tem produto) E
            -- a sugerida na leitura (quando há) precisam estar na lista; a
            -- linha sem nenhuma das duas não entra.
            and (p.id is not null or ri.suggested_category is not null)
            and (p.id is null or p.category = any (v_shared))
            and (ri.suggested_category is null or ri.suggested_category = any (v_shared))
          order by k.item_key, ri.unit, ri.position desc, ri.id desc
      ) l
      order by l.item_key, l.unit
    on conflict (store_cnpj, item_key, unit, seen_on) do update
      set unit_price = excluded.unit_price,
          -- O nome que o app inventa quando a leitura não trouxe nenhum
          -- ("CNPJ 12345678000199") não troca um nome de verdade.
          store_name = case when excluded.store_name ~ '^CNPJ [0-9]{14}$' then public.shared_prices.store_name else excluded.store_name end,
          -- A foto não traz o estado: fica o que a linha já tinha.
          store_uf = coalesce(excluded.store_uf, public.shared_prices.store_uf)
      -- Só a linha de hoje, que ninguém leu ainda (regra 4). A de um dia que
      -- já passou fica como está.
      where public.shared_prices.seen_on = v_today;
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
-- Leitura: o que outras casas viram dos produtos desta, nos mercados que importam
-- =============================================================================

-- security definer: a única porta de leitura. Parte dos apelidos da própria
-- casa (descrição de nota -> produto): a casa só recebe preço de descrição que
-- ela mesma já confirmou numa nota. Para cada (produto, mercado, unidade), a
-- linha mais recente dos últimos 90 dias, nunca a de hoje (regra 4); nada que
-- diga de quem veio, nem quantas vezes foi vista. Sem casa aberta, ou numa
-- casa que ainda não confirmou nota nenhuma, nada.
--
-- Sem geografia, a lista de todas as lojas do país que vendem um item é
-- ruído. Então só voltam dois tipos de linha:
--   mine = true:  o mercado (pelo CNPJ) é um dos mercados da própria casa.
--                 Todas.
--   mine = false: o mercado não é da casa, e fica num estado onde a casa tem
--                 pelo menos uma nota lida confirmada (os dois primeiros
--                 dígitos da chave de acesso). Para cada (produto, unidade),
--                 no máximo as 5 mais baratas. A linha sem estado (nota lida
--                 por foto) não conta aqui: só aparece no mercado da casa.
-- E fica de fora a linha que a casa já conhece: quando ela tem preço PRÓPRIO
-- daquele produto, num mercado dela com aquele CNPJ, no mesmo dia ou depois, a
-- linha é a compra dela mesma ou notícia mais velha que a dela (só pode
-- acontecer num mercado da casa). Feito aqui, na mesma fotografia do banco que
-- a leitura (o app repete a regra por garantia).
--
-- Isto é filtro de ruído, não de segurança: quem grava os próprios mercados e
-- notas escolhe o CNPJ e o estado que quiser, e o que recebe continua sendo só
-- preço de loja, de descrição que ele já tem.
create function public.shared_latest_prices()
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
  -- Nos mercados da casa: pela chave primária (mercado, item), com ou sem estado na linha.
  mine as (
    select distinct on (a.product_id, p.store_cnpj, p.unit)
      a.product_id, p.store_cnpj, p.store_name, p.store_uf, p.unit, p.unit_price, p.seen_on
      from public.product_aliases a
      cross join my_stores m
      join public.shared_prices p on p.store_cnpj = m.cnpj and p.item_key = a.alias
      where a.household_id = (select id from me)
        and p.seen_on >= (select today from me) - 90 and p.seen_on < (select today from me)
      -- Duas descrições do mesmo produto no mesmo dia: a mais barata, sempre a mesma.
      order by a.product_id, p.store_cnpj, p.unit, p.seen_on desc, p.unit_price, p.item_key
  ),
  -- Nos outros: só linhas com o estado da casa (o índice é por item e estado), a mais recente de cada mercado.
  others as (
    select distinct on (a.product_id, p.store_cnpj, p.unit)
      a.product_id, p.store_cnpj, p.store_name, p.store_uf, p.unit, p.unit_price, p.seen_on
      from public.product_aliases a
      join public.shared_prices p on p.item_key = a.alias
      where a.household_id = (select id from me)
        and p.store_uf in (select uf from my_states)
        and not exists (select 1 from my_stores m where m.cnpj = p.store_cnpj)
        and p.seen_on >= (select today from me) - 90 and p.seen_on < (select today from me)
      order by a.product_id, p.store_cnpj, p.unit, p.seen_on desc, p.unit_price, p.item_key
  ),
  ranked as (
    select o.*, row_number() over (partition by o.product_id, o.unit order by o.unit_price, o.seen_on desc, o.store_cnpj) as place
      from others o
  )
  select m.product_id, m.store_cnpj, m.store_name, m.store_uf, m.unit, m.unit_price, m.seen_on, true
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
          and (r.purchased_at at time zone 'America/Sao_Paulo')::date >= m.seen_on
    )
  union all
  select r.product_id, r.store_cnpj, r.store_name, r.store_uf, r.unit, r.unit_price, r.seen_on, false
    from ranked r
    where r.place <= 5;
$$;

revoke execute on function public.shared_latest_prices() from public, anon;
grant execute on function public.shared_latest_prices() to authenticated;
