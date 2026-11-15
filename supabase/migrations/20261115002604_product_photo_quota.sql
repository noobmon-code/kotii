-- Limite mensal para a foto de produto (o "Escanear" do app): a foto que a pessoa tira de um produto, ou da
-- prateleira, e a IA diz o que há nela, para a despensa ou a lista. É uma cota separada da foto de nota e de
-- saúde ('photo'), por casa, com a mesma mecânica: conta antes de chamar a IA e devolve se a IA falhar. Quando a
-- foto é uma nota, a leitura dela conta em 'photo' e esta contagem volta (função parse-receipt).

alter table public.ai_usage drop constraint ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check check (kind in ('chat', 'photo', 'menu', 'nfce', 'finance', 'product'));

create or replace function public.ai_limit(p_kind text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'chat' then 300
    when 'photo' then 100
    when 'menu' then 20
    when 'nfce' then 200
    when 'finance' then 100
    when 'product' then 50
  end;
$$;

create or replace function public.ai_usage_summary()
returns table (kind text, used integer, lim integer)
language sql
stable
security definer
set search_path = ''
as $$
  select k.kind, coalesce(u.count, 0), public.ai_limit(k.kind)
  from (values ('chat'), ('photo'), ('menu'), ('nfce'), ('finance'), ('product')) as k (kind)
  left join public.ai_usage u
    on u.household_id = public.current_household_id() and u.month = public.ai_month() and u.kind = k.kind
  where k.kind <> 'finance' or public.has_beta('finance');
$$;
