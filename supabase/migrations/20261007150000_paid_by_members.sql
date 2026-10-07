-- Quem pagou (paid_by, em gastos, pagamentos de contas e notas) só pode ser
-- morador da casa. As colunas apontam para auth.users, então um morador
-- podia gravar o id de qualquer conta do sistema, e isso entrava na divisão
-- de gastos. Os acertos e pesos já conferem com is_household_member; aqui
-- é um gatilho, porque um check não pode consultar outra tabela.
--
-- Quem saiu da casa continua como pagador do que já pagou: o gatilho só
-- olha quando paid_by é gravado ou trocado.

create function public.paid_by_must_be_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.paid_by is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.paid_by is not distinct from old.paid_by then
    return new;
  end if;
  if not exists (
    select 1 from public.household_members m
    where m.household_id = new.household_id and m.user_id = new.paid_by
  ) then
    raise exception 'paid_by must be a member of the household' using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke execute on function public.paid_by_must_be_member() from public, anon, authenticated;

create trigger expenses_paid_by_member
  before insert or update of paid_by on public.expenses
  for each row execute function public.paid_by_must_be_member();
create trigger bill_payments_paid_by_member
  before insert or update of paid_by on public.bill_payments
  for each row execute function public.paid_by_must_be_member();
create trigger receipts_paid_by_member
  before insert or update of paid_by on public.receipts
  for each row execute function public.paid_by_must_be_member();
