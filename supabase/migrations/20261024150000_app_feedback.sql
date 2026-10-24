-- Recados (feedback) para quem faz o Kotii: um problema, uma sugestão, um elogio ou outra coisa sobre o app.
--
-- 1. Quem manda é a pessoa, pelo Nuke: quando ela fala do app (e não da casa), o Nuke prepara o recado num cartão,
--    com o texto exato, e ele só vai depois do toque dela em "Enviar" (send_app_feedback). Vai o texto, o tipo, o
--    aparelho (web, ios, android) e a versão do app; nenhum dado da casa, e nenhum id de casa.
-- 2. Quem lê é só quem mantém o app, no Painel do app (aba Recados), pelas funções app_feedback_list e
--    set_app_feedback. A porta é a mesma do painel: app_admins (20261023180000_app_dashboard.sql); os outros
--    recebem 42501. O e-mail de quem mandou vem de auth.users na hora da leitura (para poder responder), não fica
--    copiado aqui.
-- 3. O recado é da conta: apagar a conta apaga os recados dela (on delete cascade de auth.users).
-- 4. Contra repetição e barulho: o mesmo texto da mesma pessoa em 10 minutos devolve o recado que já existe (a
--    resposta perdida, mandada de novo, não duplica), e cada pessoa manda até 10 recados em 24 horas (NK015).
--    As mensagens de erro são em português porque o app pode mostrá-las como vêm.

-- =============================================================================
-- Os recados
-- =============================================================================

create table public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  -- Apagar a conta apaga os recados dela.
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('problema', 'sugestao', 'elogio', 'outro')),
  message text not null check (char_length(message) between 1 and 2000 and message = btrim(message)),
  platform text check (platform in ('web', 'ios', 'android')),
  app_version text check (char_length(app_version) between 1 and 40),
  status text not null default 'novo' check (status in ('novo', 'lido', 'resolvido', 'arquivado')),
  -- A nota de quem mantém o app, só dele; nula é sem nota.
  note text check (char_length(note) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A caixa de entrada filtrada por situação, do mais novo para o mais antigo; e o limite de cada pessoa.
create index app_feedback_status_created_idx on public.app_feedback (status, created_at desc, id desc);
create index app_feedback_user_created_idx on public.app_feedback (user_id, created_at desc);

-- Sem policy e sem grant para o app: ninguém lê nem grava pela API. Só as funções abaixo (como dono). Desde
-- 30/10/2026 a Supabase não dá acesso às tabelas novas pela API: os privilégios ficam escritos aqui.
alter table public.app_feedback enable row level security;
revoke all on public.app_feedback from anon, authenticated;
grant all on public.app_feedback to service_role;

-- =============================================================================
-- Peça interna: o recado como a tela lê (sem permissão para o app; roda dentro das funções abaixo)
-- =============================================================================

-- As horas em UTC, no formato ISO 8601 (2026-10-24T17:05:00Z), o mesmo em qualquer fuso da conexão.
create function public.app_feedback_item(p_row public.app_feedback, p_email text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'created_at', to_char(p_row.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'updated_at', to_char(p_row.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'kind', p_row.kind,
    'message', p_row.message,
    'platform', p_row.platform,
    'app_version', p_row.app_version,
    'status', p_row.status,
    'note', p_row.note,
    'email', p_email
  );
$$;

revoke execute on function public.app_feedback_item(public.app_feedback, text) from public, anon, authenticated;

-- =============================================================================
-- Mandar um recado (a pessoa, depois do toque no cartão do Nuke)
-- =============================================================================

create function public.send_app_feedback(
  p_kind text,
  p_message text,
  p_platform text default null,
  p_app_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  -- Os espaços das pontas saem, quebras de linha também (como o trim do app).
  v_message text := regexp_replace(coalesce(p_message, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- Versão em branco é sem versão.
  v_version text := nullif(btrim(coalesce(p_app_version, '')), '');
  v_id uuid;
begin
  if me is null then
    raise exception 'Entre na sua conta para mandar um recado.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('problema', 'sugestao', 'elogio', 'outro') then
    raise exception 'Tipo de recado desconhecido.' using errcode = '22023';
  end if;
  if char_length(v_message) not between 1 and 2000 then
    raise exception 'O recado precisa ter de 1 a 2000 caracteres.' using errcode = '22023';
  end if;
  if p_platform is not null and p_platform not in ('web', 'ios', 'android') then
    raise exception 'Aparelho desconhecido.' using errcode = '22023';
  end if;
  if char_length(v_version) > 40 then
    raise exception 'A versão do app passa de 40 caracteres.' using errcode = '22023';
  end if;

  -- Um recado por vez por pessoa: dois toques juntos não gravam dois, nem passam do limite.
  perform pg_advisory_xact_lock(hashtextextended('app_feedback:' || me::text, 0));

  -- O mesmo texto há pouco: é o mesmo recado mandado de novo (a resposta se perdeu). Devolve o que existe.
  select f.id into v_id
  from public.app_feedback f
  where f.user_id = me and f.message = v_message and f.created_at > now() - interval '10 minutes'
  order by f.created_at desc, f.id desc
  limit 1;
  if found then
    return v_id;
  end if;

  -- Até 10 recados em 24 horas (janela que corre, não o dia do calendário).
  if (
    select count(*) from public.app_feedback f
    where f.user_id = me and f.created_at > now() - interval '24 hours'
  ) >= 10 then
    raise exception 'Você já mandou 10 recados nas últimas 24 horas. Tente de novo amanhã.' using errcode = 'NK015';
  end if;

  insert into public.app_feedback (user_id, kind, message, platform, app_version)
  values (me, p_kind, v_message, p_platform, v_version)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.send_app_feedback(text, text, text, text) from public, anon;
grant execute on function public.send_app_feedback(text, text, text, text) to authenticated;

-- =============================================================================
-- A caixa de entrada (só quem mantém o app)
-- =============================================================================

-- counts conta todos os recados, por situação (zero também); total, os do filtro; items, os p_limit mais novos do
-- filtro (de 1 a 500; nulo é 200), nunca nulo.
create function public.app_feedback_list(p_status text default null, p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 500));
begin
  if not public.is_app_admin() then
    raise exception 'Este painel é só para quem mantém o app.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('novo', 'lido', 'resolvido', 'arquivado') then
    raise exception 'Situação de recado desconhecida.' using errcode = '22023';
  end if;

  return (
    with totals as (
      select
        jsonb_build_object(
          'novo', count(*) filter (where f.status = 'novo'),
          'lido', count(*) filter (where f.status = 'lido'),
          'resolvido', count(*) filter (where f.status = 'resolvido'),
          'arquivado', count(*) filter (where f.status = 'arquivado')
        ) as counts,
        count(*) filter (where p_status is null or f.status = p_status) as total
      from public.app_feedback f
    ),
    page as (
      select coalesce(
          jsonb_agg(public.app_feedback_item(x.f, x.email) order by (x.f).created_at desc, (x.f).id desc),
          '[]'::jsonb
        ) as items
      from (
        select f, u.email
        from public.app_feedback f
        left join auth.users u on u.id = f.user_id
        where p_status is null or f.status = p_status
        order by f.created_at desc, f.id desc
        limit v_limit
      ) x
    )
    select jsonb_build_object('counts', t.counts, 'total', t.total, 'items', p.items)
    from totals t, page p
  );
end;
$$;

revoke execute on function public.app_feedback_list(text, integer) from public, anon;
grant execute on function public.app_feedback_list(text, integer) to authenticated;

-- Muda a situação e/ou a nota de um recado. Nulo é "não muda"; a nota em branco apaga a nota. Devolve o recado
-- como a lista o mostra.
create function public.set_app_feedback(p_id uuid, p_status text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := regexp_replace(coalesce(p_note, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_row public.app_feedback;
  v_email text;
begin
  if not public.is_app_admin() then
    raise exception 'Este painel é só para quem mantém o app.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('novo', 'lido', 'resolvido', 'arquivado') then
    raise exception 'Situação de recado desconhecida.' using errcode = '22023';
  end if;
  if char_length(v_note) > 2000 then
    raise exception 'A nota pode ter até 2000 caracteres.' using errcode = '22023';
  end if;

  update public.app_feedback f
  set status = coalesce(p_status, f.status),
      note = case when p_note is null then f.note else nullif(v_note, '') end,
      updated_at = now()
  where f.id = p_id
  returning f.* into v_row;
  if not found then
    raise exception 'Este recado não existe mais.' using errcode = 'P0002';
  end if;

  select u.email into v_email from auth.users u where u.id = v_row.user_id;
  return public.app_feedback_item(v_row, v_email);
end;
$$;

revoke execute on function public.set_app_feedback(uuid, text, text) from public, anon;
grant execute on function public.set_app_feedback(uuid, text, text) to authenticated;
