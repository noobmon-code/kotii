-- Rodízio de tarefas: a tarefa que se repete passa de pessoa em pessoa ("louça:
-- hoje Beto, amanhã Carla") sem ninguém editar a tarefa todo dia.
--
-- A ordem fica em chore_rotation (fichas de pessoas da casa: moradores e quem
-- não tem o app; pets não). De quem é a vez continua onde sempre esteve, na
-- própria tarefa: assigned_to (morador) ou kid_id (ficha sem conta, que ganha
-- os pontos). Assim o app já instalado, que só conhece essas duas colunas,
-- mostra a pessoa certa e conclui como antes.
--
-- 1. save_chore_rotation grava a ordem (ou encerra o rodízio); save_chore_single
--    grava o responsável da tarefa sem rodízio, e recusa a que tem um. O
--    formulário que abriu sem rodízio e cria um pede o mesmo à primeira
--    (p_expect_none): ela recusa a tarefa que já tem rodízio.
-- 2. complete_chore passa a vez ao concluir e devolve quem é o próximo.
-- 3. skip_chore_turn passa a vez sem concluir.
-- 4. Gatilhos: quem sai da ordem (ficha apagada) passa a vez adiante; com menos
--    de duas pessoas o rodízio acaba; o morador que sai da casa segue na ordem
--    como pessoa sem o app; tarefa que vira "Uma vez" fica só com quem estava
--    na vez.

create table public.chore_rotation (
  chore_id uuid not null,
  person_id uuid not null,
  position integer not null check (position >= 1),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  primary key (chore_id, person_id),
  -- Adiável: a posição só é conferida no fim da instrução, então trocar a
  -- ordem de várias linhas de uma vez não esbarra em si mesma.
  unique (chore_id, position) deferrable initially immediate,
  foreign key (chore_id, household_id)
    references public.chores (id, household_id) on delete cascade,
  -- A ficha apagada sai da ordem (ver chore_rotation_person_left).
  foreign key (person_id, household_id)
    references public.people (id, household_id) on delete cascade
);
create index chore_rotation_person_idx on public.chore_rotation (person_id);
create index chore_rotation_household_idx on public.chore_rotation (household_id);

-- O app só lê a ordem. Quem grava são as funções abaixo (save_chore_rotation, complete_chore, skip_chore_turn) e
-- os gatilhos, que rodam como dono da tabela: escrita direta pela API aceitaria o que a função recusa (rodízio em
-- tarefa que não se repete, ordem de uma pessoa só, a vez de alguém de fora da ordem).
alter table public.chore_rotation enable row level security;
create policy "household members read chore_rotation" on public.chore_rotation for select to authenticated
  using (household_id = (select public.current_household_id()));

-- Permissões explícitas: a partir de 30/10/2026 a Supabase não dá mais acesso pela API às tabelas novas por
-- padrão, e a migração pode ser aplicada depois disso. A pessoa logada só lê (a regra acima diz o quê).
revoke all on public.chore_rotation from anon, authenticated;
grant select on public.chore_rotation to authenticated;
grant all on public.chore_rotation to service_role;

-- Só pessoas revezam (um check não pode consultar outra tabela, daí o gatilho).
create function public.chore_rotation_only_people()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.people p
    where p.id = new.person_id and p.household_id = new.household_id and p.kind = 'pessoa'
  ) then
    raise exception 'only people of the household take part in a chore rotation' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.chore_rotation_only_people() from public, anon, authenticated;

create trigger chore_rotation_only_people
  before insert or update of person_id, household_id on public.chore_rotation
  for each row execute function public.chore_rotation_only_people();

-- =============================================================================
-- A vez
-- =============================================================================

-- De quem é a vez: a ficha a que a tarefa aponta (kid_id, ou a do morador de
-- assigned_to). Nulo: qualquer um.
create function public.chore_turn_person(p_household_id uuid, p_assigned_to uuid, p_kid_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_kid_id,
    (select p.id from public.people p where p.household_id = p_household_id and p.member_user_id = p_assigned_to)
  );
$$;

-- A vez passa a ser desta ficha: morador em assigned_to, quem não tem o app em kid_id.
create function public.chore_set_turn(p_chore_id uuid, p_person_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.chores c
    set assigned_to = p.member_user_id,
        kid_id = case when p.member_user_id is null then p.id end
    from public.people p
    where c.id = p_chore_id and p.id = p_person_id and p.household_id = c.household_id;
$$;

-- Quem vem depois da posição p_after: o seguinte na ordem ou, depois do
-- último, o primeiro. Sem posição (a vez era de alguém de fora da ordem, ou de
-- ninguém), o primeiro.
create function public.chore_next_person(p_chore_id uuid, p_after integer)
returns uuid
language sql
stable
set search_path = ''
as $$
  select r.person_id from public.chore_rotation r
  where r.chore_id = p_chore_id
  order by (p_after is not null and r.position > p_after) desc, r.position
  limit 1;
$$;

revoke execute on function public.chore_turn_person(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.chore_set_turn(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.chore_next_person(uuid, integer) from public, anon, authenticated;

-- =============================================================================
-- 1. Gravar a ordem
-- =============================================================================

-- p_people: as fichas na ordem do rodízio (duas ou mais, sem repetir), ou
-- vazio para encerrar o rodízio (a tarefa fica com quem está na vez). Troca a
-- ordem inteira de uma vez. Rodízio novo começa pelo primeiro; no que já
-- existia, quem continua na ordem mantém a vez e, se saiu, ela vai para o
-- primeiro. A tarefa em si o app grava antes, direto na tabela, como sempre.
--
-- p_expect_none: o formulário abriu sem rodízio e vai criar um. Aí a função é
-- chamada antes de o resto da tarefa ser gravado e, com a tarefa travada,
-- confere que ela segue sem rodízio: se um foi criado nesse meio-tempo, em
-- outro celular, recusa (NK006, como save_chore_single) e nada muda, em vez
-- de trocar por outra a ordem que o formulário nunca mostrou. Aceita, a vez
-- vai para o primeiro (é um rodízio novo); os pontos e o resto da tarefa o app
-- grava em seguida. Falso, ou sem o argumento: tudo como acima.
create function public.save_chore_rotation(p_chore_id uuid, p_people uuid[], p_expect_none boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chores;
  n integer := coalesce(cardinality(p_people), 0);
  had boolean;
  turn uuid;
begin
  select * into c from public.chores ch
  where ch.id = p_chore_id and ch.household_id = public.current_household_id()
  for update;
  if not found then
    raise exception 'chore not found' using errcode = 'P0002';
  end if;
  -- Antes de qualquer outra coisa: quem não viu o rodízio não o troca nem o encerra.
  if p_expect_none and exists (select 1 from public.chore_rotation r where r.chore_id = c.id) then
    raise exception 'chore has a rotation' using errcode = 'NK006';
  end if;

  if n = 0 then
    delete from public.chore_rotation r where r.chore_id = c.id;
    return;
  end if;
  if n < 2 or n > 20 or array_ndims(p_people) <> 1 or (select count(distinct x) from unnest(p_people) as x) <> n then
    raise exception 'O rodízio precisa de 2 a 20 pessoas diferentes.' using errcode = '22023';
  end if;
  if c.recurrence = 'none' then
    raise exception 'Só tarefa que se repete pode ter rodízio.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_people) as x
    where not exists (select 1 from public.people p where p.id = x and p.household_id = c.household_id)
  ) then
    raise exception 'Alguém do rodízio não está mais na casa. Confira a ordem e salve de novo.' using errcode = 'P0002';
  end if;

  had := exists (select 1 from public.chore_rotation r where r.chore_id = c.id);
  turn := public.chore_turn_person(c.household_id, c.assigned_to, c.kid_id);

  delete from public.chore_rotation r where r.chore_id = c.id;
  insert into public.chore_rotation (chore_id, person_id, position, household_id)
  select c.id, t.x, t.ord, c.household_id from unnest(p_people) with ordinality as t (x, ord);

  if not had or turn is null or not (turn = any (p_people)) then
    perform public.chore_set_turn(c.id, p_people[1]);
  end if;
end;
$$;
revoke execute on function public.save_chore_rotation(uuid, uuid[], boolean) from public, anon;
grant execute on function public.save_chore_rotation(uuid, uuid[], boolean) to authenticated;

-- A tarefa sem rodízio: o responsável (p_assigned_to, morador; p_kid_id, quem
-- não tem o app; os dois nulos, qualquer um) e os pontos (nulo: ficam como
-- estão). O formulário que abriu sem rodízio grava os três por aqui, e não
-- direto na tabela: conferir "a tarefa segue sem rodízio?" e gravar são um
-- passo só, com a tarefa travada como em save_chore_rotation, então um espera
-- o outro terminar. Se um rodízio foi criado nesse meio-tempo, em outro
-- celular, a função recusa (NK006) e nada muda: gravado por cima, o
-- responsável de antes ficaria com a vez, talvez sem estar na ordem, e os
-- pontos da conclusão seguinte iriam para a pessoa errada. O resto da tarefa
-- (título, repetição, data) o app grava depois, direto na tabela, como sempre.
create function public.save_chore_single(p_chore_id uuid, p_assigned_to uuid, p_kid_id uuid, p_points integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chores;
begin
  select * into c from public.chores ch
  where ch.id = p_chore_id and ch.household_id = public.current_household_id()
  for update;
  if not found then
    raise exception 'chore not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.chore_rotation r where r.chore_id = c.id) then
    raise exception 'chore has a rotation' using errcode = 'NK006';
  end if;

  -- Quem pode ser o responsável é o que as chaves estrangeiras da tarefa já
  -- dizem (morador ou ficha desta casa), e os pontos, o check da coluna.
  update public.chores ch
    set assigned_to = p_assigned_to, kid_id = p_kid_id, points = coalesce(p_points, ch.points)
    where ch.id = c.id;
end;
$$;
revoke execute on function public.save_chore_single(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.save_chore_single(uuid, uuid, uuid, integer) to authenticated;

-- =============================================================================
-- 2. Concluir passa a vez
-- =============================================================================

-- Mais uma coluna na resposta (next_person_id) muda o tipo devolvido: a função
-- sai e volta. Os parâmetros e as outras colunas são os mesmos, e o app já
-- instalado lê a resposta pelo nome das colunas.
drop function public.complete_chore(uuid, date, date);

-- Registra a conclusão e agenda a próxima ocorrência (ver 20260928154748).
-- Num rodízio, a vez passa para o seguinte da ordem: os pontos e person_id são
-- de quem estava na vez (só quem não tem o app ganha pontos), e
-- next_person_id é de quem ela passa a ser (nulo sem rodízio, ou se nada foi
-- registrado). O vencimento que o app manda identifica a ocorrência: o
-- segundo toque não registra e, por isso, também não passa a vez de novo.
create function public.complete_chore(
  p_chore_id uuid,
  p_today date,
  p_due_on date default null,
  out completed boolean,
  out points integer,
  out person_id uuid,
  out due_on date,
  out active boolean,
  out next_person_id uuid
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
  base date;
  turn uuid;
  nxt uuid;
begin
  select * into c from public.chores ch
  where ch.id = p_chore_id and ch.household_id = public.current_household_id()
  for update;
  if not found then
    raise exception 'chore not found' using errcode = 'P0002';
  end if;

  completed := c.active
    and (p_due_on is null or c.due_on = p_due_on)
    -- App antigo (sem o vencimento): toque duplo em meio minuto conta uma vez.
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

    base := greatest(p_today, c.due_on);
    update public.chores ch set
      due_on = case c.recurrence
        when 'daily' then base + c.interval_count
        when 'weekly' then base + 7 * c.interval_count
        when 'monthly' then (base + make_interval(months => c.interval_count))::date
        else c.due_on
      end,
      active = c.recurrence <> 'none'
    where ch.id = c.id
    returning * into c;

    -- Rodízio: a vez vai para o seguinte. Se era de alguém de fora da ordem
    -- (tarefa editada por um app antigo), vai para o primeiro.
    if (select count(*) from public.chore_rotation r where r.chore_id = c.id) >= 2 then
      turn := public.chore_turn_person(c.household_id, c.assigned_to, c.kid_id);
      nxt := public.chore_next_person(
        c.id,
        (select r.position from public.chore_rotation r where r.chore_id = c.id and r.person_id = turn)
      );
      perform public.chore_set_turn(c.id, nxt);
    end if;
  end if;

  points := credited;
  person_id := kid;
  due_on := c.due_on;
  active := c.active;
  next_person_id := nxt;
end;
$$;
revoke execute on function public.complete_chore(uuid, date, date) from public, anon;
grant execute on function public.complete_chore(uuid, date, date) to authenticated;

-- =============================================================================
-- 3. Pular a vez
-- =============================================================================

-- Passa a vez para o seguinte sem concluir: a data fica, sem pontos e sem
-- nada no histórico. p_from é de quem a tela mostrava a vez (nulo: de
-- ninguém); se ela já passou (outro celular tocou antes), nada muda. Devolve
-- de quem a vez passou a ser, ou nulo quando nada mudou.
create function public.skip_chore_turn(p_chore_id uuid, p_from uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chores;
  turn uuid;
  nxt uuid;
begin
  select * into c from public.chores ch
  where ch.id = p_chore_id and ch.household_id = public.current_household_id()
  for update;
  if not found then
    raise exception 'chore not found' using errcode = 'P0002';
  end if;

  turn := public.chore_turn_person(c.household_id, c.assigned_to, c.kid_id);
  if not c.active
    or turn is distinct from p_from
    or (select count(*) from public.chore_rotation r where r.chore_id = c.id) < 2 then
    return null;
  end if;

  nxt := public.chore_next_person(
    c.id,
    (select r.position from public.chore_rotation r where r.chore_id = c.id and r.person_id = turn)
  );
  perform public.chore_set_turn(c.id, nxt);
  return nxt;
end;
$$;
revoke execute on function public.skip_chore_turn(uuid, uuid) from public, anon;
grant execute on function public.skip_chore_turn(uuid, uuid) to authenticated;

-- =============================================================================
-- 4. A ordem não quebra quando alguém sai dela
-- =============================================================================

-- Uma linha saiu da ordem. Se era a vez dela, a vez passa para o seguinte dos
-- que ficaram; se sobrou uma pessoa só, o rodízio acaba e a tarefa fica com
-- ela. Roda no fim da instrução: quando a ordem inteira sai de uma vez
-- (rodízio encerrado ou regravado), não sobra ninguém para receber a vez e a
-- tarefa fica com quem estava nela.
create function public.chore_rotation_row_left()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.chores;
  nxt uuid;
begin
  -- A casa inteira está sendo apagada: nada a arrumar (e mexer numa tarefa
  -- dela esbarraria na chave estrangeira da casa, que já não existe).
  if not exists (select 1 from public.households h where h.id = old.household_id) then
    return null;
  end if;
  -- Trava a tarefa, como complete_chore: a vez não anda em dois lugares ao mesmo tempo.
  select * into c from public.chores ch where ch.id = old.chore_id for update;
  if not found then
    return null; -- a tarefa saiu junto
  end if;
  if public.chore_turn_person(c.household_id, c.assigned_to, c.kid_id) = old.person_id then
    nxt := public.chore_next_person(old.chore_id, old.position);
    if nxt is not null then
      perform public.chore_set_turn(old.chore_id, nxt);
    end if;
  end if;
  if (select count(*) from public.chore_rotation r where r.chore_id = old.chore_id) < 2 then
    delete from public.chore_rotation r where r.chore_id = old.chore_id;
  end if;
  return null;
end;
$$;
revoke execute on function public.chore_rotation_row_left() from public, anon, authenticated;

create trigger chore_rotation_row_left
  after delete on public.chore_rotation
  for each row execute function public.chore_rotation_row_left();

-- A ficha vai ser apagada (ou virou pet): sai das ordens antes, enquanto a
-- tarefa ainda diz que a vez era dela. Deixado para a cascata, kid_id já
-- estaria nulo e a vez ficaria com ninguém.
create function public.chore_rotation_person_left()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Primeiro as tarefas, depois as linhas da ordem: a mesma sequência de
  -- travas de save_chore_rotation.
  perform 1 from public.chores c
  where c.id in (select r.chore_id from public.chore_rotation r where r.person_id = old.id)
  order by c.id
  for update;
  delete from public.chore_rotation r where r.person_id = old.id;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.chore_rotation_person_left() from public, anon, authenticated;

create trigger people_leave_chore_rotation
  before delete on public.people
  for each row execute function public.chore_rotation_person_left();
create trigger people_pet_leaves_chore_rotation
  after update of kind on public.people
  for each row
  when (old.kind = 'pessoa' and new.kind <> 'pessoa')
  execute function public.chore_rotation_person_left();

-- O morador sai da casa: a ficha dele continua, como pessoa sem o app
-- (member_user_id fica nulo pela chave estrangeira), e segue na ordem. Se era
-- a vez dele, assigned_to ficaria nulo e a vez, com ninguém: antes disso, a
-- vez passa de assigned_to para kid_id, apontando para a mesma ficha. (O
-- caminho inverso, a criança que ganha conta, já é do gatilho
-- people_kid_chores_to_member: kid_id vira assigned_to e a ficha é a mesma.)
create function public.chore_rotation_member_left()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A casa inteira está sendo apagada: as tarefas vão junto.
  if not exists (select 1 from public.households h where h.id = old.household_id) then
    return old;
  end if;
  update public.chores c
    set assigned_to = null, kid_id = p.id
    from public.people p
    where p.household_id = old.household_id and p.member_user_id = old.user_id
      and c.household_id = old.household_id and c.assigned_to = old.user_id
      and exists (select 1 from public.chore_rotation r where r.chore_id = c.id and r.person_id = p.id);
  return old;
end;
$$;
revoke execute on function public.chore_rotation_member_left() from public, anon, authenticated;

create trigger household_members_keep_chore_turn
  before delete on public.household_members
  for each row execute function public.chore_rotation_member_left();

-- Tarefa que deixa de se repetir (pelo app antigo também, que não conhece o
-- rodízio): fica só com quem está na vez.
create function public.chore_one_off_ends_rotation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.chore_rotation r where r.chore_id = new.id;
  return null;
end;
$$;
revoke execute on function public.chore_one_off_ends_rotation() from public, anon, authenticated;

create trigger chores_one_off_ends_rotation
  after update of recurrence on public.chores
  for each row
  when (new.recurrence = 'none' and old.recurrence <> 'none')
  execute function public.chore_one_off_ends_rotation();
