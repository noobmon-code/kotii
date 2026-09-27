-- leave_household trava a linha de membro de quem sai logo na leitura.
-- Duas saídas da mesma conta ao mesmo tempo: a segunda espera a primeira e,
-- depois dela, não acha mais o vínculo (sai com "não está em nenhuma casa"),
-- em vez de apagar um vínculo novo com outra casa em que a pessoa entrou no
-- meio. Os deletes também ficam presos à casa travada.

create or replace function public.leave_household()
returns jsonb
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

  select * into me from public.household_members m where m.user_id = auth.uid() for update;
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
    return jsonb_build_object('status', 'deleted', 'household_id', me.household_id);
  end if;

  delete from public.household_members m where m.user_id = me.user_id and m.household_id = me.household_id;
  if me.role = 'owner' then
    update public.household_members m set role = 'owner'
      where m.household_id = me.household_id and m.user_id = heir;
    -- created_by faz o papel de dono (quem pode renomear a casa).
    update public.households h set created_by = heir where h.id = me.household_id;
  end if;
  return jsonb_build_object('status', 'left', 'household_id', me.household_id);
end;
$$;
