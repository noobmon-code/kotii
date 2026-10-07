-- O dono da casa cuida de quem está nela: tira um morador e troca o código
-- de convite. Antes, quem entrou ficava para sempre (só saía por vontade
-- própria) e o código era o mesmo desde a criação da casa, então um código
-- que vazou dava acesso a tudo sem remédio.
--
-- Quem sai por decisão do dono fica como quem saiu sozinho: o que registrou
-- continua com a casa e a ficha de pessoa dele vira dependente
-- (member_user_id nulo, pela chave estrangeira). Os avisos dele sobre esta
-- casa que ficam no servidor (a agenda do navegador, push_schedule, com a
-- casa em data.householdId) saem na hora; os do celular saem quando o app
-- dele abre e vê que a casa não é mais dele (pruneHouseholdReminders).

create function public.assert_household_owner(p_household_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Trava a casa, na mesma ordem das saídas: dono tirando alguém e alguém
  -- saindo ao mesmo tempo esperam um pelo outro.
  perform 1 from public.households h where h.id = p_household_id for update;
  if not exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = auth.uid() and m.role = 'owner'
  ) then
    raise exception 'only the household owner can do this' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.assert_household_owner(uuid) from public, anon, authenticated;

/**
 * De qual casa é um aviso agendado no navegador: a casa marcada em
 * data.householdId ou, nos avisos de antes da marca, a casa do remédio
 * (data.medicationId) ou da conta, documento, tarefa, consulta ou vacina
 * (data.reminder = "<tipo>:<id>:<data>"). Nulo quando não dá para saber.
 */
create function public.reminder_household(p_data jsonb)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select h.id from public.households h where h.id::text = p_data ->> 'householdId'),
    (select m.household_id from public.medications m where m.id::text = p_data ->> 'medicationId'),
    case split_part(p_data ->> 'reminder', ':', 1)
      when 'bills' then (select b.household_id from public.bills b where b.id::text = split_part(p_data ->> 'reminder', ':', 2))
      when 'documents' then (select d.household_id from public.documents d where d.id::text = split_part(p_data ->> 'reminder', ':', 2))
      when 'chores' then (select c.household_id from public.chores c where c.id::text = split_part(p_data ->> 'reminder', ':', 2))
      when 'appointments' then (select a.household_id from public.appointments a where a.id::text = split_part(p_data ->> 'reminder', ':', 2))
      when 'vaccines' then (select v.household_id from public.vaccines v where v.id::text = split_part(p_data ->> 'reminder', ':', 2))
    end
  );
$$;
revoke execute on function public.reminder_household(jsonb) from public, anon, authenticated;

create function public.remove_member(p_household_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_household_owner(p_household_id);
  if p_user_id = auth.uid() then
    raise exception 'use leave_household to leave' using errcode = '22023';
  end if;
  delete from public.household_members m where m.household_id = p_household_id and m.user_id = p_user_id;
  if not found then
    raise exception 'user does not belong to this household' using errcode = 'P0002';
  end if;
  -- A sessão dele que estava nesta casa cai para a primeira casa que ainda tem.
  delete from public.household_sessions s where s.household_id = p_household_id and s.user_id = p_user_id;
  -- Os avisos desta casa agendados nos navegadores dele não tocam mais. Os
  -- de antes de o aviso levar a casa (sem householdId) são atribuídos pelo
  -- remédio ou pela conta, documento, tarefa, consulta ou vacina a que se
  -- referem; os de outras casas ficam. O que não dá para atribuir (o aviso
  -- do clima, que não aponta para registro nenhum, ou um aviso cujo registro
  -- já foi apagado) pode ser desta casa: sai também, e o app refaz o que
  -- ainda vale, já marcado, na próxima vez que abre nesse navegador.
  delete from public.push_schedule p
    using public.push_subscriptions s
    where p.subscription_id = s.id and s.user_id = p_user_id
      and (
        public.reminder_household(p.data) = p_household_id
        or (p.data ->> 'householdId' is null and public.reminder_household(p.data) is null)
      );
end;
$$;

-- Um navegador só agenda avisos de uma casa em que a pessoa ainda está: a
-- sincronização que estava no ar no navegador de quem acabou de ser tirado
-- não recria os avisos da casa depois da limpeza acima.
drop policy "own push schedule insert" on public.push_schedule;
create policy "own push schedule insert" on public.push_schedule for insert to authenticated
  with check (
    exists (select 1 from public.push_subscriptions s where s.id = subscription_id and s.user_id = (select auth.uid()))
    and (
      data ->> 'householdId' is null
      or exists (
        select 1 from public.household_members m
        where m.household_id::text = data ->> 'householdId' and m.user_id = (select auth.uid())
      )
    )
  );

create function public.regenerate_invite_code(p_household_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text;
begin
  perform public.assert_household_owner(p_household_id);
  update public.households h set invite_code = public.generate_invite_code()
    where h.id = p_household_id
    returning h.invite_code into code;
  return code;
end;
$$;

revoke execute on function public.remove_member(uuid, uuid) from public, anon;
revoke execute on function public.regenerate_invite_code(uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;

-- Entrar com o código trava a linha da casa: quem chega com o código antigo
-- enquanto o dono o troca espera a troca terminar e, aí, não acha mais a
-- casa (o FOR UPDATE reavalia a condição na versão nova da linha).
create or replace function public.join_household(p_invite_code text, p_display_name text)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.households;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('households:' || auth.uid()::text, 0));

  select * into h from public.households where invite_code = upper(trim(p_invite_code)) for update;
  if not found then
    raise exception 'invalid invite code' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.household_members m where m.user_id = auth.uid() and m.household_id = h.id) then
    raise exception 'already a member of this household' using errcode = '23505';
  end if;
  if (select count(*) from public.household_members m where m.user_id = auth.uid()) >= public.max_households_per_user() then
    raise exception 'household limit reached' using errcode = 'NK002';
  end if;

  insert into public.household_members (household_id, user_id, display_name, role, selected_at)
  values (h.id, auth.uid(), trim(p_display_name), 'member', now());

  return h;
end;
$$;
