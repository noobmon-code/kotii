-- Desfazer um pagamento devolve o boleto daquele vencimento: o pagamento
-- guarda o código que a conta tinha, e pay_bill o apaga da conta ao andar.

alter table public.bill_payments add column boleto text check (boleto ~ '^[0-9]{44}$');

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
  insert into public.bill_payments (household_id, bill_id, due_on, paid_on, amount, boleto)
  values (bill.household_id, bill.id, p_due_on, p_paid_on, coalesce(p_amount, bill.amount), bill.boleto)
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

-- A conta volta para o vencimento desfeito, com o boleto dele.
create or replace function public.undo_bill_payment(p_payment_id uuid)
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
  update public.bills set next_due_on = p.due_on, active = true, boleto = p.boleto where id = b.id returning * into b;
  return b;
end;
$$;
