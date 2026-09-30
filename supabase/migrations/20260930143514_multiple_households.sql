-- Várias casas por conta. Cada aparelho fica numa casa aberta e diz qual é
-- no cabeçalho x-household-id; current_household_id() devolve essa casa se
-- a pessoa é membro dela (senão, nenhuma: nada aparece e o app escolhe outra).
-- Sem o cabeçalho (versões antigas do app), vale a primeira casa em que a
-- pessoa entrou, como antes. Assim as regras de acesso de todas as tabelas
-- e as funções continuam as mesmas.

alter table public.household_members drop constraint household_members_user_id_key;
create index household_members_user_idx on public.household_members (user_id, joined_at);

-- Última vez que a pessoa abriu cada casa: um aparelho novo abre na mais recente.
alter table public.household_members add column selected_at timestamptz;

-- Até quantas casas uma conta participa (o limite de IA é por casa).
create function public.max_households_per_user()
returns int
language sql
immutable
set search_path = ''
as $$ select 5 $$;

create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with wanted as (
    select nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-household-id', '') as id
  )
  select case
    when (select id from wanted) is not null then (
      select m.household_id from public.household_members m
      where m.user_id = auth.uid() and m.household_id::text = (select id from wanted)
    )
    else (
      select m.household_id from public.household_members m
      where m.user_id = auth.uid()
      order by m.joined_at, m.household_id
      limit 1
    )
  end;
$$;

-- Casas da pessoa, da aberta mais recentemente para a menos.
create function public.my_households()
returns table (id uuid, name text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select h.id, h.name, m.role
  from public.household_members m
  join public.households h on h.id = m.household_id
  where m.user_id = auth.uid()
  order by m.selected_at desc nulls last, m.joined_at, h.id;
$$;

create function public.select_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.household_members m set selected_at = now()
    where m.user_id = auth.uid() and m.household_id = p_household_id;
  if not found then
    raise exception 'user does not belong to this household' using errcode = 'P0002';
  end if;
end;
$$;

-- Criar ou entrar: uma de cada vez por pessoa, para o limite valer.
create or replace function public.create_household(p_name text, p_display_name text)
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
  if (select count(*) from public.household_members m where m.user_id = auth.uid()) >= public.max_households_per_user() then
    raise exception 'household limit reached' using errcode = 'NK002';
  end if;

  insert into public.households (name, invite_code, created_by)
  values (trim(p_name), public.generate_invite_code(), auth.uid())
  returning * into h;

  insert into public.household_members (household_id, user_id, display_name, role, selected_at)
  values (h.id, auth.uid(), trim(p_display_name), 'owner', now());

  return h;
end;
$$;

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

  select * into h from public.households where invite_code = upper(trim(p_invite_code));
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

-- Sair de uma casa: a que a pessoa confirmou, entre as várias dela.
create or replace function public.leave_household(p_household_id uuid, p_delete_if_last boolean default false)
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
  if not exists (
    select 1 from public.household_members m where m.user_id = auth.uid() and m.household_id = p_household_id
  ) then
    raise exception 'user does not belong to this household' using errcode = 'P0002';
  end if;
  -- Primeiro a casa, depois a linha de membro (mesma ordem em toda saída).
  perform 1 from public.households h where h.id = p_household_id for update;
  -- Relida depois do lock: outra saída da mesma conta pode ter terminado antes.
  select * into me from public.household_members m
    where m.user_id = auth.uid() and m.household_id = p_household_id
    for update;
  if not found then
    raise exception 'user does not belong to this household' using errcode = 'P0002';
  end if;

  select m.user_id into heir
  from public.household_members m
  where m.household_id = p_household_id and m.user_id <> me.user_id
  order by m.joined_at, m.user_id
  limit 1;

  if heir is null then
    if not p_delete_if_last then
      raise exception 'last member' using errcode = 'NK001';
    end if;
    insert into public.household_file_cleanup (household_id) values (p_household_id) on conflict do nothing;
    delete from public.households h where h.id = p_household_id;
    return jsonb_build_object('status', 'deleted', 'household_id', p_household_id);
  end if;

  delete from public.household_members m where m.user_id = me.user_id and m.household_id = p_household_id;
  if me.role = 'owner' then
    update public.household_members m set role = 'owner'
      where m.household_id = p_household_id and m.user_id = heir;
    -- created_by faz o papel de dono (quem pode renomear a casa).
    update public.households h set created_by = heir where h.id = p_household_id;
  end if;
  return jsonb_build_object('status', 'left', 'household_id', p_household_id);
end;
$$;

revoke execute on function public.max_households_per_user() from public, anon;
revoke execute on function public.my_households() from public, anon;
revoke execute on function public.select_household(uuid) from public, anon;
grant execute on function public.max_households_per_user() to authenticated;
grant execute on function public.my_households() to authenticated;
grant execute on function public.select_household(uuid) to authenticated;

-- Fotos e arquivos: a pasta é a casa; vale para qualquer casa de que a
-- pessoa é membro (o envio não depende de o serviço de arquivos repassar o
-- cabeçalho da casa aberta).
create function public.is_my_household(p_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.user_id = auth.uid() and m.household_id::text = p_id
  );
$$;
revoke execute on function public.is_my_household(text) from public, anon;
grant execute on function public.is_my_household(text) to authenticated;

do $$
declare
  bucket text;
  label text;
begin
  foreach bucket in array array['receipts', 'health', 'documents'] loop
    label := case bucket when 'receipts' then 'receipt images' when 'health' then 'health files' else 'documents files' end;
    execute format('drop policy %I on storage.objects', 'household members read ' || label);
    execute format('drop policy %I on storage.objects', 'household members upload ' || label);
    execute format('drop policy %I on storage.objects', 'household members delete ' || label);
    execute format(
      'create policy %I on storage.objects for select to authenticated using (bucket_id = %L and public.is_my_household((storage.foldername(name))[1]))',
      'household members read ' || label, bucket);
    execute format(
      'create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L and public.is_my_household((storage.foldername(name))[1]))',
      'household members upload ' || label, bucket);
    execute format(
      'create policy %I on storage.objects for delete to authenticated using (bucket_id = %L and public.is_my_household((storage.foldername(name))[1]))',
      'household members delete ' || label, bucket);
  end loop;
end;
$$;
