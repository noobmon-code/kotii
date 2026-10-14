-- "Estou indo ao mercado": quem está saindo para as compras avisa a casa com
-- um toque, para os outros porem na lista o que falta enquanto dá tempo.
--
-- O aviso vira uma "ida" (market_trips), que o app mostra por 2 horas na
-- tela Hoje e na lista (no celular também), e um aviso na hora nos
-- navegadores dos outros moradores: uma linha 'once' na agenda de cada
-- navegador inscrito (push_schedule), com fire_at = agora, que a send-push
-- entrega no minuto seguinte, do jeito que já entrega os lembretes. No
-- celular não há push remoto: lá só o aviso dentro do app.
--
-- O título e o texto do aviso são montados aqui, com o nome do morador e o
-- nome da lista que estão no banco: quem avisa não manda texto nenhum que
-- vá parar na tela bloqueada de outra pessoa.

-- Cada navegador escolhe se recebe (Família → "Avisos neste navegador").
-- Quem já recebe avisos do Kotii começa recebendo.
alter table public.push_subscriptions add column market_trips boolean not null default true;
-- Menos o navegador que hoje não tem nada agendado (por exemplo, aquele em
-- que a pessoa desligou todos os avisos do Kotii: a inscrição fica, porque a
-- permissão do navegador continua dada; e também o que tem avisos ligados e
-- nada para os próximos dias): ele não começa a receber este sem a pessoa
-- pedir. As inscrições novas nascem ligadas, menos a do navegador que diz
-- ter desligado a opção (register_push_subscription com p_market_trips,
-- abaixo): o app guarda no navegador quem desligou (ou a encontrou desligada
-- aqui), e a inscrição que um dia trocar esta já nasce desligada; um
-- navegador que nunca abriu a lista dos avisos depois desta migração e tem a
-- inscrição refeita (sair e entrar na conta) volta ao padrão.
update public.push_subscriptions s set market_trips = false
  where not exists (select 1 from public.push_schedule p where p.subscription_id = s.id);

create table public.market_trips (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  list_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- O nome que foi no aviso, para a faixa do app dizer o mesmo.
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now(),
  -- Até quando a faixa aparece (2 horas), se a pessoa não encerrar antes.
  ends_at timestamptz not null,
  ended_at timestamptz,
  foreign key (list_id, household_id)
    references public.shopping_lists (id, household_id) on delete cascade
);
create index market_trips_household_idx on public.market_trips (household_id, created_at desc);

-- A casa lê as idas dela; criar e encerrar, só pelas funções abaixo (sem
-- policy nem permissão de escrita: nem o próprio autor mexe direto).
-- As permissões vão escritas aqui, sem contar com o padrão do projeto: a
-- partir de 30/10/2026 o Supabase não abre mais as tabelas novas do schema
-- public para a API, e esta migração pode ser aplicada depois dessa data.
alter table public.market_trips enable row level security;
revoke all on public.market_trips from anon, authenticated;
grant select on public.market_trips to authenticated;
grant all on public.market_trips to service_role;
create policy "household members read market trips" on public.market_trips
  for select to authenticated
  using (household_id = (select public.current_household_id()));

-- O registro dos avisos, de onde o limite das 24 horas é contado: uma linha por
-- ida nova, sem ligação com a lista. As idas somem com a lista (o FK acima),
-- e contar por elas deixaria a pessoa avisar sem limite, apagando a lista a
-- cada aviso. Aqui só fica o que tem menos de 24 horas (cada aviso tira o
-- resto). Só announce_market_trip lê e grava: sem policy e sem permissão
-- para quem usa o app.
create table public.market_trip_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index market_trip_log_household_idx on public.market_trip_log (household_id, user_id);
-- Para cada aviso tirar o que já fez 24 horas, de todas as casas, sem ler o registro inteiro.
create index market_trip_log_created_idx on public.market_trip_log (created_at);
alter table public.market_trip_log enable row level security;
revoke all on public.market_trip_log from anon, authenticated;
grant all on public.market_trip_log to service_role;

-- Os avisos de uma ida na fila (data.reminder = 'ida:<id>'), achados pelo índice: encerrar, avisar de
-- novo, sair da casa e arquivar ou apagar a lista tiram da fila os avisos de uma ida sem ler a agenda
-- inteira de todos os navegadores. Só as linhas postas pelo servidor entram nele; as buscas repetem o
-- `data ? 'server'` do índice, que é o que deixa o planejador usá-lo.
create index push_schedule_server_reminder_idx on public.push_schedule ((data ->> 'reminder')) where data ? 'server';

/**
 * Um nome guardado no banco, pronto para ir num aviso: numa linha só, sem
 * caracteres de controle, sem os que invertem a direção do texto e sem os
 * que não aparecem, e cortado. O nome em que não sobra nada que se veja
 * volta vazio, e quem chama põe outro texto no lugar.
 *
 * As classes vão escritas só com escapes (\uXXXX): nenhum caractere
 * invisível ou de direção fica solto neste arquivo, onde um editor poderia
 * tirá-lo sem ninguém ver. Viram espaço: os controles (U+0001–001F,
 * U+007F–009F) e os separadores de linha (U+2028, U+2029); os espaços que
 * não são o comum (o U+00A0 de propósito: o \s não o pega em todo locale;
 * U+1680, U+2000–200A, U+202F, U+205F, U+3000); o hífen que não aparece
 * (U+00AD); as marcas de direção (U+061C, U+200E, U+200F, U+202A–202E,
 * U+2066–206F); os de largura zero (U+180E, U+200B, U+2060–2064, U+FEFF);
 * os preenchimentos em branco (U+115F, U+1160, U+2800, U+3164, U+FFA0); e
 * outros que nunca são parte de uma letra (U+034F, U+17B4, U+17B5,
 * U+FFF0–FFFC e os controles de formato U+1BCA0–1BCA3, U+1D159 e
 * U+1D173–1D17A).
 *
 * O U+200C e o U+200D ficam: são eles que seguram juntas as sequências de
 * emoji (a família, a profissão). Ficam também os seletores de variação
 * (U+FE00–FE0F; U+180B–180F, do mongol; U+E0100–E01EF, dos ideogramas), as
 * marcas que se combinam com a letra de antes (U+0300–036F, U+1AB0–1AFF,
 * U+1DC0–1DFF, U+20D0–20FF, U+FE20–FE2F) e os caracteres de etiqueta
 * (U+E0000–E007F, das bandeiras): dentro de um nome de verdade eles são
 * parte da letra, e virar espaço partiria o nome. Sozinhos não fazem um
 * nome, e é o que a conta de fora olha: tirando os espaços e todos esses,
 * se não sobra nada, o nome é vazio.
 */
create function public.push_text(p_text text, p_max int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when regexp_replace(
      c.clean,
      '[ \u0300-\u036F\u180B-\u180F\u1AB0-\u1AFF\u1DC0-\u1DFF\u200C\u200D\u20D0-\u20FF\uFE00-\uFE0F\uFE20-\uFE2F\U000E0000-\U000E007F\U000E0100-\U000E01EF]+',
      '', 'g'
    ) = '' then ''
    else c.clean
  end
  from (
    select rtrim(left(btrim(regexp_replace(
      regexp_replace(
        coalesce(p_text, ''),
        '[\u0001-\u001F\u007F-\u009F\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u17B4\u17B5\u180E\u2000-\u200B\u200E\u200F\u2028-\u202F\u205F-\u206F\u2800\u3000\u3164\uFEFF\uFFA0\uFFF0-\uFFFC\U0001BCA0-\U0001BCA3\U0001D159\U0001D173-\U0001D17A]+',
        ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )), p_max)) as clean
  ) c;
$$;
revoke execute on function public.push_text(text, int) from public, anon, authenticated;

-- Até quantas idas novas uma pessoa avisa por casa em 24 horas.
create function public.max_market_trips()
returns int
language sql
immutable
set search_path = ''
as $$ select 5 $$;
revoke execute on function public.max_market_trips() from public, anon;
grant execute on function public.max_market_trips() to authenticated;

/**
 * Avisa a casa aberta que a pessoa está saindo para as compras da lista.
 * Devolve a ida (trip_id, created_at), quantos dos outros moradores tiveram
 * aviso posto na fila (notified), quantos outros moradores a casa tem
 * (members) e se a casa já tinha sido avisada (repeated).
 *
 * Contra barulho: a mesma pessoa e a mesma lista, com a ida ainda valendo e
 * avisada há menos de 30 minutos, devolve a ida que existe e não manda nada;
 * e cada pessoa avisa até max_market_trips() idas novas por casa em 24 horas
 * (depois disso, NK005), contadas em market_trip_log. Passados os 30 minutos,
 * a ida nova encerra a anterior da pessoa na mesma lista.
 */
create function public.announce_market_trip(p_list_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid := public.current_household_id();
  list public.shopping_lists;
  trip public.market_trips;
  sub record;
  others int;
  notified uuid[] := '{}';
  who text;
  list_name text;
  house text;
  title text;
  body text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if hid is null then
    raise exception 'sem casa' using errcode = '42501';
  end if;
  -- A lista é da casa aberta (a de outra casa da pessoa também não serve). Conferida já, sem esperar as
  -- travas abaixo; depois delas, de novo.
  select * into list from public.shopping_lists l
    where l.id = p_list_id and l.household_id = hid and l.archived_at is null;
  if not found then
    raise exception 'list not found' using errcode = 'P0002';
  end if;
  -- Um aviso por vez por pessoa: dois toques juntos não criam duas idas nem passam do limite.
  perform pg_advisory_xact_lock(hashtextextended('market_trips:' || auth.uid()::text, 0));
  -- E um de cada vez com a saída de um morador (leave_household e remove_member seguram a linha da casa
  -- com FOR UPDATE): quem sai neste instante não é lido como morador aqui para ganhar o aviso depois de a
  -- limpeza dele (member_left_market_trips) já ter passado. A gravação da ida já segurava a casa pela chave
  -- estrangeira; aqui a espera vem antes de contar os moradores, e não depende disso. FOR SHARE: espera
  -- quem está saindo sem travar as outras gravações da casa. Com a casa na mão, quem avisa tem de
  -- continuar nela.
  perform 1 from public.households h where h.id = hid for share;
  if not exists (select 1 from public.household_members m where m.household_id = hid and m.user_id = auth.uid()) then
    raise exception 'sem casa' using errcode = '42501';
  end if;
  -- A lista de novo, agora travada (as travas sempre nesta ordem: a da pessoa, a casa, a lista): outro
  -- aparelho pode tê-la arquivado depois da leitura de cima. FOR SHARE espera o arquivamento em curso
  -- terminar e lê a linha como ficou; e, até este aviso terminar, a lista não é arquivada.
  select * into list from public.shopping_lists l
    where l.id = p_list_id and l.household_id = hid and l.archived_at is null
    for share;
  if not found then
    raise exception 'list not found' using errcode = 'P0002';
  end if;

  select count(*) into others from public.household_members m
    where m.household_id = hid and m.user_id <> auth.uid();
  -- Sozinha na casa (o app nem mostra o botão): não há quem avisar.
  if others = 0 then
    return jsonb_build_object('trip_id', null, 'created_at', null, 'notified', 0, 'members', 0, 'repeated', false);
  end if;

  select * into trip from public.market_trips t
    where t.household_id = hid and t.list_id = p_list_id and t.user_id = auth.uid()
      and t.ended_at is null and t.created_at > now() - interval '30 minutes'
    order by t.created_at desc
    limit 1;
  if found then
    return jsonb_build_object('trip_id', trip.id, 'created_at', trip.created_at, 'notified', 0, 'members', others, 'repeated', true);
  end if;

  -- O limite das 24 horas, pelo registro (que não some com a lista): primeiro sai
  -- o que já fez 24 horas, de qualquer casa, e o que sobra da pessoa nesta
  -- casa é o que conta.
  delete from public.market_trip_log g where g.created_at <= now() - interval '24 hours';
  if (
    select count(*) from public.market_trip_log g where g.household_id = hid and g.user_id = auth.uid()
  ) >= public.max_market_trips() then
    raise exception 'too many market trips' using errcode = 'NK005';
  end if;

  -- Não há histórico de idas: as antigas da casa saem.
  delete from public.market_trips t where t.household_id = hid and t.created_at < now() - interval '7 days';

  -- Sem nada que se veja no nome (push_text devolve vazio), o aviso não sai com o título em branco.
  select coalesce(nullif(public.push_text(m.display_name, 40), ''), 'Alguém da casa') into who
    from public.household_members m
    where m.household_id = hid and m.user_id = auth.uid();
  insert into public.market_trips (household_id, list_id, user_id, display_name, ends_at)
  values (hid, p_list_id, auth.uid(), who, now() + interval '2 hours')
  returning * into trip;
  insert into public.market_trip_log (household_id, user_id) values (hid, auth.uid());

  title := who || case when list.kind = 'mercado' then ' está indo ao mercado' else ' está indo às compras' end;
  -- Com o nome da lista entre aspas; a lista sem nada que se veja no nome fica sem ele.
  list_name := public.push_text(list.name, 60);
  body := 'Falta alguma coisa? Ponha na lista ' || case when list_name = '' then '' else '“' || list_name || '” ' end || 'agora.';
  select coalesce(nullif(public.push_text(h.name, 40), ''), 'Casa') into house from public.households h where h.id = hid;

  -- Só quem mora na casa agora, menos quem avisou, nos navegadores que
  -- querem este aviso. A casa vai na linha (householdId), como nos lembretes:
  -- quem sai da casa ou é tirado dela perde na hora o que ainda não saiu
  -- (member_left_market_trips, abaixo). Para quem mora em mais de uma casa, o
  -- título diz de qual é, também como nos lembretes.
  -- FOR SHARE nas inscrições: quem desliga a opção neste instante
  -- (set_push_market_trips) não fica com o aviso. Se o desligar veio antes, a
  -- leitura espera ele terminar, relê a linha já desligada e deixa o navegador
  -- de fora; se este aviso travou antes, o desligar espera ele terminar e apaga
  -- da fila o que entrou. A ordem das travas é a das outras gravações da
  -- agenda: a inscrição antes das linhas dela.
  for sub in
    select s.id, s.user_id,
      (select count(*) from public.household_members o where o.user_id = s.user_id) > 1 as several
    from public.push_subscriptions s
    join public.household_members m on m.user_id = s.user_id
    where m.household_id = hid and s.user_id <> auth.uid() and s.market_trips
    for share of s
  loop
    begin
      insert into public.push_schedule (id, subscription_id, title, body, data, repeat, fire_at)
      values (
        gen_random_uuid(), sub.id, case when sub.several then title || ' · ' || house else title end, body,
        jsonb_build_object('reminder', 'ida:' || trip.id::text, 'server', true, 'householdId', hid),
        'once', now()
      );
      if not (sub.user_id = any (notified)) then
        notified := notified || sub.user_id;
      end if;
    exception when sqlstate 'NK003' or foreign_key_violation then
      -- A agenda deste navegador está cheia (NK003), ou a inscrição dele
      -- sumiu entre a leitura acima e esta gravação (a pessoa saiu da conta
      -- neste instante, ou o serviço de push recusou o endereço): o único FK
      -- de push_schedule é o da inscrição. Este navegador fica sem o aviso e
      -- os outros recebem; notified só conta quem teve a linha gravada.
      null;
    end;
  end loop;

  -- A ida anterior da pessoa nesta lista, se ainda vale (avisada há mais de 30 minutos), acaba aqui, com
  -- os avisos dela que não saíram (como em end_market_trip): a faixa mostra só a mais nova, e "Encerrar"
  -- nela deixaria a antiga de volta até o fim das 2 horas. Vem depois do laço, e não antes da ida nova,
  -- para travar as inscrições antes das linhas da agenda: na ordem contrária, este aviso e alguém
  -- desligando a opção (que trava a inscrição e depois apaga o aviso) podiam esperar um pelo outro.
  with ended as (
    update public.market_trips t set ended_at = now()
      where t.household_id = hid and t.list_id = p_list_id and t.user_id = auth.uid()
        and t.ended_at is null and t.id <> trip.id
    returning t.id
  )
  delete from public.push_schedule p
    using ended e
    where p.data ? 'server' and p.data ->> 'reminder' = 'ida:' || e.id::text;

  return jsonb_build_object(
    'trip_id', trip.id, 'created_at', trip.created_at,
    'notified', coalesce(array_length(notified, 1), 0), 'members', others, 'repeated', false
  );
end;
$$;

/**
 * Encerra a ida para a casa toda. Só quem avisou; devolve se encerrou. Os
 * avisos dela que ainda não saíram deixam a fila.
 */
create function public.end_market_trip(p_trip_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.market_trips t set ended_at = now()
    where t.id = p_trip_id and t.user_id = auth.uid() and t.ended_at is null;
  if not found then
    return false;
  end if;
  delete from public.push_schedule p
    where p.data ? 'server' and p.data ->> 'reminder' = 'ida:' || p_trip_id::text;
  return true;
end;
$$;

/**
 * Quem sai da casa (leave_household) ou é tirado dela (remove_member) não
 * fica na faixa como "está indo ao mercado": a ida da pessoa naquela casa
 * acaba para todos, com os avisos dela que ainda não saíram (como em
 * end_market_trip). Sem isto ela ficaria até o fim das 2 horas, porque só
 * quem avisou encerra, e essa pessoa não abre mais a casa. E a pessoa deixa
 * de receber os avisos dessa casa: o que o servidor pôs na fila dos
 * navegadores dela e ainda não saiu (a ida de alguém, avisada um instante
 * antes) sai da fila. O que é das outras casas dela fica.
 *
 * Num gatilho da linha de morador, e não dentro das duas funções: vale nos
 * dois caminhos sem recriá-las.
 */
create function public.member_left_market_trips()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  with ended as (
    update public.market_trips t set ended_at = now()
      where t.household_id = old.household_id and t.user_id = old.user_id and t.ended_at is null
    returning t.id
  )
  delete from public.push_schedule p
    using ended e
    where p.data ? 'server' and p.data ->> 'reminder' = 'ida:' || e.id::text;
  delete from public.push_schedule p
    using public.push_subscriptions s
    where p.subscription_id = s.id and s.user_id = old.user_id
      and p.data ? 'server' and p.data ->> 'householdId' = old.household_id::text;
  return null;
end;
$$;
revoke execute on function public.member_left_market_trips() from public, anon, authenticated;

create trigger household_members_end_market_trips
  after delete on public.household_members
  for each row execute function public.member_left_market_trips();

/**
 * A lista arquivada leva as idas dela: elas acabam para todos, com os avisos
 * que ainda não saíram (como em end_market_trip). O app não mostra a ida de
 * lista arquivada, e quem avisou ficaria sem o "Encerrar" para tirar da fila
 * um aviso que sairia com o nome de uma lista fechada. Arquivar é uma gravação
 * direta do app (também das versões já instaladas), por isso um gatilho; e só
 * na passagem de aberta para arquivada: renomear ou desarquivar não mexe nas
 * idas. Os avisos vêm depois das idas, na ordem de end_market_trip.
 */
create function public.list_archived_market_trips()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  with ended as (
    update public.market_trips t set ended_at = now()
      where t.list_id = new.id and t.household_id = new.household_id and t.ended_at is null
    returning t.id
  )
  delete from public.push_schedule p
    using ended e
    where p.data ? 'server' and p.data ->> 'reminder' = 'ida:' || e.id::text;
  return null;
end;
$$;
revoke execute on function public.list_archived_market_trips() from public, anon, authenticated;

create trigger shopping_lists_end_market_trips
  after update of archived_at on public.shopping_lists
  for each row when (old.archived_at is null and new.archived_at is not null)
  execute function public.list_archived_market_trips();

/**
 * A ida que sai do banco leva da fila os avisos dela que ainda não saíram. A
 * lista apagada leva as idas (o FK em cascata), e os avisos, que se ligam à
 * ida só pelo data.reminder, ficariam na fila sem ida nenhuma: sairiam com o
 * nome de uma lista que não existe mais. Vale para qualquer ida que sai (a
 * limpeza das antigas em announce_market_trip, a casa apagada).
 */
create function public.market_trip_gone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.push_schedule p
    where p.data ? 'server' and p.data ->> 'reminder' = 'ida:' || old.id::text;
  return null;
end;
$$;
revoke execute on function public.market_trip_gone() from public, anon, authenticated;

create trigger market_trips_gone
  after delete on public.market_trips
  for each row execute function public.market_trip_gone();

/**
 * Liga ou desliga "Alguém indo ao mercado" num navegador da própria pessoa
 * (o endereço de outra conta não muda nada). Devolve se mudou algum.
 * Desligando, o aviso de ida que estava na fila deste navegador sai, também o
 * de um aviso feito no mesmo instante (announce_market_trip trava a
 * inscrição que lê: um dos dois espera o outro, e o desligar vale).
 */
create function public.set_push_market_trips(p_endpoint text, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub uuid;
begin
  update public.push_subscriptions s set market_trips = coalesce(p_enabled, true)
    where s.endpoint = p_endpoint and s.user_id = auth.uid()
    returning s.id into sub;
  if sub is null then
    return false;
  end if;
  if not coalesce(p_enabled, true) then
    delete from public.push_schedule p
      where p.subscription_id = sub and p.data ? 'server' and p.data ->> 'reminder' like 'ida:%';
  end if;
  return true;
end;
$$;

/**
 * Inscreve este navegador já com a escolha dele para "Alguém indo ao
 * mercado" (p_market_trips): o navegador em que a pessoa desligou a opção (o
 * app guarda isso nele) ganha a inscrição nova já desligada, no mesmo pedido.
 * Com um segundo pedido para desligar, a inscrição nova ficava ligada no
 * meio, e assim seguia se esse pedido se perdesse. Só a linha que esta
 * chamada cria nasce com a escolha: a que já existia fica como está, porque o
 * valor do navegador pode ser velho e a escolha guardada aqui, mais nova. Sem
 * valor padrão em p_market_trips: com ele, a chamada com os quatro nomes (a
 * dos apps já instalados) ficaria ambígua no PostgREST.
 */
create function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_timezone text, p_market_trips boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  before uuid;
  sub uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_push_endpoint(p_endpoint) then
    raise exception 'invalid push endpoint' using errcode = '22023';
  end if;
  -- A trava da inscrição de quatro argumentos, que ela pega de novo (na mesma transação, passa direto):
  -- entre olhar a linha e a inscrição terminar, nenhuma outra inscrição desta conta entra no meio.
  perform pg_advisory_xact_lock(hashtextextended('push_subscriptions:' || auth.uid()::text, 0));
  select s.id into before from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = auth.uid();
  sub := public.register_push_subscription(p_endpoint, p_p256dh, p_auth, p_timezone);
  -- Outro id é linha criada agora (não havia, era de outra conta ou foi apagada no meio): só ela recebe a escolha.
  if sub is distinct from before and p_market_trips is false then
    update public.push_subscriptions s set market_trips = false where s.id = sub;
  end if;
  return sub;
end;
$$;

-- Cada navegador tira da agenda dele, ao abrir o app, o que não conhece
-- (prune_push_schedule, chamada por reconcileReminders): o aviso de ida, que
-- o servidor pôs ali e o navegador nunca viu, sairia antes de ser enviado.
-- As linhas postas pelo servidor (data.server) ficam de fora da poda. O
-- próprio navegador também pode gravar uma linha com data.server (a policy
-- de insert aceita qualquer data): isso só mexe na agenda dele mesmo, e a
-- linha continua contando para o teto de max_push_schedule().
create or replace function public.prune_push_schedule(p_subscription_id uuid, p_keep uuid[])
returns int
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.push_schedule p
    using public.push_subscriptions s
    where s.id = p_subscription_id and s.user_id = auth.uid()
      and p.subscription_id = s.id and not (p.id = any (coalesce(p_keep, '{}')))
      and not (p.data ? 'server')
    returning p.id
  )
  select count(*)::int from gone;
$$;

revoke execute on function public.announce_market_trip(uuid) from public, anon;
revoke execute on function public.end_market_trip(uuid) from public, anon;
revoke execute on function public.set_push_market_trips(text, boolean) from public, anon;
revoke execute on function public.register_push_subscription(text, text, text, text, boolean) from public, anon;
grant execute on function public.announce_market_trip(uuid) to authenticated;
grant execute on function public.end_market_trip(uuid) to authenticated;
grant execute on function public.set_push_market_trips(text, boolean) to authenticated;
grant execute on function public.register_push_subscription(text, text, text, text, boolean) to authenticated;
