-- Prazos de troca ("Hora de trocar"): o que dura meses e precisa ser trocado (escova de dente, refil do filtro,
-- travesseiro). A tabela de prazos fica no app (LONG_CYCLE_ITEMS em src/domain/longCycle.ts); aqui fica só o que a
-- casa mudou: o prazo dela, o "não sugerir" e o dia do "Já troquei" (decisão do dono de 2026-11-21: "seria bom ter a
-- tabela, mas a pessoa poder modificar para a casa dela").
--
-- item_key é a chave da tabela do app, sem FK: não aponta para produto (merge_products e delete_product não entram,
-- e o bloco de scripts/db/test.sql que confere quem aponta para products não muda) nem para pessoa (apagar a conta não
-- mexe aqui; a casa apagada leva junto).
--
-- O app pode chegar antes desta migração: sem a tabela, valem os prazos do app; sem a função, só as compras dos
-- últimos 180 dias. Nenhum código NK novo (os usados são NK001–NK006 e NK008–NK019): as gravações são upserts
-- parciais protegidos pela RLS e pelos checks (23514, 42501).

-- =============================================================================
-- 1. O que a casa mudou
-- =============================================================================
create table public.long_cycle_settings (
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  item_key text not null check (item_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  -- null: o prazo do app (a casa acompanha se o padrão mudar numa versão nova).
  every_months smallint check (every_months between 1 and 24),
  off boolean not null default false,
  -- "Já troquei": o dia de quem tocou. O "não depois de hoje" é do app (o relógio de outro aparelho adiantado conta
  -- como hoje); os limites são os de APP_MIN_DATE e APP_MAX_DATE (src/domain/dates.ts), que o app confere antes.
  replaced_on date check (replaced_on between date '2000-01-01' and date '2100-12-31'),
  primary key (household_id, item_key)
);

-- Privilégios explícitos (desde 30/10/2026 a tabela nova não ganha os do padrão).
revoke all on public.long_cycle_settings from anon, authenticated;
grant select, insert, update, delete on public.long_cycle_settings to authenticated;
grant all on public.long_cycle_settings to service_role;

alter table public.long_cycle_settings enable row level security;
create policy "household members manage long_cycle_settings" on public.long_cycle_settings
  for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

-- =============================================================================
-- 2. A última compra de cada nome, até 4 anos
-- =============================================================================
-- A última compra de cada nome que começa por uma das palavras (o app manda as primeiras palavras dos termos da
-- tabela, no singular e no plural, e as abreviações de nota que viram uma delas: longCycleFirstWords): carrinhos
-- limpos, itens marcados e linhas de notas confirmadas com produto, as mesmas três fontes de usePurchaseRecords, só
-- que com até 4 anos e uma linha por nome. Security invoker: as regras de cada tabela (a RLS da casa) valem; o filtro
-- pela casa aberta repete a regra para usar os índices por casa.
--
-- O teto de 1000 linhas (e o max_rows do PostgREST) só corta as mais antigas: só a última data de cada item importa,
-- e um corte só faz um item velho parecer nunca comprado (nenhuma sugestão, nunca uma errada). A primeira palavra é
-- a de normalize_alias, em minúsculas: no texto latino, a mesma de termText no app (sem acento, o que não é letra
-- nem número vira espaço); uma letra fora da lista do translate vira espaço aqui, e aquela linha não vem (menos
-- sugestões, nunca uma errada).
create function public.long_cycle_purchases(p_words text[], p_since timestamptz)
returns table (name text, category text, product_id uuid, quantity numeric, unit text, bought_at timestamptz, source text)
language sql
stable
security invoker
set search_path = ''
as $$
  with bought as (
    select ph.name, ph.category, ph.product_id, ph.quantity, ph.unit, ph.bought_at, 'list'::text as source
      from public.purchase_history ph
     where ph.household_id = public.current_household_id() and ph.bought_at >= p_since
    union all
    select i.name, i.category, i.product_id, i.quantity, i.unit, i.checked_at, 'list'::text
      from public.shopping_list_items i
     where i.household_id = public.current_household_id() and i.checked_at >= p_since
    union all
    select p.name, p.category, ri.product_id, ri.quantity, ri.unit, r.purchased_at, 'receipt'::text
      from public.receipts r
      join public.receipt_items ri on ri.receipt_id = r.id and ri.household_id = r.household_id
      join public.products p on p.id = ri.product_id and p.household_id = ri.household_id
     where r.household_id = public.current_household_id()
       and r.status = 'confirmed' and r.purchased_at >= p_since
  ),
  latest as (
    select distinct on (lower(public.normalize_alias(b.name)), b.category)
           b.name, b.category, b.product_id, b.quantity, b.unit, b.bought_at, b.source
      from bought b
     where split_part(lower(public.normalize_alias(b.name)), ' ', 1) = any (p_words)
     order by lower(public.normalize_alias(b.name)), b.category, b.bought_at desc
  )
  select l.name, l.category, l.product_id, l.quantity, l.unit, l.bought_at, l.source
    from latest l
   order by l.bought_at desc
   limit 1000;
$$;
revoke execute on function public.long_cycle_purchases(text[], timestamptz) from public, anon;
grant execute on function public.long_cycle_purchases(text[], timestamptz) to authenticated;
