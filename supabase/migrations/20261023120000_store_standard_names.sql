-- O nome padrão do mercado, igual em todas as casas (pedido do dono em 22/10/2026).
--
-- O mercado chega com a razão social do CNPJ ("COMPANHIA BRASILEIRA DE
-- DISTRIBUICAO"), que ninguém reconhece. A casa já pode dar o nome que conhece
-- (20261022170000_store_printed_name.sql). Agora cada CNPJ também tem um nome
-- padrão, que vale em todas as casas que não deram outro:
--
-- 1. O nome fantasia do cadastro da Receita, consultado pela BrasilAPI (só o
--    CNPJ vai). Com nome fantasia, ele vira o nome padrão sozinho; sem ele, o
--    CNPJ fica para a revisão (decisão do dono em 22/10: "Se na nota fiscal
--    estiver o fantasia, ok, se não, revisão").
-- 2. Do cadastro de pessoa (MEI, empresário individual, EIRELI e as naturezas
--    de pessoa física) nada é guardado: a razão social é o nome da pessoa, às
--    vezes com o CPF. Esse CNPJ vai para a revisão sem nada da Receita. Sem a
--    natureza jurídica na resposta, também: não dá para saber se é pessoa.
-- 3. Quem revisa é a moderação (public.moderators, uma linha por conta; a do
--    dono entra aqui). Ela vê, de cada CNPJ, o nome e o endereço impressos nas
--    notas, o que a Receita disse, os apelidos que as casas deram (o nome e
--    quantas casas, nunca quais) e em quantas casas o mercado está; e escolhe
--    o nome padrão, ou fica com o da nota.
-- 4. O nome padrão é gravado em stores.name nas casas que não deram outro nome
--    ao mercado (stores.named_by 'nota' ou 'padrao'), e o da nota fica em
--    printed_name, como numa troca feita pela casa. Assim as telas, o Nuke e
--    as finanças mostram o nome padrão sem mudar nada nelas. O nome que a casa
--    deu ('casa') nunca é trocado. A casa que volta ao nome da nota depois que
--    o padrão existe também escolheu ('casa'); "Usar o nome padrão" (gravar o
--    nome padrão) volta a seguir o padrão.
-- 5. A consulta à Receita roda no banco: o pg_cron chama a store_names_tick()
--    a cada 10 minutos. Ela lê as respostas da volta anterior e manda até 5
--    consultas novas pelo pg_net. Erro, demora ou limite da BrasilAPI: tenta
--    de novo mais tarde, até 5 vezes; depois, revisão.
-- 6. Os preços de outras casas ("Visto em outras casas") mostram o nome padrão
--    do mercado, quando ele tem um.

-- =============================================================================
-- Moderação
-- =============================================================================

create table public.moderators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.moderators enable row level security;
revoke all on public.moderators from anon, authenticated;
grant all on public.moderators to service_role;

-- O app pergunta para mostrar (ou não) a entrada da moderação em Configurações.
create function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.moderators m where m.user_id = auth.uid());
$$;

revoke execute on function public.is_moderator() from public, anon;
grant execute on function public.is_moderator() to authenticated;

-- A conta do dono. O banco de testes não tem e-mail em auth.users.
do $$
begin
  if exists (
    select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'users' and column_name = 'email'
  ) then
    execute $q$
      insert into public.moderators (user_id)
        select u.id from auth.users u where lower(u.email) = 'andrebarbusci@gmail.com'
        on conflict (user_id) do nothing
    $q$;
  end if;
end;
$$;

-- =============================================================================
-- O nome padrão de cada CNPJ
-- =============================================================================

create table public.store_names (
  cnpj text primary key check (cnpj ~ '^[0-9]{14}$'),
  -- O nome padrão; null: nenhum (o das notas).
  name text check (name is null or (name = trim(name) and char_length(name) between 1 and 60)),
  -- 'receita': o nome fantasia, sozinho; 'revisao': a moderação escolheu (o nome, ou nenhum).
  source text check (source in ('receita', 'revisao')),
  reviewed_at timestamptz,
  -- 'pendente': a consultar; 'ok': com nome fantasia; 'sem_fantasia': sem ele, ou igual à razão social;
  -- 'pessoa': cadastro de pessoa, nada guardado; 'sem_dados': resposta sem a natureza jurídica;
  -- 'nao_achou': a BrasilAPI não tem o CNPJ; 'erro': 5 tentativas sem resposta.
  receita_status text not null default 'pendente'
    check (receita_status in ('pendente', 'ok', 'sem_fantasia', 'pessoa', 'sem_dados', 'nao_achou', 'erro')),
  receita_name text,
  receita_trade_name text,
  receita_activity text,
  attempts int not null default 0,
  next_try_at timestamptz not null default now(),
  request_id bigint,
  requested_at timestamptz,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  check (name is null or source is not null)
);

create index store_names_pending on public.store_names (next_try_at) where receita_status = 'pendente';

alter table public.store_names enable row level security;
revoke all on public.store_names from anon, authenticated;
grant all on public.store_names to service_role;
-- A casa lê só o nome padrão, e só dos CNPJs dos mercados dela (stores.standard_name, abaixo).
grant select (cnpj, name) on public.store_names to authenticated;
create policy "standard names of the household stores" on public.store_names for select to authenticated
  using (exists (
    select 1 from public.stores s
      where s.cnpj = store_names.cnpj and s.household_id = (select public.current_household_id())
  ));

-- O nome padrão junto do mercado, na mesma leitura: select=..., standard_name.
create function public.standard_name(public.stores)
returns text
language sql
stable
set search_path = ''
as $$
  select n.name from public.store_names n where n.cnpj = $1.cnpj;
$$;

revoke execute on function public.standard_name(public.stores) from public, anon;
grant execute on function public.standard_name(public.stores) to authenticated;

-- =============================================================================
-- Quem deu o nome que o mercado tem na casa
-- =============================================================================

alter table public.stores add column named_by text not null default 'nota'
  check (named_by in ('nota', 'casa', 'padrao'));

-- O mercado com nome guardado foi renomeado pela casa (antes desta migração, só ela renomeava). Roda com o
-- gatilho de antes, que só cuida de printed_name.
update public.stores set named_by = 'casa' where printed_name is not null;

insert into public.store_names (cnpj)
  select distinct s.cnpj from public.stores s where s.cnpj is not null
  on conflict (cnpj) do nothing;

-- O gatilho de 20261022170000 (o nome da nota guardado em printed_name), agora também com o nome padrão:
-- - todo CNPJ de mercado entra em store_names, para a consulta à Receita;
-- - na inclusão, o mercado de CNPJ com nome padrão já entra com ele (o da nota fica guardado);
-- - numa troca de nome, named_by diz quem deu o nome: 'padrao' quando o nome é o padrão; 'nota' quando volta ao
--   da nota e não há padrão; 'casa' no resto (também a volta ao nome da nota quando há padrão: a casa escolheu);
-- - voltar ao "CNPJ ..." (o padrão saiu de um mercado cuja nota não trouxe nome) é voltar à nota.
-- named_by e printed_name nunca são gravados direto. Roda com a permissão do dono do banco: a casa não lê
-- store_names de um CNPJ que ela ainda não tem, nem grava nela.
create or replace function public.stores_keep_printed_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  standard text;
  placeholder text := 'CNPJ ' || new.cnpj;
begin
  if new.cnpj is not null then
    insert into public.store_names (cnpj) values (new.cnpj) on conflict (cnpj) do nothing;
    select n.name into standard from public.store_names n where n.cnpj = new.cnpj;
  end if;
  if tg_op = 'INSERT' then
    new.printed_name := null;
    new.named_by := 'nota';
    if standard is not null then
      if new.name is distinct from standard and new.name is distinct from placeholder then
        new.printed_name := new.name;
      end if;
      new.name := standard;
      new.named_by := 'padrao';
    end if;
    return new;
  end if;
  if new.name is not distinct from old.name then
    new.printed_name := old.printed_name;
    new.named_by := old.named_by;
    return new;
  end if;
  if new.name = placeholder then
    new.printed_name := null;
    new.named_by := 'nota';
    return new;
  end if;
  -- O nome de antes: o guardado ou, na primeira troca, o que ele tinha.
  base := coalesce(old.printed_name, old.name);
  new.printed_name := case
    when new.name = base then null
    when old.cnpj is not null and base = 'CNPJ ' || old.cnpj then null
    else base
  end;
  new.named_by := case
    when new.name = standard then 'padrao'
    when new.name = base and standard is null then 'nota'
    else 'casa'
  end;
  return new;
end;
$$;

revoke execute on function public.stores_keep_printed_name() from public, anon, authenticated;

-- Grava o nome padrão do CNPJ nos mercados das casas que não deram outro nome; sem padrão, os que seguiam o
-- padrão voltam ao nome da nota (ou ao "CNPJ ...", quando a nota não trouxe nome).
create function public.apply_store_name(p_cnpj text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  standard text;
begin
  select n.name into standard from public.store_names n where n.cnpj = p_cnpj;
  if standard is not null then
    update public.stores s set name = standard
      where s.cnpj = p_cnpj and s.named_by in ('nota', 'padrao') and s.name is distinct from standard;
  else
    update public.stores s set name = coalesce(s.printed_name, 'CNPJ ' || s.cnpj)
      where s.cnpj = p_cnpj and s.named_by = 'padrao';
  end if;
end;
$$;

revoke execute on function public.apply_store_name(text) from public, anon, authenticated;

-- =============================================================================
-- A consulta à Receita (BrasilAPI)
-- =============================================================================

-- Um nome do cadastro, limpo: sem espaços repetidos, com alguma letra e no tamanho. null: não serve.
create function public.receita_clean(p text, p_max int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when c is null or c !~ '[[:alpha:]]' or char_length(c) > p_max then null else c end
    from (select nullif(trim(regexp_replace(coalesce(p, ''), '[[:space:]]+', ' ', 'g')), '') as c) x;
$$;

revoke execute on function public.receita_clean(text, int) from public, anon, authenticated;

-- A resposta da BrasilAPI para um CNPJ: p_status é o código HTTP (0: sem resposta). Com nome fantasia de uma
-- empresa, e sem revisão da moderação, ele vira o nome padrão e vai para os mercados.
create function public.record_receita_answer(p_cnpj text, p_status int, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.store_names;
  body jsonb;
  code int;
  person boolean;
  legal text;
  trade text;
  status text;
begin
  select * into v_row from public.store_names n where n.cnpj = p_cnpj for update;
  if not found then
    return;
  end if;

  if p_status = 200 then
    begin
      body := p_body::jsonb;
    exception when others then
      body := null;
    end;
  end if;

  if p_status = 200 and jsonb_typeof(body) = 'object' then
    code := case
      when jsonb_typeof(body -> 'codigo_natureza_juridica') = 'number'
        or (body ->> 'codigo_natureza_juridica') ~ '^[0-9]{1,4}$'
        then (body ->> 'codigo_natureza_juridica')::numeric::int
    end;
    -- Pessoa: MEI; empresário individual (2135); EIRELI (2305, 2313); sociedade unipessoal de advocacia (2321);
    -- e todo o grupo 4, pessoas físicas.
    person := (jsonb_typeof(body -> 'opcao_pelo_mei') = 'boolean' and (body ->> 'opcao_pelo_mei')::boolean)
      or code in (2135, 2305, 2313, 2321)
      or code between 4000 and 4999;
    if person then
      update public.store_names
        set receita_status = 'pessoa', receita_name = null, receita_trade_name = null, receita_activity = null,
            checked_at = now(), request_id = null, requested_at = null
        where cnpj = p_cnpj;
      return;
    end if;
    if code is null then
      update public.store_names
        set receita_status = 'sem_dados', receita_name = null, receita_trade_name = null, receita_activity = null,
            checked_at = now(), request_id = null, requested_at = null
        where cnpj = p_cnpj;
      return;
    end if;
    legal := public.receita_clean(body ->> 'razao_social', 150);
    trade := public.receita_clean(body ->> 'nome_fantasia', 150);
    -- O nome fantasia igual à razão social não diz nada novo; longo demais não cabe no nome do mercado.
    status := case
      when trade is null then 'sem_fantasia'
      when legal is not null and public.normalize_alias(trade) = public.normalize_alias(legal) then 'sem_fantasia'
      when char_length(trade) > 60 then 'sem_fantasia'
      else 'ok'
    end;
    update public.store_names
      set receita_status = status, receita_name = legal, receita_trade_name = trade,
          receita_activity = public.receita_clean(body ->> 'cnae_fiscal_descricao', 200),
          checked_at = now(), request_id = null, requested_at = null
      where cnpj = p_cnpj;
    if status = 'ok' and v_row.reviewed_at is null then
      update public.store_names set name = trade, source = 'receita' where cnpj = p_cnpj;
      perform public.apply_store_name(p_cnpj);
    end if;
    return;
  end if;

  if p_status in (400, 404) then
    update public.store_names
      set receita_status = 'nao_achou', checked_at = now(), request_id = null, requested_at = null
      where cnpj = p_cnpj;
    return;
  end if;

  -- Sem resposta, limite (429), erro do servidor ou resposta que não é JSON: mais tarde, até 5 tentativas.
  update public.store_names
    set receita_status = case when v_row.attempts >= 5 then 'erro' else 'pendente' end,
        next_try_at = now() + make_interval(hours => greatest(v_row.attempts, 1) * greatest(v_row.attempts, 1)),
        checked_at = now(), request_id = null, requested_at = null
    where cnpj = p_cnpj;
end;
$$;

revoke execute on function public.record_receita_answer(text, int, text) from public, anon, authenticated;

-- Chamada pelo pg_cron: lê as respostas que chegaram (o pg_net as guarda por algumas horas) e manda até 5
-- consultas novas. A resposta que não chegou em 1 hora conta como sem resposta.
create function public.store_names_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  answer record;
begin
  for r in select n.cnpj, n.request_id, n.requested_at from public.store_names n where n.request_id is not null loop
    select h.status_code, h.content, h.timed_out into answer from net._http_response h where h.id = r.request_id;
    if found then
      perform public.record_receita_answer(
        r.cnpj,
        case when coalesce(answer.timed_out, false) then 0 else coalesce(answer.status_code, 0) end,
        answer.content
      );
    elsif r.requested_at < now() - interval '1 hour' then
      perform public.record_receita_answer(r.cnpj, 0, null);
    end if;
  end loop;

  for r in
    select n.cnpj from public.store_names n
      where n.receita_status = 'pendente' and n.request_id is null and n.next_try_at <= now()
      order by n.next_try_at, n.cnpj
      limit 5
  loop
    update public.store_names
      set request_id = net.http_get(
            url := 'https://brasilapi.com.br/api/cnpj/v1/' || r.cnpj,
            headers := jsonb_build_object('Accept', 'application/json'),
            timeout_milliseconds := 15000
          ),
          requested_at = now(),
          attempts = attempts + 1
      where cnpj = r.cnpj;
  end loop;
end;
$$;

revoke execute on function public.store_names_tick() from public, anon, authenticated;

-- =============================================================================
-- A tela da moderação
-- =============================================================================

-- Os CNPJs dos mercados das casas, com o que a moderação precisa para escolher o nome. Os apelidos vêm só com o
-- nome e quantas casas o deram; o nome da nota e o endereço, o mais comum entre as casas.
create function public.store_names_for_review()
returns table (
  cnpj text,
  name text,
  source text,
  reviewed_at timestamptz,
  receita_status text,
  receita_name text,
  receita_trade_name text,
  receita_activity text,
  note_name text,
  address text,
  households int,
  nicknames jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_moderator() then
    raise exception 'Só a moderação vê os nomes dos mercados.' using errcode = '42501';
  end if;
  return query
    select n.cnpj, n.name, n.source, n.reviewed_at, n.receita_status, n.receita_name, n.receita_trade_name,
      n.receita_activity,
      (select x.note
         from (
           select case when s.printed_name is not null then s.printed_name when s.named_by <> 'padrao' then s.name end as note
             from public.stores s where s.cnpj = n.cnpj
         ) x
         where x.note is not null and x.note <> 'CNPJ ' || n.cnpj
         group by x.note order by count(*) desc, x.note limit 1),
      (select s.address from public.stores s
         where s.cnpj = n.cnpj and nullif(trim(s.address), '') is not null
         group by s.address order by count(*) desc, s.address limit 1),
      (select count(*)::int from public.stores s where s.cnpj = n.cnpj),
      coalesce((
        select jsonb_agg(jsonb_build_object('name', k.name, 'households', k.households) order by k.households desc, k.name)
          from (
            select min(s.name) as name, count(*)::int as households
              from public.stores s
              where s.cnpj = n.cnpj and s.named_by = 'casa' and s.printed_name is not null
              group by lower(s.name)
          ) k
      ), '[]'::jsonb)
    from public.store_names n
    where exists (select 1 from public.stores s where s.cnpj = n.cnpj)
    order by n.cnpj;
end;
$$;

revoke execute on function public.store_names_for_review() from public, anon;
grant execute on function public.store_names_for_review() to authenticated;

-- A moderação escolhe o nome padrão do CNPJ; vazio: fica o nome da nota. Vale para sempre (a Receita não muda
-- mais esse CNPJ) e vai já para os mercados das casas que não deram outro nome.
create function public.review_store_name(p_cnpj text, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(trim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g')), '');
begin
  if not public.is_moderator() then
    raise exception 'Só a moderação muda o nome dos mercados.' using errcode = '42501';
  end if;
  if char_length(cleaned) > 60 then
    raise exception 'Use até 60 letras.' using errcode = '22001';
  end if;
  update public.store_names set name = cleaned, source = 'revisao', reviewed_at = now() where cnpj = p_cnpj;
  if not found then
    raise exception 'Mercado não encontrado.' using errcode = 'P0002';
  end if;
  perform public.apply_store_name(p_cnpj);
end;
$$;

revoke execute on function public.review_store_name(text, text) from public, anon;
grant execute on function public.review_store_name(text, text) to authenticated;

-- Consultar a Receita de novo (depois de um erro, ou de o cadastro mudar). O nome escolhido na revisão fica.
create function public.lookup_store_name_again(p_cnpj text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_moderator() then
    raise exception 'Só a moderação consulta a Receita.' using errcode = '42501';
  end if;
  update public.store_names
    set receita_status = 'pendente', attempts = 0, next_try_at = now(), request_id = null, requested_at = null
    where cnpj = p_cnpj;
  if not found then
    raise exception 'Mercado não encontrado.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.lookup_store_name_again(text) from public, anon;
grant execute on function public.lookup_store_name_again(text) to authenticated;

-- =============================================================================
-- Os preços de outras casas com o nome padrão
-- =============================================================================

-- A shared_latest_prices de 20261014120000_shared_prices.sql, igual, com o nome padrão do mercado no lugar do
-- impresso, quando ele tem um.
create or replace function public.shared_latest_prices()
returns table (
  product_id uuid,
  store_cnpj text,
  store_name text,
  store_uf text,
  unit text,
  unit_price numeric,
  seen_on date,
  mine boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select h.id, (now() at time zone 'America/Sao_Paulo')::date as today
      from (select public.current_household_id() as id) h
      where exists (select 1 from public.receipts r where r.household_id = h.id and r.status = 'confirmed')
  ),
  my_stores as (
    select s.cnpj
      from public.stores s
      where s.household_id = (select id from me) and s.cnpj is not null
  ),
  my_states as (
    select distinct substr(r.access_key, 1, 2) as uf
      from public.receipts r
      where r.household_id = (select id from me)
        and r.status = 'confirmed' and r.source in ('qrcode', 'ai') and r.access_key is not null
  ),
  -- Nos mercados da casa: pela chave primária (mercado, item), com ou sem estado na linha.
  mine as (
    select distinct on (a.product_id, p.store_cnpj, p.unit)
      a.product_id, p.store_cnpj, p.store_name, p.store_uf, p.unit, p.unit_price, p.seen_on
      from public.product_aliases a
      cross join my_stores m
      join public.shared_prices p on p.store_cnpj = m.cnpj and p.item_key = a.alias
      where a.household_id = (select id from me)
        and p.seen_on >= (select today from me) - 90 and p.seen_on < (select today from me)
        and p.visible_on <= (now() at time zone 'America/Sao_Paulo')::date
      -- Duas descrições do mesmo produto no mesmo dia: a mais barata, sempre a mesma.
      order by a.product_id, p.store_cnpj, p.unit, p.seen_on desc, p.unit_price, p.item_key
  ),
  -- Nos outros: só linhas com o estado da casa (o índice é por item e estado), a mais recente de cada mercado.
  others as (
    select distinct on (a.product_id, p.store_cnpj, p.unit)
      a.product_id, p.store_cnpj, p.store_name, p.store_uf, p.unit, p.unit_price, p.seen_on
      from public.product_aliases a
      join public.shared_prices p on p.item_key = a.alias
      where a.household_id = (select id from me)
        and p.store_uf in (select uf from my_states)
        and not exists (select 1 from my_stores m where m.cnpj = p.store_cnpj)
        and p.seen_on >= (select today from me) - 90 and p.seen_on < (select today from me)
        and p.visible_on <= (now() at time zone 'America/Sao_Paulo')::date
      order by a.product_id, p.store_cnpj, p.unit, p.seen_on desc, p.unit_price, p.item_key
  ),
  ranked as (
    select o.*, row_number() over (partition by o.product_id, o.unit order by o.unit_price, o.seen_on desc, o.store_cnpj) as place
      from others o
  )
  select m.product_id, m.store_cnpj,
      coalesce((select n.name from public.store_names n where n.cnpj = m.store_cnpj), m.store_name),
      m.store_uf, m.unit, m.unit_price, m.seen_on, true
    from mine m
    -- O preço próprio da casa é o de price_observations (nota confirmada, de qualquer origem, com produto e
    -- mercado), lido aqui a partir das notas DA CASA, que têm índice.
    where not exists (
      select 1
        from public.receipts r
        join public.stores s on s.id = r.store_id and s.household_id = r.household_id
        join public.receipt_items ri on ri.receipt_id = r.id and ri.household_id = r.household_id
        where r.household_id = (select id from me)
          and r.status = 'confirmed'
          and s.cnpj = m.store_cnpj
          and ri.product_id = m.product_id
          -- Zero não é preço (a compra "sem valor"): não esconde nada, como nos outros leitores de preço.
          and ri.unit_price > 0
          and (r.purchased_at at time zone 'America/Sao_Paulo')::date >= m.seen_on
    )
  union all
  select r.product_id, r.store_cnpj,
      coalesce((select n.name from public.store_names n where n.cnpj = r.store_cnpj), r.store_name),
      r.store_uf, r.unit, r.unit_price, r.seen_on, false
    from ranked r
    where r.place <= 5;
$$;

revoke execute on function public.shared_latest_prices() from public, anon;
grant execute on function public.shared_latest_prices() to authenticated;

-- =============================================================================
-- Agenda
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise warning 'Sem o pg_net, a consulta do nome dos mercados à Receita não roda: todo CNPJ fica para a revisão';
    return;
  end if;
  perform cron.schedule('store-names', '*/10 * * * *', 'select public.store_names_tick()');
end;
$$;
