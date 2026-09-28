-- Pontos das crianças, segunda revisão:
-- 1. O histórico de conclusões (que guarda os pontos) só é escrito por
--    complete_chore: o app lê, mas não insere, muda nem apaga direto.
-- 2. complete_chore diz se registrou (completed) e quantos pontos deu, para o
--    app só comemorar o que contou.
-- 3. App antigo (sem o vencimento): toque duplo na mesma tarefa em meio minuto
--    conta uma vez só.

drop policy "household members manage chore_completions" on public.chore_completions;
create policy "household members read chore_completions" on public.chore_completions for select to authenticated
  using (household_id = (select public.current_household_id()));

drop function public.complete_chore(uuid, date, date);

-- Registra a conclusão e agenda a próxima ocorrência a partir de hoje (p_today
-- vem do aparelho). p_due_on: o vencimento que a pessoa viu; se a tarefa já
-- andou (toque duplo, outro celular) ou foi encerrada, não registra de novo.
create function public.complete_chore(
  p_chore_id uuid,
  p_today date,
  p_due_on date default null,
  out completed boolean,
  out points integer,
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
begin
  select * into c from public.chores ch
  where ch.id = p_chore_id and ch.household_id = public.current_household_id()
  for update;
  if not found then
    raise exception 'chore not found' using errcode = 'P0002';
  end if;

  completed := c.active
    and (p_due_on is null or c.due_on = p_due_on)
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

    update public.chores ch set
      due_on = case c.recurrence
        when 'daily' then p_today + c.interval_count
        when 'weekly' then p_today + 7 * c.interval_count
        when 'monthly' then (p_today + make_interval(months => c.interval_count))::date
        else c.due_on
      end,
      active = c.recurrence <> 'none'
    where ch.id = c.id
    returning * into c;
  end if;

  points := credited;
  due_on := c.due_on;
  active := c.active;
end;
$$;
revoke execute on function public.complete_chore(uuid, date, date) from public, anon;
grant execute on function public.complete_chore(uuid, date, date) to authenticated;
