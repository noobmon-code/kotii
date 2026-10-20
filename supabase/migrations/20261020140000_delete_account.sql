-- Apagar a conta pelo app (Família → Conta → "Apagar minha conta"). Quem
-- apaga é a função delete-account: ela confere o token e a senha da pessoa,
-- chama delete_account_data (abaixo, só pela chave secreta) e, por fim, apaga
-- o usuário no Auth (auth.admin.deleteUser). Esta parte é a do banco, numa
-- transação só: ou a pessoa sai de tudo, ou nada muda.
--
-- 1. Sair de cada casa pelo mesmo caminho de "Sair da casa": o dono passa a
--    casa adiante, a ficha de saúde vira dependente, as tarefas ficam sem
--    responsável, o consultor (beta_access e fin_*) sai junto pela chave
--    estrangeira. A casa em que ela é a última pessoa é apagada, mas só se o
--    app avisou (p_delete_households); senão, NK001 e nada muda, como em
--    leave_household. E o contrário: a casa que o app avisou que seria
--    apagada e que ganhou um morador desde o aviso não passa adiante com o
--    que é dela sem ela saber: NK011 e nada muda (a tela relê as casas). As
--    casas vão na ordem do id, a mesma para todo mundo: duas pessoas das
--    mesmas casas apagando a conta ao mesmo tempo não se travam. As fotos das
--    casas apagadas entram na fila de limpeza.
-- 2. O que impede apagar o usuário: households.created_by (on delete
--    restrict) passa para o responsável que ficou, e os arquivos do Storage
--    (o Supabase não apaga o usuário dono de arquivos) ficam sem dono: as
--    fotos são da casa, não de quem as enviou.
-- 3. O que é só dela sai já: as inscrições de avisos do navegador (com a
--    agenda), as sessões e as tentativas de código de convite. O resto que
--    aponta para o usuário (pesos da divisão, idas ao mercado) sai com ele.
-- 4. Os acertos da divisão de gastos ficam com a casa: quem apagou a conta
--    vira nulo (o app mostra "Ex-morador") em vez de o acerto sumir do
--    histórico em cascata. A conta do mês não muda: como já acontece com
--    quem sai da casa, o acerto com quem não mora mais nela fica fora dela.
--    Os outros registros dela (quem pagou, quem fez) já viravam nulo.
-- 5. A senha tem limite por conta (account_deletion_attempts): a função
--    conta cada tentativa antes de conferir a senha e zera a conta quando a
--    senha confere. O limite do Auth é por IP, e aqui o IP é o da função,
--    o mesmo para todo mundo.

-- -----------------------------------------------------------------------------
-- Sair de uma casa, por uma pessoa dada: o corpo de leave_household, que agora
-- só passa auth.uid(). Sem permissão para ninguém: só as duas funções abaixo.
-- -----------------------------------------------------------------------------

create function public.leave_household_as(p_user_id uuid, p_household_id uuid, p_delete_if_last boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.household_members;
  heir uuid;
begin
  if not exists (
    select 1 from public.household_members m where m.user_id = p_user_id and m.household_id = p_household_id
  ) then
    raise exception 'user does not belong to this household' using errcode = 'P0002';
  end if;
  -- Primeiro a casa, depois a linha de membro (mesma ordem em toda saída).
  perform 1 from public.households h where h.id = p_household_id for update;
  -- Relida depois do lock: outra saída da mesma conta pode ter terminado antes.
  select * into me from public.household_members m
    where m.user_id = p_user_id and m.household_id = p_household_id
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

revoke execute on function public.leave_household_as(uuid, uuid, boolean) from public, anon, authenticated, service_role;

create or replace function public.leave_household(p_household_id uuid, p_delete_if_last boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return public.leave_household_as(auth.uid(), p_household_id, p_delete_if_last);
end;
$$;

-- -----------------------------------------------------------------------------
-- Acertos: quem apagou a conta fica nulo, e o acerto fica.
-- -----------------------------------------------------------------------------

alter table public.settlements
  alter column from_user drop not null,
  alter column to_user drop not null,
  drop constraint settlements_from_user_fkey,
  drop constraint settlements_to_user_fkey,
  add constraint settlements_from_user_fkey foreign key (from_user) references auth.users (id) on delete set null,
  add constraint settlements_to_user_fkey foreign key (to_user) references auth.users (id) on delete set null;

-- -----------------------------------------------------------------------------
-- O que o app mostra antes de apagar: cada casa da pessoa, se ela é a última
-- (a casa é apagada), se é a responsável (a casa passa adiante) e se tem o
-- consultor ali (sai junto).
-- -----------------------------------------------------------------------------

create function public.account_deletion_preview()
returns table (id uuid, name text, role text, last boolean, finance boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    h.id,
    h.name,
    m.role,
    not exists (
      select 1 from public.household_members o where o.household_id = h.id and o.user_id <> m.user_id
    ),
    exists (
      select 1 from public.beta_access b where b.household_id = h.id and b.user_id = m.user_id and b.feature = 'finance'
    )
  from public.household_members m
  join public.households h on h.id = m.household_id
  where m.user_id = auth.uid()
  order by m.joined_at, h.id;
$$;

revoke execute on function public.account_deletion_preview() from public, anon;
grant execute on function public.account_deletion_preview() to authenticated;

-- -----------------------------------------------------------------------------
-- A parte do banco de apagar a conta. Só a chave secreta (a função
-- delete-account, que tirou p_user_id do token conferido). Devolve as casas
-- apagadas e as deixadas.
-- -----------------------------------------------------------------------------

create function public.delete_account_data(p_user_id uuid, p_delete_households uuid[] default '{}')
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

  return jsonb_build_object('deleted', to_jsonb(deleted), 'left', to_jsonb(kept));
end;
$$;

revoke execute on function public.delete_account_data(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.delete_account_data(uuid, uuid[]) to service_role;

-- -----------------------------------------------------------------------------
-- Tentativas de senha ao apagar a conta: até 5 por hora (contada da primeira),
-- por conta. Só a chave secreta: a função delete-account conta a tentativa
-- antes de conferir a senha (assim, pedidos ao mesmo tempo também contam) e
-- zera quando a senha confere. A linha sai com o usuário.
-- -----------------------------------------------------------------------------

create table public.account_deletion_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  attempts integer not null default 0 check (attempts >= 0),
  window_started_at timestamptz not null default now()
);
alter table public.account_deletion_attempts enable row level security;
revoke all on public.account_deletion_attempts from anon, authenticated;

-- true: a tentativa foi contada e a senha pode ser conferida; false: já são 5 nesta hora, e nada é contado.
create function public.count_account_deletion_attempt(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  tries public.account_deletion_attempts;
begin
  if p_user_id is null then
    raise exception 'user required' using errcode = '22023';
  end if;
  insert into public.account_deletion_attempts as a (user_id, attempts, window_started_at)
  values (p_user_id, 0, now())
  on conflict (user_id) do update
    set attempts = case when a.window_started_at > now() - interval '1 hour' then a.attempts else 0 end,
        window_started_at = case when a.window_started_at > now() - interval '1 hour' then a.window_started_at else now() end
  returning * into tries;
  if tries.attempts >= 5 then
    return false;
  end if;
  update public.account_deletion_attempts a set attempts = a.attempts + 1 where a.user_id = p_user_id;
  return true;
end;
$$;

create function public.clear_account_deletion_attempts(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.account_deletion_attempts a where a.user_id = p_user_id;
$$;

revoke execute on function public.count_account_deletion_attempt(uuid) from public, anon, authenticated;
grant execute on function public.count_account_deletion_attempt(uuid) to service_role;
revoke execute on function public.clear_account_deletion_attempts(uuid) from public, anon, authenticated;
grant execute on function public.clear_account_deletion_attempts(uuid) to service_role;
