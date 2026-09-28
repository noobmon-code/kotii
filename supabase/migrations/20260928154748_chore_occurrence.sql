-- Pontos das crianças, terceira revisão:
-- 1. Concluir sempre avança o vencimento: tarefa feita adiantada conta a partir
--    do vencimento (fez a de amanhã hoje: a próxima é depois de amanhã); feita
--    com atraso, a partir de hoje, como antes. Assim o vencimento que o app
--    manda identifica a ocorrência e um segundo toque não conta de novo.
-- 2. complete_chore devolve também quem recebeu os pontos (person_id), para o
--    app anunciar o nome certo mesmo se a tarefa mudou de criança em outro celular.

drop function public.complete_chore(uuid, date, date);

create function public.complete_chore(
  p_chore_id uuid,
  p_today date,
  p_due_on date default null,
  out completed boolean,
  out points integer,
  out person_id uuid,
  out due_on date,
  out active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  c public.chores;
  kid uuid;
  credited integer := 0;
  base date;
begin
  select * into c from public.chores ch
  where ch.id = p_chore_id and ch.household_id = public.current_household_id()
  for update;
  if not found then
    raise exception 'chore not found' using errcode = 'P0002';
  end if;

  completed := c.active
    and (p_due_on is null or c.due_on = p_due_on)
    -- App antigo (sem o vencimento): toque duplo em meio minuto conta uma vez.
    and (p_due_on is not null or not exists (
      select 1 from public.chore_completions cc
      where cc.chore_id = c.id and cc.completed_at > now() - interval '30 seconds'
    ));

  if completed then
    -- Pontos só para quem ainda é criança sem conta no app.
    select p.id into kid from public.people p
    where p.id = c.kid_id and p.kind = 'pessoa' and p.member_user_id is null;
    credited := case when kid is null then 0 else c.points end;

    insert into public.chore_completions (household_id, chore_id, person_id, points)
    values (c.household_id, c.id, kid, credited);

    base := greatest(p_today, c.due_on);
    update public.chores ch set
      due_on = case c.recurrence
        when 'daily' then base + c.interval_count
        when 'weekly' then base + 7 * c.interval_count
        when 'monthly' then (base + make_interval(months => c.interval_count))::date
        else c.due_on
      end,
      active = c.recurrence <> 'none'
    where ch.id = c.id
    returning * into c;
  end if;

  points := credited;
  person_id := kid;
  due_on := c.due_on;
  active := c.active;
end;
$$;
revoke execute on function public.complete_chore(uuid, date, date) from public, anon;
grant execute on function public.complete_chore(uuid, date, date) to authenticated;
