-- Remédios de uso contínuo: quanto ainda tem e até quando a receita vale, para
-- o app avisar antes de a caixa acabar ("Losartana (Ana) acaba em 7 dias") e de
-- a receita vencer. É opcional, por remédio.
--
-- O banco guarda só a contagem (quantas unidades havia e em que dia foram
-- contadas); o que sobra hoje é uma conta do app pelas doses previstas desde
-- então (src/domain/medicationStock.ts), não pelas doses marcadas. Sem tabela
-- nem função nova: as colunas ficam sob a regra de acesso que a tabela já tem
-- (household_id = current_household_id()).

alter table public.medications
  -- Unidades (comprimidos, cápsulas, doses, ml) na última contagem; nulo: o app não acompanha o estoque.
  add column stock_count numeric check (stock_count is null or stock_count >= 0),
  -- O dia da contagem (data local de quem contou).
  add column stock_counted_on date,
  -- Unidades que cada dose usa (0,5 = meio comprimido).
  add column dose_units numeric not null default 1 check (dose_units > 0),
  -- Com quantos dias de antecedência avisar que está acabando.
  add column stock_warn_days integer not null default 7 check (stock_warn_days between 1 and 60),
  -- Até quando a receita vale; não depende do estoque.
  add column prescription_until date,
  -- A contagem e o dia dela andam juntos.
  add constraint medications_stock_counted check ((stock_count is null) = (stock_counted_on is null));
