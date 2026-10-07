-- O dono da casa cuida de quem está nela: tira um morador e troca o código
-- de convite. Antes, quem entrou ficava para sempre (só saía por vontade
-- própria) e o código era o mesmo desde a criação da casa, então um código
-- que vazou dava acesso a tudo sem remédio.
--
-- Quem sai por decisão do dono fica como quem saiu sozinho: o que registrou
-- continua com a casa e a ficha de pessoa dele vira dependente
-- (member_user_id nulo, pela chave estrangeira).

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
end;
$$;

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
