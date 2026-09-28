-- Pontos das crianças, ajustes da revisão:
-- 1. Concluir é idempotente: toque duplo ou dois celulares na mesma ocorrência
--    registram uma vez só (o app manda o vencimento que viu).
-- 2. Só credita quem ainda é criança sem conta; quem ganha conta no app passa
--    a ser o responsável pelas tarefas que eram da ficha.
-- 3. Apagar a tarefa não apaga os pontos já ganhos com ela.
-- 4. Prêmio passa por uma função que trava a ficha e não deixa o saldo negativo.

-- 1 e 2 -----------------------------------------------------------------------

drop function public.complete_chore(uuid, date);

-- p_due_on: o vencimento que a pessoa viu. Se a tarefa já andou (ou foi
-- concluída de vez), não registra de novo. Sem ele (versões antigas do app),
-- só a tarefa encerrada fica de fora.
create function public.complete_chore(p_chore_id uuid, p_today date, p_due_on date default null)
returns public.chores
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.chores;
  kid uuid;
begin
  select * into c from public.chores where id = p_chore_id for update;
  if not found then
    raise exception 'chore not found' using errcode = 'P0002';
  end if;
  if not c.active or (p_due_on is not null and c.due_on <> p_due_on) then
    return c;
  end if;

  select p.id into kid from public.people p
  where p.id = c.kid_id and p.kind = 'pessoa' and p.member_user_id is null;

  insert into public.chore_completions (household_id, chore_id, person_id, points)
  values (c.household_id, c.id, kid, case when kid is null then 0 else c.points end);

  update public.chores set
    due_on = case c.recurrence
      when 'daily' then p_today + c.interval_count
      when 'weekly' then p_today + 7 * c.interval_count
      when 'monthly' then (p_today + make_interval(months => c.interval_count))::date
      else c.due_on
    end,
    active = c.recurrence <> 'none'
  where id = c.id
  returning * into c;

  return c;
end;
$$;
revoke execute on function public.complete_chore(uuid, date, date) from public, anon;
grant execute on function public.complete_chore(uuid, date, date) to authenticated;

create function public.kid_chores_to_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chores set kid_id = null, assigned_to = new.member_user_id
  where kid_id = new.id and household_id = new.household_id;
  return new;
end;
$$;
revoke execute on function public.kid_chores_to_member() from public, anon, authenticated;

create trigger people_kid_chores_to_member
  after update of member_user_id on public.people
  for each row
  when (old.member_user_id is null and new.member_user_id is not null)
  execute function public.kid_chores_to_member();

-- 3 ---------------------------------------------------------------------------

alter table public.chore_completions
  alter column chore_id drop not null,
  add column chore_title text;

-- Antes de a tarefa sair (e levar o histórico junto), as conclusões que deram
-- pontos se soltam dela e guardam o nome.
create function public.keep_awarded_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chore_completions set chore_id = null, chore_title = old.title
  where chore_id = old.id and household_id = old.household_id and points > 0;
  return old;
end;
$$;
revoke execute on function public.keep_awarded_points() from public, anon, authenticated;

create trigger chores_keep_awarded_points
  before delete on public.chores
  for each row execute function public.keep_awarded_points();

-- 4 ---------------------------------------------------------------------------

drop policy "household members manage point redemptions" on public.point_redemptions;
create policy "household members read point redemptions" on public.point_redemptions for select to authenticated
  using (household_id = (select public.current_household_id()));

create function public.redeem_points(p_person_id uuid, p_title text, p_points integer)
returns public.point_redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  hh uuid := public.current_household_id();
  balance integer;
  r public.point_redemptions;
begin
  -- Trava a ficha: dois prêmios ao mesmo tempo não passam do saldo.
  perform 1 from public.people where id = p_person_id and household_id = hh for update;
  if hh is null or not found then
    raise exception 'person not found' using errcode = 'P0002';
  end if;
  select coalesce(sum(points), 0) into balance from public.chore_completions where person_id = p_person_id;
  balance := balance - (select coalesce(sum(points), 0) from public.point_redemptions where person_id = p_person_id);
  if p_points > balance then
    raise exception 'Saldo de pontos insuficiente: % no momento.', balance using errcode = 'P0001';
  end if;
  insert into public.point_redemptions (household_id, person_id, title, points)
  values (hh, p_person_id, trim(p_title), p_points)
  returning * into r;
  return r;
end;
$$;
revoke execute on function public.redeem_points(uuid, text, integer) from public, anon;
grant execute on function public.redeem_points(uuid, text, integer) to authenticated;
