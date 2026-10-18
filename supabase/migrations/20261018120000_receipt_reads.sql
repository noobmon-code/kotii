-- Preços de outras casas: só o que o SERVIDOR leu na nota.
--
-- Até aqui o gatilho de compartilhamento (20261014120000_shared_prices.sql)
-- lia a nota e os itens que a própria casa grava pelo app: a origem
-- ('qrcode'/'ai') quem põe é o app, e descrição, preço, mercado e data podem
-- ser mudados na revisão. Uma casa podia, então, pôr na base de todos um preço
-- que nenhuma nota trouxe. Agora:
--
-- 1. Quem lê a nota (a função nfce, pelo QR code na Sefaz, e a parse-receipt,
--    pela foto com IA) grava o que leu numa tabela só do servidor
--    (receipt_reads), com a chave secreta: o mercado (CNPJ e nome impresso), a
--    chave de acesso, o dia da compra e, de cada linha, a descrição impressa,
--    a unidade e o preço unitário como o app os põe no rascunho.
-- 2. A nota guarda o id dessa leitura (receipts.read_id). A chave estrangeira
--    leva junto a casa: a nota só aponta para uma leitura da própria casa.
-- 3. Na confirmação, o gatilho só compartilha a linha da nota cuja descrição
--    (normalizada) E unidade E preço unitário batem com uma linha da leitura.
--    Linha redigitada, preço corrigido ou linha acrescentada na revisão ficam
--    na casa. O mercado (CNPJ e nome), o estado, a chave e o dia vêm da
--    leitura, não da nota: o CNPJ da chave tem de ser o da leitura, e leitura
--    sem CNPJ ou sem dia não compartilha nada.
-- 4. Nota sem leitura (a digitada, a de um app antigo, a lida antes desta
--    migração) não compartilha nada.
--
-- Todo o resto do compartilhamento fica como estava: anonimato da base, uma
-- linha por mercado/item/unidade/dia, o dia seguinte ao da gravação, saúde na
-- casa (lista do que se compartilha, nota com remédio, loja de farmácia), o
-- teto de 300 linhas, nada de zero, nada de data no futuro, e o gatilho nunca
-- derruba a confirmação.

-- Sem policy e sem grant para o app: nem ler. Só a chave secreta grava (nas
-- funções nfce e parse-receipt) e só o gatilho (como dono) lê.
create table public.receipt_reads (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  source text not null check (source in ('qrcode', 'ai')),
  access_key text check (access_key ~ '^[0-9]{44}$'),
  store_cnpj text check (store_cnpj ~ '^[0-9]{14}$'),
  store_name text check (length(store_name) <= 300),
  -- O dia da compra como a nota mostra (QR code) ou em São Paulo (foto).
  purchased_on date,
  -- [{ "description": text, "unit": text, "unit_price": number }, ...], na ordem impressa.
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 1000),
  created_at timestamptz not null default now(),
  unique (id, household_id)
);

alter table public.receipt_reads enable row level security;
revoke all on public.receipt_reads from anon, authenticated;
grant all on public.receipt_reads to service_role;

-- A nota aponta para a leitura da própria casa (a chave estrangeira leva a casa
-- junto). Leitura apagada (a limpeza abaixo, ou a casa) só tira o ponteiro.
alter table public.receipts add column read_id uuid;
alter table public.receipts add constraint receipts_read_id_fkey
  foreign key (read_id, household_id) references public.receipt_reads (id, household_id) on delete set null (read_id);
create index receipts_read_id_idx on public.receipts (read_id) where read_id is not null;

-- =============================================================================
-- Gravação na base comum: só linhas que o servidor leu
-- =============================================================================

-- O mesmo gatilho de antes (security definer, lock_timeout, tudo dentro de um
-- bloco com exception que nunca derruba a confirmação), agora conferindo cada
-- linha contra a leitura do servidor.
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
  v_name text;
  v_store text;
  v_own_name text;
  v_day date;
  v_today constant date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  begin
    -- Só nota lida pelo app E com a leitura do servidor (da mesma casa).
    if new.source not in ('qrcode', 'ai') or new.read_id is null then
      return new;
    end if;
    select * into v_read
      from public.receipt_reads rr
      where rr.id = new.read_id and rr.household_id = new.household_id;
    -- Sem CNPJ lido, o mercado não tem como ser o mesmo para duas casas; sem o
    -- dia lido, a data seria a que a casa digitou.
    if v_read.id is null or v_read.store_cnpj is null or v_read.purchased_on is null then
      return new;
    end if;
    -- A chave de acesso traz o CNPJ de quem emitiu (dígitos 7 a 20).
    if v_read.access_key is not null and substr(v_read.access_key, 7, 14) <> v_read.store_cnpj then
      return new;
    end if;

    -- O nome impresso; sem ele, o que o app põe no mercado novo ("CNPJ ...").
    v_name := trim(left(trim(coalesce(v_read.store_name, '')), 120));
    if v_name = '' then
      v_name := 'CNPJ ' || v_read.store_cnpj;
    end if;
    -- Camada (c): farmácia pelo nome impresso E pelo nome que a casa deu ao
    -- mercado da nota (na dúvida, compartilha-se menos).
    select s.name into v_own_name
      from public.stores s
      where s.id = new.store_id and s.household_id = new.household_id;
    foreach v_store in array array[public.normalize_alias(v_name), public.normalize_alias(v_own_name)] loop
      if v_store ~ v_pharmacy or (v_store ~ v_pague_menos and v_store !~ v_market) then
        return new;
      end if;
    end loop;

    v_day := v_read.purchased_on;
    -- Data no futuro é data errada, e ficaria como "a mais recente" por meses.
    if v_day > v_today then
      return new;
    end if;

    -- O teto de 300 linhas por nota.
    if (select count(*) from public.receipt_items ri where ri.receipt_id = new.id) > 300 then
      return new;
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
      return new;
    end if;

    -- Como antes, mais a conferência: a linha só entra quando a leitura do
    -- servidor tem uma linha com a mesma chave, a mesma unidade e o mesmo preço
    -- unitário. Uma leitura malformada dá erro aqui, e o bloco não grava nada.
    insert into public.shared_prices (store_cnpj, store_uf, store_name, item_key, unit, seen_on, unit_price, visible_on)
    select v_read.store_cnpj, substr(v_read.access_key, 1, 2), v_name, l.item_key, l.unit, v_day, l.unit_price, v_today + 1
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
              select 1
                from jsonb_to_recordset(v_read.lines) as x (description text, unit text, unit_price numeric)
                where public.normalize_alias(x.description) = k.item_key
                  and x.unit = ri.unit
                  and round(x.unit_price, 4) = ri.unit_price
            )
          order by k.item_key, ri.unit, ri.position desc, ri.id desc
      ) l
      order by l.item_key, l.unit
    on conflict (store_cnpj, item_key, unit, seen_on) do update
      set unit_price = excluded.unit_price,
          store_name = case when excluded.store_name ~ '^CNPJ [0-9]{14}$' then public.shared_prices.store_name else excluded.store_name end,
          store_uf = coalesce(excluded.store_uf, public.shared_prices.store_uf)
      where public.shared_prices.visible_on > v_today;
  exception when others then
    raise log 'share_receipt_prices: nada compartilhado (%)', sqlstate;
  end;
  return new;
end;
$$;

revoke execute on function public.share_receipt_prices() from public, anon, authenticated;

-- =============================================================================
-- Limpeza: a leitura só serve até a nota ser confirmada
-- =============================================================================

-- A leitura guarda o que a casa comprou. Depois de 30 dias, sai a que nenhum
-- rascunho espera (a nota já confirmada já compartilhou o que tinha, e a
-- leitura sem nota é uma importação que parou no meio). Roda uma vez por dia.
create function public.forget_receipt_reads()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.receipt_reads rr
      where rr.created_at < now() - interval '30 days'
        and not exists (select 1 from public.receipts r where r.read_id = rr.id and r.status = 'draft')
      returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.forget_receipt_reads() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  perform cron.schedule('receipt-reads-cleanup', '41 4 * * *', 'select public.forget_receipt_reads()');
end;
$$;
