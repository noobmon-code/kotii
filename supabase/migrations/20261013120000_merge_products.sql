-- Juntar produtos. Os produtos de uma casa só são únicos pelo nome, então
-- "Arroz 5kg" e "Arroz Tio João 5 kg" são dois: cada um com metade do
-- histórico de preços. Quando a pessoa diz que são o mesmo, um fica (com o
-- nome, a categoria e a validade aprendida dele) e tudo o que apontava para o
-- outro passa a apontar para ele, numa transação só. O app sugere os pares de
-- nome parecido e a pessoa decide: nada é juntado sozinho.

-- =============================================================================
-- "São diferentes": o par que a casa recusou não volta como sugestão, para
-- ninguém da casa. Juntar à mão continua possível.
-- =============================================================================

create table public.product_distinct_pairs (
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  -- Os dois produtos, o de id menor primeiro: o par existe uma vez só, seja
  -- qual for a ordem em que apareceu na tela.
  product_a uuid not null,
  product_b uuid not null,
  created_at timestamptz not null default now(),
  primary key (household_id, product_a, product_b),
  check (product_a < product_b),
  foreign key (product_a, household_id) references public.products (id, household_id) on delete cascade,
  foreign key (product_b, household_id) references public.products (id, household_id) on delete cascade
);
create index product_distinct_pairs_b_idx on public.product_distinct_pairs (product_b);

alter table public.product_distinct_pairs enable row level security;
revoke all on public.product_distinct_pairs from anon, authenticated;
grant select, insert, delete on public.product_distinct_pairs to authenticated;
grant all on public.product_distinct_pairs to service_role;

create policy "household members manage product_distinct_pairs" on public.product_distinct_pairs for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

-- =============================================================================
-- O histórico de compras (carrinhos limpos) só tinha leitura e exclusão para
-- quem é da casa. Juntar precisa trocar o produto dessas linhas, e a função
-- roda com as permissões de quem chama: sem uma regra de UPDATE a troca não
-- alcançaria linha nenhuma, e apagar o produto as deixaria sem produto. Só a
-- coluna product_id pode mudar; nome, quantidade e data continuam como foram
-- gravados por clear_checked_items.
-- =============================================================================

revoke update on public.purchase_history from authenticated;
grant update (product_id) on public.purchase_history to authenticated;

create policy "household members re-point purchase history" on public.purchase_history for update to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

-- =============================================================================
-- merge_products: p_merge deixa de existir e tudo o que era dele passa para
-- p_keep. Nada é somado nem recalculado: as linhas trocam de produto.
--
-- security invoker: os dois produtos precisam estar à vista de quem chama (a
-- RLS da casa cuida disso; produto de outra casa é "não encontrado"), e cada
-- troca abaixo é uma que a pessoa já podia fazer pela API.
--
-- Tabelas que apontam para products (todas pelo par id + casa):
--   receipt_items, shopping_list_items, pantry_items, purchase_history
--     (on delete set null: sem a troca, a linha perderia o produto);
--   product_aliases, list_item_links, product_distinct_pairs
--     (on delete cascade: sem a troca, a linha seria apagada).
-- Uma tabela nova que aponte para products precisa entrar aqui (um teste em
-- scripts/db/test.sql falha se a lista mudar).
--
-- Devolve o que passou: purchases (linhas de notas confirmadas), pantry (itens
-- abertos da despensa) e list (itens de listas abertas) são o que a pessoa
-- lê; os outros números são as linhas trocadas em cada tabela.
--
-- p_keep_name e p_merge_name: os nomes que a pessoa leu na confirmação. O app
-- busca os dois produtos ao abrir a confirmação, mas entre essa busca e o toque
-- passam alguns segundos, e outro aparelho pode renomear um deles (um "Arroz"
-- criado com o nome errado vira "Feijão"): a pessoa confirmaria juntar arroz e
-- acabaria com feijão no histórico, sem volta. Com os dois produtos travados,
-- o nome dado que não for exatamente o da linha recusa com NK008, antes de
-- qualquer troca. Sem o nome (omitido ou null), não há conferência.
-- =============================================================================

create function public.merge_products(p_keep uuid, p_merge uuid, p_keep_name text default null, p_merge_name text default null)
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
