-- O nome que a casa dá ao mercado (pedido do dono em 22/10/2026).
--
-- O mercado chega com o nome impresso na nota, que é a razão social do CNPJ:
-- "COMPANHIA BRASILEIRA DE DISTRIBUICAO" é o Pão de Açúcar, e ninguém o
-- reconhece assim. Agora a casa pode renomear o mercado. O novo nome fica em
-- stores.name, que todas as telas já mostram, e o nome de antes vai para
-- stores.printed_name, só enquanto o nome for outro.
--
-- 1. Quem guarda o nome de antes é o gatilho, não o app: na primeira troca, o
--    nome de antes vai para printed_name; nas seguintes, ele fica; voltar a
--    ele limpa a coluna. O "CNPJ ..." que o app põe quando a nota não trouxe
--    nome não é guardado (não é nome de nada). printed_name não se grava de
--    outro jeito: na inclusão e numa gravação que não troca o nome, o valor
--    mandado é ignorado.
-- 2. O mercado continua sendo achado pelo CNPJ (a leitura do QR code e a por
--    foto), e o nome dele não muda com a nota seguinte. Sem CNPJ, a busca
--    pelo nome também olha o de antes (src/data/receipts.ts e a função
--    parse-receipt).
-- 3. O que sai para as outras casas não muda: os preços compartilhados levam o
--    nome lido pelo servidor (receipt_reads), nunca o da casa. E a farmácia
--    continua farmácia depois de renomeada: a camada (c) da share_receipt_prices
--    (abaixo) olha também o nome guardado.

alter table public.stores add column printed_name text;

create function public.stores_keep_printed_name()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  base text;
begin
  if tg_op = 'INSERT' then
    new.printed_name := null;
    return new;
  end if;
  if new.name is not distinct from old.name then
    new.printed_name := old.printed_name;
    return new;
  end if;
  -- O nome de antes: o guardado ou, na primeira troca, o que ele tinha.
  base := coalesce(old.printed_name, old.name);
  new.printed_name := case
    when new.name = base then null
    when old.cnpj is not null and base = 'CNPJ ' || old.cnpj then null
    else base
  end;
  return new;
end;
$$;

revoke execute on function public.stores_keep_printed_name() from public, anon, authenticated;

create trigger stores_keep_printed_name
  before insert or update on public.stores
  for each row execute function public.stores_keep_printed_name();

-- =============================================================================
-- Farmácia renomeada continua farmácia
-- =============================================================================

-- A share_receipt_prices de 20261020120000_shared_prices_fixes.sql, igual, com
-- o nome guardado na camada (c). Antes da troca de nome, o stores.name da
-- farmácia ("DROGARIA SAO PAULO S/A") segurava a nota cuja leitura não trouxe
-- nome; renomeada ("Pacheco"), esse nome só está em printed_name.
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
    -- dá erro aqui, e o bloco não grava nada.
    insert into public.shared_prices (store_cnpj, store_uf, store_name, item_key, unit, seen_on, unit_price, visible_on)
    with read_lines as materialized (
      select distinct public.normalize_alias(x.description) as item_key, x.unit, round(x.unit_price, 4) as unit_price
        from jsonb_to_recordset(v_read.lines) as x (description text, unit text, unit_price numeric)
    )
    select v_read.store_cnpj, substr(v_key, 1, 2), v_name, l.item_key, l.unit, v_day, l.unit_price, v_today + 1
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
          store_uf = coalesce(excluded.store_uf, public.shared_prices.store_uf)
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
