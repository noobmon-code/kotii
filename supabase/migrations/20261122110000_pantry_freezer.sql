-- Congelador da despensa: a compra que vai para o congelador ganha a validade do congelador (o dia em que foi
-- congelada + o tempo do tipo dela, fixo: o mesmo de DEFAULT_FREEZE_DAYS em src/domain/freezer.ts, que um teste Jest
-- lê daqui). "Descongelei" volta a contar a validade de antes de onde ela parou. Não há tempos por casa (decisão do
-- dono de 2026-11-21: um tempo fixo por tipo).
--
-- O app pode chegar antes desta migração: os controles do congelador só aparecem quando pantry_freezer_available()
-- responde true, e as leituras da despensa repetem sem as colunas novas. Um app antigo lê 'congelado' e
-- 'descongelado' como uma origem qualquer e devolve a linha como leu; o gatilho abaixo refaz a data de 'congelado'.
-- Nenhum código NK novo: o que mudou no meio volta como menos linhas (os usados são NK001–NK006 e NK008–NK019,
-- NK018 e NK019 os da correção de nota confirmada).

-- =============================================================================
-- 1. A compra no congelador
-- =============================================================================
alter table public.pantry_items
  add column frozen_on date,            -- dia em que foi congelada (null: nunca, ou desfeito no mesmo dia)
  add column thawed_on date,            -- dia em que saiu (null: ainda no congelador, ou nunca foi)
  add column freeze_kind text,          -- o tipo da tabela do congelador
  add column fresh_expires_on date,     -- a validade de antes do congelador (só enquanto congelada)
  add column fresh_expiry_source text,
  -- A compra descongelada que voltou para o congelador: o dia em que tinha sido congelada e o dia em que tinha saído
  -- (só enquanto congelada de novo; quem grava é o gatilho pantry_items_freezer_history). Descongelar no mesmo dia
  -- desfaz e volta para ela, descongelada: sem isto, a compra pareceria nunca ter ido ao congelador, e a validade
  -- digitada depois ensinaria o produto.
  add column prev_frozen_on date,
  add column prev_thawed_on date;

alter table public.pantry_items drop constraint if exists pantry_items_expiry_source_check;
alter table public.pantry_items
  add constraint pantry_items_expiry_source_check
    check (expiry_source in ('categoria', 'produto', 'manual', 'congelado', 'descongelado')),
  add constraint pantry_items_fresh_expiry_source_check
    check (fresh_expiry_source in ('categoria', 'produto', 'manual', 'descongelado')),
  add constraint pantry_items_freeze_kind_check
    check (freeze_kind in ('carne', 'frango', 'carne_moida', 'peixe', 'pao', 'frios')),
  add constraint pantry_items_freeze_kind_with_day check ((frozen_on is null) = (freeze_kind is null)),
  add constraint pantry_items_frozen_on_range check (frozen_on between date '2000-01-01' and date '2100-12-31'),
  add constraint pantry_items_thawed_after_frozen check (
    thawed_on is null or (frozen_on is not null and thawed_on between frozen_on and date '2100-12-31')),
  add constraint pantry_items_fresh_while_frozen check (
    fresh_expires_on is null or (frozen_on is not null and thawed_on is null)),
  add constraint pantry_items_fresh_source_with_date check (fresh_expiry_source is null or fresh_expires_on is not null),
  -- 'congelado' é a validade do congelador: só enquanto a compra está nele.
  add constraint pantry_items_congelado_in_freezer check (
    expiry_source is distinct from 'congelado' or (frozen_on is not null and thawed_on is null)),
  -- 'descongelado' é a validade de quem saiu do congelador: a compra guarda que esteve nele (e não ensina o produto).
  add constraint pantry_items_descongelado_was_frozen check (expiry_source is distinct from 'descongelado' or frozen_on is not null),
  -- A de antes 'descongelado' é de uma compra que voltou ao congelador, e o desfazer volta para a descongelada.
  add constraint pantry_items_fresh_descongelado_refrozen check (
    fresh_expiry_source is distinct from 'descongelado' or prev_frozen_on is not null),
  add constraint pantry_items_prev_while_frozen check (
    prev_frozen_on is null or (frozen_on is not null and thawed_on is null)),
  add constraint pantry_items_prev_pair check ((prev_frozen_on is null) = (prev_thawed_on is null)),
  add constraint pantry_items_prev_range check (
    prev_frozen_on between date '2000-01-01' and date '2100-12-31'
    and prev_thawed_on between prev_frozen_on and date '2100-12-31');

-- Não há check frozen_on >= purchased_on: um app antigo pode mudar a data da compra de um item congelado, e esse
-- salvar não pode começar a falhar. O app e freeze_pantry_items já não congelam antes da compra.

-- =============================================================================
-- 2. O tempo de cada tipo no congelador (= DEFAULT_FREEZE_DAYS; um teste Jest lê este case)
-- =============================================================================
create function public.pantry_freeze_days(p_kind text)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_kind
    when 'carne' then 90 when 'frango' then 90 when 'carne_moida' then 60
    when 'peixe' then 60 when 'pao' then 60 when 'frios' then 30
  end;
$$;

-- =============================================================================
-- 3. O banco tem a palavra final sobre a validade do congelador
-- =============================================================================
-- Quem grava 'congelado' (o formulário, a nota, congelar, um app antigo que devolve a linha como leu) fica com a
-- data do tempo do tipo, não com a que o aparelho calculou. A data digitada é 'manual' e fica.
create function public.pantry_items_freezer_expiry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.expiry_source = 'congelado' and new.frozen_on is not null and new.freeze_kind is not null then
    new.expires_on := new.frozen_on + public.pantry_freeze_days(new.freeze_kind);
  end if;
  return new;
end;
$$;
create trigger pantry_items_freezer_expiry
  before insert or update of expires_on, expiry_source, frozen_on, freeze_kind on public.pantry_items
  for each row execute function public.pantry_items_freezer_expiry();

-- A compra descongelada que volta para o congelador (congelar, ou "Congelei" no item) guarda de onde veio, em
-- prev_frozen_on e prev_thawed_on, para o descongelar no mesmo dia voltar a ela. Só este gatilho escreve as duas:
-- quem fica no congelador fica com as de antes, e quem está fora dele (descongelada, nunca congelada, desfeita)
-- fica sem.
create function public.pantry_items_freezer_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.frozen_on is not null and new.thawed_on is null and old.frozen_on is not null then
    if old.thawed_on is not null then
      new.prev_frozen_on := old.frozen_on;
      new.prev_thawed_on := old.thawed_on;
    else
      new.prev_frozen_on := old.prev_frozen_on;
      new.prev_thawed_on := old.prev_thawed_on;
    end if;
  else
    new.prev_frozen_on := null;
    new.prev_thawed_on := null;
  end if;
  return new;
end;
$$;
create trigger pantry_items_freezer_history
  before insert or update of frozen_on, thawed_on, prev_frozen_on, prev_thawed_on on public.pantry_items
  for each row execute function public.pantry_items_freezer_history();

-- =============================================================================
-- 4. confirm_receipt: a versão de 20261021150000_store_codes.sql, igual em tudo, mais o congelador. A linha que a
-- pessoa marcou "Congelei" na revisão traz frozen_on (o dia da compra), freeze_kind e a validade de antes
-- (fresh_expires_on, fresh_expiry_source); a validade 'congelado' o gatilho acima refaz. A validade digitada numa
-- linha congelada não ensina o produto: seria a do congelador.
--
-- p_items: [{ id, product_id?, new_product?: {name, category},
--             pantry?: {name, category, purchased_on, expires_on, expiry_source,
--                       frozen_on?, freeze_kind?, fresh_expires_on?, fresh_expiry_source?},
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
  v_frozen date;
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
        -- No set, product_store_codes.* é a linha de antes: outro produto com
        -- outra descrição marca o código como ambíguo (e a marca nunca sai).
        -- Duas linhas desta nota com o mesmo código caem aqui também.
        insert into public.product_store_codes (household_id, store_cnpj, store_code, product_id, learned_from)
        values (r.household_id, v_cnpj, item.store_code, v_product_id, public.normalize_alias(item.raw_description))
        on conflict (household_id, store_cnpj, store_code)
          do update set
            ambiguous = public.product_store_codes.ambiguous
              or (public.product_store_codes.product_id <> excluded.product_id
                  and public.product_store_codes.learned_from <> excluded.learned_from),
            product_id = excluded.product_id,
            learned_from = excluded.learned_from,
            updated_at = now();
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
      v_frozen := nullif(v_pantry ->> 'frozen_on', '')::date;

      insert into public.pantry_items (
        household_id, product_id, name, category, quantity, unit,
        purchased_on, expires_on, expiry_source, receipt_item_id,
        frozen_on, freeze_kind, fresh_expires_on, fresh_expiry_source
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
        item.id,
        v_frozen,
        case when v_frozen is null then null else nullif(v_pantry ->> 'freeze_kind', '') end,
        case when v_frozen is null then null else nullif(v_pantry ->> 'fresh_expires_on', '')::date end,
        case when v_frozen is null or nullif(v_pantry ->> 'fresh_expires_on', '') is null then null
             else nullif(v_pantry ->> 'fresh_expiry_source', '') end
      );

      -- Validade digitada vira a validade aprendida do produto; a de quem foi para o congelador, não.
      if v_pantry ->> 'expiry_source' = 'manual' and v_expires is not null and v_product_id is not null
         and v_frozen is null then
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
-- 5. Congelar
-- =============================================================================
-- Security invoker: a RLS da casa vale (id de outra casa não acha linha). As compras são travadas em ordem de id
-- antes de mudar, como em thaw_pantry_items: entre as duas, sem 40P01. O dia de cada compra é o pedido, nunca
-- antes da compra nem de quando ela saiu do congelador ("Congelei no dia de cada compra" manda o dia da mais
-- antiga, e cada uma fica com o seu). Já vencida antes desse dia: a validade de antes fica (o congelador não a
-- devolve), e a compra vai para o congelador do mesmo jeito. Devolve as compras que mudou: a consumida, a que já
-- está no congelador e a que não é da casa ficam de fora.
create function public.freeze_pantry_items(p_ids uuid[], p_kind text, p_frozen_on date)
returns table (item_id uuid, item_expires_on date, item_expiry_source text, item_frozen_on date)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[] := coalesce(p_ids, '{}'::uuid[]);
begin
  if p_kind is null or p_kind not in ('carne', 'frango', 'carne_moida', 'peixe', 'pao', 'frios') then
    raise exception 'unknown freeze kind' using errcode = '22023';
  end if;
  if p_frozen_on is null or p_frozen_on not between date '2000-01-01' and date '2100-12-31' then
    raise exception 'freeze day out of range' using errcode = '22023';
  end if;
  perform 1 from public.pantry_items p where p.id = any(v_ids) order by p.id for update;
  return query
    with changed as (
      update public.pantry_items p set
        fresh_expires_on = p.expires_on,
        fresh_expiry_source = case when p.expires_on is null then null else p.expiry_source end,
        frozen_on = d.day,
        thawed_on = null,
        freeze_kind = p_kind,
        expires_on = case when p.expires_on < d.day then p.expires_on
                          else d.day + public.pantry_freeze_days(p_kind) end,
        expiry_source = case when p.expires_on < d.day then p.expiry_source else 'congelado' end
      from (select q.id, greatest(p_frozen_on, q.purchased_on, coalesce(q.thawed_on, q.purchased_on)) as day
              from public.pantry_items q where q.id = any(v_ids)) d
      where p.id = d.id and p.consumed_at is null
        and (p.frozen_on is null or p.thawed_on is not null)
      returning p.id, p.expires_on, p.expiry_source, p.frozen_on
    )
    select * from changed;
end;
$$;

-- =============================================================================
-- 6. Descongelar
-- =============================================================================
-- O congelador pausa a validade: o que faltava quando foi congelada (ou o quanto já tinha passado) volta a contar
-- do dia em que saiu, com a origem 'descongelado'. No mesmo dia em que foi congelada (ou antes, com o relógio de
-- um aparelho atrasado), desfaz: a compra volta a ser o que era, com a validade de antes. A que nunca tinha ido ao
-- congelador volta sem congelador; a descongelada que tinha voltado para ele volta a ser a descongelada (os dias
-- que o gatilho guardou em prev_frozen_on e prev_thawed_on; o tipo fica o desta vez), e continua sem ensinar o
-- produto. domain/freezer.ts thawedExpiry é o espelho da validade (os mesmos casos no Jest e em
-- scripts/db/test.sql). item_undone diz qual compra foi desfeita: o aviso do app (thawedText) fala do que o banco
-- fez, como a prévia fala do que faria, e frozen_on não basta para isso (a descongelada desfeita volta com o dia
-- em que tinha sido congelada antes).
create function public.thaw_pantry_items(p_ids uuid[], p_thawed_on date)
returns table (item_id uuid, item_expires_on date, item_expiry_source text, item_frozen_on date, item_undone boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[] := coalesce(p_ids, '{}'::uuid[]);
begin
  if p_thawed_on is null or p_thawed_on not between date '2000-01-01' and date '2100-12-31' then
    raise exception 'thaw day out of range' using errcode = '22023';
  end if;
  perform 1 from public.pantry_items p where p.id = any(v_ids) order by p.id for update;
  return query
    with changed as (
      update public.pantry_items p set
        expires_on = case
          when p_thawed_on <= p.frozen_on then p.fresh_expires_on
          when p.fresh_expires_on is null then null
          else p_thawed_on + (p.fresh_expires_on - p.frozen_on) end,
        expiry_source = case
          when p_thawed_on <= p.frozen_on then p.fresh_expiry_source
          when p.fresh_expires_on is null then null
          else 'descongelado' end,
        thawed_on = case when p_thawed_on <= p.frozen_on then p.prev_thawed_on else p_thawed_on end,
        frozen_on = case when p_thawed_on <= p.frozen_on then p.prev_frozen_on else p.frozen_on end,
        freeze_kind = case when p_thawed_on <= p.frozen_on and p.prev_frozen_on is null then null else p.freeze_kind end,
        fresh_expires_on = null,
        fresh_expiry_source = null,
        prev_frozen_on = null,
        prev_thawed_on = null
      from (select q.id, q.frozen_on from public.pantry_items q where q.id = any(v_ids)) o
      where p.id = o.id and p.consumed_at is null
        and p.frozen_on is not null and p.thawed_on is null
      returning p.id, p.expires_on, p.expiry_source, p.frozen_on, p_thawed_on <= o.frozen_on
    )
    select * from changed;
end;
$$;

-- =============================================================================
-- 7. O app pergunta se este banco já tem o congelador
-- =============================================================================
-- Os controles que congelam (o menu da despensa, o "Congelei" do item e o "Congelou?" da nota) só aparecem quando
-- esta pergunta responde true: sem a migração, uma linha "Congelei" levaria 'congelado' a um check que não o
-- aceita, e a nota inteira falharia. Perguntar a freeze_pantry_items não serve (congelaria).
create function public.pantry_freezer_available()
returns boolean
language sql
stable
set search_path = ''
as $$
  select true;
$$;

revoke execute on function public.pantry_freeze_days(text) from public, anon;
revoke execute on function public.pantry_items_freezer_expiry() from public, anon, authenticated;
revoke execute on function public.pantry_items_freezer_history() from public, anon, authenticated;
revoke execute on function public.freeze_pantry_items(uuid[], text, date) from public, anon;
revoke execute on function public.thaw_pantry_items(uuid[], date) from public, anon;
revoke execute on function public.pantry_freezer_available() from public, anon;
-- O gatilho roda como quem grava: quem grava precisa poder ler o tempo do tipo.
grant execute on function public.pantry_freeze_days(text) to authenticated, service_role;
grant execute on function public.freeze_pantry_items(uuid[], text, date) to authenticated;
grant execute on function public.thaw_pantry_items(uuid[], date) to authenticated;
grant execute on function public.pantry_freezer_available() to authenticated;
