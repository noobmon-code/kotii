-- Nota confirmada: trocar o produto de uma linha (a) e incluir o item que a leitura perdeu (b). Decisões do dono de
-- 21/11/2026: (a) a entrada da despensa e o histórico de preço passam para o produto novo, e o apelido e o código
-- aprendidos daquela linha passam também; (b) o item novo vai para as linhas da nota e, como na confirmação, para a
-- despensa (com o "Congelei" da revisão nas carnes e peixes). Nada daqui vai para os preços compartilhados:
-- receipts_share_prices só roda na passagem de rascunho para confirmada, a leitura do servidor some nela, e
-- shared_prices é pela descrição, nunca pelo produto.
--
-- Esta migração vem depois da do congelador (20261122110000_pantry_freezer.sql), no nome e na ordem de aplicar: as
-- duas funções leem e gravam as colunas do congelador em pantry_items, e o plpgsql só confere os nomes das colunas
-- quando a função roda pela primeira vez (criada num banco sem o congelador, falharia em toda chamada).
--
-- As funções rodam com as permissões de quem chama (security invoker), como confirm_receipt e merge_products: a RLS
-- da casa em cada tabela é a guarda, e nenhum privilégio novo nasce aqui.
--
-- Travas, nesta ordem nas duas: os produtos já conhecidos (o de antes e o escolhido, também o achado pelo nome) for
-- key share na ordem dos ids (segura juntar e excluir, não segura renomear nem a validade aprendida), a nota for
-- update, a linha, o resto. É a ordem de merge_products (os dois produtos for update, na ordem dos ids) e a de apagar
-- a nota. Um deadlock (40P01) ainda pode cruzar com uma confirmação de outra nota da casa ao mesmo tempo (apelido e
-- código de mercado genérico, travados em ordens diferentes): o app tenta a troca de novo uma vez; quem confirma vê
-- "Outra pessoa da casa mexeu nisso agora. Tente de novo." e toca de novo.
--
-- Recusas: NK018, a linha não está mais no produto que a tela mostrava; NK019, a nota não está confirmada; P0002
-- 'receipt not found' / 'item not found' / 'product not found', nessa ordem de precedência (a nota de outra casa é
-- sempre 'receipt not found', e o produto de outra casa, 'product not found'). Os códigos NK usados são NK001–NK006 e
-- NK008–NK019.
--
-- Uma tabela ou coluna nova que aponte para products, ou uma mudança no que confirm_receipt grava ou aprende, pede
-- uma decisão aqui também, como em merge_products e delete_product.

-- A despensa de uma linha da nota: a troca acha por aqui as compras que a linha pôs lá (e apagar a nota, pela chave
-- receipt_item_id, também).
create index pantry_items_receipt_item_idx on public.pantry_items (receipt_item_id) where receipt_item_id is not null;

-- A linha incluída na nota já confirmada ("Item", add_confirmed_receipt_item): o texto é o que a pessoa digitou (começa
-- com o nome do produto escolhido), e ela não ensinou apelido nem código. Trocar o produto dela não mexe em apelido:
-- passaria para outro produto o apelido que uma nota impressa ensinou ("LEITE INTEGRAL", o nome de antes), ou criaria
-- um do texto digitado. Só esta função marca; as outras linhas, lidas ou digitadas na revisão, passam pela
-- confirmação, que ensina o apelido delas (falso, o padrão).
alter table public.receipt_items add column added_after_confirmation boolean not null default false;
comment on column public.receipt_items.added_after_confirmation is
  'A linha entrou depois da confirmação (add_confirmed_receipt_item): o texto é da pessoa, e trocar o produto dela não move nem cria apelido.';

-- =============================================================================
-- 1. O app pergunta se este banco já tem as correções
-- =============================================================================
-- "Trocar produto" e "Item" na nota confirmada só aparecem quando esta pergunta responde true: sem a migração, não
-- aparece nada morto. Perguntar às outras duas não serve (gravariam).
create function public.receipt_corrections_available()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select true;
$$;

-- =============================================================================
-- 2. Trocar o produto de uma linha da nota confirmada
-- =============================================================================
-- p_expected_product_id: o produto que a tela mostrava na linha (null: sem produto). p_product_id OU p_new_product
-- ({name, category}): o escolhido. p_shelf_life_days: as validades padrão das categorias do app (CATEGORIES,
-- chave → dias ou null), para refazer a validade estimada da despensa. p_freeze_kind: o tipo do congelador do
-- produto escolhido (domain/freezer freezeKind), ou null quando ele não vai ao congelador.
-- Devolve { product_id, changed, pantry }: changed falso é a linha que já estava no escolhido (a resposta que se
-- perdeu e foi pedida de novo).
create function public.change_receipt_item_product(
  p_receipt_id uuid,
  p_item_id uuid,
  p_expected_product_id uuid,
  p_product_id uuid,
  p_new_product jsonb,
  p_shelf_life_days jsonb,
  p_freeze_kind text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.receipts;
  item public.receipt_items;
  old_p public.products;
  new_p public.products;
  pi public.pantry_items;
  v_target uuid := p_product_id;
  v_new_name text;
  v_new_category text;
  v_key text;
  v_cnpj text;
  v_gtin text;
  v_days numeric;
  v_estimated boolean;
  v_est date;
  v_est_source text;
  v_expires date;
  v_source text;
  v_fresh date;
  v_fresh_source text;
  v_kind text;
  n_pantry integer := 0;
begin
  if (p_product_id is not null) = (coalesce(jsonb_typeof(p_new_product), '') = 'object') then
    raise exception 'choose an existing product or a new one' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_shelf_life_days), '') <> 'object' then
    raise exception 'p_shelf_life_days must be an object' using errcode = '22023';
  end if;
  if p_freeze_kind is not null and p_freeze_kind not in ('carne', 'frango', 'carne_moida', 'peixe', 'pao', 'frios') then
    raise exception 'unknown freeze kind' using errcode = '22023';
  end if;
  if p_product_id is null then
    v_new_name := btrim(coalesce(p_new_product ->> 'name', ''));
    v_new_category := coalesce(nullif(p_new_product ->> 'category', ''), 'outros');
    if v_new_name = '' then
      raise exception 'new product name required' using errcode = '22023';
    end if;
    -- O nome de um produto que a casa já tem é ele (como em confirm_receipt). Achado antes das travas, entra nelas: o
    -- produto que outra pessoa está juntando não é travado no meio, depois da nota.
    select p.id into v_target from public.products p where lower(p.name) = lower(v_new_name);
  end if;

  -- 1. Os produtos conhecidos, na ordem dos ids.
  perform 1 from public.products p where p.id in (p_expected_product_id, v_target) order by p.id for key share;

  -- 2. A nota e a linha, antes de qualquer produto: a nota de outra casa (ou apagada) é 'receipt not found'.
  select * into r from public.receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'receipt not found' using errcode = 'P0002';
  end if;
  if r.status <> 'confirmed' then
    raise exception 'receipt not confirmed' using errcode = 'NK019';
  end if;
  select * into item from public.receipt_items ri where ri.id = p_item_id and ri.receipt_id = r.id for update;
  if not found then
    raise exception 'item not found' using errcode = 'P0002';
  end if;

  -- 3. O produto escolhido (o de outra casa a RLS não mostra: 'product not found').
  if v_target is not null then
    select * into new_p from public.products p where p.id = v_target;
  end if;
  if new_p.id is null and p_product_id is not null then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  -- 4. A resposta que se perdeu e foi pedida de novo: a linha já está no escolhido. Não é erro, e nada muda.
  if new_p.id is not null and item.product_id = new_p.id then
    return jsonb_build_object('product_id', new_p.id, 'changed', false, 'pantry', 0);
  end if;
  if item.product_id is distinct from p_expected_product_id then
    raise exception 'receipt item changed' using errcode = 'NK018';
  end if;

  -- 5. Produto novo só depois das recusas: troca recusada não cria nada.
  if new_p.id is null then
    insert into public.products (household_id, name, category)
    values (r.household_id, v_new_name, v_new_category)
    on conflict (household_id, lower(name)) do update set name = public.products.name
    returning * into new_p;
  end if;
  if item.product_id is not null then
    select * into old_p from public.products p where p.id = item.product_id;
  end if;

  -- 6. A linha: histórico de preço, gastos, Mercado do mês e comparativo leem daqui. A contagem da embalagem é dos ovos
  -- (domain/packCount); em outro produto ela dividiria o preço no histórico e na lista.
  update public.receipt_items
    set product_id = new_p.id,
        pack_count = case when new_p.category = 'ovos' then item.pack_count end
    where id = item.id;

  -- 7. O apelido: passa se ainda é do produto de antes; nasce se ninguém ensinou; o de um terceiro fica. A linha
  -- incluída depois da confirmação não ensinou nenhum (o texto é da pessoa): nada passa nem nasce dela.
  v_key := public.normalize_alias(item.raw_description);
  if v_key <> '' and not item.added_after_confirmation then
    if old_p.id is not null then
      update public.product_aliases a set product_id = new_p.id
        where a.household_id = r.household_id and a.alias = v_key and a.product_id = old_p.id;
    end if;
    insert into public.product_aliases (household_id, alias, product_id)
    values (r.household_id, v_key, new_p.id)
    on conflict (household_id, alias) do nothing;
  end if;

  -- 8. Os códigos da linha, no mercado de agora da nota. O do mercado segue a regra de confirm_receipt (outro produto
  -- com outra descrição deixa ambíguo para sempre; ambíguo não volta); o de barras passa ou nasce. O de outro fica.
  if item.store_code is not null then
    select s.cnpj into v_cnpj from public.stores s where s.id = r.store_id and s.household_id = r.household_id;
    if v_cnpj is not null then
      if old_p.id is not null then
        update public.product_store_codes c
          set ambiguous = c.ambiguous or c.learned_from <> v_key,
              product_id = new_p.id,
              learned_from = v_key,
              updated_at = now()
          where c.household_id = r.household_id and c.store_cnpj = v_cnpj and c.store_code = item.store_code
            and c.product_id = old_p.id;
      end if;
      insert into public.product_store_codes (household_id, store_cnpj, store_code, product_id, learned_from)
      values (r.household_id, v_cnpj, item.store_code, new_p.id, v_key)
      on conflict (household_id, store_cnpj, store_code) do nothing;
    end if;
    v_gtin := public.gtin_key(item.store_code);
    if v_gtin is not null then
      if old_p.id is not null then
        update public.product_barcodes b set product_id = new_p.id, updated_at = now()
          where b.household_id = r.household_id and b.gtin = v_gtin and b.product_id = old_p.id;
      end if;
      insert into public.product_barcodes (household_id, gtin, product_id)
      values (r.household_id, v_gtin, new_p.id)
      on conflict (household_id, gtin) do nothing;
    end if;
  end if;

  -- 9. A despensa: o que esta linha pôs lá (aberto ou já usado) passa para o produto novo, com o nome e a categoria
  -- dele: a troca é a pessoa dizendo o que esta compra é. Nunca nasce nem some entrada.
  --  - Fora do congelador: a validade estimada (categoria, produto, ou nenhuma) se refaz do dia da compra, com a
  --    validade aprendida do produto novo, senão a padrão da categoria dele; a digitada (manual) fica; categoria fora
  --    do mapa deixa a data.
  --  - No congelador: o tipo passa a ser o do produto novo (p_freeze_kind; null deixa o de antes, e "Descongelei"
  --    resolve), e o gatilho pantry_items_freezer_expiry refaz a validade 'congelado'; a validade de antes do
  --    congelador se refaz pela mesma regra, a não ser na compra que já estava vencida quando foi congelada (ela
  --    ficou com a validade de antes, e assim continua).
  --  - Descongelada: as datas e o tipo ficam.
  for pi in
    select * from public.pantry_items p
      where p.receipt_item_id = item.id and p.household_id = r.household_id
      order by p.id
      for update
  loop
    v_estimated := true;
    if coalesce(new_p.shelf_life_days, 0) > 0 then
      v_est := pi.purchased_on + new_p.shelf_life_days;
      v_est_source := 'produto';
    elsif p_shelf_life_days ? new_p.category then
      v_days := case when jsonb_typeof(p_shelf_life_days -> new_p.category) = 'number'
                     then (p_shelf_life_days ->> new_p.category)::numeric end;
      if v_days between 1 and 3650 then
        v_est := pi.purchased_on + v_days::integer;
        v_est_source := 'categoria';
      else
        v_est := null;
        v_est_source := null;
      end if;
    else
      v_estimated := false;
    end if;

    v_expires := pi.expires_on;
    v_source := pi.expiry_source;
    v_fresh := pi.fresh_expires_on;
    v_fresh_source := pi.fresh_expiry_source;
    v_kind := pi.freeze_kind;
    if pi.frozen_on is null then
      if v_estimated
         and (pi.expiry_source in ('categoria', 'produto') or (pi.expiry_source is null and pi.expires_on is null)) then
        v_expires := v_est;
        v_source := v_est_source;
      end if;
    elsif pi.thawed_on is null then
      v_kind := coalesce(p_freeze_kind, pi.freeze_kind);
      -- No congelador, 'categoria', 'produto' e 'descongelado' são a validade de antes, que ficou porque já tinha
      -- passado quando a compra foi congelada (freeze_pantry_items, frozenExpiryFor).
      if v_estimated and coalesce(pi.expiry_source, '') not in ('categoria', 'produto', 'descongelado')
         and (pi.fresh_expiry_source in ('categoria', 'produto')
              or (pi.fresh_expiry_source is null and pi.fresh_expires_on is null)) then
        v_fresh := v_est;
        v_fresh_source := v_est_source;
      end if;
    end if;

    update public.pantry_items
      set product_id = new_p.id,
          name = new_p.name,
          category = new_p.category,
          expires_on = v_expires,
          expiry_source = v_source,
          freeze_kind = v_kind,
          fresh_expires_on = v_fresh,
          fresh_expiry_source = v_fresh_source
      where id = pi.id;
    n_pantry := n_pantry + 1;
  end loop;

  return jsonb_build_object('product_id', new_p.id, 'changed', true, 'pantry', n_pantry);
end;
$$;

-- =============================================================================
-- 3. Incluir na nota confirmada o item que a leitura perdeu
-- =============================================================================
-- p_item: { id (feito no aparelho), raw_description, quantity, unit, unit_price, total_price (> 0),
--           product_id | new_product: {name, category},
--           pantry?: {name, category, purchased_on, expires_on, expiry_source,
--                     frozen_on?, freeze_kind?, fresh_expires_on?, fresh_expiry_source?} }
-- Devolve { item_id, added, same, product_id, pantry_item_id }: added falso é o mesmo id outra vez (a resposta do
-- primeiro se perdeu), e same diz se o pedido de agora é o mesmo que entrou.
create function public.add_confirmed_receipt_item(p_receipt_id uuid, p_item jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.receipts;
  new_p public.products;
  v_existing public.receipt_items;
  v_id uuid;
  v_target uuid;
  v_by_id boolean;
  v_new_name text;
  v_new_category text;
  v_description text;
  v_quantity numeric(12, 3);
  v_unit text;
  v_unit_price numeric(12, 4);
  v_total numeric(12, 2);
  v_pantry jsonb;
  v_position integer;
  v_pantry_id uuid;
  v_purchased date;
  v_expires date;
  v_frozen date;
begin
  if coalesce(jsonb_typeof(p_item), '') <> 'object' then
    raise exception 'p_item must be an object' using errcode = '22023';
  end if;
  v_id := nullif(p_item ->> 'id', '')::uuid;
  v_target := nullif(p_item ->> 'product_id', '')::uuid;
  v_by_id := v_target is not null;
  v_description := btrim(coalesce(p_item ->> 'raw_description', ''));
  v_quantity := (p_item ->> 'quantity')::numeric;
  v_unit := coalesce(nullif(p_item ->> 'unit', ''), 'un');
  v_unit_price := (p_item ->> 'unit_price')::numeric;
  v_total := (p_item ->> 'total_price')::numeric;
  v_pantry := case when jsonb_typeof(p_item -> 'pantry') = 'object' then p_item -> 'pantry' end;
  v_frozen := case when v_pantry is null then null else nullif(v_pantry ->> 'frozen_on', '')::date end;
  if v_id is null or v_description = '' then
    raise exception 'item id and description required' using errcode = '22023';
  end if;
  -- O item que faltou entra pelo que foi pago: sem valor não é o que esta função inclui (o brinde vai pela despensa).
  if not (v_quantity > 0) or not (v_unit_price >= 0) or not (v_total > 0) then
    raise exception 'item quantity and value required' using errcode = '22023';
  end if;
  if v_by_id = (coalesce(jsonb_typeof(p_item -> 'new_product'), '') = 'object') then
    raise exception 'choose an existing product or a new one' using errcode = '22023';
  end if;
  if not v_by_id then
    v_new_name := btrim(coalesce(p_item -> 'new_product' ->> 'name', ''));
    v_new_category := coalesce(nullif(p_item -> 'new_product' ->> 'category', ''), 'outros');
    if v_new_name = '' then
      raise exception 'new product name required' using errcode = '22023';
    end if;
    select p.id into v_target from public.products p where lower(p.name) = lower(v_new_name);
  end if;

  -- As travas: o produto conhecido, depois a nota (a ordem de change_receipt_item_product).
  if v_target is not null then
    perform 1 from public.products p where p.id = v_target for key share;
  end if;
  select * into r from public.receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'receipt not found' using errcode = 'P0002';
  end if;
  if r.status <> 'confirmed' then
    raise exception 'receipt not confirmed' using errcode = 'NK019';
  end if;

  -- O mesmo id outra vez (a resposta do primeiro se perdeu): o item já está na nota. `same` diz se o pedido de agora
  -- é o mesmo; se a pessoa mudou algo antes de mandar de novo, nada é gravado e o app avisa (ADDED_BEFORE).
  select * into v_existing from public.receipt_items ri where ri.id = v_id;
  if v_existing.id is not null then
    if v_existing.receipt_id <> r.id then
      raise exception 'item id already used' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'item_id', v_id,
      'added', false,
      'product_id', v_existing.product_id,
      'same', v_existing.raw_description = v_description
        and v_existing.quantity = v_quantity
        and v_existing.unit = v_unit
        and v_existing.unit_price = v_unit_price
        and v_existing.total_price = v_total
        and v_existing.product_id is not distinct from v_target
        and exists (select 1 from public.pantry_items p where p.receipt_item_id = v_id) = (v_pantry is not null)
        and not exists (select 1 from public.pantry_items p where p.receipt_item_id = v_id and p.frozen_on is distinct from v_frozen));
  end if;

  if v_target is not null then
    select * into new_p from public.products p where p.id = v_target;
  end if;
  if new_p.id is null and v_by_id then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
  if new_p.id is null then
    insert into public.products (household_id, name, category)
    values (r.household_id, v_new_name, v_new_category)
    on conflict (household_id, lower(name)) do update set name = public.products.name
    returning * into new_p;
  end if;

  select coalesce(max(ri.position), -1) + 1 into v_position from public.receipt_items ri where ri.receipt_id = r.id;
  -- Sem código, item genérico nem sugestão: o texto é da pessoa. Não ensina apelido, código nem validade, nem agora
  -- nem quando o produto dela for trocado (added_after_confirmation).
  insert into public.receipt_items (
    id, household_id, receipt_id, position, raw_description, product_id, quantity, unit, unit_price, total_price,
    added_after_confirmation
  ) values (
    v_id, r.household_id, r.id, v_position, v_description, new_p.id, v_quantity, v_unit, v_unit_price, v_total, true
  );

  -- A despensa, como confirm_receipt: o congelador só com frozen_on (a linha "Congelei"), e a validade 'congelado' o
  -- gatilho pantry_items_freezer_expiry refaz.
  if v_pantry is not null then
    v_purchased := coalesce(nullif(v_pantry ->> 'purchased_on', '')::date, current_date);
    v_expires := nullif(v_pantry ->> 'expires_on', '')::date;
    insert into public.pantry_items (
      household_id, product_id, name, category, quantity, unit,
      purchased_on, expires_on, expiry_source, receipt_item_id,
      frozen_on, freeze_kind, fresh_expires_on, fresh_expiry_source
    ) values (
      r.household_id,
      new_p.id,
      coalesce(nullif(btrim(v_pantry ->> 'name'), ''), new_p.name),
      coalesce(nullif(v_pantry ->> 'category', ''), new_p.category),
      v_quantity,
      v_unit,
      v_purchased,
      v_expires,
      case when v_expires is null then null else nullif(v_pantry ->> 'expiry_source', '') end,
      v_id,
      v_frozen,
      case when v_frozen is null then null else nullif(v_pantry ->> 'freeze_kind', '') end,
      case when v_frozen is null then null else nullif(v_pantry ->> 'fresh_expires_on', '')::date end,
      case when v_frozen is null or nullif(v_pantry ->> 'fresh_expires_on', '') is null then null
           else nullif(v_pantry ->> 'fresh_expiry_source', '') end
    )
    returning id into v_pantry_id;
  end if;

  return jsonb_build_object('item_id', v_id, 'added', true, 'same', true, 'product_id', new_p.id, 'pantry_item_id', v_pantry_id);
end;
$$;

comment on function public.receipt_corrections_available() is
  'O banco já tem as correções da nota confirmada ("Trocar produto" e "Item"): o app só as mostra quando responde true.';
comment on function public.change_receipt_item_product(uuid, uuid, uuid, uuid, jsonb, jsonb, text) is
  'Troca o produto de uma linha da nota confirmada: a linha, a despensa, o apelido e os códigos que ela ensinou passam para o produto escolhido (a linha incluída depois da confirmação não ensinou apelido: nenhum passa nem nasce). NK018 quando a linha já não está no produto esperado; NK019 quando a nota não está confirmada.';
comment on function public.add_confirmed_receipt_item(uuid, jsonb) is
  'Inclui na nota confirmada o item que a leitura perdeu, com valor, e põe na despensa quando pedido. O mesmo id de novo não cria outra linha (added falso, same diz se o pedido é o mesmo). NK019 quando a nota não está confirmada.';

revoke execute on function public.receipt_corrections_available() from public, anon;
revoke execute on function public.change_receipt_item_product(uuid, uuid, uuid, uuid, jsonb, jsonb, text) from public, anon;
revoke execute on function public.add_confirmed_receipt_item(uuid, jsonb) from public, anon;
grant execute on function public.receipt_corrections_available() to authenticated;
grant execute on function public.change_receipt_item_product(uuid, uuid, uuid, uuid, jsonb, jsonb, text) to authenticated;
grant execute on function public.add_confirmed_receipt_item(uuid, jsonb) to authenticated;
