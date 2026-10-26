-- Quantos vêm na embalagem do item da nota.
--
-- "OVOS RANCHO CAIPIRA" a R$ 13,99, 1 un: a nota não diz se são 10, 12 ou 20
-- ovos, e sem isso o preço não diz quanto custa cada ovo nem se compara com o
-- da cartela de outro tamanho. Quando a descrição traz a conta ("OVOS C/12",
-- "30UN"), o app já a lê dela (src/domain/packageSize.ts) e nada se guarda.
-- Quando não traz, a revisão da nota pergunta, e a resposta fica aqui, na
-- linha: é o que veio naquela compra (a marca pode vir em cartela de 10 numa
-- ida e de 20 na outra). Só a pessoa grava; as leituras não preenchem.
--
-- As duas views de preço passam a levar a coluna, no fim (create or replace
-- só deixa acrescentar colunas depois das que já existem): a lista mostra
-- quantos ovos vieram pelo último preço. A ordem e o resto ficam como estão,
-- e as permissões das views e da tabela também (a coluna nova entra no que a
-- tabela já concede). O app funciona antes desta migração: sem a coluna, lê e
-- grava sem ela (isMissingColumn).

alter table public.receipt_items
  add column pack_count smallint check (pack_count between 2 and 1000);

create or replace view public.price_observations with (security_invoker = true) as
select
  ri.household_id,
  ri.product_id,
  r.store_id,
  r.purchased_at,
  ri.unit_price,
  ri.unit,
  ri.receipt_id,
  ri.pack_count
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
  pack_count
from public.price_observations
order by product_id, store_id, unit, purchased_at desc;
