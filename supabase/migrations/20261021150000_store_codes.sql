-- O código do produto na nota. Cada linha da NFC-e traz o código que aquele
-- mercado dá ao produto ("Código", o cProd: 250474 para a BANANA PRATA de um
-- mercado da Paraíba) e, no produto embalado, muitos mercados usam o próprio
-- código de barras (EAN/GTIN, 7891000100103). A linha passa a guardar o
-- código, a nota confirmada ensina à casa "este código, neste mercado, é este
-- produto" (e, quando o código é um código de barras, "em qualquer mercado"),
-- e a próxima nota já vem com o produto: o mercado imprime o mesmo código para
-- o mesmo produto, mesmo quando muda a abreviação da descrição.
--
-- Ordem das pistas na nota nova: o código (do mercado, depois o de barras),
-- depois o apelido (product_aliases, pela descrição), depois a sugestão da IA.
--
-- Ordem de publicação: qualquer uma funciona. A função parse-receipt e o app
-- publicados antes desta migração gravam as linhas sem a coluna (PGRST204 ou
-- 42703) e tratam match_store_codes ausente (PGRST202 ou 42883) como "nenhum
-- código aprendido". A função de antes com o banco novo grava a linha sem
-- código: nada se aprende daquela nota, e o resto fica como era.

-- =============================================================================
-- A chave do código: maiúsculas, sem acento, só letras e dígitos. Vazio ou
-- com mais de 60 caracteres (o limite do cProd) não é código: null. Única
-- implementação no banco; o app e as funções gravam o código já passado pela
-- mesma regra (storeCodeKey em src/domain/storeCode.ts e em
-- supabase/functions/_shared/storeCode.ts; um teste do app falha se os dois
-- divergirem). Os acentos saem pela decomposição (NFD), antes de tirar o que
-- não é letra ASCII nem dígito, e só depois vêm as maiúsculas: assim "ß" e
-- companhia saem iguais aqui e no JavaScript (que faria "SS").
--
-- Executável por quem grava e confere notas (authenticated), como
-- normalize_alias: confirm_receipt e match_store_codes rodam com as permissões
-- de quem chama e usam as duas funções.
-- =============================================================================

create function public.store_code_key(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when length(k) between 1 and 60 then k end
  from (select upper(regexp_replace(normalize(coalesce(p, ''), NFD), '[^A-Za-z0-9]+', '', 'g')) as k) s;
$$;

-- =============================================================================
-- O código de barras que identifica um produto em qualquer mercado: os 14
-- dígitos do GTIN (o EAN-13 e o UPC-A com zeros à esquerda; o GTIN-8 com seis),
-- ou null. Só vale o código com 8, 12, 13 ou 14 dígitos e o dígito
-- verificador certo (módulo 10, pesos 3 e 1 a partir da direita). Ficam de
-- fora as faixas que a GS1 reserva para uso restrito, em que o mesmo número é
-- um produto diferente em cada mercado (ou nem é produto):
--   - EAN-13 que começa com 2 (faixa 20-29): uso interno do mercado e peso
--     variável (a balança imprime o código com o preço ou o peso);
--   - EAN-13 que começa com 02 ou 04: o UPC-A de número 2 (peso variável) e
--     4 (uso interno da loja);
--   - EAN-13 que começa com 98 ou 99: cupons e vales;
--   - GTIN-8 que começa com 0 ou 2: os números curtos de uso restrito;
--   - GTIN-14 que começa com 9: peso variável na embalagem de transporte.
-- Decidido sobre os 14 dígitos: gtin_key(gtin_key(x)) = gtin_key(x), e o
-- GTIN-8 é o que tem seis zeros à frente (a GS1 não emite EAN-13 assim).
-- =============================================================================

create function public.gtin_key(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  g text;
  total integer := 0;
begin
  if p is null or p !~ '^([0-9]{8}|[0-9]{12,14})$' then
    return null;
  end if;
  g := lpad(p, 14, '0');
  for i in 1..13 loop
    total := total + substr(g, i, 1)::integer * case when i % 2 = 1 then 3 else 1 end;
  end loop;
  if (10 - total % 10) % 10 <> substr(g, 14, 1)::integer then
    return null;
  end if;
  if g like '000000%' then
    -- GTIN-8: o primeiro dos oito dígitos.
    if substr(g, 7, 1) in ('0', '2') then
      return null;
    end if;
  elsif g like '0%' then
    -- EAN-13 (e o UPC-A, que é o EAN-13 com um zero à frente).
    if g like '02%' or g like '002%' or g like '004%' or g like '098%' or g like '099%' then
      return null;
    end if;
  elsif g like '9%' then
    return null;
  end if;
  return g;
end;
$$;

revoke execute on function public.store_code_key(text) from public, anon;
revoke execute on function public.gtin_key(text) from public, anon;
grant execute on function public.store_code_key(text) to authenticated, service_role;
grant execute on function public.gtin_key(text) to authenticated, service_role;

-- =============================================================================
-- O código de cada linha da nota, como a nota imprime (já pela chave acima).
-- Fica na linha da casa, com a RLS dela; não vai para receipt_reads nem para
-- os preços compartilhados. Nulo na nota manual, na linha sem código e nas
-- gravadas pelo app ou pela função de antes.
-- =============================================================================

alter table public.receipt_items
  add column store_code text
    constraint receipt_items_store_code_check check (store_code ~ '^[A-Z0-9]{1,60}$');

comment on column public.receipt_items.store_code is
  'Código do produto impresso na linha da nota (cProd), pela store_code_key; a nota confirmada ensina o produto dele.';

-- =============================================================================
-- O que a casa aprendeu. Dados da casa, como product_aliases: saem com ela
-- (on delete cascade) e não com quem confirmou a nota (sair da casa ou apagar
-- a conta não mexe nelas). O produto apagado leva as linhas dele; juntar
-- produtos as passa para o que fica (merge_products, abaixo).
-- =============================================================================

-- A abreviação de cada mercado: o código daquele CNPJ é este produto. Pelo
-- CNPJ e não pela loja da casa: duas lojas cadastradas com o mesmo CNPJ (ou a
-- loja apagada e lida de novo) continuam com o que já se aprendeu.
create table public.product_store_codes (
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  store_cnpj text not null check (store_cnpj ~ '^[0-9]{14}$'),
  store_code text not null check (store_code ~ '^[A-Z0-9]{1,60}$'),
  product_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (household_id, store_cnpj, store_code),
  foreign key (product_id, household_id) references public.products (id, household_id) on delete cascade
);
create index product_store_codes_product_idx on public.product_store_codes (product_id);

-- O código de barras: vale em qualquer mercado (e, no próximo passo, na
-- leitura pela câmera). Sempre os 14 dígitos da gtin_key.
create table public.product_barcodes (
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  gtin text not null check (gtin is not distinct from public.gtin_key(gtin)),
  product_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (household_id, gtin),
  foreign key (product_id, household_id) references public.products (id, household_id) on delete cascade
);
create index product_barcodes_product_idx on public.product_barcodes (product_id);

alter table public.product_store_codes enable row level security;
alter table public.product_barcodes enable row level security;

revoke all on public.product_store_codes from anon, authenticated;
revoke all on public.product_barcodes from anon, authenticated;
grant select, insert, update, delete on public.product_store_codes to authenticated;
grant select, insert, update, delete on public.product_barcodes to authenticated;
grant all on public.product_store_codes to service_role;
grant all on public.product_barcodes to service_role;

create policy "household members manage product_store_codes" on public.product_store_codes for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));
create policy "household members manage product_barcodes" on public.product_barcodes for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

-- =============================================================================
-- O produto aprendido de cada código, só da casa de quem chama: o daquele
-- mercado e, sem ele, o do código de barras. Sem CNPJ (p_store_cnpj null), só
-- o código de barras. Devolve o código como veio, para quem chama achar a
-- linha; o que não tem produto aprendido fica de fora.
-- =============================================================================

create function public.match_store_codes(p_store_cnpj text, p_codes text[])
returns table (code text, product_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.code, coalesce(s.product_id, b.product_id)
  from (select distinct c.code from unnest(p_codes) as c (code) where c.code is not null) d
  left join public.product_store_codes s
    on s.household_id = public.current_household_id()
   and s.store_cnpj = p_store_cnpj
   and s.store_code = public.store_code_key(d.code)
  left join public.product_barcodes b
    on b.household_id = public.current_household_id()
   and b.gtin = public.gtin_key(public.store_code_key(d.code))
  where coalesce(s.product_id, b.product_id) is not null;
$$;

revoke execute on function public.match_store_codes(text, text[]) from public, anon;
grant execute on function public.match_store_codes(text, text[]) to authenticated;

-- =============================================================================
-- Confirmação de nota: a versão de 20261005120000_receipt_clears_list.sql,
-- igual em tudo, mais o código de cada linha que termina com produto, ao lado
-- do apelido: no mercado da nota, se ele tem CNPJ, e como código de barras,
-- se o código é um (com ou sem CNPJ). O último vence, como no apelido. Linha
-- sem produto ("Não acompanhar preço") não ensina nada.
--
-- p_items: [{ id, product_id?, new_product?: {name, category},
--             pantry?: {name, category, purchased_on, expires_on, expiry_source},
--             list_items?: [{ id, name, name_key }], forget_links?: [name_key] }]
-- =============================================================================

create or replace function public.confirm_receipt(p_receipt_id uuid, p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.receipts;
  it jsonb;
  li jsonb;
  item public.receipt_items;
  v_product_id uuid;
  v_pantry jsonb;
  v_expires date;
  v_purchased date;
  v_cnpj text;
  v_gtin text;
begin
  select * into r from public.receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'receipt not found' using errcode = 'P0002';
  end if;
  if r.status = 'confirmed' then
    raise exception 'receipt already confirmed' using errcode = '23505';
  end if;

  -- O mercado da nota (a loja da casa; a criada à mão não tem CNPJ).
  select s.cnpj into v_cnpj from public.stores s where s.id = r.store_id and s.household_id = r.household_id;

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

    -- O código da linha: a abreviação daquele mercado e, se for um, o código de barras.
    if v_product_id is not null and item.store_code is not null then
      if v_cnpj is not null then
        insert into public.product_store_codes (household_id, store_cnpj, store_code, product_id)
        values (r.household_id, v_cnpj, item.store_code, v_product_id)
        on conflict (household_id, store_cnpj, store_code)
          do update set product_id = excluded.product_id, updated_at = now();
      end if;
      v_gtin := public.gtin_key(item.store_code);
      if v_gtin is not null then
        insert into public.product_barcodes (household_id, gtin, product_id)
        values (r.household_id, v_gtin, v_product_id)
        on conflict (household_id, gtin)
          do update set product_id = excluded.product_id, updated_at = now();
      end if;
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

    -- Ligação que a pessoa desfez nesta nota ("não foi comprado"): não volta marcada.
    if v_product_id is not null and jsonb_typeof(it -> 'forget_links') = 'array' then
      delete from public.list_item_links k
        where k.household_id = r.household_id and k.product_id = v_product_id
          and k.name_key in (select jsonb_array_elements_text(it -> 'forget_links'));
    end if;

    -- Itens de lista que esta compra cumpre: saem da lista, e o nome fica
    -- ligado ao produto. Só se o item ainda está lá com o nome visto na
    -- revisão (renomeado em outro aparelho no meio: fica, sem ligação).
    if jsonb_typeof(it -> 'list_items') = 'array' then
      for li in select value from jsonb_array_elements(it -> 'list_items') loop
        delete from public.shopping_list_items s
          where s.id = nullif(li ->> 'id', '')::uuid and s.household_id = r.household_id
            and s.name = li ->> 'name';
        if found and v_product_id is not null and coalesce(li ->> 'name_key', '') <> '' then
          insert into public.list_item_links (household_id, name_key, product_id)
          values (r.household_id, li ->> 'name_key', v_product_id)
          on conflict do nothing;
        end if;
      end loop;
    end if;
  end loop;

  update public.receipts set status = 'confirmed' where id = r.id;
end;
$$;

-- =============================================================================
-- merge_products: a versão de 20261013120000_merge_products.sql, igual em
-- tudo, mais as duas tabelas novas. Cada código (do mercado ou de barras) tem
-- um produto só na casa, então trocar o produto que some pelo que fica não
-- conflita com nada, como nos apelidos.
--
-- Tabelas que apontam para products (todas pelo par id + casa):
--   receipt_items, shopping_list_items, pantry_items, purchase_history
--     (on delete set null: sem a troca, a linha perderia o produto);
--   product_aliases, list_item_links, product_distinct_pairs,
--   product_store_codes, product_barcodes
--     (on delete cascade: sem a troca, a linha seria apagada).
-- Uma tabela nova que aponte para products precisa entrar aqui (um teste em
-- scripts/db/test.sql falha se a lista mudar).
-- =============================================================================

create or replace function public.merge_products(p_keep uuid, p_merge uuid, p_keep_name text default null, p_merge_name text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  keep public.products;
  gone public.products;
  v_key text;
  n_purchases integer;
  n_pantry integer;
  n_list integer;
  n_receipt_items integer;
  n_pantry_items integer;
  n_list_items integer;
  n_history integer;
  n_aliases integer;
  n_links integer;
begin
  if p_keep is null or p_merge is null then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
  if p_keep = p_merge then
    raise exception 'cannot merge a product with itself' using errcode = '22023';
  end if;

  -- Trava os dois sempre na ordem dos ids: duas pessoas juntando o mesmo par
  -- ao mesmo tempo (até em sentidos opostos) esperam uma pela outra, sem
  -- deadlock, e a segunda já não encontra o produto que sumiu. A trava também
  -- segura quem renomeia: as linhas lidas logo abaixo, já com ela, trazem o
  -- nome que vale até o fim desta transação.
  perform 1 from public.products p where p.id = least(p_keep, p_merge) for update;
  perform 1 from public.products p where p.id = greatest(p_keep, p_merge) for update;
  select * into keep from public.products p where p.id = p_keep;
  select * into gone from public.products p where p.id = p_merge;
  if keep.id is null or gone.id is null then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
  -- Com a RLS os dois são da casa aberta; a conferência vale para quem passa por cima dela (service_role).
  if keep.household_id <> gone.household_id then
    raise exception 'products belong to different households' using errcode = '22023';
  end if;
  -- Os nomes que a pessoa confirmou. Depois de "não encontrado": quem não vê o
  -- produto (outra casa) não fica sabendo se acertou o nome dele.
  if (p_keep_name is not null and p_keep_name <> keep.name)
    or (p_merge_name is not null and p_merge_name <> gone.name) then
    raise exception 'product renamed' using errcode = 'NK008';
  end if;

  -- O que a pessoa vai ler que passou, contado antes da troca.
  select count(*) into n_purchases
    from public.receipt_items ri
    join public.receipts r on r.id = ri.receipt_id
    where ri.product_id = gone.id and r.status = 'confirmed';
  select count(*) into n_pantry
    from public.pantry_items i
    where i.product_id = gone.id and i.consumed_at is null;
  select count(*) into n_list
    from public.shopping_list_items i
    join public.shopping_lists l on l.id = i.list_id
    where i.product_id = gone.id and l.archived_at is null;

  -- Itens de nota (o histórico de preços e os gastos do mês), de rascunhos também.
  update public.receipt_items set product_id = keep.id
    where product_id = gone.id and household_id = gone.household_id;
  get diagnostics n_receipt_items = row_count;

  update public.pantry_items set product_id = keep.id
    where product_id = gone.id and household_id = gone.household_id;
  get diagnostics n_pantry_items = row_count;

  update public.shopping_list_items set product_id = keep.id
    where product_id = gone.id and household_id = gone.household_id;
  get diagnostics n_list_items = row_count;

  update public.purchase_history set product_id = keep.id
    where product_id = gone.id and household_id = gone.household_id;
  get diagnostics n_history = row_count;

  -- As descrições de nota que levavam ao outro produto agora levam a este
  -- (cada descrição só tem um produto na casa: não há o que conflitar).
  update public.product_aliases set product_id = keep.id
    where product_id = gone.id and household_id = gone.household_id;
  get diagnostics n_aliases = row_count;

  -- Os códigos de mercado e de barras, do mesmo jeito (um produto por código).
  -- Não entram na resposta, que fica como era: o app mostra o que a pessoa lê.
  update public.product_store_codes set product_id = keep.id, updated_at = now()
    where product_id = gone.id and household_id = gone.household_id;
  update public.product_barcodes set product_id = keep.id, updated_at = now()
    where product_id = gone.id and household_id = gone.household_id;

  -- Nomes de lista ligados aos dois: fica uma ligação só (a chave é casa, nome e produto).
  delete from public.list_item_links k
    where k.product_id = gone.id and k.household_id = gone.household_id
      and exists (
        select 1 from public.list_item_links o
        where o.household_id = k.household_id and o.name_key = k.name_key and o.product_id = keep.id
      );
  update public.list_item_links set product_id = keep.id
    where product_id = gone.id and household_id = gone.household_id;
  get diagnostics n_links = row_count;

  -- O nome do produto que some vira ligação para o que fica: um item de lista
  -- digitado com o nome antigo continua achando o produto. A chave é a do app
  -- (listNameKey em src/domain/listLinks.ts): sem acento, minúscula, só letras
  -- e números separados por um espaço, até 200 caracteres. Nome que não deixa
  -- chave válida ("!!!") fica sem ligação.
  v_key := btrim(left(btrim(regexp_replace(
    lower(regexp_replace(normalize(gone.name, NFD), '[\u0300-\u036f]', '', 'g')),
    '[^a-z0-9]+', ' ', 'g'
  )), 200));
  if v_key ~ '^[a-z0-9]+( [a-z0-9]+)*$' then
    insert into public.list_item_links (household_id, name_key, product_id)
    values (keep.household_id, v_key, keep.id)
    on conflict do nothing;
  end if;

  -- "São diferentes" do produto que some passa a valer para o que fica (a
  -- pessoa disse que os dois são o mesmo, então o que era diferente de um é
  -- diferente do outro). O par dos dois entre si, se a casa tinha recusado e
  -- depois juntou à mão, só sai.
  insert into public.product_distinct_pairs (household_id, product_a, product_b)
  select d.household_id, least(keep.id, o.other), greatest(keep.id, o.other)
    from public.product_distinct_pairs d
    cross join lateral (select case when d.product_a = gone.id then d.product_b else d.product_a end as other) o
    where gone.id in (d.product_a, d.product_b) and o.other <> keep.id
  on conflict do nothing;
  delete from public.product_distinct_pairs d where gone.id in (d.product_a, d.product_b);

  -- Antes de apagar: se alguma linha ainda aponta para o produto que some
  -- (uma regra de acesso que mudou e fez uma troca acima não alcançar nada),
  -- nada é juntado. Apagar agora soltaria ou apagaria essas linhas.
  if exists (select 1 from public.receipt_items where product_id = gone.id)
    or exists (select 1 from public.pantry_items where product_id = gone.id)
    or exists (select 1 from public.shopping_list_items where product_id = gone.id)
    or exists (select 1 from public.purchase_history where product_id = gone.id)
    or exists (select 1 from public.product_aliases where product_id = gone.id)
    or exists (select 1 from public.product_store_codes where product_id = gone.id)
    or exists (select 1 from public.product_barcodes where product_id = gone.id)
    or exists (select 1 from public.list_item_links where product_id = gone.id)
    or exists (select 1 from public.product_distinct_pairs d where gone.id in (d.product_a, d.product_b))
  then
    raise exception 'rows still point to the merged product' using errcode = '55000';
  end if;

  delete from public.products where id = gone.id;

  return jsonb_build_object(
    'kept', keep.id,
    'purchases', n_purchases,
    'pantry', n_pantry,
    'list', n_list,
    'receipt_items', n_receipt_items,
    'pantry_items', n_pantry_items,
    'list_items', n_list_items,
    'purchase_history', n_history,
    'aliases', n_aliases,
    'links', n_links
  );
end;
$$;

revoke execute on function public.merge_products(uuid, uuid, text, text) from public, anon;
grant execute on function public.merge_products(uuid, uuid, text, text) to authenticated;
