-- Testes do schema: isolamento entre famílias (RLS), matching, preços,
-- confirmação de nota, recorrência de tarefas, remédios, saúde, aparelhos,
-- documentos, financeiro, saída da casa e compromissos da família.
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
  assert public.join_household('ZZZZZZ', 'Beto') is null, 'wrong code: nothing, and the attempt counts';
  begin
    perform 1 from public.join_attempts;
    raise exception 'FAIL: app user read the join attempts';
  exception when insufficient_privilege then null;
  end;
end $$;
select public.join_household(lower(:'invite_code'), 'Beto') \gset

select set_config('request.jwt.claim.sub', :'user_c', false) \gset
select public.create_household('Casa C', 'Caio') \gset

reset role;
select id as hh_a from public.households where name = 'Casa A' \gset
select set_config('test.hh_a', :'hh_a', false) \gset
set role authenticated;

-- ---------------------------------------------------------------------------
\echo '• código errado demais: a conta espera uma hora'
\set user_z '00000000-0000-0000-0000-00000000001a'
reset role;
insert into auth.users (id) values (:'user_z');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_z', false) \gset
do $$
begin
  for i in 1..public.max_join_attempts() loop
    assert public.join_household('ZZZZZ' || i, 'Zé') is null, 'wrong code';
  end loop;
  begin
    perform public.join_household('ZZZZZZ', 'Zé');
    raise exception 'FAIL: tried past the limit';
  exception when sqlstate 'NK004' then null;
  end;
  -- Mesmo o código certo espera: a conta está bloqueada.
  begin
    perform public.join_household(current_setting('test.invite_a'), 'Zé');
    raise exception 'FAIL: the right code bypassed the block';
  exception when sqlstate 'NK004' then null;
  end;
end $$;
reset role;
do $$
begin
  assert (select failed from public.join_attempts where user_id = '00000000-0000-0000-0000-00000000001a') = public.max_join_attempts(), 'attempts counted';
  -- A hora passou (contada do primeiro erro: errar de novo não a estica).
  update public.join_attempts set window_started_at = now() - interval '61 minutes';
end $$;
set role authenticated;
do $$
begin
  assert public.join_household('ZZZZZZ', 'Zé') is null, 'after an hour, tries again';
end $$;
reset role;
do $$
begin
  assert (select failed from public.join_attempts where user_id = '00000000-0000-0000-0000-00000000001a') = 1, 'a new hour starts the count over';
  assert (select window_started_at from public.join_attempts where user_id = '00000000-0000-0000-0000-00000000001a') > now() - interval '1 minute', 'and starts now';
  -- Um erro a cada 59 minutos nunca chega ao limite: a hora é contada do primeiro erro.
  update public.join_attempts set failed = 9, window_started_at = now() - interval '59 minutes';
end $$;
set role authenticated;
do $$
begin
  assert public.join_household('ZZZZZZ', 'Zé') is null, 'tenth error inside the hour';
  begin
    perform public.join_household('ZZZZZZ', 'Zé');
    raise exception 'FAIL: tried past the limit';
  exception when sqlstate 'NK004' then null;
  end;
end $$;
reset role;
update public.join_attempts set window_started_at = now() - interval '2 hours';
set role authenticated;
do $$
begin
  perform public.join_household(current_setting('test.invite_a'), 'Zé');
  assert (select count(*) from public.household_members where user_id = auth.uid()) = 1, 'the right code joins';
  perform public.leave_household(current_setting('test.hh_a')::uuid);
end $$;
reset role;
do $$
begin
  assert (select failed from public.join_attempts where user_id = '00000000-0000-0000-0000-00000000001a') = 10, 'joining does not clear the count';
  -- Zé passou por A só para o teste: a ficha que ficou lá sai.
  delete from public.people where household_id = current_setting('test.hh_a')::uuid and name = 'Zé';
  -- A hora dos dez erros ainda corre: entrar e sair não abre brecha.
  update public.join_attempts set window_started_at = now() - interval '10 minutes';
end $$;
set role authenticated;
do $$
begin
  begin
    perform public.join_household('ZZZZZZ', 'Zé');
    raise exception 'FAIL: joining a known household reset the limit';
  exception when sqlstate 'NK004' then null;
  end;
end $$;
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
  -- A nota pelo QR code não usa IA, mas a busca na Sefaz conta no mesmo limite.
  select * into r from public.use_ai('nfce');
  assert r.allowed and r.used = 1 and r.lim = 200, 'the QR code reading has its own limit';
  assert (select array_agg(kind order by kind) from public.ai_usage_summary()) = array['chat', 'menu', 'nfce', 'photo'], 'the summary lists every kind';
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

  -- Quem pagou: só morador da casa (em gastos, pagamentos e notas).
  insert into public.expenses (description, amount, paid_by) values ('Padaria', 12, b);
  begin
    insert into public.expenses (description, amount, paid_by) values ('X', 1, c);
    raise exception 'FAIL: expense paid by someone outside the household';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.expenses set paid_by = c where description = 'Padaria';
    raise exception 'FAIL: expense handed to someone outside the household';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.receipts (source, paid_by) values ('manual', c);
    raise exception 'FAIL: receipt paid by someone outside the household';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.bill_payments set paid_by = c;
    raise exception 'FAIL: bill payment handed to someone outside the household';
  exception when foreign_key_violation then null;
  end;
  update public.expenses set paid_by = null where description = 'Padaria';
  delete from public.expenses where description = 'Padaria';
end $$;
-- Quem saiu continua como pagador do que pagou: editar o gasto não esbarra no gatilho.
reset role;
alter table public.expenses disable trigger expenses_paid_by_member;
insert into public.expenses (household_id, description, amount, paid_by)
  values (current_setting('test.hh_a')::uuid, 'Antigo', 5, '00000000-0000-0000-0000-00000000000c');
alter table public.expenses enable trigger expenses_paid_by_member;
set role authenticated;
do $$
begin
  -- O app manda o gasto inteiro, com o mesmo pagador.
  update public.expenses set amount = 6, paid_by = '00000000-0000-0000-0000-00000000000c' where description = 'Antigo';
  assert (select amount from public.expenses where description = 'Antigo') = 6, 'editing keeps a payer who left';
  delete from public.expenses where description = 'Antigo';
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
\echo '• o dono tira moradores e troca o código de convite'
\set user_k '00000000-0000-0000-0000-000000000014'
\set user_l '00000000-0000-0000-0000-000000000015'
reset role;
insert into auth.users (id) values (:'user_k'), (:'user_l');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_k', false) \gset
select (public.create_household('Casa K', 'Kim')).id as hh_k \gset
select set_config('test.hh_k', :'hh_k', false) \gset
select invite_code as invite_k from public.households where id = :'hh_k' \gset
select set_config('request.jwt.claim.sub', :'user_l', false) \gset
select public.join_household(:'invite_k', 'Lia') \gset
do $$
declare
  hk uuid := current_setting('test.hh_k')::uuid;
begin
  begin
    perform public.regenerate_invite_code(hk);
    raise exception 'FAIL: a member changed the invite code';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.remove_member(hk, '00000000-0000-0000-0000-000000000014');
    raise exception 'FAIL: a member removed the owner';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', auth.uid(), 'session_id', 'sessao-l')::text, true);
  perform public.select_household(hk);
  perform set_config('request.jwt.claims', '', true);
  -- No navegador de L: avisos desta casa e de outra, com e sem a casa marcada
  -- (os sem marca são de antes de o aviso levar a casa: valem pelo remédio ou pela tarefa).
  perform set_config('test.sub_l', public.register_push_subscription('https://fcm.googleapis.com/fcm/send/l1', 'k', 'a', 'UTC')::text, false);
  insert into public.medications (person_name, name, times) values ('Lia', 'Vitamina K', array['08:00']);
  insert into public.chores (title, due_on) values ('Tarefa da K', '2026-10-10');
end $$;
-- As linhas de outra casa e as antigas entram direto (a policy só deixa o
-- navegador agendar avisos de casas em que a pessoa está).
reset role;
do $$
declare
  hk uuid := current_setting('test.hh_k')::uuid;
begin
  insert into public.push_schedule (id, subscription_id, title, repeat, hour, minute, data) values
    ('00000000-0000-0000-0000-0000000000b1', current_setting('test.sub_l')::uuid, 'Remédio da casa K', 'daily', 8, 0, json_build_object('medicationId', 'm', 'householdId', hk)::jsonb),
    ('00000000-0000-0000-0000-0000000000b2', current_setting('test.sub_l')::uuid, 'Conta de outra casa', 'daily', 8, 0, json_build_object('reminder', 'bills:x:2026-10-10', 'householdId', gen_random_uuid())::jsonb),
    ('00000000-0000-0000-0000-0000000000b3', current_setting('test.sub_l')::uuid, 'Remédio antigo da K', 'daily', 8, 0, json_build_object('medicationId', (select id from public.medications where name = 'Vitamina K'))::jsonb),
    ('00000000-0000-0000-0000-0000000000b4', current_setting('test.sub_l')::uuid, 'Tarefa antiga da K', 'daily', 9, 0, json_build_object('reminder', 'chores:' || (select id from public.chores where title = 'Tarefa da K') || ':2026-10-10')::jsonb),
    ('00000000-0000-0000-0000-0000000000b5', current_setting('test.sub_l')::uuid, 'Conta antiga já apagada (casa desconhecida)', 'daily', 9, 0, json_build_object('reminder', 'bills:' || gen_random_uuid() || ':2026-10-10')::jsonb),
    ('00000000-0000-0000-0000-0000000000b6', current_setting('test.sub_l')::uuid, 'Clima de outra casa', 'daily', 7, 0, json_build_object('reminder', 'weather:dia:2026-10-10', 'householdId', gen_random_uuid())::jsonb),
    ('00000000-0000-0000-0000-0000000000b7', current_setting('test.sub_l')::uuid, 'Clima antigo (sem casa)', 'daily', 7, 0, json_build_object('reminder', 'weather:dia:2026-10-11')::jsonb),
    ('00000000-0000-0000-0000-0000000000b8', current_setting('test.sub_l')::uuid, 'Remédio antigo já apagado', 'daily', 8, 0, json_build_object('medicationId', gen_random_uuid())::jsonb);
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_k', false) \gset
do $$
declare
  hk uuid := current_setting('test.hh_k')::uuid;
  old_code text := (select invite_code from public.households where id = hk);
  new_code text;
begin
  begin
    perform public.regenerate_invite_code(current_setting('test.hh_a')::uuid);
    raise exception 'FAIL: changed the invite code of a foreign household';
  exception when insufficient_privilege then null;
  end;
  new_code := public.regenerate_invite_code(hk);
  assert new_code <> old_code and new_code ~ '^[A-Z2-9]{6}$', 'a new code in the same format';
  assert (select invite_code from public.households where id = hk) = new_code, 'the household has the new code';
  perform set_config('test.invite_k_old', old_code, false);
  perform set_config('test.invite_k_new', new_code, false);

  begin
    perform public.remove_member(hk, auth.uid());
    raise exception 'FAIL: the owner removed itself';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.remove_member(hk, '00000000-0000-0000-0000-00000000000c');
    raise exception 'FAIL: removed someone who is not a member';
  exception when no_data_found then null;
  end;
  perform public.remove_member(hk, '00000000-0000-0000-0000-000000000015');
  assert (select count(*) from public.household_members where household_id = hk) = 1, 'the member is out';
  assert (select member_user_id from public.people where household_id = hk and name = 'Lia') is null,
    'the person record stays as a dependent';
end $$;
reset role;
do $$
begin
  assert (select array_agg(id order by id) from public.push_schedule where subscription_id = current_setting('test.sub_l')::uuid)
    = array['00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b6']::uuid[],
    'the removed member browser loses this household reminders (tagged, resolved by medication/chore, or untagged and unresolvable), keeps the other household ones';
  delete from public.push_subscriptions where id = current_setting('test.sub_l')::uuid;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_l', false) \gset
do $$
declare
  hk uuid := current_setting('test.hh_k')::uuid;
begin
  assert (select count(*) from public.households where id = hk) = 0, 'the removed member no longer sees the household';
  perform set_config('request.headers', json_build_object('x-household-id', hk)::text, true);
  assert public.current_household_id() is null, 'nor with the header';
  perform set_config('request.headers', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', auth.uid(), 'session_id', 'sessao-l')::text, true);
  assert public.current_household_id() is null, 'nor through the session that had it open';
  perform set_config('request.jwt.claims', '', true);
  -- A sincronização que ainda rodava no navegador dele não recria os avisos da casa.
  perform set_config('test.sub_l', public.register_push_subscription('https://fcm.googleapis.com/fcm/send/l2', 'k', 'a', 'UTC')::text, false);
  begin
    insert into public.push_schedule (id, subscription_id, title, repeat, hour, minute, data)
      values (gen_random_uuid(), current_setting('test.sub_l')::uuid, 'Remédio da casa K', 'daily', 8, 0, json_build_object('medicationId', 'm', 'householdId', hk)::jsonb);
    raise exception 'FAIL: scheduled a reminder of a household the user is no longer in';
  exception when insufficient_privilege then null;
  end;
  insert into public.push_schedule (id, subscription_id, title, repeat, hour, minute)
    values (gen_random_uuid(), current_setting('test.sub_l')::uuid, 'Aviso sem casa', 'daily', 8, 0);
  -- Código antigo: não acha a casa (a versão final de join_household devolve nulo e conta a tentativa).
  assert (public.join_household(current_setting('test.invite_k_old'), 'Lia')).id is null, 'the old invite code no longer works';
  -- (Se o código antigo tivesse entrado, este falharia com "already a member".)
  perform public.join_household(current_setting('test.invite_k_new'), 'Lia');
  assert (select member_user_id from public.people where household_id = hk and name = 'Lia') = auth.uid(),
    'joining again takes the dependent record back';
  -- De volta na casa, os avisos dela voltam a poder ser agendados.
  insert into public.push_schedule (id, subscription_id, title, repeat, hour, minute, data)
    values (gen_random_uuid(), current_setting('test.sub_l')::uuid, 'Remédio da casa K', 'daily', 8, 0, json_build_object('medicationId', 'm', 'householdId', hk)::jsonb);
end $$;
reset role;
do $$
begin
  assert not exists (select 1 from public.household_sessions where household_id = current_setting('test.hh_k')::uuid
    and user_id = '00000000-0000-0000-0000-000000000015' and session_id = 'sessao-l'), 'the removed member session forgot the household';
  delete from public.push_subscriptions where id = current_setting('test.sub_l')::uuid;
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
    assert sqlerrm like 'Faltam os segredos project_url e push_cron_secret%', 'names the missing secrets';
  end;
  -- Sem anon_key: a chamada não leva chave do Supabase, só o segredo.
  insert into vault.decrypted_secrets values
    ('project_url', 'https://projeto.supabase.co/'), ('push_cron_secret', 'segredo-cron'),
    ('push_vapid', '{"applicationServerKey": "BPublica", "publicKey": {"kty": "EC"}, "privateKey": {"kty": "EC"}, "subject": "mailto:x@y.z"}');
  perform public.request_push_send();
  assert (select url from net.requests order by id desc limit 1) = 'https://projeto.supabase.co/functions/v1/send-push', 'calls send-push';
  assert (select headers ->> 'x-push-secret' from net.requests order by id desc limit 1) = 'segredo-cron', 'with the cron secret';
  assert (select headers from net.requests order by id desc limit 1) - 'Content-Type' - 'x-push-secret' = '{}', 'and no API key or token';
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

  -- Teto de navegadores por conta: o que ficou mais tempo sem abrir sai, com a agenda.
  for n in 1..public.max_push_subscriptions() loop
    perform public.register_push_subscription('https://fcm.googleapis.com/fcm/send/j' || n, 'k', 'a', 'UTC');
  end loop;
  insert into public.push_schedule (id, subscription_id, title, repeat, hour, minute)
  values (gen_random_uuid(), (select id from public.push_subscriptions where endpoint like '%/j3'), 'Do antigo', 'daily', 8, 0);
end $$;
-- O navegador j3 ficou um mês sem abrir o app (o app não mexe em updated_at: só a função).
reset role;
update public.push_subscriptions set updated_at = now() - interval '30 days' where endpoint like '%/j3';
set role authenticated;
do $$
begin
  perform public.register_push_subscription('https://fcm.googleapis.com/fcm/send/j-novo', 'k', 'a', 'UTC');
  assert (select count(*) from public.push_subscriptions) = public.max_push_subscriptions(), 'one browser past the cap: the cap holds';
  assert not exists (select 1 from public.push_subscriptions where endpoint like '%/j3'), 'the stalest browser is out';
  assert not exists (select 1 from public.push_schedule where title = 'Do antigo'), 'and its schedule with it';
  assert exists (select 1 from public.push_subscriptions where endpoint like '%/j-novo'), 'the new browser is in';
  -- Um navegador conhecido de novo não derruba ninguém.
  perform public.register_push_subscription('https://fcm.googleapis.com/fcm/send/j1', 'k2', 'a', 'UTC');
  assert (select count(*) from public.push_subscriptions) = public.max_push_subscriptions(), 'a known browser just updates';
  delete from public.push_schedule;
  for n in 1..public.max_push_subscriptions() loop
    perform public.unregister_push_subscription('https://fcm.googleapis.com/fcm/send/j' || n);
  end loop;
  perform public.unregister_push_subscription('https://fcm.googleapis.com/fcm/send/j-novo');
  assert (select count(*) from public.push_subscriptions) = 0, 'all unregistered';
end $$;
reset role;
do $$
begin
  assert not exists (select 1 from public.push_schedule), 'the schedule goes with the subscription';
  assert not exists (select 1 from public.push_subscriptions where user_id = '00000000-0000-0000-0000-000000000012'), 'I lost the browser to J';
end $$;
set client_min_messages = warning;
drop schema vault cascade;
delete from net.requests;
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
    assert sqlerrm like 'Faltam os segredos project_url e cleanup_cron_secret%', 'cleanup job names the missing secrets';
  end;
  -- Com os segredos: chama a função com o segredo da limpeza, que só a service role lê.
  insert into vault.decrypted_secrets values
    ('project_url', 'https://projeto.supabase.co/'), ('cleanup_cron_secret', 'segredo-limpeza');
  perform public.request_household_file_cleanup();
  assert (select url from net.requests order by id desc limit 1) = 'https://projeto.supabase.co/functions/v1/leave-household', 'calls leave-household';
  assert (select headers ->> 'x-cleanup-secret' from net.requests order by id desc limit 1) = 'segredo-limpeza', 'with the cleanup secret';
  assert (select headers from net.requests order by id desc limit 1) - 'Content-Type' - 'x-cleanup-secret' = '{}', 'and no API key or token';
  assert public.cleanup_config() = 'segredo-limpeza', 'config for leave-household';
  delete from public.household_file_cleanup;
  assert public.request_household_file_cleanup() is null, 'empty queue: nothing to call';
end $$;
set role authenticated;
do $$
begin
  begin
    perform public.cleanup_config();
    raise exception 'FAIL: the app read the cleanup secret';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set client_min_messages = warning;
drop schema net cascade;
reset client_min_messages;

-- ---------------------------------------------------------------------------
\echo '• consultor financeiro (beta): liberação, dados do banco privados e limite da IA'
-- Kátia tem a liberação na Casa da Kátia (e outra casa sem ela); Léo mora com
-- ela e perde a liberação no meio dos testes; Mara tem a liberação na casa dela.
\set user_k '00000000-0000-0000-0000-000000000017'
\set user_l '00000000-0000-0000-0000-000000000018'
\set user_m '00000000-0000-0000-0000-000000000019'
reset role;
insert into auth.users (id) values (:'user_k'), (:'user_l'), (:'user_m');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_k', false) \gset
select (public.create_household('Casa da Kátia', 'Kátia')).invite_code as invite_k \gset
select (public.create_household('Casa de praia da Kátia', 'Kátia')).id as hh_k2 \gset
select set_config('request.jwt.claim.sub', :'user_l', false) \gset
select public.join_household(:'invite_k', 'Léo') \gset
select set_config('request.jwt.claim.sub', :'user_m', false) \gset
select (public.create_household('Casa da Mara', 'Mara')).id as hh_m \gset
reset role;
select id as hh_k from public.households where name = 'Casa da Kátia' \gset
select set_config('test.hh_k', :'hh_k', false) \gset
select set_config('test.hh_k2', :'hh_k2', false) \gset
select set_config('test.hh_m', :'hh_m', false) \gset

-- Liberação manual (editor SQL), só para moradora da casa.
insert into public.beta_access (user_id, household_id, feature) values
  (:'user_k', :'hh_k', 'finance'),
  (:'user_l', :'hh_k', 'finance'),
  (:'user_m', :'hh_m', 'finance');
do $$
begin
  begin
    insert into public.beta_access (user_id, household_id, feature)
    values ('00000000-0000-0000-0000-000000000019', current_setting('test.hh_k')::uuid, 'finance');
    raise exception 'FAIL: granted the beta outside the household';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.beta_access (user_id, household_id, feature)
    values ('00000000-0000-0000-0000-000000000017', current_setting('test.hh_k')::uuid, 'outra');
    raise exception 'FAIL: granted an unknown feature';
  exception when check_violation then null;
  end;
end $$;

-- A função finance grava com a chave de serviço.
set role service_role;
do $$
declare
  hk uuid := current_setting('test.hh_k')::uuid;
  hk2 uuid := current_setting('test.hh_k2')::uuid;
  hm uuid := current_setting('test.hh_m')::uuid;
  k uuid := '00000000-0000-0000-0000-000000000017';
  l uuid := '00000000-0000-0000-0000-000000000018';
  m uuid := '00000000-0000-0000-0000-000000000019';
  doc_hash text := encode(sha256(convert_to(k || ':12345678909', 'UTF8')), 'hex');
begin
  insert into public.fin_connections (id, user_id, household_id, label, pluggy_item_id, status) values
    ('00000000-0000-0000-0000-0000000000c1', k, hk, 'Nubank', 'item-k-nubank', 'UPDATED'),
    ('00000000-0000-0000-0000-0000000000c2', k, hk, 'Inter', 'item-k-inter', 'UPDATED'),
    ('00000000-0000-0000-0000-0000000000c3', l, hk, 'Banco do Léo', 'item-l', 'UPDATED'),
    ('00000000-0000-0000-0000-0000000000c4', m, hm, 'Santander', 'item-m', 'UPDATED');
  insert into public.fin_accounts
    (id, connection_id, user_id, household_id, pluggy_account_id, type, name, number_last4, owner_doc_hash, balance)
  values
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', k, hk, 'acc-k-nubank', 'BANK', 'Conta', '1234', doc_hash, 1500),
    ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c2', k, hk, 'acc-k-inter', 'CREDIT', 'Cartão', '9876', null, 320.50),
    ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c3', l, hk, 'acc-l', 'BANK', 'Conta', null, null, 10),
    ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000c4', m, hm, 'acc-m', 'BANK', 'Conta', null, null, 10);
  insert into public.fin_transactions
    (account_id, user_id, household_id, pluggy_transaction_id, status, direction, amount, occurred_on, description,
     counterparty_doc_kind, counterparty_doc_hash)
  values
    ('00000000-0000-0000-0000-0000000000a1', k, hk, 'tx-k-1', 'POSTED', 'DEBIT', 45.90, '2026-10-01', 'Padaria', null, null),
    ('00000000-0000-0000-0000-0000000000a1', k, hk, 'tx-k-2', 'PENDING', 'DEBIT', 120, '2026-10-02', 'PIX enviado', 'CPF', doc_hash),
    ('00000000-0000-0000-0000-0000000000a2', k, hk, 'tx-k-3', 'POSTED', 'DEBIT', 89.90, '2026-10-03', 'Mercado', null, null),
    ('00000000-0000-0000-0000-0000000000a3', l, hk, 'tx-l-1', 'POSTED', 'DEBIT', 15, '2026-10-03', 'Café', null, null),
    ('00000000-0000-0000-0000-0000000000a4', m, hm, 'tx-m-1', 'POSTED', 'CREDIT', 3000, '2026-10-05', 'Salário', null, null);

  -- Cada linha é de uma pessoa numa casa em que ela mora, do começo ao fim.
  begin
    insert into public.fin_connections (user_id, household_id, label, pluggy_item_id) values (m, hk, 'Intrusa', 'item-x');
    raise exception 'FAIL: connection for someone outside the household';
  exception when foreign_key_violation then null;
  end;
  -- E só com a liberação naquela casa: nem a chave de serviço grava banco sem ela.
  begin
    insert into public.fin_connections (user_id, household_id, label, pluggy_item_id) values (k, hk2, 'Sem liberação', 'item-k2');
    raise exception 'FAIL: connection without the beta grant';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.fin_connections (user_id, household_id, beta_feature, label, pluggy_item_id)
    values (k, hk, 'outra', 'Outra', 'item-k3');
    raise exception 'FAIL: connection tied to another feature';
  exception when check_violation then null;
  end;
  begin
    insert into public.fin_connections (user_id, household_id, label, pluggy_item_id) values (m, hm, 'Nubank', 'item-k-nubank');
    raise exception 'FAIL: the same Pluggy item twice';
  exception when unique_violation then null;
  end;
  begin
    insert into public.fin_accounts (connection_id, user_id, household_id, pluggy_account_id, type)
    values ('00000000-0000-0000-0000-0000000000c1', m, hm, 'acc-x', 'BANK');
    raise exception 'FAIL: account under someone else''s connection';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.fin_transactions
      (account_id, user_id, household_id, pluggy_transaction_id, status, direction, amount, occurred_on, description)
    values ('00000000-0000-0000-0000-0000000000a1', l, hk, 'tx-x', 'POSTED', 'DEBIT', 1, '2026-10-01', 'X');
    raise exception 'FAIL: transaction under someone else''s account';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.fin_connections (user_id, household_id, label, pluggy_item_id) values (k, hk, '   ', 'item-y');
    raise exception 'FAIL: blank label';
  exception when check_violation then null;
  end;
  begin
    insert into public.fin_connections (user_id, household_id, label, pluggy_item_id) values (k, hk, repeat('x', 41), 'item-y');
    raise exception 'FAIL: label longer than 40';
  exception when check_violation then null;
  end;
  begin
    insert into public.fin_transactions
      (account_id, user_id, household_id, pluggy_transaction_id, status, direction, amount, occurred_on, description)
    values ('00000000-0000-0000-0000-0000000000a1', k, hk, 'tx-x', 'POSTED', 'DEBIT', -1, '2026-10-01', 'X');
    raise exception 'FAIL: negative amount (the direction says the sign)';
  exception when check_violation then null;
  end;
  -- Documentos de pessoas nunca ficam crus.
  begin
    update public.fin_accounts set number_last4 = '12345678' where id = '00000000-0000-0000-0000-0000000000a1';
    raise exception 'FAIL: stored the whole account number';
  exception when check_violation then null;
  end;
  begin
    update public.fin_accounts set owner_doc_hash = '12345678909' where id = '00000000-0000-0000-0000-0000000000a1';
    raise exception 'FAIL: stored the owner CPF';
  exception when check_violation then null;
  end;
  begin
    update public.fin_transactions set counterparty_doc_hash = '12345678909' where pluggy_transaction_id = 'tx-k-2';
    raise exception 'FAIL: stored a raw CPF as the hash';
  exception when check_violation then null;
  end;
  begin
    update public.fin_transactions set counterparty_cnpj = '12345678909' where pluggy_transaction_id = 'tx-k-2';
    raise exception 'FAIL: stored a CPF in counterparty_cnpj';
  exception when check_violation then null;
  end;

  -- Uma sincronização por banco de cada vez (fin_claim_sync, pela função finance).
  assert public.fin_claim_sync('00000000-0000-0000-0000-0000000000c1', k, hk, '2026-10-07 12:00:00+00'), 'the first sync takes its turn';
  assert not public.fin_claim_sync('00000000-0000-0000-0000-0000000000c1', k, hk, '2026-10-07 12:09:59+00'), 'a second one while it runs skips the bank';
  assert public.fin_claim_sync('00000000-0000-0000-0000-0000000000c2', k, hk, '2026-10-07 12:00:30+00'), 'another bank has its own turn';
  assert not public.fin_claim_sync('00000000-0000-0000-0000-0000000000c1', l, hk, '2026-10-07 13:00:00+00'), 'only for the owner';
  assert not public.fin_claim_sync('00000000-0000-0000-0000-0000000000c1', k, hk2, '2026-10-07 13:00:00+00'), 'only in the connection''s household';
  assert public.fin_claim_sync('00000000-0000-0000-0000-0000000000c1', k, hk, '2026-10-07 12:10:01+00'), 'a turn stuck for more than 10 min is taken over';
  assert (select sync_started_at from public.fin_connections where id = '00000000-0000-0000-0000-0000000000c1') = '2026-10-07 12:10:01+00',
    'the turn is now the newer sync''s';
  -- Devolver a vez (releaseSync, na função) só vale para a sincronização que está com ela.
  update public.fin_connections set sync_started_at = null where id = '00000000-0000-0000-0000-0000000000c1' and sync_started_at = '2026-10-07 12:00:00+00';
  assert not found, 'the stuck sync cannot release the newer one''s turn';
  update public.fin_connections set sync_started_at = null where id = '00000000-0000-0000-0000-0000000000c1' and sync_started_at = '2026-10-07 12:10:01+00';
  assert found, 'the newer sync releases its turn';
  assert public.fin_claim_sync('00000000-0000-0000-0000-0000000000c1', k, hk, '2026-10-07 12:10:02+00'), 'free again after the release';
  update public.fin_connections set sync_started_at = null where id in ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2');
end $$;

-- Anônimo: nada.
set role anon;
do $$
begin
  begin
    perform public.has_beta('finance');
    raise exception 'FAIL: anon called has_beta';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.fin_transactions;
    raise exception 'FAIL: anon read bank transactions';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.fin_remove_connection('00000000-0000-0000-0000-0000000000c1');
    raise exception 'FAIL: anon removed a connection';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.fin_claim_sync('00000000-0000-0000-0000-0000000000c1', gen_random_uuid(), gen_random_uuid(), now());
    raise exception 'FAIL: anon claimed a sync';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Kátia, na casa com a liberação: vê só os próprios dados e não grava nada.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_k', false) \gset
do $$
declare
  r record;
begin
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_k'))::text, true);
  assert public.has_beta('finance'), 'K has the beta in this household';
  assert not public.has_beta('outra'), 'only the granted feature';
  assert (select count(*) from public.beta_access) = 1, 'K sees her grant';
  assert (select array_agg(label order by label) from public.fin_connections) = array['Inter', 'Nubank'], 'K sees her banks only';
  assert (select count(*) from public.fin_accounts) = 2, 'K sees her accounts only';
  assert (select array_agg(pluggy_transaction_id order by pluggy_transaction_id) from public.fin_transactions)
    = array['tx-k-1', 'tx-k-2', 'tx-k-3'], 'K sees her transactions only';
  begin
    insert into public.fin_connections (user_id, household_id, label, pluggy_item_id)
    values (auth.uid(), public.current_household_id(), 'Itaú', 'item-k-app');
    raise exception 'FAIL: the app inserted a connection';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.fin_transactions set amount = 0;
    raise exception 'FAIL: the app changed a transaction';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.fin_accounts;
    raise exception 'FAIL: the app deleted an account';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.beta_access (user_id, household_id, feature)
    values (auth.uid(), current_setting('test.hh_k2')::uuid, 'finance');
    raise exception 'FAIL: granted herself the beta';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.fin_remove_connection('00000000-0000-0000-0000-0000000000c3');
    raise exception 'FAIL: removed the connection of another member';
  exception when no_data_found then null;
  end;
  begin
    perform public.fin_remove_connection('00000000-0000-0000-0000-0000000000c4');
    raise exception 'FAIL: removed a connection of another household';
  exception when no_data_found then null;
  end;
  begin
    perform public.fin_claim_sync('00000000-0000-0000-0000-0000000000c1', auth.uid(), public.current_household_id(), now());
    raise exception 'FAIL: the app claimed a sync';
  exception when insufficient_privilege then null;
  end;

  select * into r from public.use_ai('finance');
  assert r.allowed and r.used = 1 and r.lim = 100, 'the finance chat counts on its own quota';
  assert public.ai_limit('finance') = 100, 'finance limit';
  assert (select used from public.ai_usage_summary() where kind = 'finance') = 1, 'K sees the finance usage';
  assert (select count(*) from public.ai_usage_summary()) = 5, 'K sees the five kinds';
  assert (select used from public.ai_usage_summary() where kind = 'chat') = 0, 'the household chat quota is untouched';

  -- A outra casa dela, sem liberação: nada do banco nem do consultor.
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_k2'))::text, true);
  assert not public.has_beta('finance'), 'no beta in the other household';
  assert (select count(*) from public.fin_connections) = 0, 'no banks in the other household';
  assert (select count(*) from public.fin_accounts) = 0, 'no accounts in the other household';
  assert (select count(*) from public.fin_transactions) = 0, 'no transactions in the other household';
  begin
    perform public.fin_remove_connection('00000000-0000-0000-0000-0000000000c2');
    raise exception 'FAIL: removed a connection from a household without the beta';
  exception when no_data_found then null;
  end;
  begin
    perform public.use_ai('finance');
    raise exception 'FAIL: used the finance chat without the beta';
  exception when insufficient_privilege then null;
  end;
  assert not exists (select 1 from public.ai_usage_summary() where kind = 'finance'), 'no finance row without the beta';
end $$;

-- Tirar a liberação do Léo (editor SQL) apaga na hora os bancos dele naquela
-- casa, com contas e lançamentos; os da Kátia, na mesma casa, ficam. Uma
-- sincronização dele que ainda rodava não grava mais nada.
set role service_role;
do $$
declare
  hk uuid := current_setting('test.hh_k')::uuid;
  l uuid := '00000000-0000-0000-0000-000000000018';
begin
  delete from public.beta_access where user_id = l and household_id = hk and feature = 'finance';
  assert not exists (select 1 from public.fin_connections where pluggy_item_id = 'item-l'), 'revoking removed L''s bank';
  assert not exists (select 1 from public.fin_accounts where pluggy_account_id = 'acc-l'), 'and its account';
  assert not exists (select 1 from public.fin_transactions where pluggy_transaction_id = 'tx-l-1'), 'and its transactions';
  assert (select array_agg(pluggy_item_id order by pluggy_item_id) from public.fin_connections where household_id = hk)
    = array['item-k-inter', 'item-k-nubank'], 'K keeps her banks in the same household';
  assert (select count(*) from public.fin_transactions where household_id = hk) = 3, 'and her transactions';
  begin
    insert into public.fin_connections (user_id, household_id, label, pluggy_item_id) values (l, hk, 'Banco do Léo', 'item-l');
    raise exception 'FAIL: connection saved after the grant was revoked';
  exception when foreign_key_violation then null;
  end;
end $$;
set role authenticated;

-- Léo mora na mesma casa, agora sem liberação: não vê nada.
select set_config('request.jwt.claim.sub', :'user_l', false) \gset
do $$
begin
  assert public.current_household_id() = current_setting('test.hh_k')::uuid, 'L lives with K';
  assert not public.has_beta('finance'), 'L has no beta';
  assert (select count(*) from public.beta_access) = 0, 'L does not see K''s grant';
  assert (select count(*) from public.fin_connections) = 0, 'L sees no bank';
  assert (select count(*) from public.fin_accounts) = 0, 'L sees no account';
  assert (select count(*) from public.fin_transactions) = 0, 'L sees no transaction';
  begin
    perform public.fin_remove_connection('00000000-0000-0000-0000-0000000000c3');
    raise exception 'FAIL: removed a connection without the beta';
  exception when no_data_found then null;
  end;
  begin
    perform public.fin_remove_connection('00000000-0000-0000-0000-0000000000c1');
    raise exception 'FAIL: removed K''s connection';
  exception when no_data_found then null;
  end;
  begin
    perform public.use_ai('finance');
    raise exception 'FAIL: L used the finance chat';
  exception when insufficient_privilege then null;
  end;
  assert (select array_agg(kind order by kind) from public.ai_usage_summary()) = array['chat', 'menu', 'nfce', 'photo'],
    'L sees only the household kinds';
  assert not exists (select 1 from public.ai_usage where kind = 'finance'), 'L does not see K''s finance usage';
  assert (select u.allowed from public.use_ai('chat') u), 'the household chat still works for L';
end $$;

-- Mara, outra casa com liberação: só o banco dela, cota própria.
select set_config('request.jwt.claim.sub', :'user_m', false) \gset
do $$
begin
  assert public.has_beta('finance'), 'M has the beta in her household';
  assert (select array_agg(label) from public.fin_connections) = array['Santander'], 'M sees only her bank';
  assert (select array_agg(pluggy_transaction_id) from public.fin_transactions) = array['tx-m-1'], 'M sees only her transactions';
  begin
    perform public.fin_remove_connection('00000000-0000-0000-0000-0000000000c1');
    raise exception 'FAIL: M removed K''s connection';
  exception when no_data_found then null;
  end;
  assert (select used from public.ai_usage_summary() where kind = 'finance') = 0, 'M has her own finance quota';
end $$;

-- Kátia desconecta o Inter: contas e lançamentos vão junto.
select set_config('request.jwt.claim.sub', :'user_k', false) \gset
do $$
begin
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_k'))::text, true);
  perform public.fin_remove_connection('00000000-0000-0000-0000-0000000000c2');
  assert (select array_agg(label) from public.fin_connections) = array['Nubank'], 'Inter removed';
  assert (select array_agg(pluggy_account_id) from public.fin_accounts) = array['acc-k-nubank'], 'its account went along';
  assert (select count(*) from public.fin_transactions) = 2, 'and its transactions';
  begin
    perform public.fin_remove_connection('00000000-0000-0000-0000-0000000000c2');
    raise exception 'FAIL: removed the same connection twice';
  exception when no_data_found then null;
  end;
end $$;

-- Kátia escolhe categorias para os lançamentos: só dela, só na casa com a liberação.
do $$
declare
  hk uuid := current_setting('test.hh_k')::uuid;
  hk2 uuid := current_setting('test.hh_k2')::uuid;
  bad_key text;
begin
  perform set_config('request.headers', json_build_object('x-household-id', hk)::text, true);
  insert into public.fin_category_rules (match_key, category) values
    ('m:padaria real', 'mercado'),
    ('doc:' || repeat('c', 64), 'moradia'),
    ('p:tx-00000000-0000-0000-0000-0000000000f1', 'lazer');
  assert (select count(*) from public.fin_category_rules where user_id = auth.uid() and household_id = hk) = 3,
    'K saved her rules (user and household by default)';
  insert into public.fin_category_rules (match_key, category) values ('m:padaria real', 'lazer')
    on conflict (user_id, household_id, match_key) do update set category = excluded.category;
  assert (select category from public.fin_category_rules where match_key = 'm:padaria real') = 'lazer', 'K changed a rule';
  delete from public.fin_category_rules where match_key = 'p:tx-00000000-0000-0000-0000-0000000000f1';
  assert (select count(*) from public.fin_category_rules) = 2, 'K removed a rule';
  foreach bad_key in array array['x:qualquer', 'm:', 'm:Padaria', 'm:loja 123', 'doc:abc', 'p:tx-1', 'm:' || repeat('a', 81)] loop
    begin
      insert into public.fin_category_rules (match_key, category) values (bad_key, 'mercado');
      raise exception 'FAIL: saved the rule key %', bad_key;
    exception when check_violation then null;
    end;
  end loop;
  begin
    insert into public.fin_category_rules (match_key, category) values ('m:outra loja', 'roupa');
    raise exception 'FAIL: saved an unknown category';
  exception when check_violation then null;
  end;
  begin
    insert into public.fin_category_rules (user_id, match_key, category)
    values ('00000000-0000-0000-0000-000000000018', 'm:outra loja', 'mercado');
    raise exception 'FAIL: saved a rule for another member';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.fin_category_rules (household_id, match_key, category) values (hk2, 'm:outra loja', 'mercado');
    raise exception 'FAIL: saved a rule for another household';
  exception when insufficient_privilege then null;
  end;
  -- Na outra casa dela, sem liberação: nem vê nem grava.
  perform set_config('request.headers', json_build_object('x-household-id', hk2)::text, true);
  assert (select count(*) from public.fin_category_rules) = 0, 'no rules in the household without the beta';
  begin
    insert into public.fin_category_rules (match_key, category) values ('m:outra loja', 'mercado');
    raise exception 'FAIL: saved a rule without the beta';
  exception when insufficient_privilege or foreign_key_violation then null;
  end;
end $$;

-- Saúde escolhida deixa uma marca que nem trocar de categoria nem desfazer
-- apagam; a pessoa só lê as marcas.
do $$
declare
  hk uuid := current_setting('test.hh_k')::uuid;
begin
  perform set_config('request.headers', json_build_object('x-household-id', hk)::text, true);
  insert into public.fin_category_rules (match_key, category) values ('m:clinica sorriso', 'saude');
  insert into public.fin_category_rules (match_key, category) values ('p:tx-00000000-0000-0000-0000-0000000000f2', 'lazer');
  assert (select count(*) from public.fin_sensitive_keys) = 1, 'only the Saúde choice left a mark';
  update public.fin_category_rules set category = 'saude' where match_key = 'p:tx-00000000-0000-0000-0000-0000000000f2';
  assert (select array_agg(match_key order by match_key) from public.fin_sensitive_keys)
    = array['m:clinica sorriso', 'p:tx-00000000-0000-0000-0000-0000000000f2'], 'changing a rule to Saúde left a mark too';
  assert (select array_agg(distinct user_id) from public.fin_sensitive_keys) = array[auth.uid()]
    and (select array_agg(distinct household_id) from public.fin_sensitive_keys) = array[hk], 'the marks are hers, in this household';
  update public.fin_category_rules set category = 'lazer' where match_key = 'm:clinica sorriso';
  delete from public.fin_category_rules where match_key = 'p:tx-00000000-0000-0000-0000-0000000000f2';
  assert (select count(*) from public.fin_sensitive_keys) = 2, 'changing or undoing keeps the marks';
  insert into public.fin_category_rules (match_key, category) values ('m:clinica sorriso', 'saude')
    on conflict (user_id, household_id, match_key) do update set category = excluded.category;
  assert (select count(*) from public.fin_sensitive_keys) = 2, 'Saúde again keeps a single mark';
  delete from public.fin_category_rules where match_key = 'm:clinica sorriso';
  assert (select count(*) from public.fin_sensitive_keys) = 2, 'and so does undoing it';
  begin
    insert into public.fin_sensitive_keys (user_id, household_id, match_key) values (auth.uid(), hk, 'm:outra loja');
    raise exception 'FAIL: K wrote a mark';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.fin_sensitive_keys set match_key = 'm:outra loja';
    raise exception 'FAIL: K changed a mark';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.fin_sensitive_keys;
    raise exception 'FAIL: K removed her marks';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_k2'))::text, true);
  assert (select count(*) from public.fin_sensitive_keys) = 0, 'no marks in the household without the beta';
end $$;

-- Limite das marcas: um app em loop não enche a tabela. Cheia, a Saúde numa
-- chave nova é recusada (em vez de ficar sem a marca); onde já há marca, passa.
reset role;
insert into public.fin_sensitive_keys (user_id, household_id, match_key)
select :'user_k'::uuid, current_setting('test.hh_k')::uuid, 'm:enchimento ' || n from generate_series(1, 1998) n;
set role authenticated;
do $$
begin
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_k'))::text, true);
  assert (select count(*) from public.fin_sensitive_keys) = 2000, 'K is at the mark limit';
  begin
    insert into public.fin_category_rules (match_key, category) values ('m:clinica nova', 'saude');
    raise exception 'FAIL: saved Saúde without room for its mark';
  exception when program_limit_exceeded then null;
  end;
  assert not exists (select 1 from public.fin_category_rules where match_key = 'm:clinica nova'), 'the refused rule was not saved';
  insert into public.fin_category_rules (match_key, category) values ('m:clinica sorriso', 'saude');
  insert into public.fin_category_rules (match_key, category) values ('m:clinica nova', 'lazer');
  delete from public.fin_category_rules where match_key in ('m:clinica sorriso', 'm:clinica nova');
end $$;
reset role;
delete from public.fin_sensitive_keys where match_key like 'm:enchimento %';
set role authenticated;

-- "Só esta" em Saúde marca também as parecidas da compra: o sigilo segue a
-- loja quando o lançamento ganha outro id (previsto que vira lançado, banco reconectado).
do $$
declare
  bad_key text;
begin
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_k'))::text, true);
  insert into public.fin_category_rules (match_key, category, similar_key)
  values ('p:tx-00000000-0000-0000-0000-0000000000f3', 'saude', 'm:espaco viver bem');
  assert (select count(*) from public.fin_sensitive_keys
          where match_key in ('p:tx-00000000-0000-0000-0000-0000000000f3', 'm:espaco viver bem')) = 2,
    'Só esta in Saúde marked the purchase and its similar ones';
  insert into public.fin_category_rules (match_key, category, similar_key)
  values ('p:tx-00000000-0000-0000-0000-0000000000f4', 'lazer', 'm:outra loja');
  assert not exists (select 1 from public.fin_sensitive_keys
                     where match_key in ('p:tx-00000000-0000-0000-0000-0000000000f4', 'm:outra loja')),
    'other categories mark nothing';
  update public.fin_category_rules set category = 'saude' where match_key = 'p:tx-00000000-0000-0000-0000-0000000000f4';
  assert exists (select 1 from public.fin_sensitive_keys where match_key = 'm:outra loja'), 'changing to Saúde marks the similar ones too';
  -- Escolha antiga, sem similar_key: gravar a chave depois também marca (é assim que o app repara).
  insert into public.fin_category_rules (match_key, category) values ('p:tx-00000000-0000-0000-0000-0000000000f6', 'saude');
  update public.fin_category_rules set similar_key = 'm:clinica nova'
  where match_key = 'p:tx-00000000-0000-0000-0000-0000000000f6' and category = 'saude';
  assert exists (select 1 from public.fin_sensitive_keys where match_key = 'm:clinica nova'), 'saving the similar key later marks it';
  -- Escolha antiga trocada para outra categoria antes do reparo: a troca traz a chave das parecidas, e ela marca.
  insert into public.fin_category_rules (match_key, category) values ('p:tx-00000000-0000-0000-0000-0000000000f7', 'saude');
  insert into public.fin_category_rules (match_key, category, similar_key)
  values ('p:tx-00000000-0000-0000-0000-0000000000f7', 'lazer', 'm:clinica antiga')
  on conflict (user_id, household_id, match_key) do update set category = excluded.category, similar_key = excluded.similar_key;
  assert exists (select 1 from public.fin_sensitive_keys where match_key = 'm:clinica antiga'), 'leaving Saúde still marks the similar ones';
  -- Trocar entre outras categorias continua sem marcar.
  insert into public.fin_category_rules (match_key, category, similar_key)
  values ('p:tx-00000000-0000-0000-0000-0000000000f8', 'lazer', 'm:loja comum');
  update public.fin_category_rules set category = 'mercado' where match_key = 'p:tx-00000000-0000-0000-0000-0000000000f8';
  assert not exists (select 1 from public.fin_sensitive_keys where match_key in ('p:tx-00000000-0000-0000-0000-0000000000f8', 'm:loja comum')),
    'moving between other categories marks nothing';
  foreach bad_key in array array['p:tx-00000000-0000-0000-0000-0000000000f5', 'x:qualquer', 'm:Loja', 'doc:abc'] loop
    begin
      insert into public.fin_category_rules (match_key, category, similar_key) values ('m:loja teste', 'mercado', bad_key);
      raise exception 'FAIL: saved the similar key %', bad_key;
    exception when check_violation then null;
    end;
  end loop;
  delete from public.fin_category_rules where match_key like 'p:tx-%';
  assert (select count(*) from public.fin_sensitive_keys) = 10, 'undoing keeps all the marks';
end $$;

-- Léo, na mesma casa e sem liberação, não vê nem mexe nas escolhas da Kátia.
select set_config('request.jwt.claim.sub', :'user_l', false) \gset
do $$
begin
  assert (select count(*) from public.fin_category_rules) = 0, 'L sees none of K''s rules';
  update public.fin_category_rules set category = 'outros';
  delete from public.fin_category_rules;
  begin
    insert into public.fin_category_rules (match_key, category) values ('m:outra loja', 'mercado');
    raise exception 'FAIL: L saved a rule without the beta';
  exception when insufficient_privilege or foreign_key_violation then null;
  end;
  assert (select count(*) from public.fin_sensitive_keys) = 0, 'L sees none of K''s marks';
  begin
    delete from public.fin_sensitive_keys;
    raise exception 'FAIL: L removed K''s marks';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.fin_category_rules where user_id = '00000000-0000-0000-0000-000000000017') = 2,
    'K''s rules untouched by L';
  assert (select category from public.fin_category_rules where match_key = 'm:padaria real') = 'lazer', 'still hers';
  assert (select count(*) from public.fin_sensitive_keys where user_id = '00000000-0000-0000-0000-000000000017') = 10,
    'and her marks';
end $$;
set role authenticated;

-- Léo ganha a liberação de novo e conecta outro banco (chave de serviço).
set role service_role;
do $$
declare
  hk uuid := current_setting('test.hh_k')::uuid;
  l uuid := '00000000-0000-0000-0000-000000000018';
begin
  insert into public.beta_access (user_id, household_id, feature) values (l, hk, 'finance');
  insert into public.fin_connections (id, user_id, household_id, label, pluggy_item_id, status)
  values ('00000000-0000-0000-0000-0000000000c5', l, hk, 'Banco do Léo', 'item-l2', 'UPDATED');
  insert into public.fin_accounts (id, connection_id, user_id, household_id, pluggy_account_id, type)
  values ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000c5', l, hk, 'acc-l2', 'BANK');
  insert into public.fin_transactions
    (account_id, user_id, household_id, pluggy_transaction_id, status, direction, amount, occurred_on, description)
  values ('00000000-0000-0000-0000-0000000000a5', l, hk, 'tx-l-2', 'POSTED', 'DEBIT', 20, '2026-10-04', 'Padaria');
end $$;
set role authenticated;

-- Sair da casa leva junto a liberação e os dados do banco daquela casa; a casa
-- continua, com os da Kátia.
select set_config('request.jwt.claim.sub', :'user_l', false) \gset
do $$
begin
  assert public.has_beta('finance'), 'L has the beta again';
  assert (select array_agg(pluggy_item_id) from public.fin_connections) = array['item-l2'], 'L sees his new bank';
  assert (public.leave_household(current_setting('test.hh_k')::uuid))->>'status' = 'left', 'L left';
end $$;
reset role;
do $$
declare
  l uuid := '00000000-0000-0000-0000-000000000018';
begin
  assert not exists (select 1 from public.beta_access where user_id = l), 'leaving took L''s grant';
  assert not exists (select 1 from public.fin_connections where pluggy_item_id = 'item-l2'), 'and his bank';
  assert not exists (select 1 from public.fin_accounts where pluggy_account_id = 'acc-l2'), 'and its account';
  assert not exists (select 1 from public.fin_transactions where pluggy_transaction_id = 'tx-l-2'), 'and its transactions';
  assert exists (select 1 from public.fin_connections where pluggy_item_id = 'item-k-nubank'), 'K keeps her bank';
  assert exists (select 1 from public.fin_accounts where pluggy_account_id = 'acc-k-nubank'), 'and her account';
  assert (select count(*) from public.fin_transactions where pluggy_transaction_id like 'tx-k-%') = 2, 'and her transactions';
  assert exists (select 1 from public.beta_access where user_id = '00000000-0000-0000-0000-000000000017'), 'and her grant';
  assert (select count(*) from public.fin_category_rules where user_id = '00000000-0000-0000-0000-000000000017') = 2,
    'and her category rules';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_k', false) \gset
do $$
begin
  assert (public.leave_household(current_setting('test.hh_k')::uuid, true))->>'status' = 'deleted', 'K closed her household';
end $$;
reset role;
do $$
begin
  assert not exists (select 1 from public.fin_category_rules), 'category rules left with the grant';
  assert not exists (select 1 from public.fin_sensitive_keys), 'and so did the Saúde marks';
  assert not exists (select 1 from public.fin_connections where pluggy_item_id = 'item-k-nubank'), 'connections left with the household';
  assert not exists (select 1 from public.fin_accounts where pluggy_account_id in ('acc-k-nubank', 'acc-k-inter')), 'accounts too';
  assert not exists (select 1 from public.fin_transactions where pluggy_transaction_id like 'tx-k-%'), 'transactions too';
  assert (select array_agg(user_id) from public.beta_access) = array['00000000-0000-0000-0000-000000000019'::uuid], 'only M keeps a grant';
  assert exists (select 1 from public.fin_transactions where pluggy_transaction_id = 'tx-m-1'), 'M keeps her data';
end $$;

-- Tirar a liberação (editor SQL) apaga os bancos dela naquela casa, com contas e lançamentos.
set role service_role;
do $$
begin
  assert exists (select 1 from public.fin_connections where pluggy_item_id = 'item-m'), 'M still has her bank';
  delete from public.beta_access where user_id = '00000000-0000-0000-0000-000000000019' and feature = 'finance';
  assert not exists (select 1 from public.fin_connections where pluggy_item_id = 'item-m'), 'revoking removed M''s bank';
  assert not exists (select 1 from public.fin_accounts where pluggy_account_id = 'acc-m'), 'and its account';
  assert not exists (select 1 from public.fin_transactions where pluggy_transaction_id = 'tx-m-1'), 'and its transactions';
  begin
    insert into public.fin_connections (user_id, household_id, label, pluggy_item_id)
    values ('00000000-0000-0000-0000-000000000019', current_setting('test.hh_m')::uuid, 'Santander', 'item-m');
    raise exception 'FAIL: M''s connection saved after the grant was revoked';
  exception when foreign_key_violation then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
\echo '• compromissos da família: repetição, quem leva e busca, mudanças de um dia e isolamento'
-- Nara mora na Casa da Nara, com a filha Ana, o Beto, a vó e o Rex; Otto mora
-- em outra casa.
\set user_n '00000000-0000-0000-0000-00000000001b'
\set user_o '00000000-0000-0000-0000-00000000001c'
reset role;
insert into auth.users (id) values (:'user_n'), (:'user_o');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_o', false) \gset
select (public.create_household('Casa do Otto', 'Otto')).id as hh_o \gset
select set_config('request.jwt.claim.sub', :'user_n', false) \gset
select (public.create_household('Casa da Nara', 'Nara')).id as hh_n \gset
select set_config('test.hh_o', :'hh_o', false) \gset
select set_config('test.hh_n', :'hh_n', false) \gset

do $$
declare
  nara uuid;
  ana uuid;
  beto uuid;
  vo uuid;
  rex uuid;
  swim uuid;
  bath uuid;
  e public.family_events;
begin
  select id into nara from public.people where member_user_id = auth.uid();
  insert into public.people (name) values ('Ana') returning id into ana;
  insert into public.people (name) values ('Beto') returning id into beto;
  insert into public.people (name) values ('Vó Maria') returning id into vo;
  insert into public.people (name, kind) values ('Rex', 'pet') returning id into rex;

  -- Natação da Ana: terça e quinta, o Beto leva e a Nara busca.
  insert into public.family_events (title, starts_on, start_time, end_time, person_id, take_by, pick_up_by, location, bring, recurrence, weekdays)
  values ('Natação da Ana', '2026-10-13', '16:00', '17:00', ana, beto, nara, 'Clube', 'touca e toalha', 'weekly', '{2,4}')
  returning * into e;
  swim := e.id;
  assert e.household_id = current_setting('test.hh_n')::uuid, 'the event belongs to the open household';
  assert e.created_by = auth.uid(), 'created_by defaults to the user';
  -- O compromisso pode ser de um pet; sem hora, é o dia todo.
  insert into public.family_events (title, starts_on, person_id) values ('Banho do Rex', '2026-10-17', rex) returning id into bath;
  assert (select recurrence = 'none' and start_time is null and weekdays is null from public.family_events where id = bath), 'defaults: once, all day';
  insert into public.family_events (title, starts_on, recurrence, until_on) values ('Aluguel da quadra', '2026-10-31', 'monthly', '2026-12-31');
  insert into public.family_events (title, starts_on, recurrence) values ('Aniversário da tia Lu', '2024-02-29', 'yearly');

  -- Toda semana precisa dos dias: de 0 a 6, sem repetir; fora dela, não há dias.
  begin
    insert into public.family_events (title, starts_on, recurrence) values ('Sem dias', '2026-10-13', 'weekly');
    raise exception 'FAIL: weekly event without weekdays';
  exception when check_violation then null;
  end;
  begin
    insert into public.family_events (title, starts_on, recurrence, weekdays) values ('Sem dias', '2026-10-13', 'weekly', '{}');
    raise exception 'FAIL: weekly event with no weekday';
  exception when check_violation then null;
  end;
  begin
    insert into public.family_events (title, starts_on, recurrence, weekdays) values ('Dia 7', '2026-10-13', 'weekly', '{2,7}');
    raise exception 'FAIL: weekday out of range';
  exception when check_violation then null;
  end;
  begin
    insert into public.family_events (title, starts_on, recurrence, weekdays) values ('Repetido', '2026-10-13', 'weekly', '{2,2}');
    raise exception 'FAIL: repeated weekday';
  exception when check_violation then null;
  end;
  begin
    insert into public.family_events (title, starts_on, recurrence, weekdays) values ('Matriz', '2026-10-13', 'weekly', '{{1,2},{3,4}}');
    raise exception 'FAIL: weekdays as a two-dimensional array';
  exception when check_violation then null;
  end;
  begin
    insert into public.family_events (title, starts_on, recurrence, weekdays) values ('Mensal com dias', '2026-10-13', 'monthly', '{2}');
    raise exception 'FAIL: weekdays outside a weekly event';
  exception when check_violation then null;
  end;
  begin
    insert into public.family_events (title, starts_on, recurrence) values ('Todo dia', '2026-10-13', 'daily');
    raise exception 'FAIL: unknown recurrence';
  exception when check_violation then null;
  end;

  -- Pet não leva nem busca.
  begin
    insert into public.family_events (title, starts_on, take_by) values ('Passeio', '2026-10-13', rex);
    raise exception 'FAIL: a pet takes someone';
  exception when check_violation then null;
  end;
  begin
    update public.family_events set pick_up_by = rex where id = swim;
    raise exception 'FAIL: a pet picks someone up';
  exception when check_violation then null;
  end;

  -- Horários e datas.
  begin
    update public.family_events set end_time = '15:00' where id = swim;
    raise exception 'FAIL: ends before it starts';
  exception when check_violation then null;
  end;
  begin
    update public.family_events set end_time = '16:00' where id = swim;
    raise exception 'FAIL: ends when it starts';
  exception when check_violation then null;
  end;
  begin
    insert into public.family_events (title, starts_on, end_time) values ('Só o fim', '2026-10-13', '17:00');
    raise exception 'FAIL: end time without a start time';
  exception when check_violation then null;
  end;
  begin
    update public.family_events set until_on = '2026-10-12' where id = swim;
    raise exception 'FAIL: until before the start';
  exception when check_violation then null;
  end;
  update public.family_events set until_on = '2026-10-13' where id = swim;
  update public.family_events set until_on = null where id = swim;
  begin
    update public.family_events set until_on = '2026-12-31' where id = bath;
    raise exception 'FAIL: until on an event that does not repeat';
  exception when check_violation then null;
  end;

  -- Textos.
  begin
    insert into public.family_events (title, starts_on) values ('   ', '2026-10-13');
    raise exception 'FAIL: blank title';
  exception when check_violation then null;
  end;
  begin
    insert into public.family_events (title, starts_on) values (repeat('x', 121), '2026-10-13');
    raise exception 'FAIL: title too long';
  exception when check_violation then null;
  end;
  begin
    update public.family_events set bring = repeat('x', 301) where id = swim;
    raise exception 'FAIL: bring too long';
  exception when check_violation then null;
  end;
  begin
    update public.family_events set location = repeat('x', 201) where id = swim;
    raise exception 'FAIL: location too long';
  exception when check_violation then null;
  end;

  -- Só neste dia: não vai ter; a vó leva; ninguém busca.
  insert into public.family_event_days (event_id, occurs_on, cancelled) values (swim, '2026-10-15', true);
  insert into public.family_event_days (event_id, occurs_on, override_take, take_by) values (swim, '2026-10-20', true, vo);
  insert into public.family_event_days (event_id, occurs_on, override_pick_up) values (swim, '2026-10-22', true);
  assert (select household_id from public.family_event_days where occurs_on = '2026-10-15') = current_setting('test.hh_n')::uuid,
    'the day belongs to the open household';
  begin
    insert into public.family_event_days (event_id, occurs_on) values (swim, '2026-10-27');
    raise exception 'FAIL: kept a day with nothing changed';
  exception when check_violation then null;
  end;
  begin
    insert into public.family_event_days (event_id, occurs_on, cancelled, take_by) values (swim, '2026-10-27', true, vo);
    raise exception 'FAIL: who takes without marking the change';
  exception when check_violation then null;
  end;
  begin
    insert into public.family_event_days (event_id, occurs_on, override_pick_up, pick_up_by) values (swim, '2026-10-27', true, rex);
    raise exception 'FAIL: a pet picks someone up on one day';
  exception when check_violation then null;
  end;
  begin
    insert into public.family_event_days (event_id, occurs_on, cancelled) values (swim, '2026-10-15', true);
    raise exception 'FAIL: two rows for the same day';
  exception when unique_violation then null;
  end;
  -- Desfazer e mudar de novo: a linha do dia é uma só.
  update public.family_event_days set cancelled = false, override_take = true, take_by = vo where event_id = swim and occurs_on = '2026-10-15';
  update public.family_event_days set cancelled = true, override_take = false, take_by = null where event_id = swim and occurs_on = '2026-10-15';

  perform set_config('test.ev_swim', swim::text, false);
  perform set_config('test.ev_bath', bath::text, false);
  perform set_config('test.p_ana', ana::text, false);
  perform set_config('test.p_beto', beto::text, false);
  perform set_config('test.p_vo', vo::text, false);
end $$;

-- Otto, de outra casa: não vê nem mexe em nada disso.
select set_config('request.jwt.claim.sub', :'user_o', false) \gset
do $$
declare
  swim uuid := current_setting('test.ev_swim')::uuid;
  hh_n uuid := current_setting('test.hh_n')::uuid;
  own uuid;
begin
  assert (select count(*) from public.family_events) = 0, 'O sees no foreign events';
  assert (select count(*) from public.family_event_days) = 0, 'O sees no foreign day changes';
  update public.family_events set title = 'Invadido';
  delete from public.family_events;
  update public.family_event_days set cancelled = true;
  delete from public.family_event_days;
  begin
    insert into public.family_events (household_id, title, starts_on) values (hh_n, 'Invasão', '2026-10-13');
    raise exception 'FAIL: O created an event in a foreign household';
  exception when insufficient_privilege then null;
  end;
  -- Dia de um compromisso de outra casa: pela casa do Otto, o compromisso não
  -- existe; dizendo que é da outra casa, a regra de acesso barra.
  begin
    insert into public.family_event_days (event_id, occurs_on, cancelled) values (swim, '2026-10-13', true);
    raise exception 'FAIL: O changed a day of a foreign event';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.family_event_days (event_id, occurs_on, household_id, cancelled) values (swim, '2026-10-13', hh_n, true);
    raise exception 'FAIL: O changed a day of a foreign event, naming its household';
  exception when insufficient_privilege then null;
  end;
  -- Ficha de outra casa não entra como "de quem é" nem como quem leva.
  begin
    insert into public.family_events (title, starts_on, person_id) values ('Da Ana', '2026-10-13', current_setting('test.p_ana')::uuid);
    raise exception 'FAIL: event for a foreign person';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.family_events (title, starts_on, take_by) values ('Carona', '2026-10-13', current_setting('test.p_beto')::uuid);
    raise exception 'FAIL: a foreign person takes someone';
  exception when foreign_key_violation then null;
  end;
  -- Na própria casa, funciona.
  insert into public.family_events (title, starts_on) values ('Feira', '2026-10-13') returning id into own;
  assert (select count(*) from public.family_events) = 1, 'O sees only the own event';
  -- Mudar o compromisso de casa também não passa.
  begin
    update public.family_events set household_id = hh_n where id = own;
    raise exception 'FAIL: moved an event to a foreign household';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Nara de novo: nada mudou; fichas apagadas e compromissos apagados.
select set_config('request.jwt.claim.sub', :'user_n', false) \gset
do $$
declare
  swim uuid := current_setting('test.ev_swim')::uuid;
  bath uuid := current_setting('test.ev_bath')::uuid;
  ana uuid := current_setting('test.p_ana')::uuid;
  beto uuid := current_setting('test.p_beto')::uuid;
  vo uuid := current_setting('test.p_vo')::uuid;
  e public.family_events;
  d public.family_event_days;
begin
  assert (select count(*) from public.family_events) = 4, 'the events are untouched by O';
  assert (select title from public.family_events where id = swim) = 'Natação da Ana', 'the title too';
  assert (select count(*) from public.family_event_days where event_id = swim) = 3, 'and the day changes';
  assert (select cancelled from public.family_event_days where event_id = swim and occurs_on = '2026-10-15'), 'still cancelled';

  -- A ficha de quem leva some: o compromisso fica, sem quem leva.
  delete from public.people where id = beto;
  select * into e from public.family_events where id = swim;
  assert e.take_by is null and e.pick_up_by is not null and e.person_id = ana, 'deleting the person clears only who takes';
  -- A vó, que levava só no dia 20, vira pet por engano: naquele dia fica sem ninguém.
  update public.family_events set pick_up_by = vo where id = swim;
  update public.people set kind = 'pet' where id = vo;
  select * into e from public.family_events where id = swim;
  assert e.pick_up_by is null and e.person_id = ana, 'a profile that becomes a pet stops picking up';
  select * into d from public.family_event_days where event_id = swim and occurs_on = '2026-10-20';
  assert d.override_take and d.take_by is null, 'and stops taking on that day: nobody takes';
  -- De volta a pessoa, leva de novo naquele dia; apagada, o dia fica sem ninguém.
  update public.people set kind = 'pessoa' where id = vo;
  update public.family_event_days set take_by = vo where event_id = swim and occurs_on = '2026-10-20';
  delete from public.people where id = vo;
  select * into d from public.family_event_days where event_id = swim and occurs_on = '2026-10-20';
  assert d.override_take and d.take_by is null, 'deleting the person of a day change leaves nobody for that day';
  -- A ficha de quem é o compromisso some: ele fica, da família toda.
  delete from public.people where id = ana;
  assert (select person_id is null and title = 'Natação da Ana' from public.family_events where id = swim), 'the event survives its person';
  assert (select count(*) from public.family_event_days where event_id = swim) = 3, 'and so do its day changes';

  -- Apagar o compromisso leva os dias dele, e só eles.
  insert into public.family_event_days (event_id, occurs_on, cancelled) values (bath, '2026-10-17', true);
  delete from public.family_events where id = swim;
  assert (select count(*) from public.family_event_days where event_id = swim) = 0, 'deleting the event deletes its day changes';
  assert (select count(*) from public.family_event_days) = 1, 'the other event keeps its own';
  assert (select count(*) from public.family_events) = 3, 'the other events stay';
end $$;

-- A casa apagada leva compromissos e dias junto.
reset role;
do $$
begin
  delete from public.households where id = current_setting('test.hh_n')::uuid;
  assert (select count(*) from public.family_events where household_id = current_setting('test.hh_n')::uuid) = 0, 'household gone, events gone';
  assert (select count(*) from public.family_event_days) = 0, 'and day changes';
  assert (select count(*) from public.family_events) = 1, 'the other household keeps its event';
  -- As permissões das tabelas são explícitas: não dependem do padrão do projeto.
  assert not has_table_privilege('anon', 'public.family_events', 'select, insert, update, delete, truncate'), 'anon has no access to family_events';
  assert (select bool_and(has_table_privilege(who, 'public.family_events', verb))
            from unnest(array['authenticated', 'service_role']) as who, unnest(array['select', 'insert', 'update', 'delete']) as verb),
    'members and the service role reach family_events through the API';
  assert not has_table_privilege('authenticated', 'public.family_events', 'truncate, references, trigger'), 'and members get nothing beyond that on family_events';
  assert not has_table_privilege('anon', 'public.family_event_days', 'select, insert, update, delete, truncate'), 'anon has no access to family_event_days';
  assert (select bool_and(has_table_privilege(who, 'public.family_event_days', verb))
            from unnest(array['authenticated', 'service_role']) as who, unnest(array['select', 'insert', 'update', 'delete']) as verb),
    'members and the service role reach family_event_days through the API';
  assert not has_table_privilege('authenticated', 'public.family_event_days', 'truncate, references, trigger'), 'and members get nothing beyond that on family_event_days';
end $$;

-- ---------------------------------------------------------------------------
\echo '• rodízio de tarefas: a ordem, a vez ao concluir, pular a vez e quem sai da ordem'
-- Rita e Beto moram na Casa do Rodízio, com Lia, Nina, Téo e Bidu (crianças,
-- sem o app) e o pet Rex; Otto mora em outra casa, com o filho Tito.
\set user_r '00000000-0000-0000-0000-000000000021'
\set user_s '00000000-0000-0000-0000-000000000022'
\set user_o '00000000-0000-0000-0000-000000000023'
\set user_t '00000000-0000-0000-0000-000000000024'
insert into auth.users (id) values (:'user_r'), (:'user_s'), (:'user_o'), (:'user_t');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_o', false) \gset
select public.create_household('Casa do Otto', 'Otto') \gset
insert into public.people (name) values ('Tito');
select set_config('request.jwt.claim.sub', :'user_r', false) \gset
select (public.create_household('Casa do Rodízio', 'Rita')).invite_code as invite_r \gset
select set_config('request.jwt.claim.sub', :'user_s', false) \gset
select public.join_household(:'invite_r', 'Beto') \gset
select set_config('request.jwt.claim.sub', :'user_r', false) \gset
insert into public.people (name) values ('Lia'), ('Nina'), ('Teo'), ('Bidu');
insert into public.people (name, kind, species) values ('Rex', 'pet', 'cachorro');
reset role;
select id as hh_r from public.households where name = 'Casa do Rodízio' \gset
select set_config('test.hh_r', :'hh_r', false) \gset
-- As fichas, pelo nome: test.r_rita, test.r_beto, test.r_lia…
select count(set_config('test.r_' || lower(name), id::text, false)) as people_r
  from public.people where household_id = :'hh_r' or name = 'Tito' \gset
-- A ordem só se grava por save_chore, junto com a tarefa. Para os testes que só trocam a ordem: a tarefa como
-- está no banco e a ordem nova, como o formulário que mostrou o rodízio e não mexeu em mais nada.
create function pg_temp.save_order(p_chore_id uuid, p_people uuid[]) returns uuid language sql as $$
  select public.save_chore(c.id, c.title, c.notes, c.recurrence, c.interval_count, c.due_on, p_people => p_people)
  from public.chores c where c.id = p_chore_id;
$$;
-- O responsável salvo pela função sem falar da ordem (p_people nulo): a vez fica com quem foi escolhido, mesmo de
-- fora da ordem. Direto na tabela, numa tarefa em rodízio, o banco recusa (ver chores_turn_not_by_hand, abaixo).
create function pg_temp.save_turn(p_chore_id uuid, p_assigned_to uuid, p_kid_id uuid) returns uuid language sql as $$
  select public.save_chore(c.id, c.title, c.notes, c.recurrence, c.interval_count, c.due_on,
    p_set_turn => true, p_assigned_to => p_assigned_to, p_kid_id => p_kid_id)
  from public.chores c where c.id = p_chore_id;
$$;
set role authenticated;

-- A ordem: quem foi escolhido primeiro começa; pet, gente de outra casa, uma
-- pessoa só, pessoa repetida e tarefa que não se repete ficam de fora.
do $$
declare
  rita uuid := current_setting('test.r_rita')::uuid;
  beto uuid := current_setting('test.r_beto')::uuid;
  lia uuid := current_setting('test.r_lia')::uuid;
  nina uuid := current_setting('test.r_nina')::uuid;
  rex uuid := current_setting('test.r_rex')::uuid;
  tito uuid := current_setting('test.r_tito')::uuid;
  dishes uuid;
  once uuid;
  c public.chores;
begin
  -- A tarefa já existia (aqui, gravada direto na tabela, como o app antigo) e ganha a ordem.
  insert into public.chores (title, recurrence, due_on, assigned_to, points)
    values ('Lavar a louça', 'daily', '2026-10-12', auth.uid(), 10) returning id into dishes;
  perform pg_temp.save_order(dishes, array[beto, rita, lia]);
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = dishes) = array[beto, rita, lia],
    'the order is the order picked';
  select * into c from public.chores where id = dishes;
  assert c.assigned_to = '00000000-0000-0000-0000-000000000022' and c.kid_id is null,
    'a new rotation starts with the first of the order, even if the chore had someone else';

  begin
    perform pg_temp.save_order(dishes, array[beto, rex]);
    raise exception 'FAIL: a pet took part in a rotation';
  exception when check_violation then null;
  end;
  begin
    perform pg_temp.save_order(dishes, array[beto, tito]);
    raise exception 'FAIL: a person of another household took part in a rotation';
  exception when no_data_found then null;
  end;
  begin
    perform pg_temp.save_order(dishes, array[beto]);
    raise exception 'FAIL: rotation with one person';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform pg_temp.save_order(dishes, array[beto, rita, beto]);
    raise exception 'FAIL: rotation with a repeated person';
  exception when invalid_parameter_value then null;
  end;
  insert into public.chores (title, due_on) values ('Trocar a lâmpada', '2026-10-12') returning id into once;
  begin
    perform pg_temp.save_order(once, array[beto, rita]);
    raise exception 'FAIL: rotation on a one-off chore';
  exception when invalid_parameter_value then null;
  end;
  -- A ordem só se grava pelas funções: direto na tabela, quem mora na casa só lê. Senão entraria o que a
  -- função recusa (rodízio em tarefa que não se repete) e a vez ficaria com alguém de fora da ordem.
  begin
    insert into public.chore_rotation (chore_id, person_id, position) values (once, beto, 1), (once, rita, 2);
    raise exception 'FAIL: a member wrote a rotation straight into a one-off chore';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.chore_rotation (chore_id, person_id, position) values (dishes, nina, 4);
    raise exception 'FAIL: a member wrote straight into the order';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.chore_rotation set person_id = nina where chore_id = dishes and person_id = beto;
    raise exception 'FAIL: a member changed the order straight in the table';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.chore_rotation where chore_id = dishes and person_id = lia;
    raise exception 'FAIL: a member deleted from the order straight in the table';
  exception when insufficient_privilege then null;
  end;
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = dishes) = array[beto, rita, lia],
    'a refused order changes nothing';
  delete from public.chores where id = once;
  perform set_config('test.r_dishes', dishes::text, false);
end $$;
-- O que segura a tabela por baixo das funções (elas gravam como dono, e é como dono que se confere): só
-- pessoas entram, e duas não ficam na mesma posição.
reset role;
do $$
declare
  hh uuid := current_setting('test.hh_r')::uuid;
  beto uuid := current_setting('test.r_beto')::uuid;
  rita uuid := current_setting('test.r_rita')::uuid;
  lia uuid := current_setting('test.r_lia')::uuid;
  nina uuid := current_setting('test.r_nina')::uuid;
  rex uuid := current_setting('test.r_rex')::uuid;
  dishes uuid := current_setting('test.r_dishes')::uuid;
begin
  begin
    insert into public.chore_rotation (chore_id, person_id, position, household_id) values (dishes, rex, 9, hh);
    raise exception 'FAIL: a pet written straight into the order';
  exception when check_violation then null;
  end;
  begin
    insert into public.chore_rotation (chore_id, person_id, position, household_id) values (dishes, nina, 1, hh);
    raise exception 'FAIL: two people in the same position';
  exception when unique_violation then null;
  end;
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = dishes) = array[beto, rita, lia],
    'a refused row changes nothing';
end $$;
set role authenticated;

-- Outra casa não lê nem mexe na ordem, nem chama as funções nesta tarefa.
select set_config('request.jwt.claim.sub', :'user_o', false) \gset
do $$
declare
  dishes uuid := current_setting('test.r_dishes')::uuid;
  beto uuid := current_setting('test.r_beto')::uuid;
  rita uuid := current_setting('test.r_rita')::uuid;
  tito uuid := current_setting('test.r_tito')::uuid;
  mine uuid;
begin
  assert (select count(*) from public.chore_rotation) = 0, 'O sees no foreign order';
  begin
    update public.chore_rotation set position = position + 10;
    raise exception 'FAIL: O changed a foreign order';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.chore_rotation;
    raise exception 'FAIL: O deleted a foreign order';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.chore_rotation (chore_id, person_id, position) values (dishes, tito, 9);
    raise exception 'FAIL: O put his kid in a foreign chore';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.chore_rotation (chore_id, person_id, position, household_id)
      values (dishes, beto, 9, current_setting('test.hh_r')::uuid);
    raise exception 'FAIL: O wrote into a foreign household';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_chore(dishes, 'Lavar a louça', null, 'daily', 1, '2026-10-12', p_people => array[beto, rita]);
    raise exception 'FAIL: O saved the order of a foreign chore';
  exception when no_data_found then null;
  end;
  begin
    perform public.save_chore(dishes, 'Lavar a louça', null, 'daily', 1, '2026-10-12', p_people => '{}');
    raise exception 'FAIL: O ended a foreign rotation';
  exception when no_data_found then null;
  end;
  begin
    perform public.skip_chore_turn(dishes, beto);
    raise exception 'FAIL: O skipped a foreign turn';
  exception when no_data_found then null;
  end;
  begin
    perform public.complete_chore(dishes, '2026-10-12', '2026-10-12');
    raise exception 'FAIL: O completed a foreign chore';
  exception when no_data_found then null;
  end;
  -- Na casa dele, gente de outra casa não entra.
  insert into public.chores (title, recurrence) values ('Tarefa do Otto', 'weekly') returning id into mine;
  begin
    perform pg_temp.save_order(mine, array[tito, beto]);
    raise exception 'FAIL: O put a foreign person in his rotation';
  exception when no_data_found then null;
  end;
  delete from public.chores where id = mine;
end $$;
set role anon;
do $$
begin
  begin
    perform public.save_chore(gen_random_uuid(), 'Anon', null, 'daily', 1, '2026-10-12', p_people => '{}');
    raise exception 'FAIL: anon called save_chore';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_chore_rotation(gen_random_uuid(), '{}');
    raise exception 'FAIL: anon called save_chore_rotation';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.skip_chore_turn(gen_random_uuid(), null);
    raise exception 'FAIL: anon called skip_chore_turn';
  exception when insufficient_privilege then null;
  end;
end $$;
set role authenticated;
do $$
begin
  begin
    perform public.chore_set_turn(current_setting('test.r_dishes')::uuid, current_setting('test.r_tito')::uuid);
    raise exception 'FAIL: app user called an internal rotation function';
  exception when insufficient_privilege then null;
  end;
  -- As regras da ordem também são uma peça de dentro: pela API, a ordem só se grava junto com a tarefa (save_chore).
  begin
    perform public.save_chore_rotation(current_setting('test.r_dishes')::uuid, '{}');
    raise exception 'FAIL: app user saved an order outside save_chore';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Concluir passa a vez (depois do último, volta ao primeiro); os pontos são
-- de quem estava na vez, e só de quem não tem o app.
select set_config('request.jwt.claim.sub', :'user_s', false) \gset
do $$
declare
  rita uuid := current_setting('test.r_rita')::uuid;
  beto uuid := current_setting('test.r_beto')::uuid;
  lia uuid := current_setting('test.r_lia')::uuid;
  nina uuid := current_setting('test.r_nina')::uuid;
  dishes uuid := current_setting('test.r_dishes')::uuid;
  trash uuid;
  plain uuid;
  c public.chores;
  r record;
begin
  assert (select count(*) from public.chore_rotation where chore_id = dishes) = 3, 'B reads the household order';
  select * into r from public.complete_chore(dishes, '2026-10-12', '2026-10-12');
  assert r.completed and r.points = 0 and r.person_id is null and r.next_person_id = rita and r.due_on = '2026-10-13',
    'a member turn: no points, and the turn passes to the next';
  select * into c from public.chores where id = dishes;
  assert c.assigned_to = '00000000-0000-0000-0000-000000000021' and c.kid_id is null, 'the chore is now of the next member';
  -- Toque duplo (ou outro celular) na mesma ocorrência: não passa a vez de novo.
  select * into r from public.complete_chore(dishes, '2026-10-12', '2026-10-12');
  assert not r.completed and r.next_person_id is null, 'a repeated completion passes no turn';
  assert (select assigned_to from public.chores where id = dishes) = '00000000-0000-0000-0000-000000000021', 'the turn passed once';

  select * into r from public.complete_chore(dishes, '2026-10-13', '2026-10-13');
  assert r.completed and r.points = 0 and r.next_person_id = lia, 'the turn passes to the kid';
  select * into c from public.chores where id = dishes;
  assert c.assigned_to is null and c.kid_id = lia, 'a kid turn is kept in kid_id';
  select * into r from public.complete_chore(dishes, '2026-10-14', '2026-10-14');
  assert r.completed and r.points = 10 and r.person_id = lia and r.next_person_id = beto,
    'the kid whose turn it was earns the points, and after the last comes the first';
  select * into c from public.chores where id = dishes;
  assert c.assigned_to = auth.uid() and c.kid_id is null, 'wrapped around to the first';
  assert (select balance from public.kid_points where person_id = lia) = 10, 'points went to the kid of the turn';
  assert (select coalesce(sum(points), 0) from public.chore_completions where chore_id = dishes and person_id is distinct from lia) = 0,
    'member turns earned nothing';
  assert (select count(*) from public.chore_completions where chore_id = dishes) = 3, 'three completions';

  -- A vez é de alguém de fora da ordem (o responsável salvo sem mexer na ordem): o próximo é o primeiro.
  perform pg_temp.save_turn(dishes, null, nina);
  select * into r from public.complete_chore(dishes, '2026-10-15', '2026-10-15');
  assert r.completed and r.person_id = nina and r.next_person_id = beto, 'turn outside the order: next is the first';
  perform pg_temp.save_turn(dishes, null, null);
  select * into r from public.complete_chore(dishes, '2026-10-16', '2026-10-16');
  assert r.completed and r.next_person_id = beto, 'nobody in the turn: next is the first';

  -- App já instalado: chama sem o vencimento e lê as colunas de sempre.
  insert into public.chores (title, recurrence, due_on) values ('Levar o lixo', 'weekly', '2026-10-12') returning id into trash;
  perform pg_temp.save_order(trash, array[rita, beto]);
  select * into r from public.complete_chore(trash, '2026-10-12');
  assert r.completed and r.points = 0 and r.person_id is null and r.due_on = '2026-10-19' and r.active and r.next_person_id = beto,
    'the old call shape completes and passes the turn';
  select * into r from public.complete_chore(trash, '2026-10-12');
  assert not r.completed, 'old app double tap completes once';
  assert (select assigned_to from public.chores where id = trash) = auth.uid(), 'and passes the turn once';

  -- Tarefa sem rodízio: como sempre, sem próximo.
  insert into public.chores (title, recurrence, due_on, assigned_to) values ('Arrumar a sala', 'daily', '2026-10-12', auth.uid())
    returning id into plain;
  select * into r from public.complete_chore(plain, '2026-10-12', '2026-10-12');
  assert r.completed and r.next_person_id is null, 'no rotation: no next person';
  assert (select assigned_to from public.chores where id = plain) = auth.uid(), 'a plain chore keeps its person';
  delete from public.chores where id = plain;
  perform set_config('test.r_trash', trash::text, false);
end $$;

-- Pular a vez: passa sem concluir, e dois toques ao mesmo tempo passam uma vez só.
do $$
declare
  rita uuid := current_setting('test.r_rita')::uuid;
  beto uuid := current_setting('test.r_beto')::uuid;
  lia uuid := current_setting('test.r_lia')::uuid;
  dishes uuid := current_setting('test.r_dishes')::uuid;
  c public.chores;
  plain uuid;
begin
  assert (select assigned_to from public.chores where id = dishes) = auth.uid(), 'B is on turn';
  assert public.skip_chore_turn(dishes, beto) = rita, 'skipping passes the turn to the next';
  select * into c from public.chores where id = dishes;
  assert c.assigned_to = '00000000-0000-0000-0000-000000000021' and c.due_on = '2026-10-17' and c.active, 'the date stays';
  assert (select count(*) from public.chore_completions where chore_id = dishes) = 5, 'nothing in the history';
  assert (select balance from public.kid_points where person_id = lia) = 10, 'and no points';
  -- O outro celular ainda mostrava a vez de Beto.
  assert public.skip_chore_turn(dishes, beto) is null, 'a second skip from the old turn does nothing';
  assert (select assigned_to from public.chores where id = dishes) = '00000000-0000-0000-0000-000000000021', 'the turn passed once';
  assert public.skip_chore_turn(dishes, rita) = lia and public.skip_chore_turn(dishes, lia) = beto, 'skipping wraps around too';

  insert into public.chores (title, recurrence, assigned_to) values ('Sem rodízio', 'daily', auth.uid()) returning id into plain;
  assert public.skip_chore_turn(plain, beto) is null, 'no rotation: nothing to skip';
  assert (select assigned_to from public.chores where id = plain) = auth.uid(), 'and the chore keeps its person';
  -- Apagar a tarefa leva a ordem dela.
  perform pg_temp.save_order(plain, array[lia, beto]);
  delete from public.chores where id = plain;
  assert (select count(*) from public.chore_rotation where chore_id = plain) = 0, 'the order goes with the chore';
  begin
    perform public.skip_chore_turn(gen_random_uuid(), beto);
    raise exception 'FAIL: skipped a chore that does not exist';
  exception when no_data_found then null;
  end;
end $$;

-- Editar a ordem: quem continua nela mantém a vez; se saiu, a vez vai para o
-- primeiro. Encerrar o rodízio deixa a tarefa com quem estava na vez.
do $$
declare
  rita uuid := current_setting('test.r_rita')::uuid;
  beto uuid := current_setting('test.r_beto')::uuid;
  lia uuid := current_setting('test.r_lia')::uuid;
  nina uuid := current_setting('test.r_nina')::uuid;
  dishes uuid := current_setting('test.r_dishes')::uuid;
  c public.chores;
begin
  perform pg_temp.save_order(dishes, array[lia, beto, nina]);
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = dishes) = array[lia, beto, nina],
    'the order is replaced at once';
  assert (select assigned_to from public.chores where id = dishes) = auth.uid(), 'who stays in the order keeps the turn';
  perform pg_temp.save_order(dishes, array[nina, lia]);
  select * into c from public.chores where id = dishes;
  assert c.assigned_to is null and c.kid_id = nina, 'who left the order hands the turn to the first';
  perform pg_temp.save_order(dishes, array[beto, rita, nina]);
  assert (select kid_id from public.chores where id = dishes) = nina, 'the first is not forced when the turn is still in the order';

  perform pg_temp.save_order(dishes, '{}');
  assert (select count(*) from public.chore_rotation where chore_id = dishes) = 0, 'an empty order ends the rotation';
  select * into c from public.chores where id = dishes;
  assert c.assigned_to is null and c.kid_id = nina, 'ending the rotation keeps the current person';
  perform pg_temp.save_order(dishes, '{}');
  assert (select kid_id from public.chores where id = dishes) = nina, 'ending again changes nothing';

  -- O app antigo passa a tarefa para "Uma vez": o rodízio acaba e fica quem estava na vez.
  perform pg_temp.save_order(dishes, array[beto, rita, lia]);
  perform public.skip_chore_turn(dishes, beto);
  update public.chores set recurrence = 'none' where id = dishes;
  assert (select count(*) from public.chore_rotation where chore_id = dishes) = 0, 'a one-off chore has no rotation';
  assert (select assigned_to from public.chores where id = dishes) = '00000000-0000-0000-0000-000000000021', 'and keeps the person of the turn';
  update public.chores set recurrence = 'daily' where id = dishes;
end $$;

-- A vez de uma tarefa em rodízio não muda direto na tabela (NK009): a ordem ficaria lá, e a próxima conclusão
-- seguiria revezando. É o que o app já instalado (de antes do rodízio) e o app novo, quando a API ainda não enxerga
-- save_chore, fariam. O resto da tarefa, o mesmo responsável e a tarefa sem rodízio passam como sempre.
do $$
declare
  beto uuid := current_setting('test.r_beto')::uuid;
  rita uuid := current_setting('test.r_rita')::uuid;
  lia uuid := current_setting('test.r_lia')::uuid;
  dishes uuid := current_setting('test.r_dishes')::uuid;
  plain uuid;
  was public.chores;
  c public.chores;
begin
  perform pg_temp.save_order(dishes, array[beto, rita, lia]);
  assert public.skip_chore_turn(dishes, beto) = rita, 'the rotation is back, on the turn of R';
  select * into was from public.chores where id = dishes;
  begin
    update public.chores set assigned_to = auth.uid() where id = dishes;
    raise exception 'FAIL: a member changed the assignee of a rotating chore straight in the table';
  exception when sqlstate 'NK009' then
    assert sqlerrm = 'chore has a rotation', sqlerrm;
  end;
  begin
    update public.chores set assigned_to = null, kid_id = lia where id = dishes;
    raise exception 'FAIL: a member gave the turn of a rotating chore to a kid straight in the table';
  exception when sqlstate 'NK009' then null;
  end;
  begin
    update public.chores set assigned_to = null where id = dishes;
    raise exception 'FAIL: a member gave a rotating chore to anyone straight in the table';
  exception when sqlstate 'NK009' then null;
  end;
  -- O app antigo grava a tarefa inteira de uma vez: com a troca do responsável, nada do resto fica.
  begin
    update public.chores set title = 'Lavar a louça e as panelas', recurrence = 'none', assigned_to = auth.uid() where id = dishes;
    raise exception 'FAIL: a member changed the assignee of a rotating chore with the rest of it';
  exception when sqlstate 'NK009' then null;
  end;
  select * into c from public.chores where id = dishes;
  assert c = was, 'a refused write changes nothing in the chore';
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = dishes) = array[beto, rita, lia],
    'nor in the order';

  -- A vez de uma criança também (kid_id).
  perform public.skip_chore_turn(dishes, rita);
  begin
    update public.chores set kid_id = null, assigned_to = auth.uid() where id = dishes;
    raise exception 'FAIL: a member took the turn of a kid straight in the table';
  exception when sqlstate 'NK009' then null;
  end;
  begin
    update public.chores set kid_id = current_setting('test.r_nina')::uuid where id = dishes;
    raise exception 'FAIL: a member passed the turn to another kid straight in the table';
  exception when sqlstate 'NK009' then null;
  end;
  assert (select kid_id from public.chores where id = dishes) = lia, 'the kid keeps the turn';

  -- O resto da tarefa, sim: título, observação, data e pontos; e a tarefa inteira com o mesmo responsável (o app
  -- antigo manda tudo).
  update public.chores set title = 'Lavar a louça e as panelas', notes = 'Com detergente', due_on = '2026-10-20', points = 7
    where id = dishes;
  select * into c from public.chores where id = dishes;
  assert c.title = 'Lavar a louça e as panelas' and c.notes = 'Com detergente' and c.due_on = '2026-10-20' and c.points = 7
    and c.assigned_to is null and c.kid_id = lia, 'the rest of a rotating chore is written straight as always';
  update public.chores set assigned_to = null, kid_id = lia, title = 'Lavar a louça', notes = null, points = 10 where id = dishes;
  select * into c from public.chores where id = dishes;
  assert c.title = 'Lavar a louça' and c.notes is null and c.points = 10 and c.assigned_to is null and c.kid_id = lia,
    'and so is the whole chore with the same assignee';
  assert (select count(*) from public.chore_rotation where chore_id = dishes) = 3, 'and the order stays';

  -- Tarefa sem rodízio: o responsável muda direto na tabela, como sempre.
  insert into public.chores (title, recurrence, assigned_to) values ('Molhar as plantas', 'daily', auth.uid()) returning id into plain;
  update public.chores set assigned_to = '00000000-0000-0000-0000-000000000021' where id = plain;
  update public.chores set assigned_to = null, kid_id = lia where id = plain;
  update public.chores set kid_id = null where id = plain;
  select * into c from public.chores where id = plain;
  assert c.assigned_to is null and c.kid_id is null, 'a chore without rotation changes its assignee straight in the table';
  -- Nem a que já teve rodízio: acabado, ela volta a ser como as outras.
  perform pg_temp.save_order(plain, array[beto, lia]);
  perform pg_temp.save_order(plain, '{}');
  update public.chores set assigned_to = '00000000-0000-0000-0000-000000000021', kid_id = null where id = plain;
  assert (select assigned_to from public.chores where id = plain) = '00000000-0000-0000-0000-000000000021',
    'nor after its rotation ended';
  delete from public.chores where id = plain;

  -- Pelas funções a vez muda como antes: pular, concluir, o responsável escolhido e a ordem nova.
  assert public.skip_chore_turn(dishes, lia) = beto, 'skipping moves the turn';
  assert (select next_person_id from public.complete_chore(dishes, '2026-10-20', '2026-10-20')) = rita, 'completing moves the turn';
  perform pg_temp.save_turn(dishes, null, lia);
  assert (select kid_id from public.chores where id = dishes) = lia, 'save_chore with a person chosen moves the turn';
  perform pg_temp.save_order(dishes, array[rita, beto]);
  assert (select assigned_to from public.chores where id = dishes) = '00000000-0000-0000-0000-000000000021',
    'a new order from save_chore moves the turn';
  perform pg_temp.save_order(dishes, array[beto, rita, lia]);
  assert (select assigned_to from public.chores where id = dishes) = '00000000-0000-0000-0000-000000000021', 'R is on turn again';
end $$;

-- save_chore: o formulário grava a tarefa inteira numa chamada só, numa transação: os campos, o responsável (só
-- quando foi escolhido) e a ordem do rodízio. Recusada qualquer parte, nada daquela chamada fica gravado.
-- Primeiro a tarefa nova.
do $$
declare
  hh uuid := current_setting('test.hh_r')::uuid;
  rita uuid := current_setting('test.r_rita')::uuid;
  lia uuid := current_setting('test.r_lia')::uuid;
  rex uuid := current_setting('test.r_rex')::uuid;
  room uuid;
  lamp uuid;
  upkeep uuid;
  yard uuid;
  fridge uuid;
  loose uuid;
  c public.chores;
  chores_before integer;
begin
  -- Sem rodízio: os campos, os pontos e o responsável escolhido (uma criança).
  room := public.save_chore(null, 'Arrumar a sala', 'Com o aspirador', 'weekly', 2, '2026-10-12', 5, p_set_turn => true, p_kid_id => lia);
  select * into c from public.chores where id = room;
  assert c.household_id = hh and c.title = 'Arrumar a sala' and c.notes = 'Com o aspirador' and c.recurrence = 'weekly'
    and c.interval_count = 2 and c.due_on = '2026-10-12' and c.points = 5 and c.assigned_to is null and c.kid_id = lia
    and c.active and c.equipment_id is null and c.created_by = auth.uid(),
    'a new chore is created in the household of who calls, with the fields, the points and the person chosen';
  assert not exists (select 1 from public.chore_rotation r where r.chore_id = room), 'and without an order';
  -- Sem os pontos e sem responsável escolhido: 0 ponto, de qualquer um.
  lamp := public.save_chore(null, 'Trocar a lâmpada', null, 'none', 1, '2026-10-12');
  select * into c from public.chores where id = lamp;
  assert c.recurrence = 'none' and c.points = 0 and c.assigned_to is null and c.kid_id is null,
    'no points and no person in the call: a chore of anyone, worth nothing';
  -- O responsável só é gravado quando o formulário o escolheu (p_set_turn).
  loose := public.save_chore(null, 'Sem escolha', null, 'none', 1, '2026-10-12', p_assigned_to => auth.uid(), p_kid_id => lia);
  select * into c from public.chores where id = loose;
  assert c.assigned_to is null and c.kid_id is null, 'a person sent without p_set_turn is not written';
  delete from public.chores where id = loose;
  -- Manutenção: a tarefa nova nasce ligada ao aparelho.
  insert into public.equipment (name) values ('Geladeira') returning id into fridge;
  upkeep := public.save_chore(
    null, 'Trocar o filtro', null, 'monthly', 6, '2026-11-01',
    p_equipment_id => fridge, p_set_turn => true, p_assigned_to => auth.uid()
  );
  select * into c from public.chores where id = upkeep;
  assert c.equipment_id = fridge and c.assigned_to = auth.uid() and c.kid_id is null and c.interval_count = 6,
    'a new maintenance chore is tied to its equipment';

  -- Já com rodízio: a ordem é gravada na mesma chamada, e a vez é do primeiro.
  yard := public.save_chore(null, 'Regar o jardim', null, 'daily', 1, '2026-10-12', 10, p_people => array[rita, lia]);
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = yard) = array[rita, lia],
    'a new chore is created with its order';
  select * into c from public.chores where id = yard;
  assert c.assigned_to = '00000000-0000-0000-0000-000000000021' and c.kid_id is null and c.points = 10,
    'and the turn starts with the first of the order';

  -- Rodízio recusado na tarefa nova: nem a tarefa fica.
  chores_before := (select count(*) from public.chores);
  begin
    perform public.save_chore(null, 'Não fica', null, 'none', 1, '2026-10-12', p_people => array[rita, lia]);
    raise exception 'FAIL: a new one-off chore was created with a rotation';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.save_chore(null, 'Não fica', null, 'daily', 1, '2026-10-12', p_people => array[rita, rex]);
    raise exception 'FAIL: a new chore was created with a pet in its rotation';
  exception when check_violation then null;
  end;
  begin
    perform public.save_chore(null, 'Não fica', null, 'daily', 1, '2026-10-12', p_people => array[rita]);
    raise exception 'FAIL: a new chore was created with a rotation of one person';
  exception when invalid_parameter_value then null;
  end;
  assert (select count(*) from public.chores) = chores_before and not exists (select 1 from public.chores where title = 'Não fica'),
    'a refused order leaves no chore behind';

  perform set_config('test.r_room', room::text, false);
  perform set_config('test.r_lamp', lamp::text, false);
  perform set_config('test.r_upkeep', upkeep::text, false);
  perform set_config('test.r_yard', yard::text, false);
  perform set_config('test.r_fridge', fridge::text, false);
end $$;

-- A tarefa que já existe: os campos, e o responsável só quando foi escolhido.
do $$
declare
  lia uuid := current_setting('test.r_lia')::uuid;
  nina uuid := current_setting('test.r_nina')::uuid;
  tito uuid := current_setting('test.r_tito')::uuid;
  room uuid := current_setting('test.r_room')::uuid;
  fridge uuid := current_setting('test.r_fridge')::uuid;
  c public.chores;
  was public.chores;
begin
  -- Só os campos: o responsável e os pontos ficam como estão.
  select * into was from public.chores where id = room;
  assert public.save_chore(room, 'Arrumar a sala e o corredor', null, 'daily', 3, '2026-10-20') = room, 'the answer is the id of the chore';
  select * into c from public.chores where id = room;
  was.title := 'Arrumar a sala e o corredor';
  was.notes := null;
  was.recurrence := 'daily';
  was.interval_count := 3;
  was.due_on := '2026-10-20';
  assert c = was, 'fields only: the person and the points stay, and so does everything else of the chore';
  -- O aparelho é da tarefa nova: na que já existe, ele não muda.
  perform public.save_chore(room, c.title, c.notes, c.recurrence, c.interval_count, c.due_on, p_equipment_id => fridge);
  select * into c from public.chores where id = room;
  assert c = was, 'the equipment of a chore that exists does not change';

  -- O responsável escolhido: um morador, uma criança (com os pontos), qualquer um.
  perform public.save_chore(room, c.title, c.notes, c.recurrence, c.interval_count, c.due_on, 0,
    p_set_turn => true, p_assigned_to => '00000000-0000-0000-0000-000000000021');
  select * into c from public.chores where id = room;
  assert c.assigned_to = '00000000-0000-0000-0000-000000000021' and c.kid_id is null and c.points = 0, 'a member, and no points';
  perform public.save_chore(room, c.title, c.notes, c.recurrence, c.interval_count, c.due_on, 7, p_set_turn => true, p_kid_id => nina);
  -- Sem os pontos na chamada, eles ficam como estão.
  perform public.save_chore(room, c.title, c.notes, c.recurrence, c.interval_count, c.due_on, p_set_turn => true, p_kid_id => lia);
  select * into c from public.chores where id = room;
  assert c.assigned_to is null and c.kid_id = lia and c.points = 7, 'a kid; points left out of the call stay as they were';
  perform public.save_chore(room, c.title, c.notes, c.recurrence, c.interval_count, c.due_on, 0, p_set_turn => true);
  select * into was from public.chores where id = room;
  assert was.assigned_to is null and was.kid_id is null and was.points = 0, 'nobody: the chore is of anyone';

  -- Quem pode ser o responsável e o que cada campo aceita seguem o que a tabela já exigia. A recusa não deixa
  -- nada gravado: nem o título novo que veio na mesma chamada.
  begin
    perform public.save_chore(room, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 3, p_set_turn => true, p_kid_id => tito);
    raise exception 'FAIL: a kid of another household became the person of the chore';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.save_chore(room, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 3,
      p_set_turn => true, p_assigned_to => '00000000-0000-0000-0000-000000000023');
    raise exception 'FAIL: a member of another household became the person of the chore';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.save_chore(room, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 1001);
    raise exception 'FAIL: more points than a chore can be worth';
  exception when check_violation then null;
  end;
  begin
    perform public.save_chore(room, '  ', 'x', 'weekly', 9, '2026-12-01');
    raise exception 'FAIL: a chore without a title';
  exception when check_violation then null;
  end;
  begin
    perform public.save_chore(room, 'Outro título', 'x', 'yearly', 9, '2026-12-01');
    raise exception 'FAIL: a recurrence that does not exist';
  exception when check_violation then null;
  end;
  begin
    perform public.save_chore(room, 'Outro título', 'x', 'weekly', 0, '2026-12-01');
    raise exception 'FAIL: an interval of zero';
  exception when check_violation then null;
  end;
  select * into c from public.chores where id = room;
  assert c = was, 'a refused save changes nothing';
  -- A tarefa que não existe (apagada em outro celular): a resposta que o app reconhece.
  begin
    perform public.save_chore(gen_random_uuid(), 'Outro título', null, 'weekly', 1, '2026-12-01');
    raise exception 'FAIL: saved a chore that does not exist';
  exception when no_data_found then
    assert sqlerrm = 'chore not found', sqlerrm;
  end;
end $$;

-- A repetição e a ordem na mesma chamada, e as recusas das regras da ordem.
do $$
declare
  rita uuid := current_setting('test.r_rita')::uuid;
  beto uuid := current_setting('test.r_beto')::uuid;
  lia uuid := current_setting('test.r_lia')::uuid;
  rex uuid := current_setting('test.r_rex')::uuid;
  tito uuid := current_setting('test.r_tito')::uuid;
  lamp uuid := current_setting('test.r_lamp')::uuid;
  yard uuid := current_setting('test.r_yard')::uuid;
  c public.chores;
  was public.chores;
begin
  -- A tarefa "Uma vez" que passa a se repetir já com rodízio: uma chamada só. A repetição é gravada antes da
  -- ordem, na mesma transação, e a vez vai para o primeiro.
  perform public.save_chore(lamp, 'Trocar a lâmpada', null, 'weekly', 1, '2026-10-12', 10, p_people => array[beto, rita, lia], p_expect_none => true);
  select * into was from public.chores where id = lamp;
  assert was.recurrence = 'weekly' and was.assigned_to = auth.uid() and was.kid_id is null and was.points = 10,
    'a one-off chore becomes a repeating one with its rotation in one call';
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = lamp) = array[beto, rita, lia],
    'with the order asked';

  -- O contrário não existe: "Uma vez" e uma ordem na mesma chamada. A recusa desfaz a repetição gravada e traz de
  -- volta o rodízio que o gatilho tinha encerrado.
  begin
    perform public.save_chore(lamp, 'Outro título', null, 'none', 1, '2026-10-12', p_people => array[rita, beto]);
    raise exception 'FAIL: an order was saved on a chore that the same call made one-off';
  exception when invalid_parameter_value then null;
  end;
  select * into c from public.chores where id = lamp;
  assert c = was, 'the refusal undoes the recurrence written by the same call';
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = lamp) = array[beto, rita, lia],
    'and the rotation is whole';

  -- A tarefa em rodízio que vira "Uma vez": o rodízio acaba e ela fica com quem está na vez no banco (Lia, a
  -- quem a vez passou em outro celular). O formulário não manda o responsável: ele mandaria quem o aparelho
  -- achava que estava na vez e, se não conhecesse Lia, outra pessoa da ordem, ou ninguém.
  assert public.skip_chore_turn(lamp, beto) = rita and public.skip_chore_turn(lamp, rita) = lia, 'the turn passed to the kid';
  perform public.save_chore(lamp, 'Trocar a lâmpada', null, 'none', 1, '2026-10-12', p_people => '{}');
  select * into c from public.chores where id = lamp;
  assert c.recurrence = 'none' and c.assigned_to is null and c.kid_id = lia and c.points = 10,
    'a rotating chore turned one-off keeps whoever had the turn, and the points';
  assert not exists (select 1 from public.chore_rotation r where r.chore_id = lamp), 'and has no rotation';
  -- O mesmo sem falar da ordem (p_people nulo): quem encerra o rodízio é o gatilho, na mesma transação.
  perform public.save_chore(lamp, 'Trocar a lâmpada', null, 'daily', 1, '2026-10-12', p_people => array[rita, beto]);
  assert (select assigned_to from public.chores where id = lamp) = '00000000-0000-0000-0000-000000000021', 'rotating again: the turn is of the first';
  perform public.save_chore(lamp, 'Trocar a lâmpada', null, 'none', 1, '2026-10-12');
  select * into c from public.chores where id = lamp;
  assert c.recurrence = 'none' and c.assigned_to = '00000000-0000-0000-0000-000000000021' and c.kid_id is null,
    'one-off without a word about the order: the holder stays too';
  assert not exists (select 1 from public.chore_rotation r where r.chore_id = lamp), 'and the rotation is ended';

  -- Encerrar o rodízio (ordem vazia). Com o responsável escolhido, é ele; sem, fica quem estava na vez.
  perform public.save_chore(yard, 'Regar o jardim', null, 'daily', 1, '2026-10-12', 0, p_set_turn => true, p_assigned_to => auth.uid(), p_people => '{}');
  select * into c from public.chores where id = yard;
  assert c.assigned_to = auth.uid() and c.kid_id is null and c.points = 0, 'ending the rotation with a person chosen: the chore is of that person';
  assert not exists (select 1 from public.chore_rotation r where r.chore_id = yard), 'an empty order ends the rotation';
  perform public.save_chore(yard, 'Regar o jardim', null, 'daily', 1, '2026-10-12', 10, p_people => array[rita, lia]);
  assert public.skip_chore_turn(yard, rita) = lia, 'the turn passed to the kid';
  perform public.save_chore(yard, 'Regar o jardim', null, 'daily', 1, '2026-10-12', p_people => '{}');
  select * into c from public.chores where id = yard;
  assert c.assigned_to is null and c.kid_id = lia and c.points = 10, 'ending the rotation without choosing: whoever had the turn stays';
  perform public.save_chore(yard, 'Regar o jardim', null, 'daily', 1, '2026-10-12', p_people => '{}');
  assert (select kid_id from public.chores where id = yard) = lia, 'ending again changes nothing';

  -- Cada recusa das regras da ordem desfaz também os campos gravados na mesma chamada.
  perform public.save_chore(yard, 'Regar o jardim', null, 'daily', 1, '2026-10-12', 10, p_people => array[rita, lia, beto]);
  select * into was from public.chores where id = yard;
  begin
    perform public.save_chore(yard, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 99, p_people => array[beto, rex]);
    raise exception 'FAIL: a pet took part in a rotation';
  exception when check_violation then null;
  end;
  begin
    perform public.save_chore(yard, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 99, p_people => array[beto, tito]);
    raise exception 'FAIL: a person of another household took part in a rotation';
  exception when no_data_found then
    assert sqlerrm = 'Alguém do rodízio não está mais na casa. Confira a ordem e salve de novo.', sqlerrm;
  end;
  begin
    perform public.save_chore(yard, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 99, p_people => array[beto]);
    raise exception 'FAIL: rotation with one person';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.save_chore(yard, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 99, p_people => array[beto, rita, beto]);
    raise exception 'FAIL: rotation with a repeated person';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.save_chore(yard, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 99, p_people => array[array[beto, rita]]);
    raise exception 'FAIL: an order that is not a plain list';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.save_chore(yard, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 99,
      p_people => array(select gen_random_uuid() from generate_series(1, 21)));
    raise exception 'FAIL: rotation with more than 20 people';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.save_chore(yard, 'Outro título', 'x', 'none', 1, '2026-12-01', 99, p_people => array[beto, rita]);
    raise exception 'FAIL: rotation on a one-off chore';
  exception when invalid_parameter_value then
    assert sqlerrm = 'Só tarefa que se repete pode ter rodízio.', sqlerrm;
  end;
  select * into c from public.chores where id = yard;
  assert c = was, 'a refused order changes nothing in the chore: not the title, not the points, not the turn';
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = yard) = array[rita, lia, beto],
    'nor in the order';
end $$;

-- p_expect_none: o formulário abriu sem rodízio. Conferir que a tarefa segue sem rodízio e gravar são um passo só
-- no banco, com a tarefa travada: se outro celular criou um rodízio nesse meio-tempo, a função recusa (NK006) e
-- nada muda, em vez de pôr a vez em quem pode nem estar na ordem, ou de trocar por outra a ordem que o formulário
-- nunca mostrou.
do $$
declare
  rita uuid := current_setting('test.r_rita')::uuid;
  beto uuid := current_setting('test.r_beto')::uuid;
  lia uuid := current_setting('test.r_lia')::uuid;
  nina uuid := current_setting('test.r_nina')::uuid;
  hall uuid;
  c public.chores;
  was public.chores;
  done record;
begin
  -- Sem rodízio (a tarefa é de Nina e vale 3): o responsável escolhido é gravado, e a ordem nova também, com a
  -- vez no primeiro, como em todo rodízio novo.
  hall := public.save_chore(null, 'Varrer o corredor', null, 'daily', 1, '2026-10-12', 3, p_set_turn => true, p_kid_id => nina);
  perform public.save_chore(hall, 'Varrer o corredor', null, 'daily', 1, '2026-10-12', 0,
    p_set_turn => true, p_assigned_to => auth.uid(), p_expect_none => true);
  select * into c from public.chores where id = hall;
  assert c.assigned_to = auth.uid() and c.kid_id is null and c.points = 0, 'no rotation: the flagged save writes the person chosen';
  perform public.save_chore(hall, 'Varrer o corredor', null, 'daily', 1, '2026-10-12', 10, p_people => array[rita, lia], p_expect_none => true);
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = hall) = array[rita, lia],
    'no rotation: the flagged save creates the order';
  select * into was from public.chores where id = hall;
  assert was.assigned_to = '00000000-0000-0000-0000-000000000021' and was.kid_id is null and was.points = 10,
    'and the turn goes to the first of the new order, not to who the chore was of';

  -- Com rodízio: recusa, seja o que for que o formulário pede (um responsável, outra ordem, nenhuma, só os
  -- campos, uma ordem que nem valeria, "Uma vez"), e antes de olhar o pedido.
  begin
    perform public.save_chore(hall, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 0,
      p_set_turn => true, p_assigned_to => auth.uid(), p_expect_none => true);
    raise exception 'FAIL: the flagged save put the turn on a member outside the order';
  exception when sqlstate 'NK006' then null;
  end;
  begin
    perform public.save_chore(hall, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 99, p_set_turn => true, p_kid_id => lia, p_expect_none => true);
    raise exception 'FAIL: the flagged save moved the turn inside the order';
  exception when sqlstate 'NK006' then null;
  end;
  begin
    perform public.save_chore(hall, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 0, p_set_turn => true, p_expect_none => true);
    raise exception 'FAIL: the flagged save took the turn from everyone';
  exception when sqlstate 'NK006' then null;
  end;
  begin
    perform public.save_chore(hall, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 99, p_people => array[beto, nina], p_expect_none => true);
    raise exception 'FAIL: the flagged save replaced a rotation the form never showed';
  exception when sqlstate 'NK006' then null;
  end;
  begin
    perform public.save_chore(hall, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 99, p_people => array[lia, rita], p_expect_none => true);
    raise exception 'FAIL: the flagged save went over a rotation of the same people in another order';
  exception when sqlstate 'NK006' then null;
  end;
  begin
    perform public.save_chore(hall, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 99, p_people => '{}', p_expect_none => true);
    raise exception 'FAIL: the flagged save ended a rotation the form never showed';
  exception when sqlstate 'NK006' then null;
  end;
  begin
    perform public.save_chore(hall, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 99, p_expect_none => true);
    raise exception 'FAIL: the flagged save wrote the fields of a chore that has a rotation';
  exception when sqlstate 'NK006' then null;
  end;
  begin
    perform public.save_chore(hall, 'Outro título', 'x', 'weekly', 9, '2026-12-01', 99, p_people => array[beto], p_expect_none => true);
    raise exception 'FAIL: the flagged save looked at the order asked before the rotation that exists';
  exception when sqlstate 'NK006' then null;
  end;
  begin
    perform public.save_chore(hall, 'Outro título', 'x', 'none', 1, '2026-12-01', 99, p_expect_none => true);
    raise exception 'FAIL: the flagged save made one-off a chore that has a rotation';
  exception when sqlstate 'NK006' then null;
  end;
  -- Pelo nome dos argumentos, como a API chama.
  begin
    perform public.save_chore(
      p_chore_id => hall, p_title => 'Outro título', p_notes => null, p_recurrence => 'daily', p_interval_count => 1, p_due_on => '2026-12-01',
      p_points => 0, p_equipment_id => null, p_set_turn => true, p_assigned_to => auth.uid(), p_kid_id => null, p_people => null, p_expect_none => true
    );
    raise exception 'FAIL: the flagged save, called by name, went over a rotation';
  exception when sqlstate 'NK006' then
    assert sqlerrm = 'chore has a rotation', sqlerrm;
  end;
  select * into c from public.chores where id = hall;
  assert c = was, 'a refused flagged save changes nothing in the chore: not the title, not the turn, not the points';
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = hall) = array[rita, lia],
    'nor in the order';
  -- A conclusão seguinte é de quem estava na vez, e a vez segue a ordem.
  select * into done from public.complete_chore(hall, '2026-10-12', '2026-10-12');
  assert done.completed and done.points = 0 and done.person_id is null and done.next_person_id = lia, 'the turn was still of the member in the order';

  -- A mesma ordem não é o rodízio de outro celular: é a deste formulário, de uma chamada que chegou ao banco e
  -- cuja resposta se perdeu. Salvar de novo passa, grava os campos, e a vez fica onde está (ela já passou para Lia).
  perform public.save_chore(hall, 'Varrer o corredor e a escada', null, 'daily', 1, '2026-10-13', 10, p_people => array[rita, lia], p_expect_none => true);
  select * into c from public.chores where id = hall;
  assert c.title = 'Varrer o corredor e a escada' and c.assigned_to is null and c.kid_id = lia and c.points = 10,
    'the flagged save of the order the chore already has is not a conflict: the fields are written and the turn stays';
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = hall) = array[rita, lia],
    'and the order is the same';

  -- Sem o aviso (o formulário mostrou o rodízio), ou com ele falso ou nulo: a ordem é trocada inteira, quem
  -- continua nela mantém a vez e, se saiu, a vez vai para o primeiro.
  perform public.save_chore(hall, c.title, null, 'daily', 1, '2026-10-13', 10, p_people => array[lia, rita, beto]);
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = hall) = array[lia, rita, beto],
    'without the flag the order is replaced';
  assert (select kid_id from public.chores where id = hall) = lia, 'and who stays in the order keeps the turn';
  perform public.save_chore(hall, c.title, null, 'daily', 1, '2026-10-13', 10, p_people => array[beto, nina], p_expect_none => false);
  select * into c from public.chores where id = hall;
  assert c.assigned_to = auth.uid() and c.kid_id is null, 'who left the order hands the turn to the first';
  perform public.save_chore(hall, c.title, null, 'daily', 1, '2026-10-13', 10, p_people => array[nina, beto, lia], p_expect_none => null);
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = hall) = array[nina, beto, lia],
    'a null flag is no flag';
  assert (select assigned_to from public.chores where id = hall) = auth.uid(), 'and the turn stays';

  -- O rodízio acabou: a função volta a aceitar o aviso. Ordem vazia numa tarefa sem rodízio: nada a fazer, sem erro.
  perform public.save_chore(hall, c.title, null, 'daily', 1, '2026-10-13', 10, p_people => '{}');
  perform public.save_chore(hall, c.title, null, 'daily', 1, '2026-10-13', 10, p_people => '{}', p_expect_none => true);
  assert not exists (select 1 from public.chore_rotation r where r.chore_id = hall), 'a flagged empty order on a chore without rotation does nothing';
  assert (select assigned_to from public.chores where id = hall) = auth.uid(), 'and the chore keeps its person';
  perform public.save_chore(hall, c.title, null, 'daily', 1, '2026-10-13', 10, p_people => array[lia, beto], p_expect_none => true);
  select * into c from public.chores where id = hall;
  assert c.assigned_to is null and c.kid_id = lia, 'with the rotation ended, the flagged save is accepted again, and the turn starts with the first';
  perform set_config('test.r_hall', hall::text, false);
end $$;

-- Outra casa não salva nem confere esta tarefa: com rodízio ou sem, com o aviso ou sem, a resposta é a mesma (a
-- tarefa não existe para ela). Na casa dela, gente e aparelho de outra casa não entram, e a tarefa nova não fica.
select set_config('request.jwt.claim.sub', :'user_o', false) \gset
do $$
declare
  rita uuid := current_setting('test.r_rita')::uuid;
  beto uuid := current_setting('test.r_beto')::uuid;
  lia uuid := current_setting('test.r_lia')::uuid;
  tito uuid := current_setting('test.r_tito')::uuid;
  room uuid := current_setting('test.r_room')::uuid;
  hall uuid := current_setting('test.r_hall')::uuid;
  mine uuid;
begin
  begin
    perform public.save_chore(room, 'Do Otto', null, 'daily', 1, '2026-10-12', 3, p_set_turn => true, p_assigned_to => auth.uid());
    raise exception 'FAIL: O saved a foreign chore';
  exception when no_data_found then
    assert sqlerrm = 'chore not found', sqlerrm;
  end;
  begin
    perform public.save_chore(room, 'Do Otto', null, 'daily', 1, '2026-10-12', 3, p_set_turn => true, p_kid_id => tito, p_expect_none => true);
    raise exception 'FAIL: O put his kid in a foreign chore';
  exception when no_data_found then null;
  end;
  begin
    perform public.save_chore(hall, 'Do Otto', null, 'daily', 1, '2026-10-12', p_people => array[beto, rita], p_expect_none => true);
    raise exception 'FAIL: O learned of, or went over, a foreign rotation with the flag';
  exception when no_data_found then
    assert sqlerrm = 'chore not found', sqlerrm;
  end;
  begin
    perform public.save_chore(hall, 'Do Otto', null, 'daily', 1, '2026-10-12', p_people => array[beto, rita]);
    raise exception 'FAIL: O saved the order of a foreign chore';
  exception when no_data_found then null;
  end;
  begin
    perform public.save_chore(hall, 'Do Otto', null, 'daily', 1, '2026-10-12', p_people => '{}');
    raise exception 'FAIL: O ended a foreign rotation';
  exception when no_data_found then null;
  end;

  begin
    perform public.save_chore(null, 'Tarefa do Otto', null, 'weekly', 1, '2026-10-12', 5, p_set_turn => true, p_kid_id => lia);
    raise exception 'FAIL: O gave his chore to a kid of another household';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.save_chore(null, 'Tarefa do Otto', null, 'weekly', 1, '2026-10-12',
      p_set_turn => true, p_assigned_to => '00000000-0000-0000-0000-000000000021');
    raise exception 'FAIL: O gave his chore to a member of another household';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.save_chore(null, 'Tarefa do Otto', null, 'weekly', 1, '2026-10-12', p_equipment_id => current_setting('test.r_fridge')::uuid);
    raise exception 'FAIL: O tied his chore to the equipment of another household';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.save_chore(null, 'Tarefa do Otto', null, 'weekly', 1, '2026-10-12', p_people => array[tito, beto]);
    raise exception 'FAIL: O put a foreign person in his rotation';
  exception when no_data_found then
    assert sqlerrm = 'Alguém do rodízio não está mais na casa. Confira a ordem e salve de novo.', sqlerrm;
  end;
  assert not exists (select 1 from public.chores where title = 'Tarefa do Otto'), 'a refused new chore is not created';
  -- O que é dele, ele salva: a tarefa nasce na casa dele.
  mine := public.save_chore(null, 'Tarefa do Otto', null, 'weekly', 1, '2026-10-12', 5, p_set_turn => true, p_kid_id => tito);
  assert (select household_id from public.chores where id = mine) = public.current_household_id(), 'a new chore of O is created in his household';
  delete from public.chores where id = mine;
end $$;
-- Quem ainda não tem casa não cria tarefa (rodando como dono, a regra de acesso da tabela não barraria).
select set_config('request.jwt.claim.sub', :'user_t', false) \gset
do $$
begin
  assert public.current_household_id() is null, 'T has no household yet';
  begin
    perform public.save_chore(null, 'Sem casa', null, 'none', 1, '2026-10-12');
    raise exception 'FAIL: someone without a household created a chore';
  exception when insufficient_privilege then
    assert sqlerrm = 'sem casa', sqlerrm;
  end;
  begin
    perform public.save_chore(current_setting('test.r_room')::uuid, 'Sem casa', null, 'none', 1, '2026-10-12');
    raise exception 'FAIL: someone without a household saved a chore';
  exception when no_data_found then null;
  end;
end $$;
set role anon;
do $$
begin
  begin
    perform public.save_chore(null, 'Anon', null, 'none', 1, '2026-10-12');
    raise exception 'FAIL: anon called save_chore';
  exception when insufficient_privilege then
    -- A permissão da função, e não a recusa de dentro dela ("sem casa").
    assert sqlerrm like 'permission denied for function%', sqlerrm;
  end;
end $$;
reset role;
do $$
declare
  save constant text := 'public.save_chore(uuid, text, text, text, integer, date, integer, uuid, boolean, uuid, uuid, uuid[], boolean)';
  rules constant text := 'public.save_chore_rotation(uuid, uuid[])';
  c public.chores;
begin
  select * into c from public.chores where id = current_setting('test.r_room')::uuid;
  assert c.title = 'Arrumar a sala e o corredor' and c.assigned_to is null and c.kid_id is null and c.points = 0, 'the foreign calls changed nothing';
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = current_setting('test.r_hall')::uuid)
    = array[current_setting('test.r_lia')::uuid, current_setting('test.r_beto')::uuid], 'nor in the order';
  assert not exists (select 1 from public.chores where title in ('Sem casa', 'Anon', 'Do Otto', 'Tarefa do Otto')), 'and created nothing';

  -- Cada permissão conferida sozinha: quem chama save_chore é só quem entrou no app.
  assert not has_function_privilege('public', save, 'execute'), 'save_chore is not open to every role';
  assert not has_function_privilege('anon', save, 'execute'), 'anon cannot call save_chore';
  assert has_function_privilege('authenticated', save, 'execute'), 'members call save_chore';
  -- Roda como dono (a casa é conferida dentro dela), com o search_path vazio, como as irmãs.
  assert (select p.prosecdef from pg_proc p where p.oid = save::regprocedure), 'save_chore is security definer';
  assert (select p.proconfig from pg_proc p where p.oid = save::regprocedure) = array['search_path=""'], 'with an empty search_path';
  assert (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_chore') = 1,
    'save_chore is one function';
  -- As regras da ordem são uma peça de dentro: ninguém as chama pela API, nem quem entrou no app.
  assert not has_function_privilege('public', rules, 'execute'), 'save_chore_rotation is not open to every role';
  assert not has_function_privilege('anon', rules, 'execute'), 'anon cannot call save_chore_rotation';
  assert not has_function_privilege('authenticated', rules, 'execute'), 'members cannot call save_chore_rotation straight';
  assert (select p.proconfig from pg_proc p where p.oid = rules::regprocedure) = array['search_path=""'],
    'save_chore_rotation has an empty search_path';
  -- O que saiu, saiu: a função do responsável e a ordem com o terceiro argumento.
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_chore_single'),
    'save_chore_single is gone';
  assert to_regprocedure('public.save_chore_rotation(uuid, uuid[], boolean)') is null, 'the three-argument save_chore_rotation is gone';
  assert (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_chore_rotation') = 1,
    'save_chore_rotation is one function';
  -- As outras funções do rodízio: concluir e pular são de quem entrou no app; as peças de dentro, de ninguém.
  assert not has_function_privilege('public', 'public.complete_chore(uuid, date, date)', 'execute'), 'complete_chore is not open to every role';
  assert not has_function_privilege('anon', 'public.complete_chore(uuid, date, date)', 'execute'), 'anon cannot call complete_chore';
  assert has_function_privilege('authenticated', 'public.complete_chore(uuid, date, date)', 'execute'), 'members call complete_chore';
  assert not has_function_privilege('public', 'public.skip_chore_turn(uuid, uuid)', 'execute'), 'skip_chore_turn is not open to every role';
  assert not has_function_privilege('anon', 'public.skip_chore_turn(uuid, uuid)', 'execute'), 'anon cannot call skip_chore_turn';
  assert has_function_privilege('authenticated', 'public.skip_chore_turn(uuid, uuid)', 'execute'), 'members call skip_chore_turn';
  assert not exists (
    select 1
    from unnest(array['public', 'anon', 'authenticated']) as who,
      unnest(array['public.chore_turn_person(uuid, uuid, uuid)', 'public.chore_set_turn(uuid, uuid)', 'public.chore_next_person(uuid, integer)']) as fn
    where has_function_privilege(who, fn, 'execute')
  ), 'the pieces that read and move the turn are called by no role of the API';
  -- A recusa da troca direta da vez roda com os direitos de quem grava (current_user é quem fez a instrução), e
  -- dispara sem que ninguém da API possa chamá-la (os testes acima são da pessoa logada, sem esse direito).
  assert not (select p.prosecdef from pg_proc p where p.oid = 'public.chore_turn_not_by_hand()'::regprocedure),
    'chore_turn_not_by_hand is security invoker';
  assert (select p.proconfig from pg_proc p where p.oid = 'public.chore_turn_not_by_hand()'::regprocedure) = array['search_path=""'],
    'with an empty search_path';
  assert not exists (
    select 1 from unnest(array['public', 'anon', 'authenticated']) as who
    where has_function_privilege(who, 'public.chore_turn_not_by_hand()', 'execute')
  ), 'chore_turn_not_by_hand is called by no role of the API';
end $$;

-- As tarefas das corridas: três sem rodízio, de Beto, e a da varanda, que vale 4.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_s', false) \gset
do $$
begin
  perform set_config('test.r_attic', public.save_chore(null, 'Limpar o sótão', null, 'weekly', 1, '2026-10-12', p_set_turn => true, p_assigned_to => auth.uid())::text, false);
  perform set_config('test.r_car', public.save_chore(null, 'Lavar o carro', null, 'weekly', 1, '2026-10-12', p_set_turn => true, p_assigned_to => auth.uid())::text, false);
  perform set_config('test.r_walk', public.save_chore(null, 'Passear com o Rex', null, 'daily', 1, '2026-10-12', p_set_turn => true, p_assigned_to => auth.uid())::text, false);
  perform set_config('test.r_porch', public.save_chore(null, 'Varrer a varanda', null, 'daily', 1, '2026-10-12', 4, p_set_turn => true, p_assigned_to => auth.uid())::text, false);
end $$;
reset role;

-- A corrida, com duas sessões de verdade: esta e uma segunda, aberta com dblink (vem com o Postgres). Quem
-- chega depois espera a trava da linha da tarefa (save_chore a pega com "for update" antes de qualquer outra
-- coisa) e só confere o rodízio, ou a própria tarefa, depois de a primeira terminar.
select exists (select 1 from pg_available_extensions where name = 'dblink') as has_dblink \gset
\if :has_dblink
create schema race;
create extension dblink schema race;
-- A segunda sessão é o celular de Beto. Se algo der errado, ela desiste em vez de esperar para sempre.
select format(
  'dbname=%s user=%s port=%s host=''%s''',
  current_database(),
  session_user,
  current_setting('port'),
  case when current_setting('listen_addresses') = '' then split_part(current_setting('unix_socket_directories'), ',', 1) else 'localhost' end
) as race_conn \gset
select race.dblink_connect('beto', :'race_conn') as race_connected \gset
select race.dblink_exec('beto', 'set statement_timeout = ''30s''') as race_timeout \gset
select race.dblink_exec('beto', 'set role authenticated') as race_role \gset
select set_config('test.race_pid', pid::text, false) as race_pid
  from race.dblink('beto', format('select set_config(''request.jwt.claim.sub'', %L, false), pg_backend_pid()', :'user_s')) as t (sub text, pid integer) \gset

-- (a) Rita cria o rodízio do sótão (Rita, Lia) e ainda não terminou; Beto, com o formulário aberto sem rodízio,
--     salva a tarefa como dele, com outro título, outra repetição e outros pontos. A gravação dele espera a de
--     Rita e, quando ela termina, é recusada inteira.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_r', false) \gset
begin;
select public.save_chore(
  current_setting('test.r_attic')::uuid, 'Limpar o sótão', null, 'weekly', 1, '2026-10-12', 10,
  p_people => array[current_setting('test.r_rita')::uuid, current_setting('test.r_lia')::uuid], p_expect_none => true
) as race_first \gset
-- A tarefa como Rita a deixa: é com ela que se compara depois.
select set_config('test.race_was', c::text, false) as race_was from public.chores c where c.id = current_setting('test.r_attic')::uuid \gset
reset role;
select race.dblink_send_query(
  'beto',
  format(
    'select public.save_chore(%L, ''Limpar o sótão e o porão'', ''de Beto'', ''daily'', 2, ''2026-11-01'', 0, p_set_turn => true, p_assigned_to => %L, p_expect_none => true)',
    current_setting('test.r_attic'), :'user_s'
  )
) as race_sent \gset
do $$
declare
  beto_pid integer := current_setting('test.race_pid')::integer;
begin
  for i in 1..200 loop
    exit when pg_backend_pid() = any (pg_blocking_pids(beto_pid));
    perform pg_sleep(0.05);
  end loop;
  assert pg_backend_pid() = any (pg_blocking_pids(beto_pid)), 'the flagged save waits for the chore row that the other save holds';
  assert race.dblink_is_busy('beto') = 1, 'and has not answered yet';
end $$;
commit;
do $$
declare
  attic uuid := current_setting('test.r_attic')::uuid;
begin
  begin
    perform * from race.dblink_get_result('beto') as t (saved uuid);
    raise exception 'FAIL: the flagged save went over a rotation created while it waited';
  exception when sqlstate 'NK006' then null;
  end;
  assert (select c::text from public.chores c where c.id = attic) = current_setting('test.race_was'),
    'nothing of the refused save was written: the chore is as the first save left it, with the turn on the first of the new order';
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = attic)
    = array[current_setting('test.r_rita')::uuid, current_setting('test.r_lia')::uuid], 'and the order is whole';
end $$;
-- A consulta que falhou terminou: a sessão de Beto fica livre para a próxima.
select count(*) as race_drained from race.dblink_get_result('beto') as t (saved uuid) \gset

-- (b) Rita apaga o carro e ainda não terminou; Beto salva a tarefa. A gravação dele espera e, quando a tarefa
--     some, responde que ela não existe: a resposta que o app troca pelo aviso da tarefa apagada.
set role authenticated;
begin;
delete from public.chores where id = current_setting('test.r_car')::uuid;
reset role;
select race.dblink_send_query(
  'beto',
  format(
    'select public.save_chore(%L, ''Lavar o carro por dentro'', null, ''weekly'', 1, ''2026-10-12'', 0, p_set_turn => true, p_assigned_to => %L, p_expect_none => true)',
    current_setting('test.r_car'), :'user_s'
  )
) as race_sent \gset
do $$
declare
  beto_pid integer := current_setting('test.race_pid')::integer;
begin
  for i in 1..200 loop
    exit when pg_backend_pid() = any (pg_blocking_pids(beto_pid));
    perform pg_sleep(0.05);
  end loop;
  assert pg_backend_pid() = any (pg_blocking_pids(beto_pid)), 'the save waits for the chore row that the delete holds';
end $$;
commit;
do $$
begin
  begin
    perform * from race.dblink_get_result('beto') as t (saved uuid);
    raise exception 'FAIL: the save answered as if a chore deleted while it waited had been saved';
  exception when no_data_found then
    assert sqlerrm = 'chore not found', sqlerrm;
  end;
  assert not exists (select 1 from public.chores c where c.id = current_setting('test.r_car')::uuid), 'and the chore was not brought back';
end $$;
select count(*) as race_drained from race.dblink_get_result('beto') as t (saved uuid) \gset

-- (c) Os dois formulários abriram sem rodízio e os dois criam um. Rita grava o do passeio (Rita, Lia) e ainda não
--     terminou; o de Beto (Beto, Nina, com outro título e outros pontos) espera e, quando ela termina, é recusado
--     inteiro: a ordem e a tarefa dela ficam como ela deixou.
set role authenticated;
begin;
select public.save_chore(
  current_setting('test.r_walk')::uuid, 'Passear com o Rex', null, 'daily', 1, '2026-10-12', 10,
  p_people => array[current_setting('test.r_rita')::uuid, current_setting('test.r_lia')::uuid], p_expect_none => true
) as race_first \gset
select set_config('test.race_was', c::text, false) as race_was from public.chores c where c.id = current_setting('test.r_walk')::uuid \gset
reset role;
select race.dblink_send_query(
  'beto',
  format(
    'select public.save_chore(%L, ''Passear com o Rex no parque'', ''de Beto'', ''weekly'', 2, ''2026-11-01'', 7, p_people => array[%L, %L]::uuid[], p_expect_none => true)',
    current_setting('test.r_walk'), current_setting('test.r_beto'), current_setting('test.r_nina')
  )
) as race_sent \gset
do $$
declare
  beto_pid integer := current_setting('test.race_pid')::integer;
begin
  for i in 1..200 loop
    exit when pg_backend_pid() = any (pg_blocking_pids(beto_pid));
    perform pg_sleep(0.05);
  end loop;
  assert pg_backend_pid() = any (pg_blocking_pids(beto_pid)), 'the second flagged save waits for the chore row that the first holds';
  assert race.dblink_is_busy('beto') = 1, 'and has not answered yet';
end $$;
commit;
do $$
declare
  walk uuid := current_setting('test.r_walk')::uuid;
begin
  begin
    perform * from race.dblink_get_result('beto') as t (saved uuid);
    raise exception 'FAIL: the flagged save replaced a rotation created while it waited';
  exception when sqlstate 'NK006' then null;
  end;
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = walk)
    = array[current_setting('test.r_rita')::uuid, current_setting('test.r_lia')::uuid], 'the order of who came first is whole';
  assert (select c::text from public.chores c where c.id = walk) = current_setting('test.race_was'),
    'and the refused save is refused whole: the title, the recurrence, the points and the turn are of the first';
end $$;
select count(*) as race_drained from race.dblink_get_result('beto') as t (saved uuid) \gset

-- (d) Na ordem contrária, quem chega depois não tem o que recusar: Rita salva a varanda como dela (sem rodízio) e
--     ainda não terminou; Beto cria o rodízio (Beto, Lia). A gravação dele espera, é aceita inteira (os campos
--     dele ficam) e, como o rodízio é novo, a vez começa pelo primeiro da ordem.
set role authenticated;
begin;
select public.save_chore(
  current_setting('test.r_porch')::uuid, 'Varrer a varanda', 'de Rita', 'daily', 1, '2026-10-12', 0,
  p_set_turn => true, p_assigned_to => :'user_r', p_expect_none => true
) as race_first \gset
reset role;
select race.dblink_send_query(
  'beto',
  format(
    'select public.save_chore(%L, ''Varrer a varanda e a escada'', null, ''daily'', 1, ''2026-10-12'', 10, p_people => array[%L, %L]::uuid[], p_expect_none => true)',
    current_setting('test.r_porch'), current_setting('test.r_beto'), current_setting('test.r_lia')
  )
) as race_sent \gset
do $$
declare
  beto_pid integer := current_setting('test.race_pid')::integer;
begin
  for i in 1..200 loop
    exit when pg_backend_pid() = any (pg_blocking_pids(beto_pid));
    perform pg_sleep(0.05);
  end loop;
  assert pg_backend_pid() = any (pg_blocking_pids(beto_pid)), 'the save of the order waits for the chore row that the save of the person holds';
end $$;
commit;
select count(*) as race_saved from race.dblink_get_result('beto') as t (saved uuid) \gset
do $$
declare
  porch uuid := current_setting('test.r_porch')::uuid;
  c public.chores;
begin
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = porch)
    = array[current_setting('test.r_beto')::uuid, current_setting('test.r_lia')::uuid], 'the rotation was created after the save of the person';
  select * into c from public.chores where id = porch;
  assert c.title = 'Varrer a varanda e a escada' and c.notes is null and c.points = 10, 'the later save is written whole';
  assert c.assigned_to = '00000000-0000-0000-0000-000000000022' and c.kid_id is null, 'and the turn is inside the order: of its first, not of R';
end $$;
-- (A consulta que deu certo só termina quando não há mais resultado a ler.)
select count(*) as race_drained from race.dblink_get_result('beto') as t (saved uuid) \gset
select race.dblink_disconnect('beto') as race_closed \gset
drop extension dblink;
drop schema race;
\else
\echo '  (este Postgres não tem dblink: a corrida entre duas sessões não rodou; fica conferido que save_chore trava a linha da tarefa antes de tudo)'
-- Sem a segunda sessão, o que se confere é o que segura a corrida: a função trava a linha da tarefa antes de olhar
-- a ordem e de gravar, então uma chamada espera a outra terminar.
do $$
declare
  src text := (
    select p.prosrc from pg_proc p
    where p.oid = 'public.save_chore(uuid, text, text, text, integer, date, integer, uuid, boolean, uuid, uuid, uuid[], boolean)'::regprocedure
  );
begin
  assert src ~ 'for update;\s+if not found then.*chore_rotation', 'save_chore locks the chore row before it looks at the order';
  assert src ~ 'for update;\s+if not found then.*p_expect_none.*NK006.*update public\.chores', 'with the flag, it refuses before it writes anything';
  assert src ~ 'update public\.chores.*perform public\.save_chore_rotation', 'and the fields and the order are written by the same call';
end $$;
\endif
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_s', false) \gset
delete from public.chores where id in (
  current_setting('test.r_room')::uuid, current_setting('test.r_lamp')::uuid, current_setting('test.r_upkeep')::uuid,
  current_setting('test.r_yard')::uuid, current_setting('test.r_hall')::uuid, current_setting('test.r_attic')::uuid,
  current_setting('test.r_car')::uuid, current_setting('test.r_walk')::uuid, current_setting('test.r_porch')::uuid
);
delete from public.equipment where id = current_setting('test.r_fridge')::uuid;

-- Ficha apagada (ou que virou pet) sai da ordem; se era a vez dela, a vez
-- passa para o seguinte; com uma pessoa só, o rodízio acaba e a tarefa fica com ela.
select set_config('request.jwt.claim.sub', :'user_r', false) \gset
do $$
declare
  rita uuid := current_setting('test.r_rita')::uuid;
  beto uuid := current_setting('test.r_beto')::uuid;
  lia uuid := current_setting('test.r_lia')::uuid;
  nina uuid := current_setting('test.r_nina')::uuid;
  teo uuid := current_setting('test.r_teo')::uuid;
  bidu uuid := current_setting('test.r_bidu')::uuid;
  dishes uuid := current_setting('test.r_dishes')::uuid;
  sweep uuid;
  plain uuid;
  dust uuid;
  c public.chores;
begin
  insert into public.chores (title, recurrence, points) values ('Varrer a casa', 'weekly', 5) returning id into sweep;
  perform pg_temp.save_order(sweep, array[bidu, nina, teo, beto]);
  perform pg_temp.save_order(dishes, array[rita, nina, lia]);
  insert into public.chores (title, kid_id, points) values ('Guardar os brinquedos', nina, 5) returning id into plain;
  -- Um rodízio sem Nina, mas na vez dela (o responsável salvo sem mexer na ordem).
  insert into public.chores (title, recurrence) values ('Tirar o pó', 'weekly') returning id into dust;
  perform pg_temp.save_order(dust, array[rita, lia]);
  perform pg_temp.save_turn(dust, null, nina);

  -- Bidu vira pet na vez dele: sai da ordem, e a vez passa.
  update public.people set kind = 'pet', species = 'cachorro' where id = bidu;
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = sweep) = array[nina, teo, beto],
    'a person turned pet leaves the order';
  assert (select kid_id from public.chores where id = sweep) = nina, 'and hands the turn to the next';

  -- Nina é apagada: na vez dela (varrer) e fora da vez (louça).
  delete from public.people where id = nina;
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = sweep) = array[teo, beto],
    'a deleted record leaves the order';
  select * into c from public.chores where id = sweep;
  assert c.kid_id = teo and c.assigned_to is null, 'it was her turn: the turn goes to the next in the order';
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = dishes) = array[rita, lia],
    'she leaves every order';
  assert (select assigned_to from public.chores where id = dishes) = auth.uid(), 'not her turn: the turn stays';
  select * into c from public.chores where id = plain;
  assert c.kid_id is null and c.assigned_to is null, 'a plain chore of hers goes back to anyone, as before';
  -- A chave estrangeira tira a vez dela de um rodízio em que ela não está: o Postgres faz isso como dono da
  -- tabela, não como quem apagou a ficha, e a recusa da gravação direta (NK009) não vale para ela.
  select * into c from public.chores where id = dust;
  assert c.kid_id is null and c.assigned_to is null, 'a rotating chore on her turn, outside the order, goes back to anyone';
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = dust) = array[rita, lia],
    'and keeps its order';
  delete from public.chores where id = dust;

  -- Teo é apagado na vez dele: sobra Beto, o rodízio acaba e a tarefa fica com ele.
  delete from public.people where id = teo;
  assert (select count(*) from public.chore_rotation where chore_id = sweep) = 0, 'with one person left the order is dissolved';
  select * into c from public.chores where id = sweep;
  assert c.assigned_to = '00000000-0000-0000-0000-000000000022' and c.kid_id is null, 'the chore stays with whoever is left';
  assert (select next_person_id from public.complete_chore(sweep, '2026-10-12')) is null, 'it is a plain chore again';
  assert (select assigned_to from public.chores where id = sweep) = '00000000-0000-0000-0000-000000000022', 'of the same person';

  -- Quem sai não estava na vez: a tarefa continua com quem estava.
  perform pg_temp.save_order(sweep, array[lia, beto]);
  assert public.skip_chore_turn(sweep, lia) = beto, 'B is on turn';
  perform set_config('test.r_sweep', sweep::text, false);
  perform set_config('test.r_plain', plain::text, false);
end $$;
-- A linha tirada à mão, como dono (quem mora na casa não apaga da ordem): o gatilho desfaz o rodízio do mesmo jeito.
reset role;
do $$
declare
  sweep uuid := current_setting('test.r_sweep')::uuid;
begin
  delete from public.chore_rotation where chore_id = sweep and person_id = current_setting('test.r_lia')::uuid;
  assert found, 'the owner removed the row';
  assert (select count(*) from public.chore_rotation where chore_id = sweep) = 0, 'a row removed by hand dissolves the order too';
  assert (select assigned_to from public.chores where id = sweep) = '00000000-0000-0000-0000-000000000022', 'the turn stays where it was';
end $$;
set role authenticated;
delete from public.chores where id in (current_setting('test.r_sweep')::uuid, current_setting('test.r_plain')::uuid);

-- A criança da vez ganha conta no app: continua na ordem, agora como
-- moradora, e a próxima conclusão não trava nem pula ninguém.
do $$
declare
  rita uuid := current_setting('test.r_rita')::uuid;
  lia uuid := current_setting('test.r_lia')::uuid;
  dishes uuid := current_setting('test.r_dishes')::uuid;
begin
  -- Ordem da louça: Rita, Lia; a vez é de Rita.
  assert public.skip_chore_turn(dishes, rita) = lia, 'the turn goes to the kid';
  assert (select kid_id from public.chores where id = dishes) = lia, 'kid turn';
end $$;
reset role;
insert into public.household_members (household_id, user_id, display_name) values (:'hh_r', :'user_t', 'Lia');
set role authenticated;
do $$
declare
  rita uuid := current_setting('test.r_rita')::uuid;
  lia uuid := current_setting('test.r_lia')::uuid;
  dishes uuid := current_setting('test.r_dishes')::uuid;
  c public.chores;
  r record;
begin
  assert (select member_user_id from public.people where id = lia) = '00000000-0000-0000-0000-000000000024', 'the kid has an account now';
  select * into c from public.chores where id = dishes;
  assert c.kid_id is null and c.assigned_to = '00000000-0000-0000-0000-000000000024', 'her turn moved to the account';
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = dishes) = array[rita, lia],
    'and she stays in the order';
  select * into r from public.complete_chore(dishes, c.due_on, c.due_on);
  assert r.completed and r.points = 0 and r.person_id is null and r.next_person_id = rita,
    'with an account she earns no points, and the turn passes to the next (nobody skipped)';
  assert public.skip_chore_turn(dishes, rita) = lia, 'the turn comes back to her as a member';
  assert (select assigned_to from public.chores where id = dishes) = '00000000-0000-0000-0000-000000000024', 'in assigned_to';
end $$;

-- O morador sai da casa: a ficha dele fica, sem o app, e ele segue na ordem;
-- se era a vez dele, continua sendo.
do $$
declare
  rita uuid := current_setting('test.r_rita')::uuid;
  beto uuid := current_setting('test.r_beto')::uuid;
  trash uuid := current_setting('test.r_trash')::uuid;
  plain uuid;
  dust uuid;
  c public.chores;
  r record;
begin
  -- Lixo: Rita, Beto, na vez de Beto, que é tirado da casa.
  select * into c from public.chores where id = trash;
  assert c.assigned_to = '00000000-0000-0000-0000-000000000022', 'B is on turn';
  insert into public.chores (title, assigned_to) values ('Tarefa do Beto', '00000000-0000-0000-0000-000000000022') returning id into plain;
  -- E um rodízio sem Beto, na vez dele (o responsável salvo sem mexer na ordem).
  insert into public.chores (title, recurrence) values ('Tirar o pó', 'weekly') returning id into dust;
  perform pg_temp.save_order(dust, array[rita, current_setting('test.r_lia')::uuid]);
  perform pg_temp.save_turn(dust, '00000000-0000-0000-0000-000000000022', null);
  perform public.remove_member(current_setting('test.hh_r')::uuid, '00000000-0000-0000-0000-000000000022');
  assert (select member_user_id from public.people where id = beto) is null, 'the record stays, without the app';
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = trash) = array[rita, beto],
    'who left the household stays in the order';
  select * into c from public.chores where id = trash;
  assert c.assigned_to is null and c.kid_id = beto, 'it was his turn: it still is, as a person without the app';
  select * into c from public.chores where id = plain;
  assert c.assigned_to is null and c.kid_id is null, 'a plain chore of his goes back to anyone, as before';
  -- Pela chave estrangeira, como a ficha apagada: a recusa da gravação direta não segura a saída dele.
  select * into c from public.chores where id = dust;
  assert c.assigned_to is null and c.kid_id is null, 'a rotating chore on his turn, outside the order, goes back to anyone';
  assert (select count(*) from public.chore_rotation where chore_id = dust) = 2, 'and keeps its order';
  delete from public.chores where id = dust;
  select * into r from public.complete_chore(trash, '2026-10-19', '2026-10-19');
  assert r.completed and r.next_person_id = rita, 'the next completion passes the turn on (not stuck)';
  select * into r from public.complete_chore(trash, '2026-10-26', '2026-10-26');
  assert r.completed and r.next_person_id = beto, 'and comes back to him (nobody skipped)';
  assert (select kid_id from public.chores where id = trash) = beto, 'in kid_id now';
  delete from public.chores where id = plain;
end $$;
-- Lia sai sozinha, na vez dela na louça (Rita, Lia).
select set_config('request.jwt.claim.sub', :'user_t', false) \gset
do $$
begin
  assert (select assigned_to from public.chores where id = current_setting('test.r_dishes')::uuid) = auth.uid(), 'L is on turn';
  assert (public.leave_household(current_setting('test.hh_r')::uuid))->>'status' = 'left', 'L left';
end $$;
select set_config('request.jwt.claim.sub', :'user_r', false) \gset
do $$
declare
  rita uuid := current_setting('test.r_rita')::uuid;
  lia uuid := current_setting('test.r_lia')::uuid;
  dishes uuid := current_setting('test.r_dishes')::uuid;
  c public.chores;
  r record;
begin
  select * into c from public.chores where id = dishes;
  assert c.assigned_to is null and c.kid_id = lia, 'leaving on her turn keeps the turn, as a person without the app';
  select * into r from public.complete_chore(dishes, c.due_on, c.due_on);
  assert r.completed and r.points = 10 and r.person_id = lia and r.next_person_id = rita,
    'without the app she earns the points again, and the turn passes';
end $$;
-- Apagar a casa com rodízios dentro não esbarra em nada, nem com uma vez que
-- acabou de passar para a moradora que sai por último.
do $$
begin
  assert public.skip_chore_turn(current_setting('test.r_trash')::uuid, current_setting('test.r_beto')::uuid)
    = current_setting('test.r_rita')::uuid, 'R is on turn';
  assert (public.leave_household(current_setting('test.hh_r')::uuid, true))->>'status' = 'deleted', 'R closed the household';
end $$;
reset role;
do $$
begin
  assert not exists (select 1 from public.chore_rotation), 'the orders left with the household';
  -- As permissões da tabela são explícitas: não dependem do padrão do projeto. Um verbo de cada vez:
  -- has_table_privilege com uma lista ("insert, update") é verdadeira quando qualquer um deles vale.
  assert not exists (
    select 1 from unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) as verb
    where has_table_privilege('anon', 'public.chore_rotation', verb)
  ), 'anon has no access to chore_rotation';
  assert has_table_privilege('authenticated', 'public.chore_rotation', 'select'), 'members read chore_rotation through the API';
  assert not has_table_privilege('authenticated', 'public.chore_rotation', 'insert'), 'members cannot insert into chore_rotation';
  assert not has_table_privilege('authenticated', 'public.chore_rotation', 'update'), 'members cannot update chore_rotation';
  assert not has_table_privilege('authenticated', 'public.chore_rotation', 'delete'), 'members cannot delete from chore_rotation';
  assert not has_table_privilege('authenticated', 'public.chore_rotation', 'truncate'), 'members cannot truncate chore_rotation';
  assert not exists (
    select 1 from unnest(array['references', 'trigger']) as verb
    where has_table_privilege('authenticated', 'public.chore_rotation', verb)
  ), 'and members get nothing beyond reading chore_rotation';
  assert (select bool_and(has_table_privilege('service_role', 'public.chore_rotation', verb))
            from unnest(array['select', 'insert', 'update', 'delete']) as verb),
    'the service role keeps full access to chore_rotation';
  assert (select array_agg(cmd::text) from pg_policies where schemaname = 'public' and tablename = 'chore_rotation') = array['SELECT'],
    'the only policy on chore_rotation is for reading';
  delete from public.household_file_cleanup where household_id = current_setting('test.hh_r')::uuid;
end $$;

\echo 'OK — todos os testes do banco passaram'
