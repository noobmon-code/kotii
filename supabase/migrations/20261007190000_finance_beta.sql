-- Consultor financeiro (beta). Os extratos dos bancos (Pluggy, pelos itens do
-- MeuPluggy) ficam em tabelas privadas de uma pessoa numa casa: o resto da
-- casa (cônjuge, outros moradores) nunca vê. "Modo sombra": as tabelas do
-- financeiro (contas, pagamentos, gastos, orçamento) não mudam; o app só lê
-- os dados do banco e sugere. Quem grava é a função finance, com a chave de
-- serviço; o app só lê, e só com a liberação (beta_access) na casa aberta.
--
-- Liberar é manual, pelo editor SQL do Supabase (a pessoa precisa ser
-- moradora da casa):
--   insert into public.beta_access (user_id, household_id, feature)
--   values ('<id da pessoa>', '<id da casa>', 'finance');
-- Tirar também (os bancos dela naquela casa saem junto, com contas e
-- lançamentos):
--   delete from public.beta_access
--   where user_id = '<id da pessoa>' and household_id = '<id da casa>' and feature = 'finance';

-- =============================================================================
-- Liberação do beta
-- =============================================================================

create table public.beta_access (
  user_id uuid not null,
  household_id uuid not null,
  feature text not null check (feature in ('finance')),
  granted_at timestamptz not null default now(),
  primary key (user_id, household_id, feature),
  -- Saiu da casa: perde a liberação junto.
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);

-- A pessoa vê só as próprias liberações; ninguém se libera pelo app.
alter table public.beta_access enable row level security;
revoke all on public.beta_access from anon, authenticated;
grant select on public.beta_access to authenticated;
grant all on public.beta_access to service_role;
create policy "own beta access" on public.beta_access for select to authenticated
  using (user_id = (select auth.uid()));

-- security definer: consultada dentro das policies, não pode depender de RLS.
create function public.has_beta(p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.beta_access b
    where b.user_id = auth.uid()
      and b.household_id = public.current_household_id()
      and b.feature = p_feature
  );
$$;

revoke execute on function public.has_beta(text) from public, anon;
grant execute on function public.has_beta(text) to authenticated, service_role;

-- =============================================================================
-- Bancos conectados, contas e lançamentos
-- =============================================================================

-- Um item do MeuPluggy (um banco). O mesmo item não entra duas vezes, nem
-- por outra pessoa. Preso à liberação (beta_feature + foreign key para
-- beta_access): tirar a liberação apaga os bancos da pessoa naquela casa, e
-- as contas e os lançamentos vão junto, na mesma transação; sem ela, a pessoa
-- não vê nem consegue desconectar pelo app, e o extrato não fica guardado sem
-- uso (LGPD). Uma sincronização que ainda estava rodando não grava mais nada
-- (foreign key, 23503).
create table public.fin_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  household_id uuid not null,
  beta_feature text not null default 'finance' check (beta_feature = 'finance'),
  label text not null check (length(trim(label)) between 1 and 40),
  pluggy_item_id text not null unique,
  -- Situação do item na Pluggy (UPDATED, LOGIN_ERROR, OUTDATED...).
  status text,
  error_message text,
  -- Quando a Pluggy atualizou o item no banco (o MeuPluggy renova sozinho).
  item_updated_at timestamptz,
  last_synced_at timestamptz,
  -- Sincronização em andamento (a hora em que começou): uma por banco de cada vez (fin_claim_sync).
  sync_started_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id, household_id),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade,
  foreign key (user_id, household_id, beta_feature)
    references public.beta_access (user_id, household_id, feature) on delete cascade
);
-- Também atende o cascade da liberação (user_id, household_id).
create index fin_connections_member_idx on public.fin_connections (household_id, user_id);

create table public.fin_accounts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  user_id uuid not null,
  household_id uuid not null,
  pluggy_account_id text not null unique,
  type text not null check (type in ('BANK', 'CREDIT')),
  subtype text,
  name text,
  marketing_name text,
  -- Só o final do número da conta ou do cartão, nunca ele inteiro.
  number_last4 text check (char_length(number_last4) <= 4),
  -- HMAC-SHA256 (hex, segredo só da função) do CPF/CNPJ do titular: reconhece transferência para si
  -- mesmo sem guardar o documento.
  owner_doc_hash text check (owner_doc_hash ~ '^[0-9a-fA-F]{64}$'),
  -- No cartão: limite usado (fatura aberta mais parcelas a vencer).
  balance numeric(14, 2),
  currency_code text,
  credit_limit numeric(14, 2),
  available_credit numeric(14, 2),
  bill_due_date date,
  bill_close_date date,
  minimum_payment numeric(14, 2),
  updated_at timestamptz not null default now(),
  unique (id, user_id, household_id),
  foreign key (connection_id, user_id, household_id)
    references public.fin_connections (id, user_id, household_id) on delete cascade
);
create index fin_accounts_connection_idx on public.fin_accounts (connection_id);

create table public.fin_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  user_id uuid not null,
  household_id uuid not null,
  pluggy_transaction_id text not null unique,
  -- PENDING conta como "previsto".
  status text not null check (status in ('PENDING', 'POSTED')),
  direction text not null check (direction in ('DEBIT', 'CREDIT')),
  -- Valor absoluto, na moeda da conta (R$); o sentido vem de direction.
  amount numeric(14, 2) not null check (amount >= 0),
  -- Só em compra em moeda estrangeira.
  original_amount numeric(14, 2),
  original_currency text,
  occurred_on date not null,
  -- Data da compra no cartão (a parcela cai em outra data).
  purchase_on date,
  description text not null,
  description_raw text,
  category_id text,
  category text,
  operation_type text,
  payment_method text,
  merchant_name text,
  merchant_cnpj text,
  -- Quem recebeu (saída) ou quem pagou (entrada). CPF nunca fica cru: só o hash (nem na descrição).
  counterparty_name text,
  counterparty_doc_kind text check (counterparty_doc_kind in ('CPF', 'CNPJ')),
  counterparty_doc_hash text check (counterparty_doc_hash ~ '^[0-9a-fA-F]{64}$'),
  counterparty_cnpj text,
  boleto_barcode text,
  installment_number integer,
  total_installments integer,
  card_bill_id text,
  bill_forecast text,
  other_credits_type text,
  fee_type text,
  -- Sumiu da Pluggy (lançamento desfeito ou trocado): sai das contas sem apagar.
  deleted_at timestamptz,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (counterparty_doc_kind is distinct from 'CPF' or counterparty_cnpj is null),
  foreign key (account_id, user_id, household_id)
    references public.fin_accounts (id, user_id, household_id) on delete cascade
);
create index fin_transactions_user_date_idx on public.fin_transactions (user_id, household_id, occurred_on);
-- A sincronização marca como apagado o que sumiu da janela de cada conta.
create index fin_transactions_account_date_idx on public.fin_transactions (account_id, occurred_on);

-- Só leitura, só a dona, só na casa aberta e com a liberação. Quem grava é a
-- função finance (chave de serviço).
alter table public.fin_connections enable row level security;
alter table public.fin_accounts enable row level security;
alter table public.fin_transactions enable row level security;
revoke all on public.fin_connections, public.fin_accounts, public.fin_transactions from anon, authenticated;
grant select on public.fin_connections, public.fin_accounts, public.fin_transactions to authenticated;
grant all on public.fin_connections, public.fin_accounts, public.fin_transactions to service_role;

create policy "own finance connections" on public.fin_connections for select to authenticated
  using (
    user_id = (select auth.uid())
    and household_id = (select public.current_household_id())
    and (select public.has_beta('finance'))
  );
create policy "own finance accounts" on public.fin_accounts for select to authenticated
  using (
    user_id = (select auth.uid())
    and household_id = (select public.current_household_id())
    and (select public.has_beta('finance'))
  );
create policy "own finance transactions" on public.fin_transactions for select to authenticated
  using (
    user_id = (select auth.uid())
    and household_id = (select public.current_household_id())
    and (select public.has_beta('finance'))
  );

-- Desconectar um banco: sai com as contas e os lançamentos.
create function public.fin_remove_connection(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.has_beta('finance') then
    delete from public.fin_connections c
      where c.id = p_id and c.user_id = auth.uid() and c.household_id = public.current_household_id();
    if found then
      return;
    end if;
  end if;
  raise exception 'finance connection not found' using errcode = 'P0002';
end;
$$;

revoke execute on function public.fin_remove_connection(uuid) from public, anon;
grant execute on function public.fin_remove_connection(uuid) to authenticated;

-- A vez de sincronizar um banco (função finance, chave de serviço). Duas
-- sincronizações do mesmo banco ao mesmo tempo (o consultor aberto de novo
-- enquanto a primeira roda, outro aparelho) gravariam as contas e a hora fora
-- de ordem e esconderiam os saldos até a próxima. Pega a vez se ninguém está
-- sincronizando ou se quem pegou começou há mais de 10 min (a função caiu no
-- meio; uma chamada dura no máximo 400 s). Quem pega devolve no fim
-- (sync_started_at = null, só se a vez ainda é dela). p_at é a hora da
-- sincronização, a mesma que ela grava nas linhas.
create function public.fin_claim_sync(p_connection uuid, p_user uuid, p_household uuid, p_at timestamptz)
returns boolean
language sql
set search_path = ''
as $$
  with claimed as (
    update public.fin_connections c
       set sync_started_at = p_at
     where c.id = p_connection
       and c.user_id = p_user
       and c.household_id = p_household
       and (c.sync_started_at is null or c.sync_started_at < p_at - interval '10 minutes')
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke execute on function public.fin_claim_sync(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.fin_claim_sync(uuid, uuid, uuid, timestamptz) to service_role;

-- =============================================================================
-- Limite de IA: conversa com o consultor (só com a liberação)
-- =============================================================================

alter table public.ai_usage drop constraint ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check check (kind in ('chat', 'photo', 'menu', 'nfce', 'finance'));

-- O uso do consultor não aparece para quem não tem a liberação.
drop policy "household members read ai usage" on public.ai_usage;
create policy "household members read ai usage" on public.ai_usage for select to authenticated
  using (
    household_id = (select public.current_household_id())
    and (kind <> 'finance' or (select public.has_beta('finance')))
  );

create or replace function public.ai_limit(p_kind text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_kind when 'chat' then 300 when 'photo' then 100 when 'menu' then 20 when 'nfce' then 200 when 'finance' then 100 end;
$$;

create or replace function public.use_ai(
  p_kind text,
  out allowed boolean,
  out used integer,
  out lim integer,
  out household uuid,
  out usage_month text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  hh uuid := public.current_household_id();
begin
  lim := public.ai_limit(p_kind);
  if hh is null or lim is null then
    raise exception 'invalid ai usage' using errcode = '22023';
  end if;
  if p_kind = 'finance' and not public.has_beta('finance') then
    raise exception 'finance beta not enabled' using errcode = '42501';
  end if;
  household := hh;
  usage_month := public.ai_month();
  insert into public.ai_usage as u (household_id, month, kind, count)
  values (hh, usage_month, p_kind, 1)
  on conflict (household_id, month, kind) do update set count = u.count + 1 where u.count < lim
  returning u.count into used;
  allowed := found;
  if not allowed then
    used := lim;
  end if;
end;
$$;

create or replace function public.ai_usage_summary()
returns table (kind text, used integer, lim integer)
language sql
stable
security definer
set search_path = ''
as $$
  select k.kind, coalesce(u.count, 0), public.ai_limit(k.kind)
  from (values ('chat'), ('photo'), ('menu'), ('nfce'), ('finance')) as k (kind)
  left join public.ai_usage u
    on u.household_id = public.current_household_id() and u.month = public.ai_month() and u.kind = k.kind
  where k.kind <> 'finance' or public.has_beta('finance');
$$;
