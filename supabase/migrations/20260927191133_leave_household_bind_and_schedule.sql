-- Sair da casa, quarta volta:
-- 1. leave_household recebe a casa que a pessoa confirmou (p_household_id).
--    Se ela já está em outra (saiu e entrou numa nova por outro aparelho),
--    recusa (P0002) em vez de sair ou apagar a casa errada.
-- 2. A fila de fotos ganha um consumidor independente: de hora em hora o
--    pg_cron chama a função leave-household em modo "drain" (pg_net), com a
--    URL do projeto e a chave anon (pública) guardadas no Vault como
--    project_url e anon_key. Onde não há pg_cron/pg_net (o Postgres dos
--    testes), o agendamento é pulado.

drop function public.leave_household(boolean);

create function public.leave_household(p_household_id uuid, p_delete_if_last boolean default false)
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
  if not found or hid is distinct from p_household_id then
    raise exception 'user does not belong to this household' using errcode = 'P0002';
  end if;
  -- Primeiro a casa, depois a linha de membro (mesma ordem em toda saída).
  perform 1 from public.households h where h.id = hid for update;
  -- Relida depois do lock: outra saída da mesma conta pode ter terminado antes.
  select * into me from public.household_members m
    where m.user_id = auth.uid() and m.household_id = hid
    for update;
  if not found then
    raise exception 'user does not belong to this household' using errcode = 'P0002';
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

revoke execute on function public.leave_household(uuid, boolean) from public, anon;
grant execute on function public.leave_household(uuid, boolean) to authenticated;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
    or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron/pg_net indisponíveis: limpeza agendada não criada';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  create extension if not exists pg_net with schema extensions;
  perform cron.schedule(
    'household-file-cleanup',
    '17 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/leave-household',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
        ),
        body := '{"drain": true}'::jsonb
      )
      where exists (select 1 from public.household_file_cleanup)
    $job$
  );
end;
$$;
