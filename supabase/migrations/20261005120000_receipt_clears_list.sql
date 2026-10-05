-- A nota tira da lista o que a compra cumpriu. A lista é digitada solta
-- ("Coca", "Refrigerante") e cada mercado escreve de um jeito: ao confirmar a
-- nota, a pessoa diz quais itens da lista cada item da nota cumpre. Eles saem
-- da lista (marcados no carrinho ou não), e o nome vira um vínculo com o
-- produto: na próxima nota, o mesmo nome já vem marcado.

create table public.list_item_links (
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  -- Nome do item da lista sem acento, maiúscula nem pontuação (listNameKey no app).
  name_key text not null check (name_key ~ '^[a-z0-9]+( [a-z0-9]+)*$' and length(name_key) <= 200),
  product_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (household_id, name_key, product_id),
  foreign key (product_id, household_id) references public.products (id, household_id) on delete cascade
);

alter table public.list_item_links enable row level security;
create policy "household members manage list_item_links" on public.list_item_links for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

-- =============================================================================
-- Confirmação de nota: liga itens a produtos, aprende apelidos e validade,
-- alimenta a despensa e tira da lista o que a compra cumpriu. Tudo numa
-- transação.
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
