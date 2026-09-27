-- Financeiro: contas a pagar (recorrentes ou únicas), pagamentos e gastos
-- avulsos. Os gastos de mercado vêm das notas fiscais confirmadas.

-- Categorias do financeiro (espelho de src/domain/finance.ts).
create domain public.finance_category as text check (value in (
  'mercado', 'casa', 'moradia', 'contas', 'assinaturas', 'saude',
  'educacao', 'transporte', 'pet', 'lazer', 'outros'
));

-- =============================================================================
-- Contas a pagar
-- =============================================================================

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category public.finance_category not null default 'contas',
  -- Nulo: valor varia (luz, água); informado a cada pagamento.
  amount numeric(12, 2) check (amount >= 0),
  recurrence text not null default 'monthly' check (recurrence in ('monthly', 'yearly', 'once')),
  -- Dia do vencimento; guardado à parte para o dia 31 voltar depois de fevereiro.
  due_day integer check (due_day between 1 and 31),
  next_due_on date not null,
  autopay boolean not null default false,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, household_id)
);
create index bills_household_due_idx on public.bills (household_id, next_due_on) where active;

create table public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  bill_id uuid not null,
  due_on date not null,
  paid_on date not null default current_date,
  amount numeric(12, 2) not null check (amount >= 0),
  paid_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bill_id, due_on),
  foreign key (bill_id, household_id) references public.bills (id, household_id) on delete cascade
);
create index bill_payments_household_paid_idx on public.bill_payments (household_id, paid_on);

-- =============================================================================
-- Gastos avulsos (sem nota): feira, farmácia, conserto…
-- =============================================================================

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  description text not null check (length(trim(description)) > 0),
  amount numeric(12, 2) not null check (amount > 0),
  spent_on date not null default current_date,
  category public.finance_category not null default 'outros',
  notes text,
  paid_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index expenses_household_spent_idx on public.expenses (household_id, spent_on);

-- =============================================================================
-- Pagar e desfazer. Pagar recebe o vencimento que a pessoa viu na tela: se
-- outra pessoa da casa pagou antes (o vencimento já andou), não paga de novo.
-- =============================================================================

create function public.pay_bill(p_bill_id uuid, p_due_on date, p_amount numeric, p_paid_on date)
returns public.bills
language plpgsql
security invoker
set search_path = ''
as $$
declare
  b public.bills;
  months integer;
  first_of_month date;
  last_day integer;
begin
  select * into b from public.bills where id = p_bill_id for update;
  if not found then
    raise exception 'bill not found' using errcode = 'P0002';
  end if;
  if not b.active or b.next_due_on <> p_due_on then
    return b;
  end if;
  if coalesce(p_amount, b.amount) is null then
    raise exception 'amount required for a variable bill' using errcode = '22023';
  end if;

  -- Vencimento já pago (a data foi editada para trás ou a conta reaberta):
  -- vale o pagamento que já existe; a conta só anda.
  insert into public.bill_payments (household_id, bill_id, due_on, paid_on, amount)
  values (b.household_id, b.id, p_due_on, p_paid_on, coalesce(p_amount, b.amount))
  on conflict (bill_id, due_on) do nothing;

  if b.recurrence = 'once' then
    update public.bills set active = false where id = b.id returning * into b;
    return b;
  end if;

  months := case b.recurrence when 'monthly' then 1 else 12 end;
  first_of_month := (date_trunc('month', p_due_on) + make_interval(months => months))::date;
  last_day := extract(day from (first_of_month + interval '1 month' - interval '1 day'))::integer;
  update public.bills
    set next_due_on = first_of_month + (least(coalesce(b.due_day, extract(day from p_due_on)::integer), last_day) - 1)
    where id = b.id
    returning * into b;
  return b;
end;
$$;

-- Só o pagamento mais recente de uma conta pode ser desfeito: o vencimento
-- volta para ele e a conta volta a ficar ativa.
create function public.undo_bill_payment(p_payment_id uuid)
returns public.bills
language plpgsql
security invoker
set search_path = ''
as $$
declare
  p public.bill_payments;
  b public.bills;
begin
  select * into p from public.bill_payments where id = p_payment_id;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  select * into b from public.bills where id = p.bill_id for update;
  if exists (select 1 from public.bill_payments where bill_id = p.bill_id and due_on > p.due_on) then
    raise exception 'only the latest payment can be undone' using errcode = '22023';
  end if;
  delete from public.bill_payments where id = p.id;
  update public.bills set next_due_on = p.due_on, active = true where id = b.id returning * into b;
  return b;
end;
$$;

revoke execute on function public.pay_bill(uuid, date, numeric, date) from public, anon;
revoke execute on function public.undo_bill_payment(uuid) from public, anon;
grant execute on function public.pay_bill(uuid, date, numeric, date) to authenticated;
grant execute on function public.undo_bill_payment(uuid) to authenticated;

-- =============================================================================
-- RLS
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['bills', 'bill_payments', 'expenses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "household members manage %1$s" on public.%1$I for all to authenticated '
      'using (household_id = (select public.current_household_id())) '
      'with check (household_id = (select public.current_household_id()))',
      t
    );
  end loop;
end;
$$;
