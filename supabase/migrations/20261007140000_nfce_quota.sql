-- Limite mensal também para a nota pelo QR code. A função nfce não usa IA,
-- mas faz o servidor buscar a página da Sefaz (até 15 s e 3 MB por chamada)
-- e nada limitava quantas vezes uma conta logada podia pedir isso. Entra
-- como mais um tipo no limite por casa (ai_usage), com a mesma mecânica:
-- conta antes de buscar e devolve se a Sefaz não respondeu.

alter table public.ai_usage drop constraint ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check check (kind in ('chat', 'photo', 'menu', 'nfce'));

create or replace function public.ai_limit(p_kind text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_kind when 'chat' then 300 when 'photo' then 100 when 'menu' then 20 when 'nfce' then 200 end;
$$;

create or replace function public.ai_usage_summary()
returns table (kind text, used integer, lim integer)
language sql
stable
security definer
set search_path = ''
as $$
  select k.kind, coalesce(u.count, 0), public.ai_limit(k.kind)
  from (values ('chat'), ('photo'), ('menu'), ('nfce')) as k (kind)
  left join public.ai_usage u
    on u.household_id = public.current_household_id() and u.month = public.ai_month() and u.kind = k.kind;
$$;
