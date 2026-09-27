-- Sair da casa, terceira volta:
-- 1. A casa só é apagada se quem sai confirmou isso (p_delete_if_last). Se a
--    pessoa confirmou "sair" com outros moradores e, no meio, ficou sozinha,
--    a função recusa (NK001) e o app pergunta de novo.
-- 2. Trava a casa antes da linha de membro, sempre nessa ordem: dono e
--    morador saindo juntos não travam um ao outro.
-- 3. Casa apagada entra em household_file_cleanup, na mesma transação: a
--    função leave-household apaga as fotos e só então tira a casa da fila;
--    se falhar, tenta de novo na próxima vez.

create table public.household_file_cleanup (
  household_id uuid primary key,
  requested_at timestamptz not null default now(),
  attempts integer not null default 0
);
-- Sem policies: só a service role (a função leave-household) lê e apaga.
alter table public.household_file_cleanup enable row level security;
revoke all on public.household_file_cleanup from anon, authenticated;

drop function public.leave_household();

create function public.leave_household(p_delete_if_last boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
  me public.household_members;
  heir uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select m.household_id into hid from public.household_members m where m.user_id = auth.uid();
  if not found then
    raise exception 'user does not belong to a household' using errcode = 'P0002';
  end if;
  -- Primeiro a casa, depois a linha de membro (mesma ordem em toda saída).
  perform 1 from public.households h where h.id = hid for update;
  -- Relida depois do lock: outra saída da mesma conta pode ter terminado
  -- antes, e a pessoa pode estar agora em outra casa, que não é esta.
  select * into me from public.household_members m
    where m.user_id = auth.uid() and m.household_id = hid
    for update;
  if not found then
    raise exception 'user does not belong to a household' using errcode = 'P0002';
  end if;

  select m.user_id into heir
  from public.household_members m
  where m.household_id = hid and m.user_id <> me.user_id
  order by m.joined_at, m.user_id
  limit 1;

  if heir is null then
    if not p_delete_if_last then
      raise exception 'last member' using errcode = 'NK001';
    end if;
    insert into public.household_file_cleanup (household_id) values (hid) on conflict do nothing;
    delete from public.households h where h.id = hid;
    return jsonb_build_object('status', 'deleted', 'household_id', hid);
  end if;

  delete from public.household_members m where m.user_id = me.user_id and m.household_id = hid;
  if me.role = 'owner' then
    update public.household_members m set role = 'owner'
      where m.household_id = hid and m.user_id = heir;
    -- created_by faz o papel de dono (quem pode renomear a casa).
    update public.households h set created_by = heir where h.id = hid;
  end if;
  return jsonb_build_object('status', 'left', 'household_id', hid);
end;
$$;

revoke execute on function public.leave_household(boolean) from public, anon;
grant execute on function public.leave_household(boolean) to authenticated;
