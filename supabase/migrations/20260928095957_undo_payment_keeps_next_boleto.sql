-- Desfazer um pagamento com o boleto do próximo vencimento já lido apagaria
-- esse boleto novo: pede para tirá-lo antes, e o código do vencimento
-- desfeito volta como antes.

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
  if b.boleto is not null and b.boleto is distinct from p.boleto then
    raise exception 'A conta já tem o boleto do próximo vencimento. Tire esse boleto e salve antes de desfazer o pagamento.'
      using errcode = '22023';
  end if;
  delete from public.bill_payments where id = p.id;
  update public.bills set next_due_on = p.due_on, active = true, boleto = p.boleto where id = b.id returning * into b;
  return b;
end;
$$;
