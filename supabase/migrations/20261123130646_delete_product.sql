-- Excluir um produto que não está em nenhuma nota. Os produtos da casa nascem de uma nota confirmada ou do código
-- de barras lido pela câmera ("Qual produto é este?"), e ficam quando a nota que os criou é excluída: um nome
-- errado, ou um produto que ninguém compra, só atrapalha nos seletores e nas sugestões de juntar. O produto que
-- está em alguma nota guarda o histórico de preços e os gastos dos meses: para ele o caminho é juntar.

-- =============================================================================
-- 1. O código de mercado ambíguo sobrevive ao produto.
-- =============================================================================
-- Cada linha de product_store_codes guarda o último produto que o código ensinou, e o código que ensinou dois
-- produtos com duas descrições fica ambíguo para sempre (20261021150000_store_codes.sql): match_store_codes deixa
-- de usá-lo naquele mercado. Com a chave em cascade, o produto apagado levava a linha e a marca, e o código
-- genérico (o 1 de todo o hortifruti a granel) voltava a valer na nota seguinte. Agora a linha ambígua fica, sem
-- produto: ninguém lê o produto de uma linha ambígua (match_store_codes a ignora; confirm_receipt troca o produto e
-- mantém a marca, "ambiguous or ..."), e merge_products só mexe nas linhas que apontam para o produto que some. A
-- linha que não é ambígua continua saindo com o produto, pelo gatilho abaixo.
--
-- Não é um check (product_id is not null or ambiguous): ao apagar uma casa, o Postgres apaga os produtos e estas
-- linhas por duas chaves, numa ordem que depende do nome interno dos gatilhos; com os produtos antes, o set null
-- numa linha que não é ambígua violaria o check, e a casa não sairia (o último morador que sai, a conta apagada).
-- O gatilho roda depois do set null, em qualquer ordem.
alter table public.product_store_codes alter column product_id drop not null;
alter table public.product_store_codes drop constraint product_store_codes_product_id_household_id_fkey;
alter table public.product_store_codes add constraint product_store_codes_product_id_household_id_fkey
  foreign key (product_id, household_id) references public.products (id, household_id) on delete set null (product_id);

-- A linha sem produto que não é ambígua não ensina nada (e confirm_receipt, que calcula a marca com o produto de
-- antes, daria null onde a coluna não aceita): sai. Vale para o set null da chave (que roda como dona da tabela e
-- dispara este gatilho) e para quem grava direto pela API.
create function public.product_store_codes_forget_unlinked()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.product_store_codes c
    where c.household_id = new.household_id and c.store_cnpj = new.store_cnpj and c.store_code = new.store_code
      and c.product_id is null and not c.ambiguous;
  return null;
end;
$$;
-- O gatilho dispara sem esse direito: ninguém precisa chamar a função.
revoke execute on function public.product_store_codes_forget_unlinked() from public, anon, authenticated;

create trigger product_store_codes_forget_unlinked
  after insert or update of product_id, ambiguous on public.product_store_codes
  for each row
  when (new.product_id is null and not new.ambiguous)
  execute function public.product_store_codes_forget_unlinked();

-- =============================================================================
-- 2. O produto que está numa nota não sai por um delete direto pela API.
-- =============================================================================
-- Nenhuma versão do app apaga produto direto (a política de products é "for all", então dava). Só sai por
-- delete_product, que recusa antes, ou por merge_products, que passa as linhas de nota antes de apagar. "Direto
-- pela API" é o current_user ser o papel da API, como em chores_turn_not_by_hand: as funções security definer
-- (leave_household_as, delete_account_data) e as ações das chaves (a casa apagada leva produtos e notas, que o
-- Postgres roda como dona da tabela) passam. A leitura é com os direitos de quem apaga: as linhas de nota do
-- produto são da casa dele (chave composta), à vista pela RLS.
create function public.products_keep_receipt_lines()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if exists (
      select 1 from public.receipt_items ri
      join public.receipts r on r.id = ri.receipt_id
      where ri.product_id = old.id and r.status = 'confirmed'
    ) then
      raise exception 'product has purchases' using errcode = 'NK016';
    end if;
    if exists (select 1 from public.receipt_items ri where ri.product_id = old.id) then
      raise exception 'product is on a receipt under review' using errcode = 'NK017';
    end if;
  end if;
  return old;
end;
$$;
revoke execute on function public.products_keep_receipt_lines() from public, anon, authenticated;

create trigger products_keep_receipt_lines
  before delete on public.products
  for each row
  execute function public.products_keep_receipt_lines();

-- =============================================================================
-- 3. delete_product: excluir o produto que não está em nenhuma nota.
-- =============================================================================
-- O que aponta para o produto (as mesmas tabelas de merge_products; scripts/db/test.sql confere a lista e o que
-- a chave faz com cada uma):
--   receipt_items: nenhum, nem de rascunho. Com nota confirmada, NK016; só com rascunho, NK017: o item da nota
--     em revisão perderia o produto e, confirmado, criaria outro igual pelo nome da nota.
--   pantry_items, shopping_list_items, purchase_history (set null): ficam, com o nome e a categoria deles, sem o
--     produto. O que está na despensa e na lista continua lá.
--   product_aliases, list_item_links, product_barcodes, product_distinct_pairs (cascade): saem com o produto.
--   product_store_codes (set null, parte 1): a linha ambígua fica sem produto; as outras saem.
-- Uma tabela nova que aponte para products precisa de uma decisão aqui e em merge_products.
--
-- security invoker, como merge_products: o produto precisa estar à vista de quem chama (a RLS da casa; o de outra
-- casa é "não encontrado"), e apagar um produto da casa a pessoa já podia pela API. As ações das chaves (set null,
-- cascade) são do banco e não passam pela RLS.
--
-- p_name: o nome que a pessoa leu na pergunta. Entre a leitura e o toque, outro aparelho pode renomear o produto;
-- com ele travado, o nome dado que não for exatamente o da linha recusa com NK008 (o código de merge_products),
-- antes de qualquer mudança. Sem o nome (null), não há conferência.
--
-- Devolve o que perdeu a ligação: pantry (itens abertos da despensa), list (itens de listas abertas) e barcodes.
create function public.delete_product(p_id uuid, p_name text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  gone public.products;
  n_pantry integer;
  n_list integer;
  n_barcodes integer;
  n_deleted integer;
begin
  if p_id is null then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
  -- A trava segura quem renomeia, quem junta (merge_products trava os produtos na ordem dos ids) e quem grava uma
  -- linha que aponta para ele: a chave estrangeira de uma linha nova ou trocada espera esta transação e, depois
  -- dela, não acha o produto (23503, que o app já trata). A linha gravada antes da trava já está à vista abaixo.
  select * into gone from public.products p where p.id = p_id for update;
  if gone.id is null then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
  -- Depois de "não encontrado": quem não vê o produto (outra casa) não fica sabendo se acertou o nome dele.
  if p_name is not null and p_name <> gone.name then
    raise exception 'product renamed' using errcode = 'NK008';
  end if;
  -- As mesmas recusas do gatilho products_keep_receipt_lines, aqui também para quem passa por cima dele (service_role).
  if exists (
    select 1 from public.receipt_items ri
    join public.receipts r on r.id = ri.receipt_id
    where ri.product_id = gone.id and r.status = 'confirmed'
  ) then
    raise exception 'product has purchases' using errcode = 'NK016';
  end if;
  if exists (select 1 from public.receipt_items ri where ri.product_id = gone.id) then
    raise exception 'product is on a receipt under review' using errcode = 'NK017';
  end if;

  select count(*) into n_pantry from public.pantry_items i where i.product_id = gone.id and i.consumed_at is null;
  select count(*) into n_list
    from public.shopping_list_items i
    join public.shopping_lists l on l.id = i.list_id
    where i.product_id = gone.id and l.archived_at is null;
  select count(*) into n_barcodes from public.product_barcodes b where b.product_id = gone.id;

  delete from public.products where id = gone.id;
  get diagnostics n_deleted = row_count;
  -- Uma regra de acesso que mudou e não deixou apagar: nada muda (o que não saiu não pode virar "excluído").
  if n_deleted <> 1 then
    raise exception 'product was not deleted' using errcode = '55000';
  end if;

  return jsonb_build_object('deleted', gone.id, 'pantry', n_pantry, 'list', n_list, 'barcodes', n_barcodes);
end;
$$;

revoke execute on function public.delete_product(uuid, text) from public, anon;
grant execute on function public.delete_product(uuid, text) to authenticated;

-- =============================================================================
-- 4. O app pergunta se este banco já sabe excluir produto.
-- =============================================================================
-- O botão "Excluir produto" só aparece quando esta pergunta responde true: o app pode chegar antes desta migração,
-- e sem ela a pessoa faria a pergunta inteira para ouvir "ainda não está disponível". Perguntar a delete_product
-- não serve (excluiria).
create function public.delete_product_available()
returns boolean
language sql
stable
set search_path = ''
as $$
  select true;
$$;

revoke execute on function public.delete_product_available() from public, anon;
grant execute on function public.delete_product_available() to authenticated;
