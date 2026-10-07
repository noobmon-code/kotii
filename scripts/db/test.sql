-- Testes do schema: isolamento entre famílias (RLS), matching, preços,
-- confirmação de nota, recorrência de tarefas, remédios, saúde, aparelhos,
-- documentos, financeiro e saída da casa.
-- Rodado por scripts/db/test.sh depois de stubs.sql + migrations.

\set ON_ERROR_STOP 1
\set QUIET 1
\set user_a '00000000-0000-0000-0000-00000000000a'
\set user_b '00000000-0000-0000-0000-00000000000b'
\set user_c '00000000-0000-0000-0000-00000000000c'

insert into auth.users (id) values (:'user_a'), (:'user_b'), (:'user_c');

-- ---------------------------------------------------------------------------
\echo '• anônimo não cria família nem chama RPCs internas'
set role anon;
do $$
begin
  perform public.create_household('Casa X', 'X');
  raise exception 'FAIL: anon created household';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.current_household_id();
  raise exception 'FAIL: anon called current_household_id';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------------------
\echo '• A cria família; B entra pelo código; C cria outra família'
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
select (public.create_household('Casa A', 'Ana')).invite_code as invite_code \gset
select set_config('test.invite_a', :'invite_code', false) \gset

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

  begin
    insert into public.receipts (store_id, image_path) values (s_bom, '00000000-0000-0000-0000-000000000000/nota.jpg');
    raise exception 'FAIL: receipt photo in another household folder';
  exception when check_violation then null;
  end;
  begin
    insert into public.receipts (store_id, extra_image_paths) values (s_bom, array[current_setting('test.hh_a') || '/']);
    raise exception 'FAIL: receipt photo without a file name';
  exception when check_violation then null;
  end;
  insert into public.receipts (store_id, image_path, extra_image_paths)
    values (s_bom, current_setting('test.hh_a') || '/nota-1.jpg', array[current_setting('test.hh_a') || '/nota-2.jpg']) returning id into r2;
  delete from public.receipts where id = r2;

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
  r record;
begin
  insert into public.chores (title, recurrence, interval_count, due_on, assigned_to)
    values ('Limpar banheiro', 'weekly', 1, '2026-09-20', auth.uid()) returning id into c;
  select * into r from public.complete_chore(c, '2026-09-26');
  assert r.completed and r.due_on = '2026-10-03' and r.active, 'weekly: next week from completion';

  insert into public.chores (title, recurrence, interval_count, due_on)
    values ('Trocar filtro', 'monthly', 1, '2026-01-31') returning id into c;
  select * into r from public.complete_chore(c, '2026-01-31');
  assert r.due_on = '2026-02-28', 'monthly clamps to end of month';

  insert into public.chores (title, due_on) values ('Trocar lâmpada', '2026-09-26') returning id into c;
  select * into r from public.complete_chore(c, '2026-09-26');
  assert not r.active, 'one-off chore deactivates';

  assert (select count(*) from public.chore_completions) = 3, 'completions logged';
  begin
    insert into public.chore_completions (chore_id) values (c);
    raise exception 'FAIL: completion written without complete_chore';
  exception when insufficient_privilege then null;
  end;
  update public.chore_completions set completed_at = now();
  assert not found, 'completions cannot be changed directly';
  delete from public.chore_completions;
  assert not found, 'completions cannot be deleted directly';

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

  -- Regularidade: antigos seguem todo dia; cada forma com o seu campo.
  assert (select frequency from public.medications where id = m) = 'daily', 'existing medications stay daily';
  insert into public.medications (person_name, name, times, frequency, weekdays, total_doses)
    values ('Ana', 'Vitamina B12', array['09:00'], 'weekdays', array[1, 3, 5]::smallint[], 12);
  insert into public.medications (person_name, name, times, frequency, interval_days)
    values ('Ana', 'Antialérgico', array['09:00'], 'interval', 2);
  insert into public.medications (person_name, name, times, frequency) values ('Ana', 'Injeção', array['09:00'], 'monthly');
  begin
    insert into public.medications (person_name, name, times, frequency) values ('Ana', 'X', array['09:00'], 'weekdays');
    raise exception 'FAIL: weekdays without days';
  exception when check_violation then null;
  end;
  begin
    insert into public.medications (person_name, name, times, weekdays) values ('Ana', 'X', array['09:00'], array[1]::smallint[]);
    raise exception 'FAIL: days on a daily medication';
  exception when check_violation then null;
  end;
  begin
    insert into public.medications (person_name, name, times, frequency, weekdays)
      values ('Ana', 'X', array['09:00'], 'weekdays', array[7]::smallint[]);
    raise exception 'FAIL: weekday out of range';
  exception when check_violation then null;
  end;
  begin
    insert into public.medications (person_name, name, times, frequency, interval_days) values ('Ana', 'X', array['09:00'], 'interval', 1);
    raise exception 'FAIL: every 1 day as interval';
  exception when check_violation then null;
  end;
  begin
    insert into public.medications (person_name, name, times, total_doses) values ('Ana', 'X', array['09:00'], 0);
    raise exception 'FAIL: zero doses';
  exception when check_violation then null;
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
  perform set_config('test.banana_token', (select toggle_token from public.shopping_list_items where name = 'Banana')::text, false);
  update public.shopping_list_items set checked_at = now(), checked_by = auth.uid()
    where list_id = current_setting('test.list_a')::uuid and name = 'Banana';
  assert found, 'B checks item on shared list';
  assert (select toggle_token <> current_setting('test.banana_token')::uuid from public.shopping_list_items where name = 'Banana'),
    'a toggle without a new token still renews it';
end $$;

-- A estava sem internet e desmarcou a Banana com o selo antigo: a marcação
-- chega depois da de B e não passa por cima.
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  token uuid;
begin
  update public.shopping_list_items set checked_at = null, checked_by = null, toggle_token = gen_random_uuid()
    where name = 'Banana' and toggle_token = current_setting('test.banana_token')::uuid;
  assert not found, 'a queued toggle based on an old token does not overwrite a newer one';
  assert (select checked_at from public.shopping_list_items where name = 'Banana') is not null, 'item stays checked';
  select toggle_token into token from public.shopping_list_items where name = 'Banana';
  update public.shopping_list_items set quantity = 2 where name = 'Banana';
  assert (select toggle_token from public.shopping_list_items where name = 'Banana') = token, 'other edits keep the token';
  update public.shopping_list_items set quantity = 1.5 where name = 'Banana';
end $$;

select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  assert (select count(*) from public.shopping_list_items) = 0, 'C sees no foreign list items';
  delete from public.shopping_lists where id = current_setting('test.list_a')::uuid;
  assert not found, 'C cannot delete foreign list';
end $$;

-- ---------------------------------------------------------------------------
\echo '• lista de mercado aberta: acha a da casa ou cria uma só'
select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
declare
  first uuid;
  again uuid;
  other uuid;
begin
  select id into first from public.open_market_list();
  assert (select name from public.shopping_lists where id = first) = 'Mercado', 'creates "Mercado" when none is open';
  select id into again from public.open_market_list('Outra');
  assert again = first, 'the open market list is reused';
  update public.shopping_lists set archived_at = now() where id = first;
  select id into other from public.open_market_list();
  assert other <> first, 'an archived list is not reused';
  delete from public.shopping_lists where id in (first, other);
end $$;
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
begin
  assert (select id from public.open_market_list()) = current_setting('test.list_a')::uuid,
    'each household gets its own open market list';
end $$;

-- ---------------------------------------------------------------------------
\echo '• limpar o carrinho guarda o histórico de compras'
select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  assert public.clear_checked_items(
    current_setting('test.list_a')::uuid,
    array(select id from public.shopping_list_items),
    array(select toggle_token from public.shopping_list_items)
  ) = 0, 'C cannot clear a foreign cart';
  assert (select count(*) from public.purchase_history) = 0, 'C sees no foreign history';
end $$;
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  ids uuid[];
  tokens uuid[];
begin
  begin
    insert into public.purchase_history (name) values ('Arroz');
    raise exception 'FAIL: history written directly';
  exception when insufficient_privilege then null;
  end;
  -- O carrinho que a pessoa viu ao tocar em Limpar.
  select array_agg(id), array_agg(toggle_token) into ids, tokens
    from public.shopping_list_items
    where list_id = current_setting('test.list_a')::uuid and checked_at is not null;
  -- Alguém marca outro item antes de a limpeza chegar ao servidor.
  update public.shopping_list_items set checked_at = now()
    where list_id = current_setting('test.list_a')::uuid and checked_at is null;
  assert public.clear_checked_items(current_setting('test.list_a')::uuid, ids, tokens) = 1, 'checked item moves to history';
  assert (select count(*) from public.shopping_list_items where list_id = current_setting('test.list_a')::uuid) = 1,
    'item checked after the tap stays on the list';
  update public.shopping_list_items set checked_at = null where list_id = current_setting('test.list_a')::uuid;
  assert (select name from public.purchase_history) = 'Banana', 'history keeps the item';
  assert (select quantity from public.purchase_history) = 1.5, 'history keeps the quantity';
  assert (select bought_at is not null from public.purchase_history), 'history keeps when it was bought';
end $$;
select set_config('request.jwt.claim.sub', :'user_b', false) \gset
do $$
begin
  assert (select count(*) from public.purchase_history) = 1, 'B sees the household history';
end $$;

-- ---------------------------------------------------------------------------
\echo '• limpar o carrinho leva à despensa o que a pessoa confirmou'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  l uuid := current_setting('test.list_a')::uuid;
  ids uuid[];
  tokens uuid[];
  pantry_before integer;
begin
  insert into public.shopping_list_items (list_id, name, category, quantity, checked_at)
    values (l, 'Leite', 'laticinios', 2, now()), (l, 'Detergente', 'limpeza', 1, now()), (l, 'Pão', 'padaria', 6, now());
  select array_agg(id), array_agg(toggle_token) into ids, tokens
    from public.shopping_list_items where list_id = l and checked_at is not null;
  -- Alguém devolve o Pão à lista antes de a limpeza chegar: ele não sai, nem vai à despensa.
  update public.shopping_list_items set checked_at = null, toggle_token = gen_random_uuid() where list_id = l and name = 'Pão';
  select count(*) into pantry_before from public.pantry_items;

  begin
    perform public.clear_checked_items(l, ids, tokens, '{"id": "x"}'::jsonb);
    raise exception 'FAIL: p_pantry that is not a list';
  exception when invalid_parameter_value then null;
  end;

  assert public.clear_checked_items(l, ids, tokens, jsonb_build_array(
    jsonb_build_object('id', (select id from public.shopping_list_items where list_id = l and name = 'Leite'),
      'quantity', 3, 'purchased_on', '2026-09-20', 'expires_on', '2026-10-10', 'expiry_source', 'categoria'),
    jsonb_build_object('id', (select id from public.shopping_list_items where list_id = l and name = 'Pão'), 'quantity', 6)
  )) = 2, 'Leite and Detergente leave the cart';
  assert (select count(*) from public.pantry_items) = pantry_before + 1, 'only the confirmed item that left the cart goes to the pantry';
  assert (select quantity from public.pantry_items where name = 'Leite' and receipt_item_id is null) = 3, 'pantry takes the confirmed quantity';
  assert (select unit from public.pantry_items where name = 'Leite' and receipt_item_id is null) = 'un', 'pantry keeps the list unit';
  assert (select purchased_on from public.pantry_items where name = 'Leite' and receipt_item_id is null) = '2026-09-20', 'pantry purchase date';
  assert (select expires_on from public.pantry_items where name = 'Leite' and receipt_item_id is null) = '2026-10-10', 'pantry expiry';
  assert (select expiry_source from public.pantry_items where name = 'Leite' and receipt_item_id is null) = 'categoria', 'pantry expiry source';
  assert (select category from public.pantry_items where name = 'Leite' and receipt_item_id is null) = 'laticinios', 'pantry category from the list';
  assert not exists (select 1 from public.pantry_items where name in ('Detergente', 'Pão')), 'unconfirmed or remaining items stay out of the pantry';
  assert exists (select 1 from public.purchase_history where name = 'Leite' and quantity = 2), 'history keeps the list quantity';
  assert exists (select 1 from public.shopping_list_items where list_id = l and name = 'Pão'), 'Pão stays on the list';
  delete from public.shopping_list_items where list_id = l and name = 'Pão';
end $$;
select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  -- Id do carrinho de outra casa: nada sai e nada entra na despensa de ninguém.
  perform public.clear_checked_items(current_setting('test.list_a')::uuid, array[gen_random_uuid()], array[gen_random_uuid()],
    '[{"quantity": 1}]'::jsonb);
  assert (select count(*) from public.pantry_items) = 0, 'C gets nothing in its pantry';
end $$;
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
begin
  delete from public.pantry_items where name = 'Leite' and receipt_item_id is null;
end $$;

-- ---------------------------------------------------------------------------
\echo '• a nota tira da lista o que a compra cumpriu e aprende o vínculo'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  l uuid := current_setting('test.list_a')::uuid;
  r uuid;
  i_cebola uuid;
  i_coca uuid;
  i_avulso uuid;
  l_cebola uuid;
  l_coca uuid;
  l_pao uuid;
  l_fica uuid;
  p_coca uuid;
begin
  insert into public.shopping_list_items (list_id, name, category) values (l, 'Cebola', 'hortifruti') returning id into l_cebola;
  insert into public.shopping_list_items (list_id, name, category, checked_at) values (l, 'Coca', 'bebidas', now())
    returning id into l_coca;
  insert into public.shopping_list_items (list_id, name, category) values (l, 'Pão', 'padaria') returning id into l_pao;
  insert into public.shopping_list_items (list_id, name, category) values (l, 'Detergente', 'limpeza') returning id into l_fica;

  insert into public.receipts (purchased_at, source) values ('2026-10-03 21:00-03', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, quantity, unit, unit_price, total_price)
    values (r, 'CEBOLA GRANEL 600G', 0.6, 'kg', 5, 3) returning id into i_cebola;
  insert into public.receipt_items (receipt_id, raw_description, quantity, unit, unit_price, total_price)
    values (r, 'COCA S ACUCAR 1 5L', 1, 'un', 9, 9) returning id into i_coca;
  insert into public.receipt_items (receipt_id, raw_description, quantity, unit, unit_price, total_price)
    values (r, 'PAO FRANCES', 0.3, 'kg', 15, 4.5) returning id into i_avulso;

  -- Nome fora do formato do app: nada é confirmado.
  begin
    perform public.confirm_receipt(r, jsonb_build_array(jsonb_build_object(
      'id', i_coca, 'new_product', jsonb_build_object('name', 'Coca-Cola Zero 1,5L', 'category', 'bebidas'),
      'list_items', jsonb_build_array(jsonb_build_object('id', l_coca, 'name', 'Coca', 'name_key', 'Coca!')))));
    raise exception 'FAIL: link with a name key out of format';
  exception when check_violation then null;
  end;
  assert exists (select 1 from public.shopping_list_items where id = l_coca), 'failed confirm keeps the list';

  perform public.confirm_receipt(r, jsonb_build_array(
    jsonb_build_object('id', i_cebola,
      'new_product', jsonb_build_object('name', 'Cebola Granel 600g', 'category', 'hortifruti'),
      'list_items', jsonb_build_array(
        jsonb_build_object('id', l_cebola, 'name', 'Cebola', 'name_key', 'cebola'),
        -- Visto como "Detergente Ypê", renomeado depois em outro aparelho: fica, sem ligação.
        jsonb_build_object('id', l_fica, 'name', 'Detergente Ypê', 'name_key', 'detergente ype'))),
    jsonb_build_object('id', i_coca,
      'new_product', jsonb_build_object('name', 'Coca-Cola Zero 1,5L', 'category', 'bebidas'),
      -- O "Refrigerante" já tinha saído da lista (outra pessoa): sem vínculo.
      'list_items', jsonb_build_array(
        jsonb_build_object('id', l_coca, 'name', 'Coca', 'name_key', 'coca'),
        jsonb_build_object('id', gen_random_uuid(), 'name', 'Refrigerante', 'name_key', 'refrigerante'))),
    -- Sem produto (não acompanhar preço): sai da lista, sem vínculo.
    jsonb_build_object('id', i_avulso,
      'list_items', jsonb_build_array(jsonb_build_object('id', l_pao, 'name', 'Pão', 'name_key', 'pao')))
  ));

  select id into p_coca from public.products where name = 'Coca-Cola Zero 1,5L';
  assert not exists (select 1 from public.shopping_list_items where id in (l_cebola, l_coca, l_pao)),
    'items the purchase fulfilled leave the list, in the cart or not';
  assert exists (select 1 from public.shopping_list_items where id = l_fica), 'the rest of the list stays';
  assert exists (select 1 from public.list_item_links where name_key = 'coca' and product_id = p_coca), 'coca -> Coca-Cola Zero';
  assert exists (select 1 from public.list_item_links k join public.products p on p.id = k.product_id
    where k.name_key = 'cebola' and p.name = 'Cebola Granel 600g'), 'cebola -> Cebola Granel';
  assert not exists (select 1 from public.list_item_links where name_key in ('refrigerante', 'pao', 'detergente ype')),
    'no link for an item already gone, renamed meanwhile or a purchase without product';
  assert not exists (select 1 from public.purchase_history where name in ('Cebola', 'Coca', 'Pão')),
    'the receipt is the purchase record (no cart history)';

  -- Outra nota: a pessoa diz que a Coca não cumpre mais o "Coca" (ligação errada).
  insert into public.receipts (purchased_at, source) values ('2026-10-04 12:00-03', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, quantity, unit, unit_price, total_price)
    values (r, 'COCA S ACUCAR 1 5L', 1, 'un', 9, 9) returning id into i_coca;
  perform public.confirm_receipt(r, jsonb_build_array(jsonb_build_object('id', i_coca, 'product_id', p_coca,
    'forget_links', jsonb_build_array('coca'))));
  assert not exists (select 1 from public.list_item_links where name_key = 'coca'), 'forgotten link is gone';
  assert exists (select 1 from public.list_item_links where name_key = 'cebola'), 'other links stay';
  insert into public.list_item_links (name_key, product_id) values ('coca', p_coca);

  delete from public.shopping_list_items where id = l_fica;
  perform set_config('test.coca', p_coca::text, false);
end $$;
select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  assert (select count(*) from public.list_item_links) = 0, 'C does not see A links';
  begin
    insert into public.list_item_links (household_id, name_key, product_id)
      values (current_setting('test.hh_a')::uuid, 'coca', current_setting('test.coca')::uuid);
    raise exception 'FAIL: C wrote a link into A';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', :'user_a', false) \gset

-- ---------------------------------------------------------------------------
\echo '• detalhes do item da lista e lixeira de fotos'
do $$
declare
  l uuid := current_setting('test.list_a')::uuid;
  hid text := public.current_household_id()::text;
  item uuid;
  token uuid;
begin
  insert into public.shopping_list_items (list_id, name, category, notes, priority, photo_path)
    values (l, 'Sabão', 'limpeza', 'O de coco, embalagem azul', 'urgente', hid || '/item-sabao.jpg')
    returning id, toggle_token into item, token;
  assert (select priority from public.shopping_list_items where id = item) = 'urgente', 'priority saved';
  assert (select priority from public.shopping_list_items where name = 'Arroz Tio João 5kg') = 'normal', 'priority defaults to normal';
  begin
    update public.shopping_list_items set priority = 'talvez' where id = item;
    raise exception 'FAIL: unknown priority';
  exception when check_violation then null;
  end;
  begin
    update public.shopping_list_items set notes = repeat('x', 501) where id = item;
    raise exception 'FAIL: notes too long';
  exception when check_violation then null;
  end;
  begin
    update public.shopping_list_items set photo_path = '00000000-0000-0000-0000-000000000000/item-x.jpg' where id = item;
    raise exception 'FAIL: photo from another household folder';
  exception when check_violation then null;
  end;
  begin
    update public.shopping_list_items set photo_path = hid || '/item-sub/x.jpg' where id = item;
    raise exception 'FAIL: photo outside the household folder root';
  exception when check_violation then null;
  end;
  begin
    update public.shopping_list_items set photo_path = hid || '/1727000000-abc123.jpg' where id = item;
    raise exception 'FAIL: photo that is not an item photo (a receipt or document one)';
  exception when check_violation then null;
  end;
  update public.shopping_list_items set notes = 'O de coco', priority = 'se_der' where id = item;
  assert (select toggle_token from public.shopping_list_items where id = item) = token, 'editing details keeps the toggle token';
  assert (select count(*) from public.storage_trash) = 0, 'no photo change, nothing in the trash';

  update public.shopping_list_items set photo_path = hid || '/item-sabao2.jpg' where id = item;
  assert (select path from public.storage_trash) = hid || '/item-sabao.jpg', 'replaced photo goes to the trash';
  assert (select bucket from public.storage_trash) = 'documents', 'trash knows the bucket';
  update public.shopping_list_items set checked_at = now() where id = item;
  select toggle_token into token from public.shopping_list_items where id = item;
  assert public.clear_checked_items(l, array[item], array[token]) = 1, 'item with photo leaves the cart';
  assert exists (select 1 from public.storage_trash where path = hid || '/item-sabao2.jpg'), 'photo of a cleared item goes to the trash';

  insert into public.shopping_list_items (list_id, name, photo_path) values (l, 'Café', hid || '/item-cafe.jpg') returning id into item;
  delete from public.shopping_list_items where id = item;
  assert exists (select 1 from public.storage_trash where path = hid || '/item-cafe.jpg'), 'photo of a removed item goes to the trash';

  begin
    insert into public.storage_trash (household_id, bucket, path) values (hid::uuid, 'documents', hid || '/x.jpg');
    raise exception 'FAIL: trash written directly';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', :'user_b', false) \gset
do $$
begin
  assert (select count(*) from public.storage_trash) = 3, 'the whole household sees the trash';
end $$;
select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  assert (select count(*) from public.storage_trash) = 0, 'C sees no foreign trash';
  delete from public.storage_trash;
end $$;
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
begin
  assert (select count(*) from public.storage_trash) = 3, 'C cannot empty a foreign trash';
  delete from public.storage_trash;
  assert (select count(*) from public.storage_trash) = 0, 'the household empties its trash';
end $$;

-- ---------------------------------------------------------------------------
\echo '• saúde: pessoas da casa, vínculo com moradores e pets'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  dep uuid;
  pet uuid;
begin
  assert (select count(*) from public.people where member_user_id is not null) = 2,
    'every member has a person';
  assert (select name from public.people where member_user_id = auth.uid()) = 'Ana', 'person named after member';
  assert (select person_id from public.medications where name = 'Vitamina D') is null,
    'medications created without person keep person_id null';

  insert into public.people (name, birth_date, blood_type) values ('Duda', '2015-04-02', 'O+') returning id into dep;
  insert into public.people (name, kind, species) values ('Rex', 'pet', 'cachorro') returning id into pet;
  perform set_config('test.person_duda', dep::text, false);
  perform set_config('test.person_rex', pet::text, false);

  begin
    insert into public.people (name) values ('duda');
    raise exception 'FAIL: duplicate person name';
  exception when unique_violation then null;
  end;

  begin
    insert into public.people (name, blood_type) values ('Zé', 'Z+');
    raise exception 'FAIL: invalid blood type';
  exception when check_violation then null;
  end;

  begin
    insert into public.people (name, member_user_id) values ('Intruso', '00000000-0000-0000-0000-00000000000c');
    raise exception 'FAIL: person linked to non-member';
  exception when foreign_key_violation then null;
  end;

  insert into public.medications (person_name, person_id, name, times) values ('Rex', pet, 'Vermífugo', array['09:00']);
end $$;

-- D entra na casa A com o nome da dependente e assume a ficha dela.
\set user_d '00000000-0000-0000-0000-00000000000d'
\set user_e '00000000-0000-0000-0000-00000000000e'
reset role;
insert into auth.users (id) values (:'user_d'), (:'user_e');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_d', false) \gset
select public.join_household(:'invite_code', ' Duda ') \gset
select set_config('request.jwt.claim.sub', :'user_e', false) \gset
select public.join_household(:'invite_code', 'Rex') \gset
do $$
begin
  assert (select member_user_id from public.people where id = current_setting('test.person_duda')::uuid)
    is distinct from auth.uid(), 'E does not take over Duda';
  assert (select name from public.people where member_user_id = auth.uid()) = 'Rex 2',
    'name taken by pet gets a suffix';
  assert (select count(*) from public.people) = 5, 'no duplicate person for Duda';
end $$;
select set_config('request.jwt.claim.sub', :'user_d', false) \gset
do $$
begin
  assert (select id from public.people where member_user_id = auth.uid()) = current_setting('test.person_duda')::uuid,
    'joining member takes over dependent with same name';
end $$;

-- ---------------------------------------------------------------------------
\echo '• saúde: consultas, vacinas, exames, treinos e dietas'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  duda uuid := current_setting('test.person_duda')::uuid;
  plan uuid;
begin
  insert into public.appointments (person_id, title, professional, starts_at)
    values (duda, 'Pediatra', 'Dra. Lia', '2026-10-05 14:30-03');
  insert into public.vaccines (person_id, name, dose, applied_on, next_dose_on)
    values (duda, 'Gripe', 'anual', '2026-04-10', '2027-04-10');
  insert into public.exams (person_id, title, exam_date, results, file_paths)
    values (duda, 'Hemograma', '2026-09-01',
      '[{"name": "Hemoglobina", "value": "13,2", "unit": "g/dL", "reference": "12,0 a 16,0"}]',
      array[current_setting('test.hh_a') || '/exame.jpg']);
  insert into public.workout_plans (person_id, title, sessions, status)
    values (duda, 'Treino A/B', '[{"name": "A", "weekdays": [1, 3], "exercises": []}]', 'active')
    returning id into plan;
  insert into public.workout_logs (plan_id, session_name, done_on) values (plan, 'A', '2026-09-28');
  insert into public.diet_plans (person_id, title, meals, shopping_items)
    values (duda, 'Dieta setembro', '[]', '[{"name": "Aveia", "category": "graos", "quantity": 1, "unit": "un"}]');
  insert into storage.objects (bucket_id, name) values ('health', current_setting('test.hh_a') || '/exame.jpg');
  perform set_config('test.plan_a', plan::text, false);

  begin
    insert into public.workout_logs (plan_id, session_name, done_on) values (plan, 'A', '2026-09-28');
    raise exception 'FAIL: same session logged twice on a day';
  exception when unique_violation then null;
  end;

  begin
    insert into public.vaccines (person_id, name) values (duda, 'Sem data');
    raise exception 'FAIL: vaccine without any date';
  exception when check_violation then null;
  end;

  begin
    insert into public.exams (person_id, title, results) values (duda, 'X', '{"a": 1}');
    raise exception 'FAIL: exam results must be an array';
  exception when check_violation then null;
  end;

  -- Arquivos: só na pasta da casa, sem subpasta.
  begin
    insert into public.exams (person_id, title, file_paths) values (duda, 'X', array['00000000-0000-0000-0000-000000000000/exame.jpg']);
    raise exception 'FAIL: exam file in another household folder';
  exception when check_violation then null;
  end;
  begin
    insert into public.workout_plans (person_id, title, file_paths) values (duda, 'X', array[current_setting('test.hh_a') || '/sub/ficha.jpg']);
    raise exception 'FAIL: workout file outside the household folder root';
  exception when check_violation then null;
  end;
  begin
    insert into public.diet_plans (person_id, title, file_paths) values (duda, 'X', array['dieta.jpg']);
    raise exception 'FAIL: diet file without the household folder';
  exception when check_violation then null;
  end;
  begin
    insert into public.exams (person_id, title, file_paths) values (duda, 'X', array[null, current_setting('test.hh_a') || '/exame.jpg']);
    raise exception 'FAIL: null file path accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.appointments (person_id, title, starts_at, status) values (duda, 'X', now(), 'talvez');
    raise exception 'FAIL: invalid appointment status';
  exception when check_violation then null;
  end;

  assert (select done_by from public.workout_logs where plan_id = plan) = auth.uid(), 'log records who trained';
end $$;

select set_config('request.jwt.claim.sub', :'user_b', false) \gset
do $$
begin
  assert (select count(*) from public.appointments) = 1, 'B sees household appointments';
  assert (select count(*) from public.vaccines) = 1, 'B sees household vaccines';
  assert (select count(*) from public.exams) = 1, 'B sees household exams';
  assert (select count(*) from public.workout_logs) = 1, 'B sees workout logs';
  assert (select count(*) from public.diet_plans) = 1, 'B sees diet plans';
  assert (select count(*) from storage.objects where bucket_id = 'health') = 1, 'B sees health files';
end $$;

select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
declare
  caio uuid;
begin
  assert (select count(*) from public.people) = 1, 'C sees only its own person';
  assert (select count(*) from public.appointments) = 0, 'C sees no foreign appointments';
  assert (select count(*) from public.vaccines) = 0, 'C sees no foreign vaccines';
  assert (select count(*) from public.exams) = 0, 'C sees no foreign exams';
  assert (select count(*) from public.workout_plans) = 0, 'C sees no foreign workout plans';
  assert (select count(*) from public.workout_logs) = 0, 'C sees no foreign workout logs';
  assert (select count(*) from public.diet_plans) = 0, 'C sees no foreign diets';
  assert (select count(*) from storage.objects where bucket_id = 'health') = 0, 'C sees no foreign health files';

  select id into caio from public.people;
  begin
    insert into public.appointments (person_id, title, starts_at)
      values (current_setting('test.person_duda')::uuid, 'X', now());
    raise exception 'FAIL: appointment for foreign person';
  exception when foreign_key_violation then null;
  end;

  begin
    -- Data fixa e diferente da do log da A: sem ela, no dia do log a trava de
    -- repetição disparava antes da checagem da casa.
    insert into public.workout_logs (plan_id, session_name, done_on) values (current_setting('test.plan_a')::uuid, 'A', '2000-01-01');
    raise exception 'FAIL: log on foreign workout plan';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.medications (person_name, person_id, name, times)
      values ('Duda', current_setting('test.person_duda')::uuid, 'X', array['08:00']);
    raise exception 'FAIL: medication for foreign person';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into storage.objects (bucket_id, name) values ('health', current_setting('test.hh_a') || '/x.jpg');
    raise exception 'FAIL: uploaded health file into foreign folder';
  exception when insufficient_privilege then null;
  end;

  delete from public.people where id = current_setting('test.person_duda')::uuid;
  assert not found, 'C cannot delete foreign person';

  insert into public.appointments (person_id, title, starts_at) values (caio, 'Dentista', now());
end $$;

-- Pessoa removida leva consultas, vacinas, exames e planos; remédio fica sem pessoa.
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  rex uuid := current_setting('test.person_rex')::uuid;
begin
  insert into public.vaccines (person_id, name, applied_on) values (rex, 'Antirrábica', '2026-03-01');
  delete from public.people where id = rex;
  assert (select count(*) from public.vaccines where name = 'Antirrábica') = 0, 'vaccines cascade with person';
  assert (select person_id from public.medications where name = 'Vermífugo') is null
    and (select person_name from public.medications where name = 'Vermífugo') = 'Rex',
    'medication keeps its name when person is removed';

  delete from public.people where id = current_setting('test.person_duda')::uuid;
  assert (select count(*) from public.appointments) = 0, 'appointments cascade';
  assert (select count(*) from public.exams) = 0, 'exams cascade';
  assert (select count(*) from public.workout_logs) = 0, 'workout logs cascade with plan';
  assert (select count(*) from public.diet_plans) = 0, 'diet plans cascade';
end $$;

-- ---------------------------------------------------------------------------
\echo '• aparelhos e documentos'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  eq uuid;
  c uuid;
  ana uuid;
begin
  insert into public.equipment (name, category, purchased_on, warranty_until, price, file_paths)
    values ('Ar do quarto', 'climatizacao', '2026-01-10', '2027-01-10', 2499.90,
      array[current_setting('test.hh_a') || '/nota-ar.jpg'])
    returning id into eq;
  insert into public.chores (title, recurrence, interval_count, due_on, equipment_id)
    values ('Limpar filtros', 'monthly', 1, '2026-09-26', eq) returning id into c;
  perform public.complete_chore(c, '2026-09-26');
  assert (select due_on from public.chores where id = c) = '2026-10-26', 'maintenance recurs like any chore';
  perform set_config('test.equipment_a', eq::text, false);

  begin
    insert into public.equipment (name, category) values ('X', 'nave');
    raise exception 'FAIL: invalid equipment category';
  exception when check_violation then null;
  end;

  begin
    insert into public.equipment (name, price) values ('X', -1);
    raise exception 'FAIL: negative price';
  exception when check_violation then null;
  end;

  select id into ana from public.people where member_user_id = auth.uid();
  insert into public.documents (person_id, kind, title, number, expires_on, remind_days)
    values (ana, 'cnh', 'CNH da Ana', '0123', '2026-10-10', 30);
  insert into public.documents (kind, title, expires_on) values ('seguro', 'Seguro residencial', '2027-03-01');
  perform set_config('test.person_ana', ana::text, false);
  insert into storage.objects (bucket_id, name) values ('documents', current_setting('test.hh_a') || '/cnh.jpg');

  begin
    insert into public.documents (kind, title) values ('holerite', 'X');
    raise exception 'FAIL: invalid document kind';
  exception when check_violation then null;
  end;

  begin
    insert into public.documents (title, remind_days) values ('X', 400);
    raise exception 'FAIL: remind_days out of range';
  exception when check_violation then null;
  end;
  begin
    insert into public.documents (title, file_paths) values ('X', array['00000000-0000-0000-0000-000000000000/cnh.jpg']);
    raise exception 'FAIL: document file in another household folder';
  exception when check_violation then null;
  end;
  begin
    insert into public.equipment (name, file_paths) values ('X', array[current_setting('test.hh_a') || '/a/b.jpg']);
    raise exception 'FAIL: equipment file outside the household folder root';
  exception when check_violation then null;
  end;
end $$;
reset role;
do $$
begin
  assert (select file_size_limit from storage.buckets where id = 'documents') = 5 * 1024 * 1024, 'buckets have a size limit';
  assert (select allowed_mime_types from storage.buckets where id = 'health') = array['image/jpeg', 'image/png', 'image/webp'], 'buckets only take photos';
end $$;
set role authenticated;

select set_config('request.jwt.claim.sub', :'user_b', false) \gset
do $$
begin
  assert (select count(*) from public.equipment) = 1, 'B sees household equipment';
  assert (select count(*) from public.documents) = 2, 'B sees household documents';
  assert (select count(*) from storage.objects where bucket_id = 'documents') = 1, 'B sees document files';
end $$;

select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  assert (select count(*) from public.equipment) = 0, 'C sees no foreign equipment';
  assert (select count(*) from public.documents) = 0, 'C sees no foreign documents';
  assert (select count(*) from storage.objects where bucket_id = 'documents') = 0, 'C sees no foreign document files';

  begin
    insert into public.chores (title, equipment_id) values ('X', current_setting('test.equipment_a')::uuid);
    raise exception 'FAIL: chore linked to foreign equipment';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.documents (person_id, title) values (current_setting('test.person_ana')::uuid, 'X');
    raise exception 'FAIL: document for foreign person';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into storage.objects (bucket_id, name) values ('documents', current_setting('test.hh_a') || '/x.jpg');
    raise exception 'FAIL: uploaded document file into foreign folder';
  exception when insufficient_privilege then null;
  end;

  update public.equipment set name = 'Hack' where id = current_setting('test.equipment_a')::uuid;
  assert not found, 'C cannot edit foreign equipment';
end $$;

select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
begin
  delete from public.equipment where id = current_setting('test.equipment_a')::uuid;
  assert (select count(*) from public.chores where title = 'Limpar filtros') = 0, 'maintenance goes with the equipment';
  delete from public.people where id = current_setting('test.person_ana')::uuid;
  assert (select count(*) from public.documents) = 1, 'personal documents go with the person; household ones stay';
end $$;

-- ---------------------------------------------------------------------------
\echo '• financeiro: contas, pagamentos e gastos'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  rent uuid;
  power uuid;
  ipva uuid;
  once uuid;
  kid uuid;
  b public.bills;
  r record;
  pay uuid;
begin
  insert into public.bills (name, category, amount, recurrence, due_day, next_due_on)
    values ('Aluguel', 'moradia', 2500, 'monthly', 31, '2026-01-31') returning id into rent;
  b := (public.pay_bill(rent, '2026-01-31', null, '2026-01-30')).bill;
  assert b.next_due_on = '2026-02-28', 'day 31 clamps to the end of February';
  b := (public.pay_bill(rent, '2026-02-28', null, '2026-02-27')).bill;
  assert b.next_due_on = '2026-03-31', 'and comes back to 31 in March';
  assert (select amount from public.bill_payments where bill_id = rent and due_on = '2026-02-28') = 2500,
    'fixed amount used when none is given';

  -- Outra pessoa já pagou este vencimento: nada acontece e o app é avisado.
  select * into r from public.pay_bill(rent, '2026-02-28', 2500, '2026-03-01');
  assert not r.paid and (r.bill).next_due_on = '2026-03-31'
    and (select count(*) from public.bill_payments where bill_id = rent) = 2,
    'stale due date is a no-op';
  assert (public.pay_bill(rent, '2026-03-31', null, '2026-03-30')).paid, 'a real payment reports paid';
  b := public.undo_bill_payment((select id from public.bill_payments where bill_id = rent and due_on = '2026-03-31'));

  insert into public.bills (name, recurrence, due_day, next_due_on, boleto)
    values ('Luz', 'monthly', 10, '2026-09-10', '83620000000667800481001809756573100158963608')
    returning id into power;
  begin
    update public.bills set boleto = '1234' where id = power;
    raise exception 'FAIL: malformed boleto';
  exception when check_violation then null;
  end;
  begin
    perform (public.pay_bill(power, '2026-09-10', null, '2026-09-10')).bill;
    raise exception 'FAIL: variable bill paid without amount';
  exception when invalid_parameter_value then null;
  end;
  b := (public.pay_bill(power, '2026-09-10', 187.40, '2026-09-09')).bill;
  assert b.next_due_on = '2026-10-10', 'monthly advance';
  assert b.boleto is null, 'paying clears the boleto of the paid due date';
  -- Desfazer devolve a conta ao vencimento, com o boleto dele.
  b := public.undo_bill_payment((select id from public.bill_payments where bill_id = power and due_on = '2026-09-10'));
  assert b.next_due_on = '2026-09-10' and b.boleto = '83620000000667800481001809756573100158963608', 'undo restores the boleto';
  b := (public.pay_bill(power, '2026-09-10', 187.40, '2026-09-09')).bill;
  assert b.next_due_on = '2026-10-10' and b.boleto is null, 'paid again';
  -- Com o boleto do próximo vencimento já lido, desfazer pede para tirá-lo antes.
  update public.bills set boleto = '83630000001234500481001809756573100158963608' where id = power;
  begin
    perform public.undo_bill_payment((select id from public.bill_payments where bill_id = power and due_on = '2026-09-10'));
    raise exception 'FAIL: undo dropped the next boleto';
  exception when invalid_parameter_value then null;
  end;
  assert (select boleto from public.bills where id = power) = '83630000001234500481001809756573100158963608', 'next boleto kept';
  update public.bills set boleto = null where id = power;

  insert into public.bills (name, category, amount, recurrence, due_day, next_due_on)
    values ('IPVA', 'transporte', 1800, 'yearly', 15, '2026-03-15') returning id into ipva;
  b := (public.pay_bill(ipva, '2026-03-15', null, '2026-03-15')).bill;
  assert b.next_due_on = '2027-03-15', 'yearly advance';

  insert into public.bills (name, amount, recurrence, next_due_on) values ('Conserto', 300, 'once', '2026-09-20')
    returning id into once;
  b := (public.pay_bill(once, '2026-09-20', null, '2026-09-20')).bill;
  assert not b.active, 'one-off bill closes when paid';
  assert not (public.pay_bill(once, '2026-09-20', 300, '2026-09-21')).paid, 'paying a closed one-off bill again reports it';

  -- Vencimento editado para uma data já paga: não duplica, só anda.
  update public.bills set next_due_on = '2026-09-10' where id = power;
  select * into r from public.pay_bill(power, '2026-09-10', 999, '2026-09-26');
  assert (r.bill).next_due_on = '2026-10-10' and not r.paid, 'already paid due date advances and reports it';
  assert (select amount from public.bill_payments where bill_id = power and due_on = '2026-09-10') = 187.40,
    'existing payment is kept';

  -- Desfazer: só o mais recente; o vencimento volta.
  select id into pay from public.bill_payments where bill_id = rent and due_on = '2026-01-31';
  begin
    perform public.undo_bill_payment(pay);
    raise exception 'FAIL: undid an older payment';
  exception when invalid_parameter_value then null;
  end;
  select id into pay from public.bill_payments where bill_id = rent and due_on = '2026-02-28';
  b := public.undo_bill_payment(pay);
  assert b.next_due_on = '2026-02-28', 'undo restores the due date';
  select id into pay from public.bill_payments where bill_id = once;
  b := public.undo_bill_payment(pay);
  assert b.active, 'undo reopens a one-off bill';

  insert into public.expenses (description, amount, category, spent_on) values ('Feira', 86.50, 'mercado', '2026-09-26');

  -- Despesa médica para o IR: quem atendeu (CPF/CNPJ só dígitos) e o paciente da casa.
  insert into public.people (name) values ('Lia') returning id into kid;
  insert into public.expenses (description, amount, category, spent_on, deductible, provider_name, provider_doc, patient_id)
    values ('Pediatra', 350, 'saude', '2026-08-12', true, 'Dra. Paula', '52998224725', kid);
  begin
    insert into public.expenses (description, amount, provider_doc) values ('X', 1, '529.982.247-25');
    raise exception 'FAIL: formatted provider document';
  exception when check_violation then null;
  end;
  update public.bills set deductible = true, provider_name = 'Unimed', provider_doc = '02812468000106' where id = ipva;
  delete from public.people where id = kid;
  assert (select patient_id from public.expenses where description = 'Pediatra') is null,
    'removing the person keeps the expense without the patient';
  insert into public.people (name) values ('Lia') returning id into kid;
  perform set_config('test.person_kid', kid::text, false);

  begin
    insert into public.expenses (description, amount) values ('Nada', 0);
    raise exception 'FAIL: zero expense';
  exception when check_violation then null;
  end;
  begin
    insert into public.bills (name, category, next_due_on) values ('X', 'cassino', '2026-09-26');
    raise exception 'FAIL: invalid finance category';
  exception when check_violation then null;
  end;
  begin
    insert into public.bills (name, due_day, next_due_on) values ('X', 32, '2026-09-26');
    raise exception 'FAIL: due day out of range';
  exception when check_violation then null;
  end;

  perform set_config('test.bill_a', rent::text, false);
end $$;

select set_config('request.jwt.claim.sub', :'user_b', false) \gset
do $$
declare
  b public.bills;
begin
  assert (select count(*) from public.bills) = 4, 'B sees household bills';
  assert (select count(*) from public.expenses) = 2, 'B sees household expenses';
  b := (public.pay_bill(current_setting('test.bill_a')::uuid, '2026-02-28', null, '2026-02-28')).bill;
  assert (select paid_by from public.bill_payments where due_on = '2026-02-28' and bill_id = b.id) = auth.uid(),
    'payment records who paid';
end $$;

select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  assert (select count(*) from public.bills) = 0, 'C sees no foreign bills';
  assert (select count(*) from public.bill_payments) = 0, 'C sees no foreign payments';
  assert (select count(*) from public.expenses) = 0, 'C sees no foreign expenses';

  begin
    insert into public.expenses (description, amount, patient_id) values ('X', 1, current_setting('test.person_kid')::uuid);
    raise exception 'FAIL: expense for a person of another household';
  exception when foreign_key_violation then null;
  end;

  begin
    perform (public.pay_bill(current_setting('test.bill_a')::uuid, '2026-03-31', 1, '2026-03-31')).bill;
    raise exception 'FAIL: paid a foreign bill';
  exception when no_data_found then null;
  end;

  begin
    insert into public.bill_payments (bill_id, due_on, amount) values (current_setting('test.bill_a')::uuid, '2030-01-01', 1);
    raise exception 'FAIL: payment on a foreign bill';
  exception when foreign_key_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
\echo '• nota importada pelo QR code'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
begin
  insert into public.receipts (source, access_key) values ('qrcode', repeat('9', 44));
  begin
    insert into public.receipts (source) values ('sefaz');
    raise exception 'FAIL: unknown receipt source';
  exception when check_violation then null;
  end;
end $$;

\echo '• orçamento por categoria'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
begin
  insert into public.budgets (category, monthly_limit) values ('mercado', 1200), ('lazer', 300);
  insert into public.budgets (category, monthly_limit) values ('mercado', 1500)
    on conflict (household_id, category) do update set monthly_limit = excluded.monthly_limit;
  assert (select monthly_limit from public.budgets where category = 'mercado') = 1500, 'upsert updates the limit';
  begin
    insert into public.budgets (category, monthly_limit) values ('pet', 0);
    raise exception 'FAIL: zero budget';
  exception when check_violation then null;
  end;
  begin
    insert into public.budgets (category, monthly_limit) values ('nao-existe', 10);
    raise exception 'FAIL: unknown category';
  exception when check_violation then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  assert (select count(*) from public.budgets) = 0, 'C sees no foreign budgets';
  update public.budgets set monthly_limit = 1;
  delete from public.budgets;
end $$;
select set_config('request.jwt.claim.sub', :'user_b', false) \gset
do $$
begin
  assert (select count(*) from public.budgets) = 2, 'B sees household budgets, untouched by C';
end $$;

\echo '• cardápio da semana'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
begin
  insert into public.menu_items (day, meal, dish) values ('2026-09-28', 'almoco', 'Frango assado com arroz');
  insert into public.menu_items (day, meal, dish) values ('2026-09-28', 'almoco', 'Lasanha')
    on conflict (household_id, day, meal) do update set dish = excluded.dish;
  assert (select dish from public.menu_items where day = '2026-09-28' and meal = 'almoco') = 'Lasanha',
    'one dish per meal: upsert replaces it';
  begin
    insert into public.menu_items (day, meal, dish) values ('2026-09-28', 'cafe', 'Pão');
    raise exception 'FAIL: unknown meal';
  exception when check_violation then null;
  end;
  begin
    insert into public.menu_items (day, meal, dish) values ('2026-09-29', 'jantar', '   ');
    raise exception 'FAIL: empty dish';
  exception when check_violation then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  assert (select count(*) from public.menu_items) = 0, 'C sees no foreign menu';
  delete from public.menu_items;
end $$;
select set_config('request.jwt.claim.sub', :'user_b', false) \gset
do $$
begin
  assert (select count(*) from public.menu_items) = 1, 'B sees the household menu, untouched by C';
end $$;

\echo '• local da casa (dicas do clima)'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
begin
  insert into public.household_location (label, latitude, longitude, source)
    values ('Pinheiros, São Paulo', -23.56728, -46.70194, 'cep');
  assert (select latitude from public.household_location) = -23.57, 'coordinates kept at about 1 km';
  begin
    insert into public.household_location (label, latitude, longitude, source) values ('Outro', -15.8, -47.9, 'gps');
    raise exception 'FAIL: second location for the household';
  exception when unique_violation then null;
  end;
  begin
    update public.household_location set source = 'mapa';
    raise exception 'FAIL: unknown source';
  exception when check_violation then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', :'user_b', false) \gset
do $$
begin
  insert into public.household_location (label, latitude, longitude, source) values ('Asa Sul, Brasília', -15.83, -47.93, 'gps')
    on conflict (household_id) do update set label = excluded.label, latitude = excluded.latitude,
      longitude = excluded.longitude, source = excluded.source;
  assert (select label from public.household_location) = 'Asa Sul, Brasília', 'any member changes the location';
end $$;
select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  assert (select count(*) from public.household_location) = 0, 'C sees no foreign location';
  update public.household_location set label = 'Invadido';
  delete from public.household_location;
  insert into public.household_location (label, latitude, longitude, source) values ('Casa C', -22.9, -43.2, 'cep');
end $$;
select set_config('request.jwt.claim.sub', :'user_b', false) \gset
do $$
begin
  assert (select label from public.household_location) = 'Asa Sul, Brasília', 'B keeps the location, untouched by C';
end $$;

\echo '• limite de uso da IA'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  r record;
begin
  select * into r from public.use_ai('photo');
  assert r.allowed and r.used = 1 and r.lim = 100, 'first use counts';
  assert r.household = public.current_household_id() and r.usage_month = public.ai_month(), 'use returns what a refund needs';
  perform public.use_ai('photo');
  begin
    perform public.refund_ai(r.household, r.usage_month, 'photo');
    raise exception 'FAIL: user refunded its own usage';
  exception when insufficient_privilege then null;
  end;
  update public.ai_usage set count = 0;
  assert not found, 'usage cannot be changed directly';
  begin
    perform public.use_ai('video');
    raise exception 'FAIL: unknown kind';
  exception when invalid_parameter_value then null;
  end;
end $$;
set role service_role;
select public.refund_ai(:'hh_a', public.ai_month(), 'photo') \gset
set role authenticated;
do $$
begin
  assert (select used from public.ai_usage_summary() where kind = 'photo') = 1, 'the server refunds a failed call';
end $$;
reset role;
update public.ai_usage set count = 20 where kind = 'photo';
insert into public.ai_usage (household_id, month, kind, count)
  select household_id, month, 'menu', 20 from public.ai_usage where kind = 'photo';
set role authenticated;
do $$
declare
  r record;
begin
  select * into r from public.use_ai('menu');
  assert not r.allowed and r.used = 20 and r.lim = 20, 'at the limit, the call is refused';
  assert (select used from public.ai_usage_summary() where kind = 'menu') = 20, 'a refused call does not count';
  assert (select used from public.ai_usage_summary() where kind = 'chat') = 0, 'unused kinds show zero';
end $$;
select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  assert (select count(*) from public.ai_usage) = 0, 'C sees no foreign usage';
  assert (select used from public.ai_usage_summary() where kind = 'menu') = 0, 'C has its own quota';
end $$;

\echo '• nota em várias fotos'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  r uuid;
  hid text := public.current_household_id()::text;
begin
  insert into public.receipts (image_path, extra_image_paths)
    values (hid || '/1.jpg', array[hid || '/2.jpg', hid || '/3.jpg']) returning id into r;
  assert (select cardinality(extra_image_paths) from public.receipts where id = r) = 2, 'extra photos are kept in order';
  begin
    update public.receipts set extra_image_paths = array(select hid || '/' || n || '.jpg' from generate_series(1, 6) n) where id = r;
    raise exception 'FAIL: too many photos';
  exception when check_violation then null;
  end;
  delete from public.receipts where id = r;
end $$;

\echo '• tarefas com pontos para as crianças'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  kid uuid := current_setting('test.person_kid')::uuid;
  bed uuid;
  toys uuid;
  dishes uuid;
  teeth uuid;
  r record;
begin
  insert into public.chores (title, recurrence, due_on, kid_id, points) values ('Arrumar a cama', 'daily', '2026-09-27', kid, 10)
    returning id into bed;
  insert into public.chores (title, due_on, kid_id, points) values ('Guardar os brinquedos', '2026-09-28', kid, 5) returning id into toys;
  insert into public.chores (title, points) values ('Lavar a louça', 50) returning id into dishes;
  select * into r from public.complete_chore(bed, '2026-09-27', '2026-09-27');
  assert r.completed and r.points = 10 and r.person_id = kid, 'completion reports the points and who got them';
  -- Toque duplo (ou outro celular) na mesma ocorrência: conta uma vez.
  select * into r from public.complete_chore(bed, '2026-09-27', '2026-09-27');
  assert not r.completed and r.points = 0, 'a repeated completion reports that nothing counted';
  assert (select count(*) from public.chore_completions where chore_id = bed) = 1, 'same occurrence completes once';
  -- App antigo (sem vencimento), tarefa que se repete: toque duplo conta uma vez.
  insert into public.chores (title, recurrence, due_on, kid_id, points) values ('Escovar os dentes', 'daily', '2026-09-28', kid, 0)
    returning id into teeth;
  perform public.complete_chore(teeth, '2026-09-28');
  perform public.complete_chore(teeth, '2026-09-28');
  assert (select count(*) from public.chore_completions where chore_id = teeth) = 1, 'old app double tap completes once';
  -- Adiantada (a de amanhã feita hoje): a próxima conta do vencimento, e o
  -- mesmo toque de novo não passa.
  update public.chores set due_on = '2026-09-30', active = true where id = teeth;
  select * into r from public.complete_chore(teeth, '2026-09-29', '2026-09-30');
  assert r.completed and r.due_on = '2026-10-01', 'early completion moves on from the due date';
  select * into r from public.complete_chore(teeth, '2026-09-29', '2026-09-30');
  assert not r.completed, 'early completion counts once';
  delete from public.chores where id = teeth;
  perform public.complete_chore(bed, '2026-09-28', '2026-09-28');
  -- Tarefa única, pelo app antigo (sem vencimento): a segunda vez não conta.
  perform public.complete_chore(toys, '2026-09-28');
  perform public.complete_chore(toys, '2026-09-28');
  perform public.complete_chore(dishes, '2026-09-28');
  assert (select sum(points) from public.chore_completions where person_id = kid) = 25, 'kid earns the chore points once per occurrence';
  assert (select points from public.chore_completions where chore_id = dishes) = 0, 'chore without a kid earns nothing';

  perform public.redeem_points(kid, ' Sorvete ', 15);
  assert (select balance from public.kid_points where person_id = kid) = 10, 'balance is earned minus redeemed';
  assert (select title from public.point_redemptions where person_id = kid) = 'Sorvete', 'redemption title is trimmed';
  begin
    perform public.redeem_points(kid, 'Bicicleta', 11);
    raise exception 'FAIL: redeemed more than the balance';
  exception when raise_exception then null;
  end;
  begin
    perform public.redeem_points(kid, 'Nada', 0);
    raise exception 'FAIL: zero-point redemption';
  exception when check_violation then null;
  end;
  begin
    insert into public.point_redemptions (person_id, title, points) values (kid, 'Direto', 1);
    raise exception 'FAIL: redemption without the balance check';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.chores (title, points) values ('X', 5000);
    raise exception 'FAIL: too many points';
  exception when check_violation then null;
  end;

  -- Apagar a tarefa não leva os pontos já ganhos.
  delete from public.chores where id = bed;
  assert (select balance from public.kid_points where person_id = kid) = 10, 'deleting a chore keeps the points earned';
  assert (select count(*) from public.chore_completions where person_id = kid and chore_id is null and chore_title = 'Arrumar a cama') = 2,
    'kept completions remember the chore';
  perform set_config('test.kid_chore', toys::text, false);
end $$;
select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  assert (select count(*) from public.kid_points where person_id = current_setting('test.person_kid')::uuid) = 0,
    'C sees no foreign points';
  begin
    perform public.redeem_points(current_setting('test.person_kid')::uuid, 'Hack', 1);
    raise exception 'FAIL: redeemed points of a foreign kid';
  exception when no_data_found then null;
  end;
end $$;
-- A criança ganha conta no app (entra na casa com o mesmo nome): as tarefas
-- dela passam para a conta e param de dar pontos à ficha.
reset role;
\set user_lia '00000000-0000-0000-0000-000000000c1d'
insert into auth.users (id) values (:'user_lia');
insert into public.household_members (household_id, user_id, display_name) values (:'hh_a', :'user_lia', 'Lia');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  kid uuid := current_setting('test.person_kid')::uuid;
  toys uuid := current_setting('test.kid_chore')::uuid;
  c public.chores;
begin
  assert (select member_user_id from public.people where id = kid) = '00000000-0000-0000-0000-000000000c1d', 'kid claimed by the new member';
  select * into c from public.chores where id = toys;
  assert c.kid_id is null and c.assigned_to = '00000000-0000-0000-0000-000000000c1d', 'kid chores move to the new account';
  update public.chores set kid_id = kid, active = true, due_on = '2026-09-29' where id = toys;
  perform public.complete_chore(toys, '2026-09-29', '2026-09-29');
  assert (select points from public.chore_completions where chore_id = toys order by completed_at desc limit 1) = 0,
    'a person with an account earns no points';
end $$;
reset role;
delete from public.household_members where user_id = :'user_lia';
set role authenticated;

\echo '• divisão de gastos: pesos e acertos entre moradores'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  a uuid := auth.uid();
  b uuid := '00000000-0000-0000-0000-00000000000b';
  c uuid := '00000000-0000-0000-0000-00000000000c';
begin
  insert into public.split_weights (user_id, weight) values (a, 2), (b, 1);
  begin
    insert into public.split_weights (user_id, weight) values (c, 1);
    raise exception 'FAIL: weight for someone outside the household';
  exception when insufficient_privilege then null;
  end;
  insert into public.settlements (month, from_user, to_user, amount) values ('2026-09', b, a, 120);
  begin
    insert into public.settlements (month, from_user, to_user, amount) values ('2026-09', a, c, 10);
    raise exception 'FAIL: settlement with someone outside the household';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.settlements (month, from_user, to_user, amount) values ('2026-09', a, a, 10);
    raise exception 'FAIL: settlement with oneself';
  exception when check_violation then null;
  end;
  begin
    insert into public.settlements (month, from_user, to_user, amount) values ('2026-13', b, a, 10);
    raise exception 'FAIL: invalid month';
  exception when check_violation then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  assert (select count(*) from public.settlements) = 0 and (select count(*) from public.split_weights) = 0,
    'C sees no foreign split';
end $$;
select set_config('request.jwt.claim.sub', :'user_b', false) \gset
do $$
begin
  assert (select count(*) from public.settlements) = 1, 'B sees the household settlements';
  assert (select weight from public.split_weights where user_id = auth.uid()) = 1, 'B sees the household weights';
end $$;

-- ---------------------------------------------------------------------------
\echo '• várias casas por conta: a casa aberta vem no cabeçalho'
\set user_h '00000000-0000-0000-0000-000000000011'
reset role;
insert into auth.users (id) values (:'user_h');
select id as hh_c from public.households where name = 'Casa C' \gset
select set_config('test.hh_c', :'hh_c', false) \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_h', false) \gset
select (public.create_household('Casa H1', 'Heitor')).id as hh_h1 \gset
select (public.create_household('Casa H2', 'Heitor')).id as hh_h2 \gset
select set_config('test.hh_h1', :'hh_h1', false) \gset
select set_config('test.hh_h2', :'hh_h2', false) \gset
do $$
declare
  h1 uuid := current_setting('test.hh_h1')::uuid;
  h2 uuid := current_setting('test.hh_h2')::uuid;
begin
  assert (select array_agg(id) from public.my_households()) = array[h2, h1], 'both houses, the latest opened first';
  -- Sem cabeçalho (app antigo): a primeira casa em que entrou.
  assert public.current_household_id() = h1, 'no header: the first household';
  insert into public.shopping_lists (name) values ('Lista H1');
  perform set_config('request.headers', json_build_object('x-household-id', h2)::text, true);
  assert public.current_household_id() = h2, 'header picks the open household';
  insert into public.shopping_lists (name) values ('Lista H2');
  assert (select array_agg(name) from public.shopping_lists) = array['Lista H2'], 'only the open household data';
  assert (select name from public.households) = 'Casa H2', 'the open household';
  assert (select count(*) from public.people where member_user_id = auth.uid()) = 1, 'a profile in each household';
  perform set_config('request.headers', json_build_object('x-household-id', h1)::text, true);
  assert (select array_agg(name) from public.shopping_lists) = array['Lista H1'], 'switching shows the other household';

  -- Casa de que não é membro (ou valor qualquer): nenhuma, em vez de cair em outra.
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_c'))::text, true);
  assert public.current_household_id() is null, 'foreign household in the header: none';
  assert (select count(*) from public.shopping_lists) = 0, 'foreign household: nothing visible';
  begin
    insert into public.shopping_lists (name) values ('Invasão');
    raise exception 'FAIL: inserted into a foreign household';
  exception when not_null_violation or insufficient_privilege then null;
  end;
  perform set_config('request.headers', '{"x-household-id": "nada"}', true);
  assert public.current_household_id() is null, 'garbage header: none';
  perform set_config('request.headers', '', true);

  perform public.select_household(h1);
  assert (select id from public.my_households() limit 1) = h1, 'selecting moves the household to the top';
  begin
    perform public.select_household(current_setting('test.hh_c')::uuid);
    raise exception 'FAIL: selected a foreign household';
  exception when no_data_found then null;
  end;
end $$;

-- Tempo real: sem cabeçalho, só com o token; vale a casa que a sessão abriu.
do $$
declare
  h1 uuid := current_setting('test.hh_h1')::uuid;
  h2 uuid := current_setting('test.hh_h2')::uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', auth.uid(), 'session_id', 'sessao-1')::text, true);
  perform public.select_household(h2);
  assert public.current_household_id() = h2, 'no header: the household this session opened';
  assert (select array_agg(name) from public.shopping_lists) = array['Lista H2'], 'realtime sees the open household';
  perform set_config('request.headers', json_build_object('x-household-id', h1)::text, true);
  assert public.current_household_id() = h1, 'the header wins over the session';
  perform set_config('request.headers', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', auth.uid(), 'session_id', 'sessao-2')::text, true);
  assert public.current_household_id() = h1, 'a session that never chose: the first household';
  begin
    perform 1 from public.household_sessions;
    raise exception 'FAIL: read household_sessions directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Entra na casa A pelo código; de novo, não.
select public.join_household(:'invite_code', 'Heitor') \gset
do $$
begin
  begin
    perform public.join_household(current_setting('test.invite_a'), 'Heitor');
    raise exception 'FAIL: joined the same household twice';
  exception when unique_violation then null;
  end;
  perform public.create_household('Casa H4', 'Heitor');
  perform public.create_household('Casa H5', 'Heitor');
  assert (select count(*) from public.my_households()) = 5, 'five households';
  begin
    perform public.create_household('Casa H6', 'Heitor');
    raise exception 'FAIL: created more households than the limit';
  exception when sqlstate 'NK002' then null;
  end;
end $$;

-- Arquivos: qualquer casa de que é membro, e só elas.
do $$
begin
  insert into storage.objects (bucket_id, name) values ('documents', current_setting('test.hh_h2') || '/item-a.jpg');
  begin
    insert into storage.objects (bucket_id, name) values ('documents', current_setting('test.hh_c') || '/item-b.jpg');
    raise exception 'FAIL: uploaded into a foreign household folder';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from storage.objects where name like current_setting('test.hh_c') || '/%') = 0,
    'foreign folder is not visible';
end $$;

-- Sair de uma casa que não é a aberta.
do $$
declare
  h1 uuid := current_setting('test.hh_h1')::uuid;
  h2 uuid := current_setting('test.hh_h2')::uuid;
begin
  perform set_config('request.headers', json_build_object('x-household-id', h1)::text, true);
  assert (public.leave_household(h2, true))->>'status' = 'deleted', 'leaves (and deletes) a household that is not open';
  assert not exists (select 1 from public.my_households() where id = h2), 'H2 is gone';
  assert (select array_agg(name) from public.shopping_lists) = array['Lista H1'], 'the open household is untouched';
  perform set_config('request.headers', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', auth.uid(), 'session_id', 'sessao-1')::text, true);
  assert public.current_household_id() = h1, 'the session whose household is gone falls back to the first';
end $$;
reset role;
delete from storage.objects where name like '%/item-a.jpg';
do $$
begin
  assert exists (select 1 from public.household_file_cleanup where household_id = current_setting('test.hh_h2')::uuid),
    'the deleted household folder is queued for cleanup';
  delete from public.household_file_cleanup where household_id = current_setting('test.hh_h2')::uuid;
end $$;
set role authenticated;

\echo '• sair da casa: dono passa adiante, o último apaga a casa'
\set user_f '00000000-0000-0000-0000-00000000000f'
\set user_g '00000000-0000-0000-0000-000000000010'
reset role;
insert into auth.users (id) values (:'user_f'), (:'user_g');
set role anon;
do $$
begin
  perform public.leave_household(gen_random_uuid());
  raise exception 'FAIL: anon called leave_household';
exception when insufficient_privilege then null;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_f', false) \gset
select (public.create_household('Casa F', 'Fê')).invite_code as invite_f \gset
insert into public.shopping_lists (name) values ('Mercado da F');
insert into public.shopping_list_items (list_id, name, checked_at)
  select id, 'Café da F', now() from public.shopping_lists where name = 'Mercado da F';
do $$
begin
  assert public.clear_checked_items(
    (select id from public.shopping_lists where name = 'Mercado da F'),
    array(select id from public.shopping_list_items where checked_at is not null),
    array(select toggle_token from public.shopping_list_items where checked_at is not null)
  ) = 1, 'F has purchase history';
end $$;
-- Item com foto: apagar a casa apaga a lista sem jogar a foto na lixeira (a limpeza da casa leva a pasta).
insert into public.shopping_list_items (list_id, name, photo_path)
  select id, 'Pão da F', public.current_household_id()::text || '/item-pao.jpg' from public.shopping_lists where name = 'Mercado da F';
select set_config('request.jwt.claim.sub', :'user_g', false) \gset
select public.join_household(:'invite_f', 'Gabi') \gset
do $$
begin
  -- Sem a policy de delete, sair direto pela tabela não faz nada.
  delete from public.household_members where user_id = auth.uid();
  assert (select count(*) from public.household_members where user_id = auth.uid()) = 1,
    'direct delete no longer leaves the household';
end $$;

select set_config('request.jwt.claim.sub', :'user_f', false) \gset
do $$
begin
  begin
    perform public.leave_household(gen_random_uuid());
    raise exception 'FAIL: left a household by the wrong id';
  exception when no_data_found then null;
  end;
  declare
    result jsonb := public.leave_household(public.current_household_id());
  begin
    assert result->>'status' = 'left', 'owner leaves a household with other members';
    assert result->>'household_id' is not null, 'returns the household left';
  end;
  assert (select count(*) from public.households) = 0, 'F no longer sees the household';
  perform public.create_household('Casa nova da F', 'Fê');
end $$;

select set_config('request.jwt.claim.sub', :'user_g', false) \gset
do $$
begin
  assert (select role from public.household_members where user_id = auth.uid()) = 'owner', 'oldest member becomes owner';
  assert (select created_by from public.households) = auth.uid(), 'new owner can rename the household';
  update public.households set name = 'Casa da Gabi';
  assert (select name from public.households) = 'Casa da Gabi', 'rename works for the new owner';
  assert (select count(*) from public.shopping_lists) = 1, 'data stays with the household';
  begin
    perform public.leave_household(public.current_household_id());
    raise exception 'FAIL: last member deleted the household without confirming';
  exception when sqlstate 'NK001' then null;
  end;
  assert (select count(*) from public.household_members where user_id = auth.uid()) = 1, 'unconfirmed leave keeps G';
  assert (public.leave_household(public.current_household_id(), true))->>'status' = 'deleted',
    'last member deletes the household when confirmed';
  begin
    perform count(*) from public.household_file_cleanup;
    raise exception 'FAIL: app user read the cleanup queue';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.request_household_file_cleanup();
    raise exception 'FAIL: app user triggered the cleanup job';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.household_members where user_id = auth.uid()) = 0, 'G left';
  begin
    perform public.leave_household(gen_random_uuid());
    raise exception 'FAIL: left without a household';
  exception when no_data_found then null;
  end;
end $$;

reset role;
do $$
begin
  assert (select count(*) from public.households where name in ('Casa F', 'Casa da Gabi')) = 0, 'household deleted';
  assert (select count(*) from public.shopping_lists where name = 'Mercado da F') = 0, 'household data deleted';
  assert (select count(*) from public.purchase_history where name = 'Café da F') = 0, 'purchase history deleted';
  assert (select count(*) from public.households where name = 'Casa nova da F') = 1, 'F can start over';
  assert (select count(*) from public.household_file_cleanup) = 1, 'deleted household queued for photo cleanup';
  assert (select count(*) from public.storage_trash) = 0, 'a deleted household leaves nothing in the photo trash';
end $$;

-- ---------------------------------------------------------------------------
\echo '• avisos no navegador: inscrição, agenda e envio'
\set user_i '00000000-0000-0000-0000-000000000012'
\set user_j '00000000-0000-0000-0000-000000000013'
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (name text, decrypted_secret text);
create schema if not exists net;
create table net.requests (id bigserial primary key, url text, headers jsonb, body jsonb);
create function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds int default 5000
) returns bigint language sql as $$
  insert into net.requests (url, headers, body) values ($1, $4, $2) returning id;
$$;
insert into auth.users (id) values (:'user_i'), (:'user_j');
set role anon;
do $$
begin
  perform public.register_push_subscription('https://fcm.googleapis.com/fcm/send/x', 'k', 'a', 'UTC');
  raise exception 'FAIL: anon registered a browser';
exception when insufficient_privilege then null;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_i', false) \gset
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/i1', 'chave', 'segredo', 'America/Sao_Paulo') as sub_i \gset
select set_config('test.sub_i', :'sub_i', false) \gset
do $$
declare
  sub uuid := current_setting('test.sub_i')::uuid;
begin
  begin
    perform public.register_push_subscription('https://evil.example/fcm/send/x', 'k', 'a', 'UTC');
    raise exception 'FAIL: registered an endpoint outside the push services';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (auth.uid(), 'https://fcm.googleapis.com/fcm/send/direto', 'k', 'a');
    raise exception 'FAIL: inserted a subscription directly';
  exception when insufficient_privilege then null;
  end;
  -- O mesmo navegador de novo: a mesma inscrição; fuso inválido fica o padrão.
  assert public.register_push_subscription('https://fcm.googleapis.com/fcm/send/i1', 'chave2', 'segredo', 'Lugar/Nenhum') = sub, 'same browser, same subscription';
  assert (select timezone from public.push_subscriptions where id = sub) = 'America/Sao_Paulo', 'invalid timezone falls back to the default';
  assert (select p256dh from public.push_subscriptions where id = sub) = 'chave2', 'keys are updated';

  -- Próxima vez, na hora local (São Paulo, UTC-3; Nova York muda de horário em 1/11).
  assert public.push_next_at('daily', null, 8, 0, null, 'America/Sao_Paulo', '2026-10-01 10:00+00') = '2026-10-01 11:00+00', 'daily: later today';
  assert public.push_next_at('daily', null, 8, 0, null, 'America/Sao_Paulo', '2026-10-01 11:00+00') = '2026-10-02 11:00+00', 'daily: the time itself is the next day';
  assert public.push_next_at('weekly', null, 9, 0, 2, 'America/Sao_Paulo', '2026-10-01 12:00+00') = '2026-10-05 12:00+00', 'weekly: next monday';
  assert public.push_next_at('weekly', null, 9, 0, 5, 'America/Sao_Paulo', '2026-10-01 13:00+00') = '2026-10-08 12:00+00', 'weekly: same weekday, later time passed';
  assert public.push_next_at('daily', null, 8, 0, null, 'America/New_York', '2026-10-31 13:00+00') = '2026-11-01 13:00+00', 'daily across the clock change';
  assert public.push_next_at('once', '2026-10-03 12:00+00', null, null, null, 'UTC', now()) = '2026-10-03 12:00+00', 'once: its own time';

  insert into public.push_schedule (id, subscription_id, title, body, repeat, hour, minute, next_at)
  values ('00000000-0000-0000-0000-0000000000a1', sub, 'Amoxicilina — Ana', 'Hora de tomar: 5 ml', 'daily', 8, 0, '2000-01-01');
  assert (select next_at from public.push_schedule where id = '00000000-0000-0000-0000-0000000000a1') > now(), 'next_at comes from the database, not the app';
  insert into public.push_schedule (id, subscription_id, title, body, repeat, fire_at, data)
  values ('00000000-0000-0000-0000-0000000000a2', sub, 'Conta vence hoje', 'Luz', 'once', now() + interval '1 day', '{"reminder": "bills:x"}');
  insert into public.push_schedule (id, subscription_id, title, repeat, fire_at)
  values ('00000000-0000-0000-0000-0000000000a3', sub, 'Velho', 'once', now() + interval '2 days');
  insert into public.push_schedule (id, subscription_id, title, repeat, hour, minute, weekday)
  values ('00000000-0000-0000-0000-0000000000a4', sub, 'Toda segunda', 'weekly', 9, 0, 2);
  begin
    insert into public.push_schedule (id, subscription_id, title, repeat)
    values (gen_random_uuid(), sub, 'Sem hora', 'daily');
    raise exception 'FAIL: daily without a time';
  exception when check_violation or not_null_violation then null;
  end;
  begin
    perform public.take_due_pushes();
    raise exception 'FAIL: the app took the due pushes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.push_config();
    raise exception 'FAIL: the app read the push keys';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Outra conta não vê nem mexe na agenda de outro navegador.
select set_config('request.jwt.claim.sub', :'user_j', false) \gset
do $$
declare
  sub uuid := current_setting('test.sub_i')::uuid;
begin
  assert (select count(*) from public.push_subscriptions) = 0, 'foreign subscriptions are hidden';
  assert (select count(*) from public.push_schedule) = 0, 'foreign schedule is hidden';
  begin
    insert into public.push_schedule (id, subscription_id, title, repeat, hour, minute) values (gen_random_uuid(), sub, 'Invasão', 'daily', 8, 0);
    raise exception 'FAIL: scheduled on a foreign browser';
  exception when insufficient_privilege then null;
  end;
  delete from public.push_schedule;
  assert public.prune_push_schedule(sub, '{}') = 0, 'cannot prune a foreign browser';
  perform public.unregister_push_subscription('https://fcm.googleapis.com/fcm/send/i1');
end $$;

-- A dona: o que o app não reconhece mais sai da agenda.
select set_config('request.jwt.claim.sub', :'user_i', false) \gset
do $$
declare
  sub uuid := current_setting('test.sub_i')::uuid;
begin
  assert (select count(*) from public.push_schedule) = 4, 'the other account removed nothing';
  assert public.prune_push_schedule(sub, array[
    '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a4'
  ]::uuid[]) = 1, 'prunes the unknown one';
  assert (select count(*) from public.push_schedule) = 3, 'keeps the known ones';
end $$;

-- Envio: os vencidos ficam reservados e só saem da agenda (ou andam para a
-- próxima vez) depois de entregues; vencido há mais de uma hora não vai.
reset role;
update public.push_schedule set next_at = '2026-10-01 10:58+00' where id = '00000000-0000-0000-0000-0000000000a1';
update public.push_schedule set next_at = '2026-10-01 10:59+00', fire_at = '2026-10-01 10:59+00' where id = '00000000-0000-0000-0000-0000000000a2';
update public.push_schedule set next_at = '2026-10-01 08:00+00' where id = '00000000-0000-0000-0000-0000000000a4';
set role service_role;
do $$
declare
  sent text[];
begin
  select array_agg(title order by title) into sent from public.take_due_pushes('2026-10-01 11:00+00');
  assert sent = array['Amoxicilina — Ana', 'Conta vence hoje'], 'takes the due ones, not the stale one';
  assert (select next_at from public.push_schedule where id = '00000000-0000-0000-0000-0000000000a4') = '2026-10-05 12:00+00', 'the stale weekly moves on silently';
  assert not exists (select 1 from public.take_due_pushes('2026-10-01 11:01+00')), 'reserved: not taken twice';
  -- O remédio foi entregue; a conta falhou por um instante (serviço de push fora).
  perform public.finish_pushes(array['00000000-0000-0000-0000-0000000000a1']::uuid[], array['00000000-0000-0000-0000-0000000000a2']::uuid[], '2026-10-01 11:00:30+00');
  assert (select next_at from public.push_schedule where id = '00000000-0000-0000-0000-0000000000a1') = '2026-10-02 11:00+00', 'delivered daily moves to tomorrow';
  select array_agg(title) into sent from public.take_due_pushes('2026-10-01 11:01+00');
  assert sent = array['Conta vence hoje'], 'the failed one goes again';
  -- A função caiu no meio do envio: a reserva vence em 5 minutos.
  assert not exists (select 1 from public.take_due_pushes('2026-10-01 11:03+00')), 'still reserved';
  assert (select endpoint from public.take_due_pushes('2026-10-01 11:07+00')) = 'https://fcm.googleapis.com/fcm/send/i1', 'after 5 minutes it goes again, to the browser address';
  perform public.finish_pushes(array['00000000-0000-0000-0000-0000000000a2']::uuid[], '{}', '2026-10-01 11:07:10+00');
  assert not exists (select 1 from public.push_schedule where id = '00000000-0000-0000-0000-0000000000a2'), 'delivered one-off leaves the schedule';
end $$;
reset role;

-- O agendamento só chama a função quando há aviso vencido, e só com os segredos.
do $$
begin
  update public.push_schedule set next_at = now() + interval '1 hour';
  assert public.request_push_send() is null, 'nothing due: no call';
  update public.push_schedule set next_at = now() - interval '1 minute' where id = '00000000-0000-0000-0000-0000000000a1';
  begin
    perform public.request_push_send();
    raise exception 'FAIL: called send-push without the Vault secrets';
  exception when raise_exception then
    assert sqlerrm like 'Faltam os segredos project_url, anon_key e push_cron_secret%', 'names the missing secrets';
  end;
  insert into vault.decrypted_secrets values
    ('project_url', 'https://projeto.supabase.co/'), ('anon_key', 'anon'), ('push_cron_secret', 'segredo-cron'),
    ('push_vapid', '{"applicationServerKey": "BPublica", "publicKey": {"kty": "EC"}, "privateKey": {"kty": "EC"}, "subject": "mailto:x@y.z"}');
  perform public.request_push_send();
  assert (select url from net.requests order by id desc limit 1) = 'https://projeto.supabase.co/functions/v1/send-push', 'calls send-push';
  assert (select headers ->> 'x-push-secret' from net.requests order by id desc limit 1) = 'segredo-cron', 'with the cron secret';
  assert (public.push_config() ->> 'cronSecret') = 'segredo-cron' and (public.push_config() ->> 'subject') = 'mailto:x@y.z', 'config for send-push';
  update public.push_schedule set claimed_at = now() where id = '00000000-0000-0000-0000-0000000000a1';
  assert public.request_push_send() is null, 'being sent right now: no second call';
  update public.push_schedule set claimed_at = null;
end $$;
set role authenticated;
do $$
begin
  assert public.push_public_key() = 'BPublica', 'the app reads the public key';
end $$;

-- O app não confirma entregas.
do $$
begin
  begin
    perform public.finish_pushes('{}', '{}');
    raise exception 'FAIL: the app confirmed deliveries';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Outra conta neste navegador: a inscrição e a agenda da anterior saem.
select set_config('request.jwt.claim.sub', :'user_j', false) \gset
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/i1', 'chave-j', 'segredo-j', 'UTC') as sub_j \gset
do $$
begin
  assert (select count(*) from public.push_subscriptions) = 1, 'J owns the browser now';
  assert (select count(*) from public.push_schedule) = 0, 'and starts with an empty schedule';
  insert into public.push_schedule (id, subscription_id, title, repeat, hour, minute)
  select gen_random_uuid(), (select id from public.push_subscriptions), 'Aviso ' || n, 'daily', 8, 0
  from generate_series(1, public.max_push_schedule()) n;
  begin
    insert into public.push_schedule (id, subscription_id, title, repeat, hour, minute)
    values (gen_random_uuid(), (select id from public.push_subscriptions), 'Um a mais', 'daily', 8, 0);
    raise exception 'FAIL: scheduled past the limit';
  exception when sqlstate 'NK003' then null;
  end;
  perform public.unregister_push_subscription('https://fcm.googleapis.com/fcm/send/i1');
  assert (select count(*) from public.push_subscriptions) = 0, 'unregistered';
end $$;
reset role;
do $$
begin
  assert not exists (select 1 from public.push_schedule), 'the schedule goes with the subscription';
  assert not exists (select 1 from public.push_subscriptions where user_id = '00000000-0000-0000-0000-000000000012'), 'I lost the browser to J';
end $$;
set client_min_messages = warning;
drop schema vault cascade;
drop schema net cascade;
reset client_min_messages;

-- Sem os segredos do Vault, o job da limpeza falha com a instrução em vez de chamar uma URL nula.
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (name text, decrypted_secret text);
do $$
begin
  begin
    perform public.request_household_file_cleanup();
    raise exception 'FAIL: cleanup job ran without the Vault secrets';
  exception when raise_exception then
    assert sqlerrm like 'Faltam os segredos project_url e anon_key%', 'cleanup job names the missing secrets';
  end;
  delete from public.household_file_cleanup;
  assert public.request_household_file_cleanup() is null, 'empty queue: nothing to call';
end $$;

\echo 'OK — todos os testes do banco passaram'
