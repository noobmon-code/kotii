-- Limite de uso da IA por casa, por mês (fuso de Brasília): mensagens ao Nuke,
-- leituras de foto (notas e saúde) e cardápios. As funções chamam use_ai antes
-- de falar com a IA e, se a IA falhar, devolvem o uso com refund_ai (só pela
-- chave de serviço). Para mudar os limites, uma migração nova troca ai_limit.

create table public.ai_usage (
  household_id uuid not null references public.households (id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  kind text not null check (kind in ('chat', 'photo', 'menu')),
  count integer not null default 0 check (count >= 0),
  primary key (household_id, month, kind)
);

-- Só leitura para a casa; quem escreve são as funções abaixo.
alter table public.ai_usage enable row level security;
create policy "household members read ai usage" on public.ai_usage for select to authenticated
  using (household_id = (select public.current_household_id()));

create function public.ai_limit(p_kind text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_kind when 'chat' then 300 when 'photo' then 100 when 'menu' then 20 end;
$$;

create function public.ai_month()
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM');
$$;

-- Conta um uso se ainda cabe no limite do mês. `allowed` falso: acabou.
-- `household` e `usage_month` voltam para a função devolver o uso se a IA falhar.
create function public.use_ai(
  p_kind text,
  out allowed boolean,
  out used integer,
  out lim integer,
  out household uuid,
  out usage_month text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  hh uuid := public.current_household_id();
begin
  lim := public.ai_limit(p_kind);
  if hh is null or lim is null then
    raise exception 'invalid ai usage' using errcode = '22023';
  end if;
  household := hh;
  usage_month := public.ai_month();
  insert into public.ai_usage as u (household_id, month, kind, count)
  values (hh, usage_month, p_kind, 1)
  on conflict (household_id, month, kind) do update set count = u.count + 1 where u.count < lim
  returning u.count into used;
  allowed := found;
  if not allowed then
    used := lim;
  end if;
end;
$$;

-- A IA falhou: o uso não conta. Só o servidor devolve (chave de serviço): quem
-- usa o app não consegue baixar o próprio contador.
create function public.refund_ai(p_household uuid, p_month text, p_kind text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_usage set count = greatest(count - 1, 0)
  where household_id = p_household and month = p_month and kind = p_kind;
$$;

-- Uso do mês com os limites, para a tela.
create function public.ai_usage_summary()
returns table (kind text, used integer, lim integer)
language sql
stable
security definer
set search_path = ''
as $$
  select k.kind, coalesce(u.count, 0), public.ai_limit(k.kind)
  from (values ('chat'), ('photo'), ('menu')) as k (kind)
  left join public.ai_usage u
    on u.household_id = public.current_household_id() and u.month = public.ai_month() and u.kind = k.kind;
$$;

revoke execute on function public.use_ai(text), public.ai_usage_summary() from public, anon;
grant execute on function public.use_ai(text), public.ai_usage_summary() to authenticated;
revoke execute on function public.refund_ai(uuid, text, text) from public, anon, authenticated;
grant execute on function public.refund_ai(uuid, text, text) to service_role;
