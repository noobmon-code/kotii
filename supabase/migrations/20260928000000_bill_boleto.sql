-- Boleto da conta: o código de barras (44 dígitos) lido pela câmera ou pela
-- linha digitável, para copiar no app do banco na hora de pagar. Vale para o
-- vencimento atual: pay_bill apaga o código quando a conta anda.

alter table public.bills add column boleto text check (boleto ~ '^[0-9]{44}$');

create or replace function public.pay_bill(
  p_bill_id uuid,
  p_due_on date,
  p_amount numeric,
  p_paid_on date,
  out bill public.bills,
  -- Falso quando o vencimento já estava pago (por outra pessoa ou antes).
  out paid boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  months integer;
  first_of_month date;
  last_day integer;
begin
  select * into bill from public.bills where id = p_bill_id for update;
  if not found then
    raise exception 'bill not found' using errcode = 'P0002';
  end if;
  paid := false;
  if not bill.active or bill.next_due_on <> p_due_on then
    return;
  end if;
  if coalesce(p_amount, bill.amount) is null then
    raise exception 'amount required for a variable bill' using errcode = '22023';
  end if;

  -- Vencimento já pago (a data foi editada para trás ou a conta reaberta):
  -- vale o pagamento que já existe; a conta só anda.
  insert into public.bill_payments (household_id, bill_id, due_on, paid_on, amount)
  values (bill.household_id, bill.id, p_due_on, p_paid_on, coalesce(p_amount, bill.amount))
  on conflict (bill_id, due_on) do nothing;
  paid := found;

  -- O boleto era deste vencimento: o próximo tem outro código.
  if bill.recurrence = 'once' then
    update public.bills set active = false, boleto = null where id = bill.id returning * into bill;
    return;
  end if;

  months := case bill.recurrence when 'monthly' then 1 else 12 end;
  first_of_month := (date_trunc('month', p_due_on) + make_interval(months => months))::date;
  last_day := extract(day from (first_of_month + interval '1 month' - interval '1 day'))::integer;
  update public.bills
    set next_due_on = first_of_month + (least(coalesce(bill.due_day, extract(day from p_due_on)::integer), last_day) - 1),
        boleto = null
    where id = bill.id
    returning * into bill;
end;
$$;
