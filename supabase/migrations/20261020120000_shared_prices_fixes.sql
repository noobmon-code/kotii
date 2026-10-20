-- Preços de outras casas: o nome do mercado sem CPF, e a nota de foto que a
-- casa corrigiu na revisão fica na casa.
--
-- 1. Nome com CPF. A razão social do MEI aberto antes de 2019 é o nome
--    completo mais o CPF, e é assim que ela sai impressa na nota e chegava à
--    base comum (e a "Em outros mercados" das casas do estado). Agora o
--    gatilho tira do nome toda sequência de 11 dígitos (com ou sem ponto e
--    traço, e o "CPF" escrito antes dela); se não sobra nome, vai o "CNPJ ..."
--    que o app já põe no mercado sem nome. Um número maior (o CNPJ, de 14)
--    não é tocado. As linhas já gravadas passam pela mesma limpeza, uma vez,
--    no fim desta migração.
-- 2. Foto corrigida na revisão. Na foto, quem lê é a IA, e ela pode errar o
--    CNPJ ou a data. Se a casa corrige o mercado ou a data na revisão, não dá
--    para saber qual dos dois vale, e o preço iria para a base com o mercado
--    ou o dia errados (e a casa podia ver a própria compra como "de outra
--    casa" no mercado lido errado). Agora a nota de foto (leitura 'ai') só
--    compartilha quando o mercado da nota tem o CNPJ da leitura e o dia da
--    nota, em São Paulo, é o da leitura.
-- 3. A chave de acesso lida na foto só vale com o dígito verificador certo:
--    um dígito lido errado daria o estado (e o CNPJ conferido) de outra nota.
--    A chave errada é ignorada (sem estado, sem a conferência do CNPJ), como
--    na foto sem chave.
--
-- No QR code nada muda: ali quem leu foi a Sefaz, e o mercado, a chave e o
-- dia da leitura continuam valendo mesmo que a casa mude a nota. O resto do
-- gatilho é o de 20261018130000_receipt_reads.sql, com os mesmos atributos
-- (security definer, search_path vazio, lock_timeout) e o mesmo revoke. O app
-- não depende desta migração: antes dela, só se compartilha mais.

-- O nome do mercado como entra na base comum: o impresso, sem CPF, aparado e
-- com até 120 letras; sem nome, o "CNPJ ..." (o mesmo do app no mercado novo).
-- Usada pelo gatilho e pela limpeza única abaixo.
create or replace function public.shared_store_name(p_name text, p_cnpj text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  -- 11 dígitos (CPF), com ou sem ponto e traço, que não são pedaço de um número
  -- maior (o CNPJ tem 14); o "CPF" escrito antes vai junto.
  v_cpf constant text := '(\mCPF[\s:.-]*)?(?<![0-9])[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}(?![0-9])';
  v_name text := trim(coalesce(p_name, ''));
begin
  if v_name ~* v_cpf then
    v_name := regexp_replace(v_name, v_cpf, ' ', 'gi');
    -- O que sobrou em volta do número: espaços repetidos e um traço ou dois-pontos pendurado.
    v_name := regexp_replace(v_name, '\s+', ' ', 'g');
    v_name := regexp_replace(v_name, '^[\s.,;:/|-]+|[\s.,;:/|-]+$', '', 'g');
    -- Sem nenhuma letra, não é nome.
    if v_name !~ '[[:alpha:]]' then
      v_name := '';
    end if;
  end if;
  v_name := trim(left(v_name, 120));
  if v_name = '' then
    v_name := 'CNPJ ' || p_cnpj;
  end if;
  return v_name;
end;
$$;

revoke execute on function public.shared_store_name(text, text) from public, anon, authenticated;

-- Dígito verificador da chave de acesso (módulo 11, pesos 2 a 9 da direita para
-- a esquerda): o mesmo de accessKeyCheckDigit em src/domain/nfce.ts.
create or replace function public.access_key_valid(p_key text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_sum integer := 0;
  v_rest integer;
begin
  if p_key is null or p_key !~ '^[0-9]{44}$' then
    return false;
  end if;
  for i in 1..43 loop
    v_sum := v_sum + substr(p_key, 44 - i, 1)::integer * (2 + (i - 1) % 8);
  end loop;
  v_rest := v_sum % 11;
  return (case when v_rest < 2 then 0 else 11 - v_rest end) = substr(p_key, 44, 1)::integer;
end;
$$;

revoke execute on function public.access_key_valid(text) from public, anon, authenticated;

-- =============================================================================
-- Gravação na base comum
-- =============================================================================

-- O gatilho de 20261018130000_receipt_reads.sql com as três mudanças acima.
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

    select s.name, s.cnpj into v_own_name, v_own_cnpj
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
    -- mercado da nota (na dúvida, compartilha-se menos).
    foreach v_store in array array[public.normalize_alias(v_name), public.normalize_alias(v_own_name)] loop
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

-- =============================================================================
-- Limpeza única: o CPF sai dos nomes já gravados
-- =============================================================================

-- Também nas linhas que já podem ser lidas (que de resto nunca mudam): a troca
-- é desta migração, a mesma para toda a base, e não diz nada de confirmação
-- nenhuma. Só a linha cujo nome muda é tocada; o dia em que ela passa a ser
-- lida fica como estava.
update public.shared_prices sp
  set store_name = public.shared_store_name(sp.store_name, sp.store_cnpj)
  where sp.store_name <> public.shared_store_name(sp.store_name, sp.store_cnpj);
