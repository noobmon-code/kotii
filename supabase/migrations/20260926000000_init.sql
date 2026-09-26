-- Nooky — schema inicial
-- Família (multiusuário), mercado (lojas, produtos, notas fiscais, preços),
-- listas de compras, despensa, tarefas da casa e remédios.
--
-- Regra de acesso: todo dado pertence a uma família (household). Cada usuário
-- participa de no máximo uma família por enquanto, então o filtro de RLS é
-- `household_id = current_household_id()`.

-- =============================================================================
-- Família
-- =============================================================================

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  invite_code text not null unique,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

-- security definer: consultado dentro das policies, não pode depender de RLS.
create function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.household_id from public.household_members m where m.user_id = auth.uid();
$$;

create function public.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- sem 0/O, 1/I
  random_bytes bytea;
  code text;
begin
  loop
    -- 32 símbolos dividem 256 exatamente: sem viés no módulo.
    random_bytes := uuid_send(gen_random_uuid());
    code := '';
    for i in 0..5 loop
      code := code || substr(alphabet, 1 + get_byte(random_bytes, i) % 32, 1);
    end loop;
    exit when not exists (select 1 from public.households h where h.invite_code = code);
  end loop;
  return code;
end;
$$;

create function public.create_household(p_name text, p_display_name text)
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
  if exists (select 1 from public.household_members m where m.user_id = auth.uid()) then
    raise exception 'user already belongs to a household' using errcode = '23505';
  end if;

  insert into public.households (name, invite_code, created_by)
  values (trim(p_name), public.generate_invite_code(), auth.uid())
  returning * into h;

  insert into public.household_members (household_id, user_id, display_name, role)
  values (h.id, auth.uid(), trim(p_display_name), 'owner');

  return h;
end;
$$;

create function public.join_household(p_invite_code text, p_display_name text)
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
  if exists (select 1 from public.household_members m where m.user_id = auth.uid()) then
    raise exception 'user already belongs to a household' using errcode = '23505';
  end if;

  select * into h from public.households where invite_code = upper(trim(p_invite_code));
  if not found then
    raise exception 'invalid invite code' using errcode = 'P0002';
  end if;

  insert into public.household_members (household_id, user_id, display_name, role)
  values (h.id, auth.uid(), trim(p_display_name), 'member');

  return h;
end;
$$;

revoke execute on function public.create_household(text, text) from public, anon;
revoke execute on function public.join_household(text, text) from public, anon;
revoke execute on function public.generate_invite_code() from public, anon, authenticated;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;

create policy "members read their household" on public.households
  for select to authenticated
  using (id = (select public.current_household_id()));

create policy "owner renames household" on public.households
  for update to authenticated
  using (id = (select public.current_household_id()) and created_by = (select auth.uid()))
  with check (id = (select public.current_household_id()));

create policy "members read members" on public.household_members
  for select to authenticated
  using (household_id = (select public.current_household_id()));

create policy "member edits own profile" on public.household_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and household_id = (select public.current_household_id()));

create policy "member leaves household" on public.household_members
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Colunas imutáveis pelo cliente: só nome de exibição é editável.
revoke update on public.household_members from authenticated;
grant update (display_name) on public.household_members to authenticated;
revoke update on public.households from authenticated;
grant update (name) on public.households to authenticated;

-- =============================================================================
-- Mercado: lojas, produtos, apelidos (matching), notas fiscais
-- =============================================================================

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  cnpj text check (cnpj ~ '^[0-9]{14}$'),
  address text,
  created_at timestamptz not null default now(),
  unique (id, household_id)
);
create unique index stores_household_cnpj_key on public.stores (household_id, cnpj)
  where cnpj is not null;

-- Produto canônico da família ("Arroz Tio João 5kg"). Preço é comparado por produto.
create table public.products (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category text not null default 'outros',
  -- Validade aprendida para este produto; sobrepõe o padrão da categoria.
  shelf_life_days integer check (shelf_life_days > 0),
  created_at timestamptz not null default now(),
  unique (id, household_id)
);
create unique index products_household_name_key on public.products (household_id, lower(name));

-- Normaliza a descrição de item de nota ("ARROZ T.JOÃO 5KG" -> "ARROZ T JOAO 5KG").
-- Única implementação: a Edge Function usa match_aliases() em vez de replicar.
create function public.normalize_alias(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(regexp_replace(
    upper(translate(
      coalesce(p, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
    )),
    '[^A-Z0-9]+', ' ', 'g'
  ));
$$;

-- Memória de matching: descrição normalizada da nota -> produto. Alimentada a
-- cada nota confirmada, então a mesma descrição é reconhecida automaticamente.
create table public.product_aliases (
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  alias text not null check (alias = public.normalize_alias(alias) and alias <> ''),
  product_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (household_id, alias),
  foreign key (product_id, household_id)
    references public.products (id, household_id) on delete cascade
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  store_id uuid,
  purchased_at timestamptz not null default now(),
  total numeric(12, 2) check (total >= 0),
  -- Chave de acesso da NFC-e (44 dígitos): evita importar a mesma nota duas vezes.
  access_key text check (access_key ~ '^[0-9]{44}$'),
  image_path text,
  source text not null default 'manual' check (source in ('ai', 'manual')),
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (store_id, household_id)
    references public.stores (id, household_id) on delete set null (store_id)
);
create unique index receipts_household_access_key_key on public.receipts (household_id, access_key)
  where access_key is not null;
create index receipts_household_purchased_at_idx on public.receipts (household_id, purchased_at desc);

create table public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  receipt_id uuid not null,
  position integer not null default 0,
  raw_description text not null,
  -- Sugestões da IA para quando o item ainda não tem produto.
  suggested_name text,
  suggested_category text,
  product_id uuid,
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit text not null default 'un' check (unit in ('un', 'kg', 'g', 'l', 'ml')),
  unit_price numeric(12, 4) not null check (unit_price >= 0),
  total_price numeric(12, 2) not null check (total_price >= 0),
  created_at timestamptz not null default now(),
  foreign key (receipt_id, household_id)
    references public.receipts (id, household_id) on delete cascade,
  foreign key (product_id, household_id)
    references public.products (id, household_id) on delete set null (product_id)
);
create index receipt_items_receipt_idx on public.receipt_items (receipt_id, position);
create index receipt_items_product_idx on public.receipt_items (product_id);

-- Observações de preço = itens de notas confirmadas ligados a um produto.
create view public.price_observations with (security_invoker = true) as
select
  ri.household_id,
  ri.product_id,
  r.store_id,
  r.purchased_at,
  ri.unit_price,
  ri.unit,
  ri.receipt_id
from public.receipt_items ri
join public.receipts r on r.id = ri.receipt_id
where r.status = 'confirmed'
  and ri.product_id is not null
  and r.store_id is not null;

-- Último preço de cada produto em cada loja (base do comparativo).
create view public.latest_prices with (security_invoker = true) as
select distinct on (product_id, store_id, unit)
  household_id,
  product_id,
  store_id,
  unit,
  unit_price,
  purchased_at
from public.price_observations
order by product_id, store_id, unit, purchased_at desc;

-- =============================================================================
-- Listas de compras
-- =============================================================================

create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  kind text not null default 'mercado' check (kind in ('mercado', 'farmacia', 'outros')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, household_id)
);

create table public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  list_id uuid not null,
  product_id uuid,
  name text not null check (length(trim(name)) > 0),
  category text not null default 'outros',
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit text not null default 'un' check (unit in ('un', 'kg', 'g', 'l', 'ml')),
  checked_at timestamptz,
  checked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (list_id, household_id)
    references public.shopping_lists (id, household_id) on delete cascade,
  foreign key (product_id, household_id)
    references public.products (id, household_id) on delete set null (product_id)
);
create index shopping_list_items_list_idx on public.shopping_list_items (list_id, created_at);

-- =============================================================================
-- Despensa
-- =============================================================================

create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  product_id uuid,
  name text not null check (length(trim(name)) > 0),
  category text not null default 'outros',
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit text not null default 'un' check (unit in ('un', 'kg', 'g', 'l', 'ml')),
  purchased_on date not null default current_date,
  expires_on date,
  -- De onde veio a validade: padrão da categoria, aprendida do produto, ou digitada.
  expiry_source text check (expiry_source in ('categoria', 'produto', 'manual')),
  receipt_item_id uuid references public.receipt_items (id) on delete set null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (product_id, household_id)
    references public.products (id, household_id) on delete set null (product_id)
);
create index pantry_items_open_idx on public.pantry_items (household_id, expires_on)
  where consumed_at is null;

-- =============================================================================
-- Tarefas da casa
-- =============================================================================

create table public.chores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  notes text,
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
  interval_count integer not null default 1 check (interval_count between 1 and 365),
  due_on date not null default current_date,
  assigned_to uuid,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (household_id, assigned_to)
    references public.household_members (household_id, user_id) on delete set null (assigned_to)
);
create index chores_active_due_idx on public.chores (household_id, due_on) where active;

create table public.chore_completions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  chore_id uuid not null,
  completed_by uuid default auth.uid() references auth.users (id) on delete set null,
  completed_at timestamptz not null default now(),
  foreign key (chore_id, household_id)
    references public.chores (id, household_id) on delete cascade
);

-- Registra a conclusão e agenda a próxima ocorrência a partir de hoje
-- (limpeza feita com atraso não deve gerar a próxima já atrasada).
-- p_today vem do aparelho: o "hoje" do usuário, não o UTC do servidor.
create function public.complete_chore(p_chore_id uuid, p_today date)
returns public.chores
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.chores;
begin
  select * into c from public.chores where id = p_chore_id for update;
  if not found then
    raise exception 'chore not found' using errcode = 'P0002';
  end if;

  insert into public.chore_completions (household_id, chore_id) values (c.household_id, c.id);

  update public.chores set
    due_on = case c.recurrence
      when 'daily' then p_today + c.interval_count
      when 'weekly' then p_today + 7 * c.interval_count
      when 'monthly' then (p_today + make_interval(months => c.interval_count))::date
      else c.due_on
    end,
    active = c.recurrence <> 'none'
  where id = c.id
  returning * into c;

  return c;
end;
$$;

-- =============================================================================
-- Remédios
-- =============================================================================

create table public.medications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  -- Texto livre: filhos e dependentes nem sempre têm conta no app.
  person_name text not null check (length(trim(person_name)) > 0),
  name text not null check (length(trim(name)) > 0),
  dosage text,
  -- Horários locais "HH:MM".
  times text[] not null check (
    cardinality(times) > 0
    and array_to_string(times, ',') ~ '^([01][0-9]|2[0-3]):[0-5][0-9](,([01][0-9]|2[0-3]):[0-5][0-9])*$'
  ),
  start_on date not null default current_date,
  end_on date check (end_on is null or end_on >= start_on),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, household_id)
);

create table public.medication_doses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  medication_id uuid not null,
  -- Data local + horário do slot ("2026-09-26" + "08:00"), independente de fuso.
  scheduled_on date not null,
  scheduled_time text not null check (scheduled_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  taken_at timestamptz not null default now(),
  taken_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (medication_id, scheduled_on, scheduled_time),
  foreign key (medication_id, household_id)
    references public.medications (id, household_id) on delete cascade
);

-- =============================================================================
-- Confirmação de nota: liga itens a produtos, aprende apelidos e validade,
-- alimenta a despensa. Tudo numa transação.
--
-- p_items: [{ id, product_id?, new_product?: {name, category},
--             pantry?: {name, category, purchased_on, expires_on, expiry_source} }]
-- =============================================================================

create function public.confirm_receipt(p_receipt_id uuid, p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.receipts;
  it jsonb;
  item public.receipt_items;
  v_product_id uuid;
  v_pantry jsonb;
  v_expires date;
  v_purchased date;
begin
  select * into r from public.receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'receipt not found' using errcode = 'P0002';
  end if;
  if r.status = 'confirmed' then
    raise exception 'receipt already confirmed' using errcode = '23505';
  end if;

  for it in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into item from public.receipt_items
      where id = (it ->> 'id')::uuid and receipt_id = r.id;
    if not found then
      raise exception 'item % does not belong to receipt', it ->> 'id' using errcode = 'P0002';
    end if;

    v_product_id := nullif(it ->> 'product_id', '')::uuid;

    if v_product_id is null and jsonb_typeof(it -> 'new_product') = 'object' then
      insert into public.products (household_id, name, category)
      values (
        r.household_id,
        trim(it -> 'new_product' ->> 'name'),
        coalesce(nullif(it -> 'new_product' ->> 'category', ''), 'outros')
      )
      on conflict (household_id, lower(name)) do update set name = public.products.name
      returning id into v_product_id;
    end if;

    update public.receipt_items set product_id = v_product_id where id = item.id;

    if v_product_id is not null and public.normalize_alias(item.raw_description) <> '' then
      insert into public.product_aliases (household_id, alias, product_id)
      values (r.household_id, public.normalize_alias(item.raw_description), v_product_id)
      on conflict (household_id, alias) do update set product_id = excluded.product_id;
    end if;

    v_pantry := it -> 'pantry';
    if jsonb_typeof(v_pantry) = 'object' then
      v_purchased := coalesce(nullif(v_pantry ->> 'purchased_on', '')::date, current_date);
      v_expires := nullif(v_pantry ->> 'expires_on', '')::date;

      insert into public.pantry_items (
        household_id, product_id, name, category, quantity, unit,
        purchased_on, expires_on, expiry_source, receipt_item_id
      ) values (
        r.household_id,
        v_product_id,
        coalesce(nullif(trim(v_pantry ->> 'name'), ''), item.suggested_name, item.raw_description),
        coalesce(nullif(v_pantry ->> 'category', ''), 'outros'),
        item.quantity,
        item.unit,
        v_purchased,
        v_expires,
        case when v_expires is null then null else nullif(v_pantry ->> 'expiry_source', '') end,
        item.id
      );

      -- Validade digitada vira a validade aprendida do produto.
      if v_pantry ->> 'expiry_source' = 'manual' and v_expires is not null and v_product_id is not null then
        update public.products
          set shelf_life_days = greatest(1, v_expires - v_purchased)
          where id = v_product_id;
      end if;
    end if;
  end loop;

  update public.receipts set status = 'confirmed' where id = r.id;
end;
$$;

-- Produto já conhecido para cada descrição de nota (usado pela Edge Function).
create function public.match_aliases(p_descriptions text[])
returns table (description text, product_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.description, a.product_id
  from unnest(p_descriptions) as d (description)
  join public.product_aliases a
    on a.alias = public.normalize_alias(d.description)
   and a.household_id = public.current_household_id();
$$;

revoke execute on function public.confirm_receipt(uuid, jsonb) from public, anon;
revoke execute on function public.complete_chore(uuid, date) from public, anon;
revoke execute on function public.match_aliases(text[]) from public, anon;
grant execute on function public.confirm_receipt(uuid, jsonb) to authenticated;
grant execute on function public.complete_chore(uuid, date) to authenticated;
grant execute on function public.match_aliases(text[]) to authenticated;

-- =============================================================================
-- RLS dos dados da família
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'stores', 'products', 'product_aliases', 'receipts', 'receipt_items',
    'shopping_lists', 'shopping_list_items', 'pantry_items',
    'chores', 'chore_completions', 'medications', 'medication_doses'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "household members manage %1$s" on public.%1$I for all to authenticated '
      'using (household_id = (select public.current_household_id())) '
      'with check (household_id = (select public.current_household_id()))',
      t
    );
  end loop;
end;
$$;

-- Sincronização em tempo real da lista de compras (duas pessoas no mercado).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.shopping_list_items;
  end if;
end;
$$;

-- =============================================================================
-- Storage: fotos das notas em receipts/<household_id>/<arquivo>
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy "household members read receipt images" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select public.current_household_id())::text
  );

create policy "household members upload receipt images" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select public.current_household_id())::text
  );

create policy "household members delete receipt images" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select public.current_household_id())::text
  );
