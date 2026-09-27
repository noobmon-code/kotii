-- Sair da casa.
--
-- Quem sai deixa para a casa o que registrou; a ficha de pessoa dele fica
-- como dependente (member_user_id vira null). Se ele criou a casa, o morador
-- mais antigo passa a ser o dono. O último a sair apaga a casa e tudo o que
-- ela tem (o app apaga antes as fotos, pela API de Storage).
--
-- A saída passa sempre por esta função, para a casa nunca ficar sem dono:
-- o delete direto em household_members deixa de ser permitido.

drop policy "member leaves household" on public.household_members;

create function public.leave_household()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.household_members;
  heir uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into me from public.household_members m where m.user_id = auth.uid();
  if not found then
    raise exception 'user does not belong to a household' using errcode = 'P0002';
  end if;
  -- Uma saída por vez em cada casa: duas pessoas saindo juntas não deixam a
  -- casa vazia e sem ser apagada.
  perform 1 from public.households h where h.id = me.household_id for update;

  select m.user_id into heir
  from public.household_members m
  where m.household_id = me.household_id and m.user_id <> me.user_id
  order by m.joined_at, m.user_id
  limit 1;

  if heir is null then
    delete from public.households h where h.id = me.household_id;
    return 'deleted';
  end if;

  delete from public.household_members m where m.user_id = me.user_id;
  if me.role = 'owner' then
    update public.household_members m set role = 'owner'
      where m.household_id = me.household_id and m.user_id = heir;
    -- created_by faz o papel de dono (quem pode renomear a casa).
    update public.households h set created_by = heir where h.id = me.household_id;
  end if;
  return 'left';
end;
$$;

revoke execute on function public.leave_household() from public, anon;
grant execute on function public.leave_household() to authenticated;
