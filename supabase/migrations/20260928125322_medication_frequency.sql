-- Remédios: regularidade (todo dia, dias da semana, a cada X dias, uma vez
-- por mês, no dia do mês do início) e tratamento por número de doses (acaba
-- quando todas forem tomadas). Os antigos seguem todo dia.

alter table public.medications
  add column frequency text not null default 'daily'
    check (frequency in ('daily', 'weekdays', 'interval', 'monthly')),
  -- 0 = domingo, como Date.getDay().
  add column weekdays smallint[]
    check (weekdays is null or (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[])),
  add column interval_days smallint check (interval_days is null or interval_days between 2 and 365),
  add column total_doses integer check (total_doses is null or total_doses between 1 and 1000),
  add constraint medications_frequency_fields check (
    (frequency = 'weekdays') = (weekdays is not null)
    and (frequency = 'interval') = (interval_days is not null)
  );
