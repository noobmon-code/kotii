-- Perfil da pessoa (Configurações → Perfil): o nome, a data de nascimento e o telefone.
--
-- 1. O nome continua em household_members.display_name, que é o que os moradores veem; agora é um por
--    pessoa: salvar o perfil troca o nome em todas as casas dela, de uma vez.
-- 2. A data de nascimento e o telefone são opcionais e só da pessoa: ficam em profiles, que só ela lê
--    (user_id = auth.uid()). Os outros moradores não veem, e nada disso vai para o resumo do Nuke, para o
--    consultor ou para a base de preços.
-- 3. Gravar é só pela save_my_profile: uma chamada, uma transação, as mesmas regras da tela
--    (src/domain/profile.ts) e um código para cada recusa (NK012 nome, NK013 data, NK014 telefone).
-- 4. A linha sai com a conta: on delete cascade de auth.users e, antes disso, na delete_account_data,
--    junto com o resto que é só da pessoa. Sair de uma casa não mexe no perfil.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- A data no futuro a função recusa (o "hoje" muda; um check não pode depender dele).
  birth_date date check (birth_date >= date '1900-01-01'),
  -- Só dígitos: o DDD e o número.
  phone text check (phone ~ '^[0-9]{10,11}$'),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Desde 30/10/2026 a Supabase não dá acesso às tabelas novas pela API: os privilégios ficam escritos aqui.
-- O app só lê; quem escreve é a save_my_profile.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;

create policy "person reads own profile" on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Salvar o perfil: confere, grava a linha e troca o nome em todas as casas da pessoa.
-- -----------------------------------------------------------------------------

create function public.save_my_profile(p_name text, p_birth_date date, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  -- Os espaços das pontas saem (os mesmos que o cleanName do app tira).
  v_name text := regexp_replace(coalesce(p_name, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- Só os dígitos; vazio é sem telefone.
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  -- O dia de hoje no Brasil, o mesmo do aparelho.
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'invalid name' using errcode = 'NK012';
  end if;
  if p_birth_date is not null and (p_birth_date < date '1900-01-01' or p_birth_date > v_today) then
    raise exception 'invalid birth date' using errcode = 'NK013';
  end if;
  if v_phone is not null and char_length(v_phone) not in (10, 11) then
    raise exception 'invalid phone' using errcode = 'NK014';
  end if;

  insert into public.profiles as p (user_id, birth_date, phone, updated_at)
  values (me, p_birth_date, v_phone, now())
  on conflict (user_id) do update
    set birth_date = excluded.birth_date, phone = excluded.phone, updated_at = excluded.updated_at;

  -- Um nome por pessoa: o mesmo em todas as casas dela (e só dela).
  update public.household_members m set display_name = v_name
    where m.user_id = me and m.display_name is distinct from v_name;

  return jsonb_build_object('name', v_name, 'birth_date', p_birth_date, 'phone', v_phone);
end;
$$;

revoke execute on function public.save_my_profile(text, date, text) from public, anon, service_role;
grant execute on function public.save_my_profile(text, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Apagar a conta: o perfil sai junto com o resto que é só da pessoa, antes do usuário. É a função de
-- 20261020140000_delete_account.sql com uma linha a mais (o delete de profiles, no fim).
-- -----------------------------------------------------------------------------

create or replace function public.delete_account_data(p_user_id uuid, p_delete_households uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  house uuid;
  result jsonb;
  deleted uuid[] := '{}';
  kept uuid[] := '{}';
begin
  if p_user_id is null then
    raise exception 'user required' using errcode = '22023';
  end if;
  -- A mesma trava de criar e entrar numa casa: nenhuma entrada no meio.
  perform pg_advisory_xact_lock(hashtextextended('households:' || p_user_id::text, 0));

  -- Na ordem do id, e não na de quem apaga: a trava de cada casa sai sempre na mesma ordem.
  for house in
    select m.household_id from public.household_members m where m.user_id = p_user_id order by m.household_id
  loop
    -- A casa em que ela ficou sozinha sem o app ter avisado: NK001 desfaz tudo.
    result := public.leave_household_as(p_user_id, house, house = any (coalesce(p_delete_households, '{}')));
    if result ->> 'status' = 'deleted' then
      deleted := deleted || house;
    elsif house = any (coalesce(p_delete_households, '{}')) then
      -- O app avisou que esta casa seria apagada, e ela ganhou um morador: desfaz tudo.
      raise exception 'household is no longer hers alone' using errcode = 'NK011';
    else
      kept := kept || house;
    end if;
  end loop;

  -- created_by que sobrou (dados de antes de a saída passar a casa adiante):
  -- vai para o responsável de agora, ou o morador mais antigo. Casa sem
  -- ninguém não tem quem a veja: sai, com as fotos na fila.
  update public.households h set created_by = coalesce(
      (select m.user_id from public.household_members m where m.household_id = h.id and m.role = 'owner' order by m.joined_at limit 1),
      (select m.user_id from public.household_members m where m.household_id = h.id order by m.joined_at, m.user_id limit 1)
    )
    where h.created_by = p_user_id
      and exists (select 1 from public.household_members m where m.household_id = h.id);
  insert into public.household_file_cleanup (household_id)
    select h.id from public.households h where h.created_by = p_user_id
    on conflict do nothing;
  with gone as (
    delete from public.households h where h.created_by = p_user_id returning h.id
  )
  select deleted || coalesce(array_agg(g.id), '{}') into deleted from gone g;

  -- Os arquivos ficam com a casa, sem dono (owner_id, a coluna nova do
  -- Storage, guarda o mesmo id como texto).
  update storage.objects o set owner = null where o.owner = p_user_id;
  if exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'storage' and c.table_name = 'objects' and c.column_name = 'owner_id'
  ) then
    execute 'update storage.objects set owner_id = null where owner_id = $1' using p_user_id::text;
  end if;

  delete from public.push_subscriptions s where s.user_id = p_user_id;
  delete from public.household_sessions s where s.user_id = p_user_id;
  delete from public.join_attempts a where a.user_id = p_user_id;
  -- O perfil (data de nascimento e telefone) é só dela.
  delete from public.profiles p where p.user_id = p_user_id;

  return jsonb_build_object('deleted', to_jsonb(deleted), 'left', to_jsonb(kept));
end;
$$;

revoke execute on function public.delete_account_data(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.delete_account_data(uuid, uuid[]) to service_role;
