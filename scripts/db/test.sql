-- Testes do schema: isolamento entre famílias (RLS), matching, preços,
-- confirmação de nota, recorrência de tarefas e remédios.
-- Rodado por scripts/db/test.sh depois de stubs.sql + migrations.

\set ON_ERROR_STOP 1
\set QUIET 1
\set user_a '00000000-0000-0000-0000-00000000000a'
\set user_b '00000000-0000-0000-0000-00000000000b'
\set user_c '00000000-0000-0000-0000-00000000000c'

insert into auth.users (id) values (:'user_a'), (:'user_b'), (:'user_c');

-- ---------------------------------------------------------------------------
\echo '• anônimo não cria família'
set role anon;
do $$
begin
  perform public.create_household('Casa X', 'X');
  raise exception 'FAIL: anon created household';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------------------
\echo '• A cria família; B entra pelo código; C cria outra família'
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
select (public.create_household('Casa A', 'Ana')).invite_code as invite_code \gset

do $$
begin
  perform public.create_household('Outra', 'Ana');
  raise exception 'FAIL: user created a second household';
exception when unique_violation then null;
end $$;

select set_config('request.jwt.claim.sub', :'user_b', false) \gset
do $$
begin
  assert (select count(*) from public.households) = 0, 'B cannot see households before joining';
  perform public.join_household('ZZZZZZ', 'Beto');
  raise exception 'FAIL: joined with invalid code';
exception when no_data_found then null;
end $$;
select public.join_household(lower(:'invite_code'), 'Beto') \gset

select set_config('request.jwt.claim.sub', :'user_c', false) \gset
select public.create_household('Casa C', 'Caio') \gset

reset role;
select id as hh_a from public.households where name = 'Casa A' \gset
select set_config('test.hh_a', :'hh_a', false) \gset
set role authenticated;

-- ---------------------------------------------------------------------------
\echo '• A importa duas notas; matching e aprendizado de validade'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  s_bom uuid;
  s_caro uuid;
  r1 uuid;
  r2 uuid;
  i_arroz uuid;
  i_leite uuid;
  i_arroz2 uuid;
  p_arroz uuid;
begin
  insert into public.stores (name, cnpj) values ('Mercado Bom', '12345678000199') returning id into s_bom;
  insert into public.stores (name, cnpj) values ('Mercado Caro', '98765432000111') returning id into s_caro;

  insert into public.receipts (store_id, purchased_at, total, access_key, source)
    values (s_bom, '2026-09-20 10:00-03', 30.50, repeat('1', 44), 'ai') returning id into r1;
  insert into public.receipt_items
    (receipt_id, position, raw_description, suggested_name, suggested_category, quantity, unit, unit_price, total_price)
    values (r1, 0, 'ARROZ T.JOÃO 5KG', 'Arroz Tio João 5kg', 'graos', 1, 'un', 25.00, 25.00)
    returning id into i_arroz;
  insert into public.receipt_items
    (receipt_id, position, raw_description, suggested_name, suggested_category, quantity, unit, unit_price, total_price)
    values (r1, 1, 'LEITE ITALAC 1L', 'Leite Italac 1L', 'laticinios', 2, 'un', 2.75, 5.50)
    returning id into i_leite;

  perform public.confirm_receipt(r1, jsonb_build_array(
    jsonb_build_object(
      'id', i_arroz,
      'new_product', jsonb_build_object('name', 'Arroz Tio João 5kg', 'category', 'graos'),
      'pantry', jsonb_build_object('name', 'Arroz Tio João 5kg', 'category', 'graos',
        'purchased_on', '2026-09-20', 'expires_on', '2027-03-20', 'expiry_source', 'manual')),
    jsonb_build_object(
      'id', i_leite,
      'new_product', jsonb_build_object('name', 'Leite Italac 1L', 'category', 'laticinios'),
      'pantry', jsonb_build_object('category', 'laticinios',
        'purchased_on', '2026-09-20', 'expires_on', '2026-12-20', 'expiry_source', 'categoria'))
  ));

  select id into p_arroz from public.products where name = 'Arroz Tio João 5kg';
  assert p_arroz is not null, 'product created on confirm';
  assert (select shelf_life_days from public.products where id = p_arroz) = 181, 'manual expiry is learned';
  assert (select shelf_life_days from public.products where name = 'Leite Italac 1L') is null,
    'category default is not learned';
  assert (select count(*) from public.pantry_items) = 2, 'pantry fed by receipt';
  assert (select name from public.pantry_items where receipt_item_id = i_leite) = 'Leite Italac 1L',
    'pantry name falls back to suggested name';
  assert (select quantity from public.pantry_items where receipt_item_id = i_leite) = 2, 'pantry quantity';
  assert (select status from public.receipts where id = r1) = 'confirmed', 'receipt confirmed';

  assert (select product_id from public.match_aliases(array['arroz t joao  5kg'])) = p_arroz,
    'alias matches despite accents/punctuation/case';
  assert (select count(*) from public.match_aliases(array['FEIJAO CAMIL 1KG'])) = 0, 'unknown alias';

  -- Mesmo arroz, outra loja, mais caro; casado ao produto existente.
  insert into public.receipts (store_id, purchased_at, total, source)
    values (s_caro, '2026-09-22 18:00-03', 28.90, 'manual') returning id into r2;
  insert into public.receipt_items (receipt_id, raw_description, quantity, unit, unit_price, total_price)
    values (r2, 'ARROZ T JOAO 5KG', 1, 'un', 28.90, 28.90) returning id into i_arroz2;
  perform public.confirm_receipt(r2, jsonb_build_array(jsonb_build_object('id', i_arroz2, 'product_id', p_arroz)));

  assert (select count(*) from public.latest_prices where product_id = p_arroz) = 2, 'one latest price per store';
  assert (select unit_price from public.latest_prices where product_id = p_arroz and store_id = s_caro) = 28.90,
    'latest price at second store';
  assert (select count(*) from public.product_aliases) = 2, 'aliases deduplicated by normalized text';

  begin
    insert into public.receipts (store_id, access_key) values (s_bom, repeat('1', 44));
    raise exception 'FAIL: duplicate NFC-e access key accepted';
  exception when unique_violation then null;
  end;

  begin
    perform public.confirm_receipt(r1, '[]');
    raise exception 'FAIL: receipt confirmed twice';
  exception when unique_violation then null;
  end;

  -- Rascunho não entra no comparativo de preços.
  insert into public.receipts (store_id, status) values (s_bom, 'draft') returning id into r2;
  insert into public.receipt_items (receipt_id, raw_description, unit_price, total_price, product_id)
    values (r2, 'ARROZ', 1.00, 1.00, p_arroz);
  assert (select unit_price from public.latest_prices where product_id = p_arroz and store_id = s_bom) = 25.00,
    'drafts do not affect prices';

  perform set_config('test.receipt_a', r1::text, false);
  insert into storage.objects (bucket_id, name) values ('receipts', current_setting('test.hh_a') || '/nota.jpg');
end $$;

-- ---------------------------------------------------------------------------
\echo '• B (mesma família) vê e edita; não altera o próprio papel'
select set_config('request.jwt.claim.sub', :'user_b', false) \gset
do $$
begin
  assert (select count(*) from public.products) = 2, 'B sees household products';
  assert (select count(*) from public.household_members) = 2, 'B sees members';
  assert (select count(*) from storage.objects) = 1, 'B sees receipt images';
  update public.household_members set display_name = 'Roberto' where user_id = auth.uid();
  begin
    update public.household_members set role = 'owner' where user_id = auth.uid();
    raise exception 'FAIL: member promoted itself';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
\echo '• C (outra família) não vê nem escreve nos dados de A'
select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  assert (select count(*) from public.households) = 1, 'C sees only its household';
  assert (select count(*) from public.household_members) = 1, 'C sees only its members';
  assert (select count(*) from public.products) = 0, 'C sees no foreign products';
  assert (select count(*) from public.receipts) = 0, 'C sees no foreign receipts';
  assert (select count(*) from public.receipt_items) = 0, 'C sees no foreign items';
  assert (select count(*) from public.latest_prices) = 0, 'views respect RLS';
  assert (select count(*) from public.pantry_items) = 0, 'C sees no foreign pantry';
  assert (select count(*) from public.match_aliases(array['ARROZ T JOAO 5KG'])) = 0, 'C cannot use foreign aliases';
  assert (select count(*) from storage.objects) = 0, 'C sees no foreign images';

  begin
    insert into public.products (household_id, name) values (current_setting('test.hh_a')::uuid, 'Invasor');
    raise exception 'FAIL: cross-household insert';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.receipt_items (receipt_id, raw_description, unit_price, total_price)
      values (current_setting('test.receipt_a')::uuid, 'x', 1, 1);
    raise exception 'FAIL: item attached to foreign receipt';
  exception when foreign_key_violation then null;
  end;

  begin
    perform public.confirm_receipt(current_setting('test.receipt_a')::uuid, '[]');
    raise exception 'FAIL: confirmed foreign receipt';
  exception when no_data_found then null;
  end;

  begin
    insert into storage.objects (bucket_id, name) values ('receipts', current_setting('test.hh_a') || '/x.jpg');
    raise exception 'FAIL: uploaded into foreign folder';
  exception when insufficient_privilege then null;
  end;

  update public.households set name = 'Hack' where id = current_setting('test.hh_a')::uuid;
  assert not found, 'C cannot rename A household';
end $$;

-- ---------------------------------------------------------------------------
\echo '• tarefas: recorrência a partir da conclusão'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  c uuid;
  r public.chores;
begin
  insert into public.chores (title, recurrence, interval_count, due_on, assigned_to)
    values ('Limpar banheiro', 'weekly', 1, '2026-09-20', auth.uid()) returning id into c;
  r := public.complete_chore(c, '2026-09-26');
  assert r.due_on = '2026-10-03' and r.active, 'weekly: next week from completion';

  insert into public.chores (title, recurrence, interval_count, due_on)
    values ('Trocar filtro', 'monthly', 1, '2026-01-31') returning id into c;
  r := public.complete_chore(c, '2026-01-31');
  assert r.due_on = '2026-02-28', 'monthly clamps to end of month';

  insert into public.chores (title, due_on) values ('Trocar lâmpada', '2026-09-26') returning id into c;
  r := public.complete_chore(c, '2026-09-26');
  assert not r.active, 'one-off chore deactivates';

  assert (select count(*) from public.chore_completions) = 3, 'completions logged';

  begin
    insert into public.chores (title, assigned_to) values ('x', '00000000-0000-0000-0000-00000000000c');
    raise exception 'FAIL: assigned to non-member';
  exception when foreign_key_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
\echo '• remédios: horários válidos e dose única por horário'
do $$
declare
  m uuid;
begin
  insert into public.medications (person_name, name, dosage, times)
    values ('Ana', 'Vitamina D', '1 cápsula', array['08:00', '20:00']) returning id into m;

  begin
    insert into public.medications (person_name, name, times) values ('Ana', 'X', array['8:00']);
    raise exception 'FAIL: invalid time accepted';
  exception when check_violation then null;
  end;

  insert into public.medication_doses (medication_id, scheduled_on, scheduled_time) values (m, '2026-09-26', '08:00');
  begin
    insert into public.medication_doses (medication_id, scheduled_on, scheduled_time) values (m, '2026-09-26', '08:00');
    raise exception 'FAIL: same dose logged twice';
  exception when unique_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
\echo '• listas de compras compartilhadas'
do $$
declare
  l uuid;
begin
  insert into public.shopping_lists (name) values ('Mercado da semana') returning id into l;
  insert into public.shopping_list_items (list_id, name, category, quantity)
    values (l, 'Arroz Tio João 5kg', 'graos', 1), (l, 'Banana', 'hortifruti', 1.5);
  perform set_config('test.list_a', l::text, false);
end $$;

select set_config('request.jwt.claim.sub', :'user_b', false) \gset
do $$
begin
  update public.shopping_list_items set checked_at = now(), checked_by = auth.uid()
    where list_id = current_setting('test.list_a')::uuid and name = 'Banana';
  assert found, 'B checks item on shared list';
end $$;

select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  assert (select count(*) from public.shopping_list_items) = 0, 'C sees no foreign list items';
  delete from public.shopping_lists where id = current_setting('test.list_a')::uuid;
  assert not found, 'C cannot delete foreign list';
end $$;

\echo 'OK — todos os testes do banco passaram'
