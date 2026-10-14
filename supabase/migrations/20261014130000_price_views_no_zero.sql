-- Zero não é preço.
--
-- O item de nota que ficou sem valor (a leitura não pegou o preço, ou a pessoa
-- deixou assim de propósito) é guardado com unit_price 0. Como observação de
-- preço, ele virava o "último preço" do produto naquele mercado: R$ 0,00 no
-- comparativo. O app já deixa essas linhas de fora do que lê
-- (src/data/market.ts), mas a view latest_prices guarda uma linha por produto,
-- mercado e unidade: quando a última é o zero, o mercado fica sem preço para
-- aquele produto até a próxima compra. Com o filtro aqui, a linha que sobra é
-- a última compra com preço de verdade.
--
-- create or replace: as mesmas colunas, na mesma ordem. A view latest_prices lê
-- desta e não precisa ser recriada, e as permissões das duas ficam como estão.
-- A linha sem valor continua na nota e nos gastos: é compra, só não é preço.

create or replace view public.price_observations with (security_invoker = true) as
select
  ri.household_id,
  ri.product_id,
  r.store_id,
  r.purchased_at,
  ri.unit_price,
  ri.unit,
  ri.receipt_id
from public.receipt_items ri
join public.receipts r on r.id = ri.receipt_id
where r.status = 'confirmed'
  and ri.product_id is not null
  and r.store_id is not null
  and ri.unit_price > 0;
