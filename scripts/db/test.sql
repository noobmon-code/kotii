-- Testes do schema: isolamento entre famílias (RLS), matching, preços,
-- confirmação de nota, recorrência e rodízio de tarefas, remédios, saúde,
-- aparelhos, documentos, prestadores e consertos, financeiro, saída da casa,
-- compromissos da família, preços compartilhados entre casas, estoque dos
-- remédios, idas ao mercado e aceite dos termos.
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
\echo '• prestadores e consertos'
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  eq uuid;
  ze uuid;
  bia uuid;
  j uuid;
begin
  insert into public.equipment (name, category) values ('Máquina de lavar', 'eletrodomestico') returning id into eq;
  insert into public.service_providers (name, trade, phone, phone_digits, notes)
    values ('Zé da Luz', 'eletricista', '(11) 98765-4321', '5511987654321', 'Só atende de manhã')
    returning id into ze;
  insert into public.service_providers (name) values ('Bia') returning id into bia;
  assert (select trade = 'outros' and recommended and phone is null and phone_digits is null
      and created_by = auth.uid() and household_id = current_setting('test.hh_a')::uuid
    from public.service_providers where id = bia), 'provider defaults';
  insert into public.service_jobs (provider_id, equipment_id, done_on, description, amount, warranty_until, notes)
    values (ze, eq, '2026-03-12', 'Trocou a placa', 180, '2026-06-12', 'Peça original') returning id into j;
  assert (select created_by = auth.uid() and household_id = current_setting('test.hh_a')::uuid
    from public.service_jobs where id = j), 'job defaults';
  -- Não cobrou, e a garantia pode acabar no próprio dia.
  insert into public.service_jobs (provider_id, done_on, description, amount, warranty_until)
    values (ze, '2026-03-20', 'Voltou para apertar', 0, '2026-03-20');
  insert into public.service_jobs (provider_id, done_on, description) values (bia, '2026-05-02', 'Faxina completa');
  perform set_config('test.equipment_wash', eq::text, false);
  perform set_config('test.provider_ze', ze::text, false);
  perform set_config('test.provider_bia', bia::text, false);
  perform set_config('test.job_ze', j::text, false);

  begin
    insert into public.service_providers (name) values ('   ');
    raise exception 'FAIL: blank provider name';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_providers (name) values (repeat('a', 81));
    raise exception 'FAIL: provider name over 80';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_providers (name, trade) values ('X', 'astronauta');
    raise exception 'FAIL: invalid trade';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_providers (name, phone) values ('X', repeat('1', 41));
    raise exception 'FAIL: phone over 40';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_providers (name, phone) values ('X', '  ');
    raise exception 'FAIL: blank phone';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_providers (name, phone, phone_digits) values ('X', '(11) 98765-4321', '(11) 98765-4321');
    raise exception 'FAIL: phone_digits with punctuation';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_providers (name, phone, phone_digits) values ('X', '1234567', '1234567');
    raise exception 'FAIL: phone_digits too short';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_providers (name, phone, phone_digits) values ('X', repeat('1', 16), repeat('1', 16));
    raise exception 'FAIL: phone_digits too long';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_providers (name, phone_digits) values ('X', '5511987654321');
    raise exception 'FAIL: phone_digits without a phone';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_providers (name, notes) values ('X', repeat('a', 501));
    raise exception 'FAIL: provider notes over 500';
  exception when check_violation then null;
  end;

  begin
    insert into public.service_jobs (done_on, description) values ('2026-03-12', 'Sem prestador');
    raise exception 'FAIL: job without a provider';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.service_jobs (provider_id, description) values (ze, 'Sem data');
    raise exception 'FAIL: job without a date';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.service_jobs (provider_id, done_on, description) values (ze, '2026-03-12', '  ');
    raise exception 'FAIL: blank job description';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_jobs (provider_id, done_on, description) values (ze, '2026-03-12', repeat('a', 201));
    raise exception 'FAIL: job description over 200';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_jobs (provider_id, done_on, description, amount) values (ze, '2026-03-12', 'X', -1);
    raise exception 'FAIL: negative job amount';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_jobs (provider_id, done_on, description, warranty_until)
      values (ze, '2026-03-12', 'X', '2026-03-11');
    raise exception 'FAIL: service warranty before the service';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_jobs (provider_id, done_on, description, notes) values (ze, '2026-03-12', 'X', repeat('a', 501));
    raise exception 'FAIL: job notes over 500';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_jobs (provider_id, done_on, description) values (gen_random_uuid(), '2026-03-12', 'X');
    raise exception 'FAIL: job for a provider that does not exist';
  exception when foreign_key_violation then null;
  end;
  -- NaN passaria num ">= 0" sozinho (para o Postgres ele é maior que tudo); o teto o recusa.
  begin
    insert into public.service_jobs (provider_id, done_on, description, amount) values (ze, '2026-03-12', 'X', 'NaN');
    raise exception 'FAIL: NaN job amount';
  exception when check_violation then null;
  end;
  -- Datas de 2000 a 2100: 'infinity', um ano a mais ou a menos não entram, na data nem na garantia.
  begin
    insert into public.service_jobs (provider_id, done_on, description) values (ze, 'infinity', 'X');
    raise exception 'FAIL: job done on infinity';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_jobs (provider_id, done_on, description, warranty_until) values (ze, '-infinity', 'X', '1900-01-01');
    raise exception 'FAIL: job done on -infinity';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_jobs (provider_id, done_on, description) values (ze, '2101-01-01', 'X');
    raise exception 'FAIL: job done in 2101';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_jobs (provider_id, done_on, description) values (ze, '1999-12-31', 'X');
    raise exception 'FAIL: job done in 1999';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_jobs (provider_id, done_on, description, warranty_until) values (ze, '2026-03-12', 'X', 'infinity');
    raise exception 'FAIL: service warranty until infinity';
  exception when check_violation then null;
  end;
  begin
    insert into public.service_jobs (provider_id, done_on, description, warranty_until) values (ze, '2026-03-12', 'X', '2101-01-01');
    raise exception 'FAIL: service warranty until 2101';
  exception when check_violation then null;
  end;
  -- Os limites valem (o maior valor e as duas pontas das datas). Desfeito no fim: os testes seguintes contam os serviços.
  begin
    insert into public.service_jobs (provider_id, done_on, description, amount, warranty_until)
      values (ze, '2000-01-01', 'X', 9999999999.99, '2100-12-31');
    insert into public.service_jobs (provider_id, done_on, description, amount) values (ze, '2100-12-31', 'X', 0);
    raise exception 'undo' using errcode = 'KT001';
  exception when sqlstate 'KT001' then null;
  end;
end $$;

-- Quem mora na mesma casa vê e muda tudo.
select set_config('request.jwt.claim.sub', :'user_b', false) \gset
do $$
begin
  assert (select count(*) from public.service_providers) = 2, 'B sees the household providers';
  assert (select count(*) from public.service_jobs) = 3, 'B sees the household jobs';
  update public.service_providers set recommended = false where id = current_setting('test.provider_bia')::uuid;
  assert found, 'B edits a household provider';
  insert into public.service_jobs (provider_id, done_on, description)
    values (current_setting('test.provider_bia')::uuid, '2026-05-09', 'Faxina leve');
end $$;

-- Outra casa não lê nem escreve, e não liga um serviço a prestador ou aparelho daqui.
select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
declare
  own uuid;
  own_eq uuid;
begin
  assert (select count(*) from public.service_providers) = 0, 'C sees no foreign providers';
  assert (select count(*) from public.service_jobs) = 0, 'C sees no foreign jobs';

  update public.service_providers set name = 'Hack' where id = current_setting('test.provider_ze')::uuid;
  assert not found, 'C cannot edit a foreign provider';
  delete from public.service_providers where id = current_setting('test.provider_ze')::uuid;
  assert not found, 'C cannot delete a foreign provider';
  update public.service_jobs set description = 'Hack' where id = current_setting('test.job_ze')::uuid;
  assert not found, 'C cannot edit a foreign job';
  delete from public.service_jobs where id = current_setting('test.job_ze')::uuid;
  assert not found, 'C cannot delete a foreign job';

  begin
    insert into public.service_providers (household_id, name) values (current_setting('test.hh_a')::uuid, 'Intruso');
    raise exception 'FAIL: C created a provider in another household';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.service_jobs (household_id, provider_id, done_on, description)
      values (current_setting('test.hh_a')::uuid, current_setting('test.provider_ze')::uuid, '2026-03-12', 'Intruso');
    raise exception 'FAIL: C created a job in another household';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.service_jobs (provider_id, done_on, description)
      values (current_setting('test.provider_ze')::uuid, '2026-03-12', 'X');
    raise exception 'FAIL: job for a foreign provider';
  exception when foreign_key_violation then null;
  end;

  insert into public.service_providers (name, trade) values ('Caio Encanador', 'encanador') returning id into own;
  insert into public.equipment (name) values ('Aquecedor') returning id into own_eq;
  begin
    insert into public.service_jobs (provider_id, equipment_id, done_on, description)
      values (own, current_setting('test.equipment_wash')::uuid, '2026-03-12', 'X');
    raise exception 'FAIL: job on foreign equipment';
  exception when foreign_key_violation then null;
  end;
  insert into public.service_jobs (provider_id, equipment_id, done_on, description, amount)
    values (own, own_eq, '2026-04-01', 'Trocou o registro', 90);
  perform set_config('test.provider_c', own::text, false);
  perform set_config('test.equipment_c', own_eq::text, false);
end $$;

-- As permissões são as escritas na migração, não as do padrão do projeto (que
-- nos stubs dá tudo a todos, como o Supabase fazia até 30/10/2026): quem não
-- entrou não tem nenhuma; quem entrou e a chave de serviço leem e gravam. Uma
-- de cada vez: com várias na mesma pergunta, has_table_privilege responde que
-- sim quando QUALQUER uma delas existe.
do $$
declare
  t text;
  p text;
begin
  foreach t in array array['public.service_providers', 'public.service_jobs'] loop
    foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      assert not has_table_privilege('anon', t, p), format('anon must not have %s on %s', p, t);
    end loop;
    foreach p in array array['select', 'insert', 'update', 'delete'] loop
      assert has_table_privilege('authenticated', t, p), format('authenticated must have %s on %s', p, t);
      assert has_table_privilege('service_role', t, p), format('service_role must have %s on %s', p, t);
    end loop;
    foreach p in array array['truncate', 'references', 'trigger'] loop
      assert not has_table_privilege('authenticated', t, p), format('authenticated must not have %s on %s', p, t);
    end loop;
  end loop;
end $$;

-- E na prática: sem entrar, nem a leitura passa da porta.
set role anon;
do $$
begin
  begin
    perform count(*) from public.service_providers;
    raise exception 'FAIL: anon read the providers';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.service_jobs;
    raise exception 'FAIL: anon read the jobs';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.service_providers (household_id, name) values (current_setting('test.hh_a')::uuid, 'Anon');
    raise exception 'FAIL: anon created a provider';
  exception when insufficient_privilege then null;
  end;
end $$;
set role authenticated;

select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
begin
  assert (select count(*) from public.service_providers) = 2, 'A still sees only its own providers';
  -- Um serviço não muda para o prestador nem para o aparelho de outra casa.
  begin
    update public.service_jobs set provider_id = current_setting('test.provider_c')::uuid
      where id = current_setting('test.job_ze')::uuid;
    raise exception 'FAIL: job moved to a foreign provider';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.service_jobs set equipment_id = current_setting('test.equipment_c')::uuid
      where id = current_setting('test.job_ze')::uuid;
    raise exception 'FAIL: job moved to foreign equipment';
  exception when foreign_key_violation then null;
  end;

  -- Aparelho apagado: o serviço fica no histórico de quem fez, sem o aparelho.
  delete from public.equipment where id = current_setting('test.equipment_wash')::uuid;
  assert (select equipment_id is null and household_id = current_setting('test.hh_a')::uuid and provider_id is not null
    from public.service_jobs where id = current_setting('test.job_ze')::uuid), 'deleting the equipment keeps the job';

  -- Prestador apagado: o histórico dele vai junto; o dos outros fica.
  delete from public.service_providers where id = current_setting('test.provider_ze')::uuid;
  assert (select count(*) from public.service_jobs where provider_id = current_setting('test.provider_ze')::uuid) = 0, 'jobs go with the provider';
  assert (select count(*) from public.service_jobs) = 2, 'the other provider keeps its jobs';
end $$;

-- Excluir pelo app: delete_service_provider confere, com o prestador travado, o número de serviços que a pessoa
-- leu na pergunta. Outro aparelho registrou um serviço depois dela (ou apagou um): nada é apagado (NK010).
do $$
declare
  lu uuid;
  confirmed integer;
begin
  insert into public.service_providers (name, trade) values ('Lu Jardins', 'jardineiro') returning id into lu;
  insert into public.service_jobs (provider_id, done_on, description) values (lu, '2026-04-01', 'Podou as árvores');
  insert into public.service_jobs (provider_id, done_on, description) values (lu, '2026-05-01', 'Cortou a grama');
  foreach confirmed in array array[0, 1, 3] loop
    begin
      perform public.delete_service_provider(lu, confirmed);
      raise exception 'FAIL: provider deleted with % jobs confirmed and 2 registered', confirmed;
    exception when sqlstate 'NK010' then null;
    end;
    assert exists (select 1 from public.service_providers where id = lu), format('the provider stays (%s confirmed)', confirmed);
    assert (select count(*) from public.service_jobs where provider_id = lu) = 2, format('and its jobs (%s confirmed)', confirmed);
  end loop;
  -- O número certo: o prestador e o histórico dele vão.
  assert public.delete_service_provider(lu, 2), 'deleted with the right count';
  assert not exists (select 1 from public.service_providers where id = lu), 'the provider is gone';
  assert (select count(*) from public.service_jobs where provider_id = lu) = 0, 'and its jobs';
  -- Outro aparelho já tinha excluído: não encontrado, sem erro e sem apagar nada.
  assert not public.delete_service_provider(lu, 0), 'a provider that is gone is not found';
  assert not public.delete_service_provider(gen_random_uuid(), null), 'nor one that never existed';
  -- Sem o número, a pergunta falou do histórico todo: vai o que houver.
  insert into public.service_providers (name) values ('Rafa Pinturas') returning id into lu;
  insert into public.service_jobs (provider_id, done_on, description) values (lu, '2026-06-01', 'Pintou a sala');
  assert public.delete_service_provider(lu, null), 'deleted without a count';
  assert not exists (select 1 from public.service_providers where id = lu), 'the provider is gone';
  assert (select count(*) from public.service_jobs where provider_id = lu) = 0, 'and its jobs';
  assert (select count(*) from public.service_jobs) = 2, 'the other provider keeps its jobs';
  perform set_config('test.provider_bia_jobs', (select count(*) from public.service_jobs where provider_id = current_setting('test.provider_bia')::uuid)::text, false);
end $$;

-- Prestador de outra casa: a função não o encontra, nem com o número certo, e não apaga nada.
select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  assert not public.delete_service_provider(current_setting('test.provider_bia')::uuid, current_setting('test.provider_bia_jobs')::integer),
    'C cannot delete a foreign provider with the right count';
  assert not public.delete_service_provider(current_setting('test.provider_bia')::uuid, null), 'nor without a count';
end $$;
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
begin
  assert exists (select 1 from public.service_providers where id = current_setting('test.provider_bia')::uuid), 'the provider of A stays';
  assert (select count(*) from public.service_jobs where provider_id = current_setting('test.provider_bia')::uuid)
    = current_setting('test.provider_bia_jobs')::integer, 'with its jobs';
  -- Só quem entrou chama a função: cada papel conferido sozinho.
  assert has_function_privilege('authenticated', 'public.delete_service_provider(uuid, integer)', 'execute'), 'members delete a provider';
  assert not has_function_privilege('anon', 'public.delete_service_provider(uuid, integer)', 'execute'), 'anon does not';
  assert not has_function_privilege('public', 'public.delete_service_provider(uuid, integer)', 'execute'), 'nor everyone (PUBLIC)';
end $$;
set role anon;
do $$
begin
  perform public.delete_service_provider(current_setting('test.provider_bia')::uuid, null);
  raise exception 'FAIL: anon deleted a provider';
exception when insufficient_privilege then null;
end $$;
set role authenticated;

-- Apagar a casa leva prestadores e serviços (aparelho, prestador e casa
-- apagados na mesma hora, cada um por um caminho). Desfeito no fim: a casa C
-- continua nos testes seguintes.
reset role;
do $$
begin
  assert (select count(*) from public.service_jobs where provider_id = current_setting('test.provider_c')::uuid) = 1, 'C has a job';
  begin
    delete from public.households where id = (
      select household_id from public.service_providers where id = current_setting('test.provider_c')::uuid
    );
    assert not exists (select 1 from public.service_providers where id = current_setting('test.provider_c')::uuid), 'providers go with the household';
    assert not exists (select 1 from public.service_jobs where provider_id = current_setting('test.provider_c')::uuid), 'jobs go with the household';
    assert (select count(*) from public.service_providers) = 1, 'the other household keeps its providers';
    raise exception 'undo' using errcode = 'KT001';
  exception when sqlstate 'KT001' then null;
  end;
  assert (select count(*) from public.service_providers) = 2, 'household deletion undone';
  -- Os testes seguintes contam aparelhos e gastos: nada daqui fica para trás.
  delete from public.service_providers;
  delete from public.equipment where id = current_setting('test.equipment_c')::uuid;
end $$;
set role authenticated;

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

\echo '• gás, água e ração: reposições e trocas'
-- Os privilégios vêm da própria migração, e não do padrão do projeto (que o
-- Supabase deixa de aplicar a tabela nova em 30/10/2026). Um por um: com uma
-- lista separada por vírgula, has_table_privilege responde verdadeiro se o
-- papel tiver QUALQUER um deles.
do $$
declare
  t text;
  p text;
begin
  foreach t in array array['public.supplies', 'public.supply_refills'] loop
    foreach p in array array['select', 'insert', 'update', 'delete', 'truncate'] loop
      assert not has_table_privilege('anon', t, p), format('anon must not have %s on %s', p, t);
    end loop;
    foreach p in array array['select', 'insert', 'update', 'delete'] loop
      assert has_table_privilege('authenticated', t, p), format('authenticated needs %s on %s', p, t);
      assert has_table_privilege('service_role', t, p), format('service_role needs %s on %s', p, t);
    end loop;
    foreach p in array array['truncate', 'references', 'trigger'] loop
      assert not has_table_privilege('authenticated', t, p), format('authenticated must not have %s on %s', p, t);
    end loop;
  end loop;
end $$;
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
declare
  gas uuid;
  n integer;
begin
  insert into public.supplies (name, kind, typical_days, notes)
    values ('Gás de cozinha', 'gas', 45, 'Disk gás: 3333-0000') returning id into gas;
  perform set_config('test.supply_a', gas::text, false);
  assert (select household_id from public.supplies where id = gas) = current_setting('test.hh_a')::uuid, 'the supply belongs to the open household';
  assert (select created_by from public.supplies where id = gas) = auth.uid(), 'and records who created it';
  insert into public.supply_refills (supply_id, refilled_on) values (gas, '2026-08-19'), (gas, '2026-10-03');

  -- "Troquei hoje" duas vezes no mesmo dia é a mesma troca: o app grava com
  -- on conflict do nothing (upsert com ignoreDuplicates), sem erro e sem linha nova.
  insert into public.supply_refills (supply_id, refilled_on) values (gas, '2026-10-03')
    on conflict (supply_id, refilled_on) do nothing;
  get diagnostics n = row_count;
  assert n = 0, 'the second tap on the same day writes nothing';
  assert (select count(*) from public.supply_refills where supply_id = gas) = 2, 'one refill per supply per day';
  begin
    insert into public.supply_refills (supply_id, refilled_on) values (gas, '2026-10-03');
    raise exception 'FAIL: two refills on the same day';
  exception when unique_violation then null;
  end;

  begin
    insert into public.supplies (name, kind) values ('   ', 'gas');
    raise exception 'FAIL: empty supply name';
  exception when check_violation then null;
  end;
  begin
    insert into public.supplies (name, kind) values (repeat('x', 61), 'gas');
    raise exception 'FAIL: supply name over 60';
  exception when check_violation then null;
  end;
  begin
    insert into public.supplies (name, kind) values ('Lenha', 'lenha');
    raise exception 'FAIL: unknown supply kind';
  exception when check_violation then null;
  end;
  begin
    insert into public.supplies (name, kind, typical_days) values ('Gás', 'gas', 0);
    raise exception 'FAIL: zero typical days';
  exception when check_violation then null;
  end;
  begin
    insert into public.supplies (name, kind, typical_days) values ('Gás', 'gas', 731);
    raise exception 'FAIL: typical days over two years';
  exception when check_violation then null;
  end;
  begin
    insert into public.supplies (name, kind, notes) values ('Gás', 'gas', repeat('x', 201));
    raise exception 'FAIL: notes over 200';
  exception when check_violation then null;
  end;
  begin
    insert into public.supply_refills (supply_id, refilled_on) values (gas, '1999-12-31');
    raise exception 'FAIL: refill before 2000';
  exception when check_violation then null;
  end;
  begin
    insert into public.supply_refills (supply_id, refilled_on) values (gas, '2101-01-01');
    raise exception 'FAIL: refill after 2100';
  exception when check_violation then null;
  end;
  -- Os limites em si passam: nome de 60, 730 dias, observação de 200, tipo padrão.
  insert into public.supplies (name, typical_days, notes) values (repeat('x', 60), 730, repeat('x', 200));
  assert (select kind from public.supplies where name = repeat('x', 60)) = 'outros', 'kind defaults to outros';
  delete from public.supplies where name = repeat('x', 60);
end $$;
select set_config('request.jwt.claim.sub', :'user_b', false) \gset
do $$
begin
  assert (select count(*) from public.supplies) = 1, 'B sees the household supplies';
  insert into public.supply_refills (supply_id, refilled_on) values (current_setting('test.supply_a')::uuid, '2026-10-10');
  assert (select count(*) from public.supply_refills) = 3, 'any member records a refill';
end $$;
select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
declare
  own uuid;
begin
  assert (select count(*) from public.supplies) = 0, 'C sees no foreign supplies';
  assert (select count(*) from public.supply_refills) = 0, 'C sees no foreign refills';
  update public.supplies set name = 'Invadido';
  delete from public.supply_refills;
  delete from public.supplies;

  begin
    insert into public.supplies (household_id, name, kind) values (current_setting('test.hh_a')::uuid, 'Invasor', 'gas');
    raise exception 'FAIL: cross-household supply';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.supply_refills (household_id, supply_id, refilled_on)
      values (current_setting('test.hh_a')::uuid, current_setting('test.supply_a')::uuid, '2026-10-05');
    raise exception 'FAIL: cross-household refill';
  exception when insufficient_privilege then null;
  end;
  -- Na própria casa, a troca não aponta para a reposição de outra.
  begin
    insert into public.supply_refills (supply_id, refilled_on) values (current_setting('test.supply_a')::uuid, '2026-10-05');
    raise exception 'FAIL: refill attached to a foreign supply';
  exception when foreign_key_violation then null;
  end;
  insert into public.supplies (name, kind) values ('Galão de água', 'agua') returning id into own;
  insert into public.supply_refills (supply_id, refilled_on) values (own, '2026-10-01');
  begin
    update public.supply_refills set supply_id = current_setting('test.supply_a')::uuid where supply_id = own;
    raise exception 'FAIL: refill moved to a foreign supply';
  exception when foreign_key_violation then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', :'user_a', false) \gset
do $$
begin
  assert (select name from public.supplies) = 'Gás de cozinha', 'A keeps the supply, untouched by C';
  assert (select array_agg(refilled_on order by refilled_on) from public.supply_refills)
    = array['2026-08-19', '2026-10-03', '2026-10-10']::date[], 'and its refills';
  -- Troca anotada por engano sai sozinha; excluir a reposição leva o histórico junto.
  delete from public.supply_refills where refilled_on = '2026-10-10';
  assert (select count(*) from public.supply_refills) = 2, 'one refill deleted';
  delete from public.supplies where id = current_setting('test.supply_a')::uuid;
  assert (select count(*) from public.supply_refills) = 0, 'deleting the supply removes its refills';
end $$;
select set_config('request.jwt.claim.sub', :'user_c', false) \gset
do $$
begin
  assert (select count(*) from public.supply_refills) = 1, 'C keeps its own refill';
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
\echo '• juntar produtos: tudo passa para o que fica, e "São diferentes" fica guardado'
-- Paula e Quim moram juntos; Rita mora em outra casa.
\set user_p '00000000-0000-0000-0000-000000000021'
\set user_q '00000000-0000-0000-0000-000000000022'
\set user_r '00000000-0000-0000-0000-000000000023'
reset role;
insert into auth.users (id) values (:'user_p'), (:'user_q'), (:'user_r');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
select (public.create_household('Casa da Paula', 'Paula')).invite_code as invite_p \gset
select set_config('request.jwt.claim.sub', :'user_q', false) \gset
select public.join_household(:'invite_p', 'Quim') \gset
select set_config('request.jwt.claim.sub', :'user_r', false) \gset
select (public.create_household('Casa da Rita', 'Rita')).id as hh_r \gset
select set_config('test.hh_r', :'hh_r', false) \gset
do $$
declare
  p uuid;
begin
  insert into public.products (name, category) values ('Arroz', 'graos') returning id into p;
  insert into public.list_item_links (name_key, product_id) values ('arroz', p);
  perform set_config('test.mp_rita', p::text, false);
end $$;
reset role;
select id as hh_p from public.households where name = 'Casa da Paula' \gset
select set_config('test.hh_p', :'hh_p', false) \gset

-- As permissões que a migração escreve. Conferidas duas vezes: como a migração as deixou e depois de rodar
-- de novo as partes dela que podem rodar de novo (os revoke e grant), que precisam dar no mesmo.
create function pg_temp.merge_products_access() returns void language plpgsql as $$
begin
  -- Cada permissão conferida sozinha: com uma lista, has_table_privilege é verdadeiro se qualquer uma existir.
  assert has_table_privilege('authenticated', 'public.product_distinct_pairs', 'select'), 'members read the pairs';
  assert has_table_privilege('authenticated', 'public.product_distinct_pairs', 'insert'), 'members add a pair';
  assert has_table_privilege('authenticated', 'public.product_distinct_pairs', 'delete'), 'members remove a pair';
  assert not has_table_privilege('authenticated', 'public.product_distinct_pairs', 'update'), 'a pair is never edited';
  assert not has_table_privilege('authenticated', 'public.product_distinct_pairs', 'truncate'), 'members do not truncate the pairs';
  assert not has_table_privilege('authenticated', 'public.product_distinct_pairs', 'references'), 'members get no references on the pairs';
  assert not has_table_privilege('authenticated', 'public.product_distinct_pairs', 'trigger'), 'members get no trigger on the pairs';
  assert not has_table_privilege('anon', 'public.product_distinct_pairs', 'select'), 'anon does not read the pairs';
  assert not has_table_privilege('anon', 'public.product_distinct_pairs', 'insert'), 'anon does not add a pair';
  assert not has_table_privilege('anon', 'public.product_distinct_pairs', 'update'), 'anon does not edit a pair';
  assert not has_table_privilege('anon', 'public.product_distinct_pairs', 'delete'), 'anon does not remove a pair';
  assert not has_table_privilege('anon', 'public.product_distinct_pairs', 'truncate'), 'anon does not truncate the pairs';
  assert has_table_privilege('service_role', 'public.product_distinct_pairs', 'select'), 'the service role reads the pairs';
  assert has_table_privilege('service_role', 'public.product_distinct_pairs', 'insert'), 'the service role adds a pair';
  assert has_table_privilege('service_role', 'public.product_distinct_pairs', 'update'), 'the service role edits a pair';
  assert has_table_privilege('service_role', 'public.product_distinct_pairs', 'delete'), 'the service role removes a pair';
  -- O histórico de compras: só o produto da linha pode mudar.
  assert not has_table_privilege('authenticated', 'public.purchase_history', 'update'), 'members do not edit the purchase history';
  assert has_column_privilege('authenticated', 'public.purchase_history', 'product_id', 'update'), 'except the product of a row';
  assert not has_column_privilege('authenticated', 'public.purchase_history', 'name', 'update'), 'the name of a purchase stays';
  assert not has_column_privilege('authenticated', 'public.purchase_history', 'quantity', 'update'), 'and its quantity';
  assert not has_column_privilege('authenticated', 'public.purchase_history', 'bought_at', 'update'), 'and its date';
  assert not has_column_privilege('authenticated', 'public.purchase_history', 'household_id', 'update'), 'and its household';
  assert has_table_privilege('authenticated', 'public.purchase_history', 'select'), 'members still read the purchase history';
  assert has_table_privilege('authenticated', 'public.purchase_history', 'delete'), 'and still forget a purchase';
  -- A função de juntar, na assinatura com os nomes que a pessoa confirmou: cada papel conferido sozinho.
  assert has_function_privilege('authenticated', 'public.merge_products(uuid, uuid, text, text)', 'execute'), 'members merge products';
  assert not has_function_privilege('anon', 'public.merge_products(uuid, uuid, text, text)', 'execute'), 'anon does not';
  assert not has_function_privilege('public', 'public.merge_products(uuid, uuid, text, text)', 'execute'), 'nor everyone (PUBLIC)';
  -- Uma função só: a assinatura sem os nomes não existe (quem chama sem eles cai nesta, pelos padrões).
  assert to_regprocedure('public.merge_products(uuid, uuid)') is null, 'the two-argument signature is gone';
  assert (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'merge_products') = 1,
    'one merge_products only';
  -- Toda tabela que aponta para products está em merge_products: uma nova precisa entrar lá, senão o
  -- produto apagado levaria (cascade) ou soltaria (set null) as linhas dela.
  assert (
    select array_agg(distinct t.relname::text order by t.relname::text)
    from pg_constraint c join pg_class t on t.oid = c.conrelid
    where c.contype = 'f' and c.confrelid = 'public.products'::regclass
  ) = array['list_item_links', 'pantry_items', 'product_aliases', 'product_barcodes', 'product_distinct_pairs',
            'product_store_codes', 'purchase_history', 'receipt_items', 'shopping_list_items'],
    'a table that references products must be handled in merge_products';
end $$;
select pg_temp.merge_products_access() \gset
revoke all on public.product_distinct_pairs from anon, authenticated;
grant select, insert, delete on public.product_distinct_pairs to authenticated;
grant all on public.product_distinct_pairs to service_role;
revoke update on public.purchase_history from authenticated;
grant update (product_id) on public.purchase_history to authenticated;
revoke execute on function public.merge_products(uuid, uuid, text, text) from public, anon;
grant execute on function public.merge_products(uuid, uuid, text, text) to authenticated;
select pg_temp.merge_products_access() \gset

-- Tudo o que juntar mexeria nos dois produtos, como quem chama vê: as linhas deles e o que aponta para cada
-- um. Depois de uma recusa, tem de estar igual ao que era.
create function pg_temp.merge_products_state(p_keep uuid, p_gone uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'products', (select jsonb_agg(to_jsonb(p) order by p.id) from public.products p where p.id in (p_keep, p_gone)),
    'receipt_items', (select jsonb_agg(to_jsonb(i) order by i.id) from public.receipt_items i where i.product_id in (p_keep, p_gone)),
    'pantry_items', (select jsonb_agg(to_jsonb(i) order by i.id) from public.pantry_items i where i.product_id in (p_keep, p_gone)),
    'list_items', (select jsonb_agg(to_jsonb(i) order by i.id) from public.shopping_list_items i where i.product_id in (p_keep, p_gone)),
    'purchase_history', (select jsonb_agg(to_jsonb(h) order by h.id) from public.purchase_history h where h.product_id in (p_keep, p_gone)),
    'prices', (select jsonb_agg(to_jsonb(o) order by o.product_id, o.receipt_id, o.unit_price)
      from public.price_observations o where o.product_id in (p_keep, p_gone)),
    'latest_prices', (select jsonb_agg(to_jsonb(l) order by l.product_id, l.store_id, l.unit)
      from public.latest_prices l where l.product_id in (p_keep, p_gone)),
    'aliases', (select jsonb_agg(to_jsonb(a) order by a.alias) from public.product_aliases a where a.product_id in (p_keep, p_gone)),
    'links', (select jsonb_agg(to_jsonb(k) order by k.name_key, k.product_id) from public.list_item_links k where k.product_id in (p_keep, p_gone)),
    'pairs', (select jsonb_agg(to_jsonb(d) order by d.product_a, d.product_b)
      from public.product_distinct_pairs d where d.product_a in (p_keep, p_gone) or d.product_b in (p_keep, p_gone))
  );
$$;

-- Paula tem o mesmo arroz com dois nomes, e cada um espalhado por todas as tabelas.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
do $$
declare
  s_assai uuid;
  s_bom uuid;
  r uuid;
  i uuid;
  l uuid;
  l_old uuid;
  p_keep uuid;
  p_gone uuid;
  p_integral uuid;
  p_parbo uuid;
  ids uuid[];
  tokens uuid[];
begin
  insert into public.stores (name) values ('Assaí') returning id into s_assai;
  insert into public.stores (name) values ('Mercado Bom') returning id into s_bom;

  -- "Arroz Tio João 5 kg": uma compra no Assaí, com a validade aprendida.
  insert into public.receipts (store_id, purchased_at, source) values (s_assai, '2026-10-01 10:00-03', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, quantity, unit, unit_price, total_price)
    values (r, 'ARROZ T.JOAO 5KG', 1, 'un', 27.50, 27.50) returning id into i;
  perform public.confirm_receipt(r, jsonb_build_array(jsonb_build_object('id', i,
    'new_product', jsonb_build_object('name', 'Arroz Tio João 5 kg', 'category', 'graos'),
    'pantry', jsonb_build_object('category', 'graos', 'purchased_on', '2026-10-01', 'expires_on', '2027-04-01', 'expiry_source', 'manual'))));
  select id into p_keep from public.products where name = 'Arroz Tio João 5 kg';

  -- "Arroz 5kg": duas compras (Mercado Bom e, depois, mais barato no Assaí) e um rascunho de nota.
  insert into public.receipts (store_id, purchased_at, source) values (s_bom, '2026-10-05 10:00-03', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, quantity, unit, unit_price, total_price)
    values (r, 'ARROZ 5KG', 1, 'un', 25.90, 25.90) returning id into i;
  perform public.confirm_receipt(r, jsonb_build_array(jsonb_build_object('id', i,
    'new_product', jsonb_build_object('name', 'Arroz 5kg', 'category', 'mercearia'),
    'pantry', jsonb_build_object('category', 'mercearia', 'purchased_on', '2026-10-05', 'expires_on', '2027-01-05', 'expiry_source', 'categoria'))));
  select id into p_gone from public.products where name = 'Arroz 5kg';
  update public.products set shelf_life_days = 90 where id = p_gone;
  insert into public.receipts (store_id, purchased_at, source) values (s_assai, '2026-10-10 10:00-03', 'manual') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, quantity, unit, unit_price, total_price)
    values (r, 'ARROZ BRANCO 5KG', 2, 'un', 24.90, 49.80) returning id into i;
  perform public.confirm_receipt(r, jsonb_build_array(jsonb_build_object('id', i, 'product_id', p_gone)));
  insert into public.receipts (store_id, status) values (s_bom, 'draft') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, unit_price, total_price, product_id) values (r, 'ARROZ 5KG', 26, 26, p_gone);

  -- Despensa: além do item aberto que veio da nota, um já consumido.
  insert into public.pantry_items (product_id, name, category, consumed_at) values (p_gone, 'Arroz', 'mercearia', now());

  -- Listas: um item aberto, um que já saiu pelo carrinho (histórico de compras) e um de lista arquivada.
  insert into public.shopping_lists (name) values ('Mercado') returning id into l;
  insert into public.shopping_list_items (list_id, name, product_id) values (l, 'Arroz', p_gone), (l, 'Feijão', null);
  insert into public.shopping_list_items (list_id, name, product_id, checked_at) values (l, 'Arroz 5kg', p_gone, now());
  select array_agg(id), array_agg(toggle_token) into ids, tokens
    from public.shopping_list_items where list_id = l and checked_at is not null;
  assert public.clear_checked_items(l, ids, tokens) = 1, 'the cart item went to the purchase history';
  insert into public.shopping_lists (name, archived_at) values ('Semana passada', now()) returning id into l_old;
  insert into public.shopping_list_items (list_id, name, product_id) values (l_old, 'Arroz', p_gone);

  -- Ligações de nome de lista: "arroz" os dois já tinham; "arroz branco" só o que some.
  insert into public.list_item_links (name_key, product_id) values ('arroz', p_keep), ('arroz', p_gone), ('arroz branco', p_gone);

  -- "São diferentes": os dois entre si (e mesmo assim dá para juntar à mão), o que some com o integral, e
  -- os dois com o parboilizado (ao juntar, sobra um par só).
  insert into public.products (name, category) values ('Arroz integral', 'graos') returning id into p_integral;
  insert into public.products (name, category) values ('Arroz parboilizado', 'graos') returning id into p_parbo;
  insert into public.product_distinct_pairs (product_a, product_b) values
    (least(p_keep, p_gone), greatest(p_keep, p_gone)),
    (least(p_gone, p_integral), greatest(p_gone, p_integral)),
    (least(p_gone, p_parbo), greatest(p_gone, p_parbo)),
    (least(p_keep, p_parbo), greatest(p_keep, p_parbo));

  perform set_config('test.mp_keep', p_keep::text, false);
  perform set_config('test.mp_gone', p_gone::text, false);
  perform set_config('test.mp_integral', p_integral::text, false);
  perform set_config('test.mp_parbo', p_parbo::text, false);
  perform set_config('test.mp_assai', s_assai::text, false);
  perform set_config('test.mp_bom', s_bom::text, false);
end $$;

-- A tabela dos pares: só na ordem certa, só produtos da casa, sem edição.
do $$
declare
  p_keep uuid := current_setting('test.mp_keep')::uuid;
  p_integral uuid := current_setting('test.mp_integral')::uuid;
begin
  begin
    insert into public.product_distinct_pairs (product_a, product_b) values (greatest(p_keep, p_integral), least(p_keep, p_integral));
    raise exception 'FAIL: pair stored with the larger id first';
  exception when check_violation then null;
  end;
  begin
    insert into public.product_distinct_pairs (product_a, product_b) values (p_keep, p_keep);
    raise exception 'FAIL: a product paired with itself';
  exception when check_violation then null;
  end;
  begin
    insert into public.product_distinct_pairs (product_a, product_b)
      values (least(p_keep, current_setting('test.mp_rita')::uuid), greatest(p_keep, current_setting('test.mp_rita')::uuid));
    raise exception 'FAIL: pair with a product of another household';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.product_distinct_pairs set created_at = now();
    raise exception 'FAIL: a pair was edited';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.product_distinct_pairs (product_a, product_b)
      select product_a, product_b from public.product_distinct_pairs limit 1;
    raise exception 'FAIL: the same pair twice';
  exception when unique_violation then null;
  end;
  -- O histórico de compras continua sem edição, fora o produto da linha (e só para um produto da casa).
  begin
    update public.purchase_history set name = 'Outro';
    raise exception 'FAIL: a purchase was renamed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.purchase_history set product_id = current_setting('test.mp_rita')::uuid;
    raise exception 'FAIL: a purchase re-pointed to a product of another household';
  exception when foreign_key_violation then null;
  end;
end $$;

-- Quim (mesma casa) vê os pares; Rita (outra casa) não vê, não grava e não apaga nada da casa da Paula.
select set_config('request.jwt.claim.sub', :'user_q', false) \gset
do $$
begin
  assert (select count(*) from public.product_distinct_pairs) = 4, 'Q sees the household pairs';
end $$;
select set_config('request.jwt.claim.sub', :'user_r', false) \gset
do $$
declare
  p_keep uuid := current_setting('test.mp_keep')::uuid;
  p_gone uuid := current_setting('test.mp_gone')::uuid;
  p_integral uuid := current_setting('test.mp_integral')::uuid;
begin
  assert (select count(*) from public.product_distinct_pairs) = 0, 'R sees no pairs of another household';
  begin
    insert into public.product_distinct_pairs (household_id, product_a, product_b)
      values (current_setting('test.hh_p')::uuid, least(p_keep, p_integral), greatest(p_keep, p_integral));
    raise exception 'FAIL: R wrote a pair into another household';
  exception when insufficient_privilege then null;
  end;
  delete from public.product_distinct_pairs where product_a in (p_keep, p_gone) or product_b in (p_keep, p_gone);
  assert not found, 'R cannot delete pairs of another household';
  update public.purchase_history set product_id = null;
  assert not found, 'R cannot touch the purchase history of another household';

  -- Juntar produtos de outra casa: para Rita eles não existem, em nenhuma das duas posições.
  begin
    perform public.merge_products(p_keep, p_gone);
    raise exception 'FAIL: R merged products of another household';
  exception when no_data_found then null;
  end;
  begin
    perform public.merge_products(current_setting('test.mp_rita')::uuid, p_gone);
    raise exception 'FAIL: R pulled a product of another household into hers';
  exception when no_data_found then null;
  end;
  begin
    perform public.merge_products(p_keep, current_setting('test.mp_rita')::uuid);
    raise exception 'FAIL: R pushed her product into another household';
  exception when no_data_found then null;
  end;
  -- Com os nomes também: certos ou errados, a resposta é a mesma, e ela não fica sabendo o nome de nada.
  begin
    perform public.merge_products(p_keep, p_gone, 'Arroz Tio João 5 kg', 'Arroz 5kg');
    raise exception 'FAIL: R merged products of another household by their names';
  exception when no_data_found then null;
  end;
  begin
    perform public.merge_products(p_keep, p_gone, 'Outro nome', 'Outro nome');
    raise exception 'FAIL: R was told the names of another household do not match';
  exception when no_data_found then null;
  end;
  begin
    perform public.merge_products(current_setting('test.mp_rita')::uuid, p_gone, 'Arroz', 'Outro nome');
    raise exception 'FAIL: R was told the name of a product of another household does not match';
  exception when no_data_found then null;
  end;
  assert (select count(*) from public.products) = 1, 'R keeps her product';
  assert (select count(*) from public.list_item_links) = 1, 'and its link';
end $$;
set role anon;
do $$
begin
  begin
    perform public.merge_products(current_setting('test.mp_keep')::uuid, current_setting('test.mp_gone')::uuid);
    raise exception 'FAIL: anon merged products';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.merge_products(current_setting('test.mp_keep')::uuid, current_setting('test.mp_gone')::uuid,
      'Arroz Tio João 5 kg', 'Arroz 5kg');
    raise exception 'FAIL: anon merged products by their names';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.product_distinct_pairs;
    raise exception 'FAIL: anon read the pairs';
  exception when insufficient_privilege then null;
  end;
end $$;
set role authenticated;

-- Paula tenta com o que não pode: o mesmo produto, um que não existe, um de outra casa. Nada muda.
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
do $$
declare
  p_keep uuid := current_setting('test.mp_keep')::uuid;
  p_gone uuid := current_setting('test.mp_gone')::uuid;
begin
  begin
    perform public.merge_products(p_keep, p_keep);
    raise exception 'FAIL: a product merged with itself';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.merge_products(p_keep, gen_random_uuid());
    raise exception 'FAIL: merged a product that does not exist';
  exception when no_data_found then null;
  end;
  begin
    perform public.merge_products(gen_random_uuid(), p_gone);
    raise exception 'FAIL: merged into a product that does not exist';
  exception when no_data_found then null;
  end;
  begin
    perform public.merge_products(p_keep, null);
    raise exception 'FAIL: merged without the other product';
  exception when no_data_found then null;
  end;
  begin
    perform public.merge_products(p_keep, current_setting('test.mp_rita')::uuid);
    raise exception 'FAIL: P merged a product of another household into hers';
  exception when no_data_found then null;
  end;
  begin
    perform public.merge_products(current_setting('test.mp_rita')::uuid, p_gone);
    raise exception 'FAIL: P merged her product into another household';
  exception when no_data_found then null;
  end;
  assert (select count(*) from public.products) = 4, 'P keeps her four products';
  assert (select count(*) from public.receipt_items where product_id = p_gone) = 3, 'and their receipt lines';
  assert (select count(*) from public.list_item_links) = 3, 'and their links';
  assert (select count(*) from public.product_distinct_pairs) = 4, 'and the pairs';
end $$;

-- Os nomes que a pessoa confirmou. O app busca os dois produtos ao abrir a confirmação; se outro aparelho
-- renomeia um deles antes do toque, o pedido chega com o nome de antes e nada é juntado (NK008): nem as
-- linhas dos dois produtos, nem a despensa, a lista, os preços, as descrições, as ligações ou os pares.
select pg_temp.merge_products_state(current_setting('test.mp_keep')::uuid, current_setting('test.mp_gone')::uuid) as mp_before \gset
select set_config('test.mp_before', :'mp_before', false) \gset
do $$
declare
  p_keep uuid := current_setting('test.mp_keep')::uuid;
  p_gone uuid := current_setting('test.mp_gone')::uuid;
  before jsonb := current_setting('test.mp_before')::jsonb;
  wrong record;
begin
  assert jsonb_array_length(before->'products') = 2 and jsonb_array_length(before->'receipt_items') = 4
    and jsonb_array_length(before->'pantry_items') = 3 and jsonb_array_length(before->'list_items') = 2
    and jsonb_array_length(before->'purchase_history') = 1 and jsonb_array_length(before->'prices') = 3
    and jsonb_array_length(before->'latest_prices') = 3 and jsonb_array_length(before->'aliases') = 3
    and jsonb_array_length(before->'links') = 3 and jsonb_array_length(before->'pairs') = 4,
    format('what the two products have before: %s', before);
  -- O nome errado de qualquer um dos dois lados, dos dois, e de um só com o outro sem nome. A comparação é
  -- exata: outra caixa, sem acento ou com um espaço a mais já é outro nome.
  for wrong in
    select * from (values
      ('Arroz Tio João 5 kg', 'Feijão carioca 1kg'),
      ('Feijão carioca 1kg', 'Arroz 5kg'),
      ('Feijão carioca 1kg', 'Feijão preto 1kg'),
      (null, 'Feijão carioca 1kg'),
      ('Feijão carioca 1kg', null),
      ('Arroz 5kg', 'Arroz Tio João 5 kg'),
      ('Arroz Tio João 5 kg', 'arroz 5kg'),
      ('Arroz Tio Joao 5 kg', 'Arroz 5kg'),
      ('Arroz Tio João 5 kg', 'Arroz 5kg '),
      ('', 'Arroz 5kg')
    ) as names (keep_name, gone_name)
  loop
    begin
      perform public.merge_products(p_keep, p_gone, wrong.keep_name, wrong.gone_name);
      raise exception 'FAIL: merged with names that are not the products'' names (%, %)', wrong.keep_name, wrong.gone_name;
    exception when sqlstate 'NK008' then null;
    end;
    assert pg_temp.merge_products_state(p_keep, p_gone) = before,
      format('a refusal by name changed something (%s, %s)', wrong.keep_name, wrong.gone_name);
  end loop;
  -- O nome certo não salva o que já era recusado: o mesmo produto, e o produto que não existe.
  begin
    perform public.merge_products(p_keep, p_keep, 'Arroz Tio João 5 kg', 'Arroz Tio João 5 kg');
    raise exception 'FAIL: a product merged with itself by its name';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.merge_products(p_keep, gen_random_uuid(), 'Arroz Tio João 5 kg', 'Arroz 5kg');
    raise exception 'FAIL: merged a product that does not exist by a name';
  exception when no_data_found then null;
  end;
  assert pg_temp.merge_products_state(p_keep, p_gone) = before, 'nothing changed';
end $$;
-- O caso de verdade: o produto que ia sumir é renomeado (gravado, em outro pedido) e só depois chega o pedido de
-- juntar, com os nomes que a confirmação tinha lido.
update public.products set name = 'Feijão carioca 1kg' where id = current_setting('test.mp_gone')::uuid;
do $$
declare
  p_keep uuid := current_setting('test.mp_keep')::uuid;
  p_gone uuid := current_setting('test.mp_gone')::uuid;
  renamed jsonb := pg_temp.merge_products_state(p_keep, p_gone);
begin
  assert renamed <> current_setting('test.mp_before')::jsonb, 'the rename is there';
  begin
    perform public.merge_products(p_keep, p_gone, 'Arroz Tio João 5 kg', 'Arroz 5kg');
    raise exception 'FAIL: merged a product that was renamed after the confirmation read it';
  exception when sqlstate 'NK008' then null;
  end;
  assert pg_temp.merge_products_state(p_keep, p_gone) = renamed, 'the renamed product and everything of the two stay as they were';
  assert (select name from public.products where id = p_gone) = 'Feijão carioca 1kg', 'with the new name';
  assert not exists (select 1 from public.list_item_links where name_key = 'feijao carioca 1kg'), 'and no link from a name that was never merged';
end $$;
-- O mesmo com o produto que ficaria.
update public.products set name = 'Arroz 5kg' where id = current_setting('test.mp_gone')::uuid;
update public.products set name = 'Arroz Tio João 5kg' where id = current_setting('test.mp_keep')::uuid;
do $$
declare
  p_keep uuid := current_setting('test.mp_keep')::uuid;
  p_gone uuid := current_setting('test.mp_gone')::uuid;
  renamed jsonb := pg_temp.merge_products_state(p_keep, p_gone);
begin
  begin
    perform public.merge_products(p_keep, p_gone, 'Arroz Tio João 5 kg', 'Arroz 5kg');
    raise exception 'FAIL: merged into a product that was renamed after the confirmation read it';
  exception when sqlstate 'NK008' then null;
  end;
  assert pg_temp.merge_products_state(p_keep, p_gone) = renamed, 'nothing changed either';
  assert exists (select 1 from public.products where id = p_gone), 'the product that would go is still there';
end $$;
update public.products set name = 'Arroz Tio João 5 kg' where id = current_setting('test.mp_keep')::uuid;
do $$
begin
  assert pg_temp.merge_products_state(current_setting('test.mp_keep')::uuid, current_setting('test.mp_gone')::uuid)
    = current_setting('test.mp_before')::jsonb, 'with the names back, everything is as it was before the refusals';
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.products where household_id = current_setting('test.hh_r')::uuid) = 1, 'the other household keeps its product';
  assert (select count(*) from public.list_item_links where household_id = current_setting('test.hh_r')::uuid) = 1, 'and its link';
  -- Quem passa por cima da RLS também não junta produtos de casas diferentes.
  begin
    perform public.merge_products(current_setting('test.mp_keep')::uuid, current_setting('test.mp_rita')::uuid);
    raise exception 'FAIL: products of two households merged';
  exception when invalid_parameter_value then null;
  end;
  assert exists (select 1 from public.products where id = current_setting('test.mp_rita')::uuid), 'the other household still has its product';
end $$;
set role authenticated;

-- Paula junta "Arroz 5kg" em "Arroz Tio João 5 kg".
do $$
declare
  p_keep uuid := current_setting('test.mp_keep')::uuid;
  p_gone uuid := current_setting('test.mp_gone')::uuid;
  p_integral uuid := current_setting('test.mp_integral')::uuid;
  p_parbo uuid := current_setting('test.mp_parbo')::uuid;
  s_assai uuid := current_setting('test.mp_assai')::uuid;
  s_bom uuid := current_setting('test.mp_bom')::uuid;
  n_items bigint;
  n_pantry bigint;
  n_list bigint;
  n_history bigint;
  n_aliases bigint;
  moved jsonb;
begin
  -- Antes: cada produto com a metade dele.
  assert (select count(*) from public.receipt_items where product_id = p_keep) = 1, 'keep: one receipt line';
  assert (select count(*) from public.receipt_items where product_id = p_gone) = 3, 'gone: three receipt lines (one in a draft)';
  assert (select count(*) from public.price_observations where product_id = p_keep) = 1, 'keep: one price';
  assert (select count(*) from public.price_observations where product_id = p_gone) = 2, 'gone: two prices';
  assert (select count(*) from public.latest_prices where product_id = p_keep) = 1, 'keep: latest price in one store';
  assert (select count(*) from public.pantry_items where product_id = p_keep) = 1, 'keep: one pantry item';
  assert (select count(*) from public.pantry_items where product_id = p_gone) = 2, 'gone: two pantry items (one consumed)';
  assert (select count(*) from public.shopping_list_items where product_id = p_gone) = 2, 'gone: two list items (one archived)';
  assert (select count(*) from public.purchase_history where product_id = p_gone) = 1, 'gone: one purchase in the history';
  assert (select count(*) from public.product_aliases where product_id = p_keep) = 1, 'keep: one alias';
  assert (select count(*) from public.product_aliases where product_id = p_gone) = 2, 'gone: two aliases';
  select count(*) into n_items from public.receipt_items;
  select count(*) into n_pantry from public.pantry_items;
  select count(*) into n_list from public.shopping_list_items;
  select count(*) into n_history from public.purchase_history;
  select count(*) into n_aliases from public.product_aliases;

  moved := public.merge_products(p_keep, p_gone);

  -- O que a função diz que passou.
  assert moved = jsonb_build_object('kept', p_keep, 'purchases', 2, 'pantry', 1, 'list', 1, 'receipt_items', 3,
    'pantry_items', 2, 'list_items', 2, 'purchase_history', 1, 'aliases', 2, 'links', 1), format('what moved: %s', moved);

  -- Um produto só, com o nome, a categoria e a validade aprendida do que ficou.
  assert not exists (select 1 from public.products where id = p_gone), 'the merged product is gone';
  assert (select count(*) from public.products) = 3, 'one product less';
  assert (select name from public.products where id = p_keep) = 'Arroz Tio João 5 kg', 'the kept name';
  assert (select category from public.products where id = p_keep) = 'graos', 'the kept category';
  assert (select shelf_life_days from public.products where id = p_keep) = 182, 'the kept learned shelf life';

  -- Nenhuma linha se perdeu nem ficou sem produto: todas trocaram de produto.
  assert (select count(*) from public.receipt_items) = n_items, 'no receipt line lost';
  assert (select count(*) from public.pantry_items) = n_pantry, 'no pantry item lost';
  assert (select count(*) from public.shopping_list_items) = n_list, 'no list item lost';
  assert (select count(*) from public.purchase_history) = n_history, 'no purchase lost';
  assert (select count(*) from public.product_aliases) = n_aliases, 'no alias lost';
  assert (select count(*) from public.receipt_items where product_id = p_keep) = 4, 'every receipt line points to the kept product';
  assert (select count(*) from public.receipt_items where product_id is null) = 0, 'no receipt line without product';
  assert (select count(*) from public.pantry_items where product_id = p_keep) = 3, 'every pantry item too';
  assert (select count(*) from public.shopping_list_items where product_id = p_keep) = 2, 'and the list items, archived list included';
  assert (select count(*) from public.shopping_list_items where product_id is null) = 1, 'the free-text list item stays free';
  assert (select count(*) from public.purchase_history where product_id = p_keep) = 1, 'and the purchase history';
  assert (select name from public.purchase_history where product_id = p_keep) = 'Arroz 5kg', 'a purchase keeps the name it was bought with';
  assert (select name from public.pantry_items where product_id = p_keep and consumed_at is not null) = 'Arroz', 'a pantry item keeps its name';

  -- O histórico de preços e o último preço por mercado viram um só.
  assert (select count(*) from public.price_observations where product_id = p_keep) = 3, 'both price histories under the kept product';
  assert (select count(*) from public.price_observations where product_id = p_gone) = 0, 'none under the merged one';
  assert (select count(*) from public.latest_prices where product_id = p_keep) = 2, 'latest price in both stores';
  assert (select unit_price from public.latest_prices where product_id = p_keep and store_id = s_assai) = 24.90,
    'Assaí: the newer purchase, which was of the merged product';
  assert (select unit_price from public.latest_prices where product_id = p_keep and store_id = s_bom) = 25.90, 'Mercado Bom: the only one';

  -- A memória das descrições: o que levava ao outro produto leva a este.
  assert (select product_id from public.match_aliases(array['arroz 5kg'])) = p_keep, 'the alias of the merged product leads to the kept one';
  assert (select product_id from public.match_aliases(array['ARROZ BRANCO 5KG'])) = p_keep, 'every alias of it';
  assert (select product_id from public.match_aliases(array['Arroz T Joao 5kg'])) = p_keep, 'and the kept product keeps its own';

  -- Ligações de nome de lista: a que os dois tinham fica uma vez, a do outro passa, e o nome antigo vira ligação.
  assert (select array_agg(name_key order by name_key) from public.list_item_links where product_id = p_keep)
    = array['arroz', 'arroz 5kg', 'arroz branco'], 'links of the kept product';
  assert (select count(*) from public.list_item_links) = 3, 'no link left behind';

  -- "São diferentes": o par dos dois sai, o do integral passa, e os dois do parboilizado viram um.
  assert (select count(*) from public.product_distinct_pairs) = 2, 'two pairs left';
  assert exists (select 1 from public.product_distinct_pairs
    where product_a = least(p_keep, p_integral) and product_b = greatest(p_keep, p_integral)), 'the integral pair moved to the kept product';
  assert exists (select 1 from public.product_distinct_pairs
    where product_a = least(p_keep, p_parbo) and product_b = greatest(p_keep, p_parbo)), 'the parboilizado pair kept once';
  assert not exists (select 1 from public.product_distinct_pairs where p_gone in (product_a, product_b)), 'no pair points to the merged product';

  -- De novo, o produto já não existe.
  begin
    perform public.merge_products(p_keep, p_gone);
    raise exception 'FAIL: merged the same product twice';
  exception when no_data_found then null;
  end;
end $$;

-- Quim (morador, não dono) também junta. O nome que some vira chave de lista como no app (listNameKey):
-- sem acento nem pontuação, e até 200 caracteres; nome sem letra nem número não deixa ligação.
select set_config('request.jwt.claim.sub', :'user_q', false) \gset
do $$
declare
  p_pao uuid;
  p_other uuid;
  long_name text := repeat('Açaí ', 45);
begin
  insert into public.products (name, category) values ('Pão de queijo', 'padaria') returning id into p_pao;
  insert into public.products (name, category) values ('  PÃO de Queijo (500g)!  ', 'padaria') returning id into p_other;
  assert (public.merge_products(p_pao, p_other))->>'links' = '0', 'nothing to re-point';
  assert (select array_agg(name_key) from public.list_item_links where product_id = p_pao) = array['pao de queijo 500g'],
    'the old name as the app writes the list key';

  insert into public.products (name, category) values ('!!!', 'outros') returning id into p_other;
  perform public.merge_products(p_pao, p_other);
  assert (select count(*) from public.list_item_links where product_id = p_pao) = 1, 'a name without letters leaves no link';

  insert into public.products (name, category) values (long_name, 'outros') returning id into p_other;
  perform public.merge_products(p_pao, p_other);
  assert (select max(length(name_key)) from public.list_item_links where product_id = p_pao) = 199, 'a long name is cut at 200 and trimmed';
  assert exists (select 1 from public.list_item_links where product_id = p_pao and name_key = rtrim(repeat('acai ', 40))), 'cut key';

  -- O produto apagado leva os pares dele.
  insert into public.products (name, category) values ('Pão francês', 'padaria') returning id into p_other;
  insert into public.product_distinct_pairs (product_a, product_b) values (least(p_pao, p_other), greatest(p_pao, p_other));
  delete from public.products where id = p_other;
  assert not exists (select 1 from public.product_distinct_pairs where p_pao in (product_a, product_b)), 'deleting a product deletes its pairs';
  perform set_config('test.mp_pao', p_pao::text, false);
end $$;

-- Com os nomes certos junta, e devolve o mesmo que sem eles. Sem nome (null, nos dois ou num só) não há
-- conferência, como quando são omitidos; o nome dado de um lado só é conferido sozinho.
do $$
declare
  p_pao uuid := current_setting('test.mp_pao')::uuid;
  p_other uuid;
  l uuid;
  moved jsonb;
begin
  select id into l from public.shopping_lists where name = 'Mercado';
  insert into public.products (name, category) values ('Pão de queijo Forno de Minas', 'congelados') returning id into p_other;
  insert into public.pantry_items (product_id, name, category) values (p_other, 'Pão de queijo', 'congelados');
  insert into public.shopping_list_items (list_id, name, product_id) values (l, 'Pão de queijo Forno de Minas', p_other);
  moved := public.merge_products(p_pao, p_other, 'Pão de queijo', 'Pão de queijo Forno de Minas');
  assert moved = jsonb_build_object('kept', p_pao, 'purchases', 0, 'pantry', 1, 'list', 1, 'receipt_items', 0,
    'pantry_items', 1, 'list_items', 1, 'purchase_history', 0, 'aliases', 0, 'links', 0), format('what moved with the names: %s', moved);
  assert not exists (select 1 from public.products where id = p_other), 'with the right names the product is merged';
  assert (select name from public.products where id = p_pao) = 'Pão de queijo', 'the kept product keeps its name';
  assert (select category from public.products where id = p_pao) = 'padaria', 'and its category';
  assert (select count(*) from public.pantry_items where product_id = p_pao) = 1, 'the pantry item moved';
  assert (select count(*) from public.shopping_list_items where product_id = p_pao) = 1, 'and the list item';
  assert exists (select 1 from public.list_item_links where product_id = p_pao and name_key = 'pao de queijo forno de minas'),
    'and the old name became a link';

  -- Como o app chama: os quatro pelo nome.
  insert into public.products (name, category) values ('Pão de queijo coquetel', 'congelados') returning id into p_other;
  perform public.merge_products(p_keep => p_pao, p_merge => p_other, p_keep_name => 'Pão de queijo', p_merge_name => 'Pão de queijo coquetel');
  assert not exists (select 1 from public.products where id = p_other), 'the four arguments by name';

  -- null nos dois, e só os dois produtos pelo nome: sem conferência.
  insert into public.products (name, category) values ('Pão de queijo tradicional', 'congelados') returning id into p_other;
  perform public.merge_products(p_pao, p_other, null, null);
  assert not exists (select 1 from public.products where id = p_other), 'null names are as no names';
  insert into public.products (name, category) values ('Pão de queijo mineiro', 'congelados') returning id into p_other;
  perform public.merge_products(p_keep => p_pao, p_merge => p_other);
  assert not exists (select 1 from public.products where id = p_other), 'the two products by name, without the names';

  -- Um nome só, certo: o outro lado não é conferido.
  insert into public.products (name, category) values ('Pão de queijo recheado', 'congelados') returning id into p_other;
  perform public.merge_products(p_pao, p_other, 'Pão de queijo', null);
  assert not exists (select 1 from public.products where id = p_other), 'only the kept name given';
  insert into public.products (name, category) values ('Pão de queijo palito', 'congelados') returning id into p_other;
  perform public.merge_products(p_pao, p_other, null, 'Pão de queijo palito');
  assert not exists (select 1 from public.products where id = p_other), 'only the merged name given';

  -- Um nome só, errado: recusa, mesmo com o outro lado sem nome. Com o nome certo, junta.
  insert into public.products (name, category) values ('Pão de queijo integral', 'congelados') returning id into p_other;
  begin
    perform public.merge_products(p_pao, p_other, null, 'Pão de queijo');
    raise exception 'FAIL: merged with the wrong name of the merged product';
  exception when sqlstate 'NK008' then null;
  end;
  begin
    perform public.merge_products(p_pao, p_other, 'Pão de queijo integral', null);
    raise exception 'FAIL: merged with the wrong name of the kept product';
  exception when sqlstate 'NK008' then null;
  end;
  assert exists (select 1 from public.products where id = p_other), 'the product is still there';
  assert not exists (select 1 from public.list_item_links where name_key = 'pao de queijo integral'), 'and its name left no link';
  perform public.merge_products(p_pao, p_other, 'Pão de queijo', 'Pão de queijo integral');
  assert not exists (select 1 from public.products where id = p_other), 'and then merged, with the right names';
end $$;

-- Se uma troca não alcança as linhas (aqui, sem a regra de UPDATE do histórico), nada é juntado: apagar o
-- produto deixaria as compras sem ele.
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
do $$
declare
  l uuid;
  p_pao uuid := current_setting('test.mp_pao')::uuid;
  p_other uuid;
  ids uuid[];
  tokens uuid[];
begin
  insert into public.products (name, category) values ('Pão de queijo congelado', 'congelados') returning id into p_other;
  select id into l from public.shopping_lists where name = 'Mercado';
  insert into public.shopping_list_items (list_id, name, product_id, checked_at) values (l, 'Pão de queijo', p_other, now());
  insert into public.shopping_list_items (list_id, name, product_id) values (l, 'Pão de queijo congelado', p_other);
  select array_agg(id), array_agg(toggle_token) into ids, tokens
    from public.shopping_list_items where list_id = l and checked_at is not null;
  assert public.clear_checked_items(l, ids, tokens) = 1, 'one more purchase in the history';
  perform set_config('test.mp_other', p_other::text, false);
end $$;
reset role;
drop policy "household members re-point purchase history" on public.purchase_history;
set role authenticated;
do $$
declare
  p_pao uuid := current_setting('test.mp_pao')::uuid;
  p_other uuid := current_setting('test.mp_other')::uuid;
begin
  begin
    perform public.merge_products(p_pao, p_other);
    raise exception 'FAIL: merged leaving the purchase history behind';
  exception when sqlstate '55000' then null;
  end;
  assert exists (select 1 from public.products where id = p_other), 'the product is still there';
  assert (select count(*) from public.purchase_history where product_id = p_other) = 1, 'with its purchase';
  assert (select count(*) from public.shopping_list_items where product_id = p_other) = 1, 'and its list item: the whole merge was undone';
end $$;
reset role;
create policy "household members re-point purchase history" on public.purchase_history for update to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));
set role authenticated;
do $$
declare
  p_pao uuid := current_setting('test.mp_pao')::uuid;
  p_other uuid := current_setting('test.mp_other')::uuid;
begin
  assert (public.merge_products(p_pao, p_other))->>'purchase_history' = '1', 'with the rule back, the purchase moves';
  assert (select count(*) from public.purchase_history where product_id = p_pao) = 1, 'to the kept product';
end $$;
reset role;

-- ---------------------------------------------------------------------------
\echo '• preços compartilhados: o que entra, o que nunca entra, quem lê e quem não alcança a tabela'
-- Paula e Quico compram no mesmo atacado, em São Paulo; Saulo também, numa
-- leitura que veio sem o nome da loja. Rita já comprou o mesmo arroz (tem o
-- apelido); Úrsula também, mas mora no Rio; Tina tem conta, mas não tem casa.
\set user_p '00000000-0000-0000-0000-00000000002a'
\set user_q '00000000-0000-0000-0000-00000000002b'
\set user_r '00000000-0000-0000-0000-00000000002c'
\set user_s '00000000-0000-0000-0000-00000000002d'
\set user_t '00000000-0000-0000-0000-00000000002e'
\set user_u '00000000-0000-0000-0000-00000000002f'
reset role;
insert into auth.users (id) values (:'user_p'), (:'user_q'), (:'user_r'), (:'user_s'), (:'user_t'), (:'user_u');
-- O que as notas confirmadas nos testes de cima tiverem compartilhado sai: aqui a conta começa do zero.
truncate public.shared_prices;
-- Só compartilha a nota que tem a leitura do servidor (receipt_reads, gravada pelas funções nfce e parse-receipt
-- com a chave secreta), e só as linhas que batem com ela. Aqui, antes de confirmar, a leitura é feita igual à
-- nota (mercado, nome, chave, dia em São Paulo e linhas): estes testes dizem o que as regras de sempre fazem com
-- o que foi lido. O que muda quando a nota e a leitura diferem está em "preços conferidos pelo servidor".
create function pg_temp.read_as_printed(p_receipt uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.receipt_reads (household_id, source, access_key, store_cnpj, store_name, purchased_on, lines)
  select r.household_id, case when r.source = 'qrcode' then 'qrcode' else 'ai' end, r.access_key, s.cnpj, s.name,
         (r.purchased_at at time zone 'America/Sao_Paulo')::date,
         coalesce((select jsonb_agg(jsonb_build_object('description', ri.raw_description, 'unit', ri.unit, 'unit_price', ri.unit_price)
                     order by ri.position)
                     from public.receipt_items ri where ri.receipt_id = r.id), '[]'::jsonb)
    from public.receipts r
    left join public.stores s on s.id = r.store_id and s.household_id = r.household_id
    where r.id = p_receipt
  returning id into v_id;
  update public.receipts set read_id = v_id where id = p_receipt;
end $$;
-- A confirmação continua sendo de quem chama (sem security definer).
create function pg_temp.confirm_as_read(p_receipt uuid, p_items jsonb) returns void
language plpgsql as $$
begin
  perform pg_temp.read_as_printed(p_receipt);
  perform public.confirm_receipt(p_receipt, p_items);
end $$;
-- O banco da Supabase roda em UTC: o dia tem de sair de São Paulo, não do fuso da sessão.
set time zone 'UTC';
select set_config('test.sp_today', ((now() at time zone 'America/Sao_Paulo')::date)::text, false) \gset

do $$
begin
  -- Nada que aponte de volta: uma coluna nova (casa, pessoa, nota, id, hora) derruba este teste. A única data
  -- além do dia da compra é o dia em que a linha passa a ser lida: um dia sem hora, igual para tudo o que foi
  -- gravado no mesmo dia por qualquer casa, que a leitura nunca devolve.
  assert (select array_agg(column_name || ' ' || data_type order by ordinal_position) from information_schema.columns
            where table_schema = 'public' and table_name = 'shared_prices')
    = array['store_cnpj text', 'store_uf text', 'store_name text', 'item_key text', 'unit text', 'seen_on date', 'unit_price numeric', 'visible_on date'],
    'shared_prices has exactly store, state, name, item key, unit, day, price and the day it becomes readable';
  assert (select bool_and(is_nullable = 'NO') from information_schema.columns
            where table_schema = 'public' and table_name = 'shared_prices' and column_name in ('seen_on', 'visible_on')),
    'both days are always there';
  -- O nome da loja vai na linha do preço: uma tabela de lojas à parte mostraria o nome gravado hoje.
  assert to_regclass('public.shared_stores') is null, 'there is no table of shared stores';
  assert (select count(*) from information_schema.columns
            where table_schema = 'public' and table_name = 'shared_prices' and column_default is not null) = 0,
    'no column fills itself (no sequence, no clock)';
  assert (select array_agg(a.attname::text order by k.ord) from pg_index i
            cross join lateral unnest(i.indkey) with ordinality as k (attnum, ord)
            join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
            where i.indrelid = 'public.shared_prices'::regclass and i.indisprimary)
    = array['store_cnpj', 'item_key', 'unit', 'seen_on'],
    'one row per store, item, unit and day';
  -- A espera por uma trava vira erro que o gatilho engole. Sem isto, quem espera cai no tempo da instrução
  -- (statement timeout), que nenhum exception apanha: a confirmação de outra casa falharia.
  assert (select proconfig from pg_proc where oid = 'public.share_receipt_prices()'::regprocedure) @> array['lock_timeout=200ms'],
    'the trigger function never waits more than 200 ms for a lock';
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
select public.create_household('Casa da Paula', 'Paula') \gset
do $$
declare
  today constant date := current_setting('test.sp_today')::date;
  d constant date := today - 10;
  ata constant text := '11222333000181';
  s_ata uuid;
  s_other uuid;
  s_hand uuid;
  s_big uuid;
  s uuid;
  r uuid;
  health text;
  pharmacy text;
  n integer := 10;
begin
  perform set_config('test.sp_house_p', public.current_household_id()::text, false);
  insert into public.stores (name, cnpj) values ('ATACADAO MOOCA', ata) returning id into s_ata;
  insert into public.stores (name, cnpj) values ('SUPER OUTRO', '99888777000166') returning id into s_other;
  insert into public.stores (name, cnpj) values ('MERCADO GRANDE', '55444333000122') returning id into s_big;
  -- Mercado criado à mão na revisão: sem CNPJ.
  insert into public.stores (name) values ('Mercadinho da esquina') returning id into s_hand;

  -- Nota do QR code às 22:30 (em UTC já é o dia seguinte), de São Paulo (a chave começa com 35).
  insert into public.receipts (store_id, purchased_at, access_key, source)
    values (s_ata, (d + time '22:30') at time zone 'America/Sao_Paulo', '352610' || ata || repeat('0', 23) || '1', 'qrcode')
    returning id into r;
  insert into public.receipt_items (receipt_id, position, raw_description, suggested_category, quantity, unit, unit_price, total_price) values
    (r, 0, 'ARROZ T.JOÃO 5KG', 'graos', 1, 'un', 22.90, 22.90),
    -- Brinde: valor zero.
    (r, 1, 'BRINDE SACOLA', 'papel', 1, 'un', 0, 0),
    -- Descrição que não deixa chave nenhuma.
    (r, 2, '***', 'graos', 1, 'un', 3.00, 3.00),
    (r, 3, 'BANANA PRATA', 'hortifruti', 1.2, 'kg', 6.99, 8.39),
    -- A mesma descrição de novo, mais abaixo na nota: uma linha só, com este preço.
    (r, 4, 'ARROZ T JOAO 5KG', 'graos', 1, 'un', 21.90, 21.90),
    -- O que o app não reconheceu fica em "outros", e "outros" não sai da casa: é lá que cai, na nota do QR
    -- code, o remédio que ele não conhece (a segunda linha vira produto novo, também "outros").
    (r, 5, 'BISC RECH OREO', 'outros', 1, 'un', 3.99, 3.99),
    (r, 6, 'SERTRALINA 50MG C/30', 'outros', 1, 'un', 35.90, 35.90),
    -- Higiene pessoal mistura xampu com item íntimo: fora.
    (r, 7, 'SHAMPOO SEDA 325ML', 'higiene', 1, 'un', 12.90, 12.90),
    -- As duas categorias precisam estar na lista: sugerida dentro e produto fora, ou o contrário, não entra.
    (r, 8, 'QJ MUSSARELA KG', 'laticinios', 0.5, 'kg', 39.90, 19.95),
    (r, 9, 'IOG NESTLE 170G', 'outros', 1, 'un', 2.99, 2.99),
    -- Sem sugestão, com produto de categoria da lista: entra.
    (r, 10, 'MACA GALA', null, 1, 'kg', 8.90, 8.90),
    -- Sem sugestão e sem produto: não se sabe o que é, não entra.
    (r, 11, 'TOMATE ITALIANO', null, 1, 'kg', 7.50, 7.50),
    -- Chave com mais de 200 letras: só esta linha fica de fora, as outras entram.
    (r, 12, repeat('ARROZ AGULHINHA ', 13) || 'TIPO 1', 'graos', 1, 'un', 5.00, 5.00);
  perform pg_temp.confirm_as_read(r, jsonb_build_array(
    jsonb_build_object('id', (select id from public.receipt_items where receipt_id = r and position = 0),
      'new_product', jsonb_build_object('name', 'Arroz Tio João 5kg', 'category', 'graos')),
    jsonb_build_object('id', (select id from public.receipt_items where receipt_id = r and position = 6),
      'new_product', jsonb_build_object('name', 'Sertralina', 'category', 'outros')),
    jsonb_build_object('id', (select id from public.receipt_items where receipt_id = r and position = 8),
      'new_product', jsonb_build_object('name', 'Queijo', 'category', 'outros')),
    jsonb_build_object('id', (select id from public.receipt_items where receipt_id = r and position = 9),
      'new_product', jsonb_build_object('name', 'Iogurte', 'category', 'laticinios')),
    jsonb_build_object('id', (select id from public.receipt_items where receipt_id = r and position = 10),
      'new_product', jsonb_build_object('name', 'Maçã', 'category', 'hortifruti'))
  ));
  perform set_config('test.sp_receipt_qr', r::text, false);

  -- Nota lida pela foto, à 00:30 do dia seguinte, sem chave de acesso (e por isso sem estado).
  insert into public.receipts (store_id, purchased_at, source)
    values (s_ata, (d + 1 + time '00:30') at time zone 'America/Sao_Paulo', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'LEITE ITALAC 1L', 'laticinios', 'un', 4.59, 4.59);
  perform pg_temp.confirm_as_read(r, '[]');
  perform set_config('test.sp_receipt_photo', r::text, false);

  -- Digitada à mão, no mesmo mercado com CNPJ: nada.
  insert into public.receipts (store_id, purchased_at, source)
    values (s_ata, (d + time '10:00') at time zone 'America/Sao_Paulo', 'manual') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'FEIJAO CAMIL 1KG', 'graos', 'un', 7.90, 7.90);
  perform pg_temp.confirm_as_read(r, '[]');

  -- Lida, mas num mercado sem CNPJ: nada.
  insert into public.receipts (store_id, purchased_at, access_key, source)
    values (s_hand, (d + time '11:00') at time zone 'America/Sao_Paulo', '352610' || ata || repeat('0', 23) || '2', 'qrcode') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'CHA MATTE LEAO 1L', 'cafe_cha', 'un', 6.90, 6.90);
  perform pg_temp.confirm_as_read(r, '[]');

  -- Lida, e a pessoa apontou para outro mercado: o CNPJ da chave não é o dele. Nada.
  insert into public.receipts (store_id, purchased_at, access_key, source)
    values (s_other, (d + time '12:00') at time zone 'America/Sao_Paulo', '352610' || ata || repeat('0', 23) || '3', 'qrcode') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'ACUCAR UNIAO 1KG', 'doces', 'un', 4.99, 4.99);
  perform pg_temp.confirm_as_read(r, '[]');

  -- Foto sem chave num mercado com CNPJ: entra, com o nome dele.
  insert into public.receipts (store_id, purchased_at, source)
    values (s_other, (d + time '13:00') at time zone 'America/Sao_Paulo', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'OLEO LIZA 900ML', 'oleos', 'un', 7.49, 7.49);
  perform pg_temp.confirm_as_read(r, '[]');

  -- Nome de loja com espaços em volta e comprido demais: vai aparado e cortado em 120 letras (aqui o corte
  -- cai depois de um espaço, que também sai).
  insert into public.stores (name, cnpj) values ('  ' || repeat('ABCDEFGHI ', 15) || ' ', '44555666000199') returning id into s;
  insert into public.receipts (store_id, purchased_at, source)
    values (s, (d + time '13:30') at time zone 'America/Sao_Paulo', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'VINAGRE CASTELO 750ML', 'temperos', 'un', 3.29, 3.29);
  perform pg_temp.confirm_as_read(r, '[]');

  -- Data no futuro (digitada errada na revisão): nada.
  insert into public.receipts (store_id, purchased_at, source)
    values (s_ata, (today + 2 + time '10:00') at time zone 'America/Sao_Paulo', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'SAL CISNE 1KG', 'temperos', 'un', 2.99, 2.99);
  perform pg_temp.confirm_as_read(r, '[]');

  -- Rascunho: só a confirmação compartilha.
  insert into public.receipts (store_id, purchased_at, source)
    values (s_ata, (d + time '14:00') at time zone 'America/Sao_Paulo', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'RASCUNHO NAO CONFIRMADO', 'graos', 'un', 1.00, 1.00);

  -- Três itens de farmácia que o app põe em categoria de mercado (tempero, bebida e óleo). Num mercado comum,
  -- numa nota sem remédio nenhum, entram: é o que as outras camadas existem para segurar.
  insert into public.receipts (store_id, purchased_at, access_key, source)
    values (s_ata, (d + time '15:00') at time zone 'America/Sao_Paulo', '352610' || ata || repeat('0', 23) || '8', 'qrcode') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price) values
    (r, 'SAL DE FRUTA ENO', 'temperos', 'un', 3.50, 3.50),
    (r, 'AGUA OXIGENADA 10V', 'bebidas', 'un', 4.50, 4.50),
    (r, 'OLEO MINERAL 100ML', 'oleos', 'un', 9.90, 9.90);
  perform pg_temp.confirm_as_read(r, '[]');

  -- Nota com uma linha de REMÉDIO, pela categoria sugerida ou pela do produto: é compra de farmácia, e NADA
  -- dela entra, nem os mesmos três itens.
  n := n + 1;
  insert into public.receipts (store_id, purchased_at, access_key, source)
    values (s_ata, (d + time '16:00') at time zone 'America/Sao_Paulo', '352610' || ata || repeat('0', 22) || n, 'qrcode') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price) values
    (r, 'DIPIRONA 500MG ' || n, 'medicamentos', 'un', 8.50, 8.50),
    (r, 'SAL DE FRUTA ENO ' || n, 'temperos', 'un', 3.50, 3.50),
    (r, 'AGUA OXIGENADA 10V ' || n, 'bebidas', 'un', 4.50, 4.50),
    (r, 'OLEO MINERAL 100ML ' || n, 'oleos', 'un', 9.90, 9.90);
  perform pg_temp.confirm_as_read(r, '[]');

  n := n + 1;
  insert into public.receipts (store_id, purchased_at, source)
    values (s_ata, (d + time '17:00') at time zone 'America/Sao_Paulo', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, position, raw_description, suggested_category, unit, unit_price, total_price) values
    (r, 0, 'ITEM SEM PISTA ' || n, null, 'un', 8.50, 8.50),
    (r, 1, 'SAL DE FRUTA ENO ' || n, 'temperos', 'un', 3.50, 3.50),
    (r, 2, 'AGUA OXIGENADA 10V ' || n, 'bebidas', 'un', 4.50, 4.50),
    (r, 3, 'OLEO MINERAL 100ML ' || n, 'oleos', 'un', 9.90, 9.90);
  perform pg_temp.confirm_as_read(r, jsonb_build_array(
    jsonb_build_object('id', (select id from public.receipt_items where receipt_id = r and position = 0),
      'new_product', jsonb_build_object('name', 'Remédio ' || n, 'category', 'medicamentos'))));

  -- Suplemento e primeiros socorros NÃO seguram a nota: é onde o app põe o iogurte proteico, a "vitamina de
  -- banana" e o curativo, que vêm em nota de supermercado. A linha deles nunca entra (não está na lista); a
  -- de laticínio da mesma nota entra. Também pela categoria sugerida e pela do produto.
  foreach health in array array['suplementos', 'primeiros_socorros'] loop
    n := n + 1;
    insert into public.receipts (store_id, purchased_at, access_key, source)
      values (s_big, (d + time '16:30') at time zone 'America/Sao_Paulo', '352610' || '55444333000122' || repeat('0', 22) || n, 'qrcode') returning id into r;
    insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price) values
      (r, 'LINHA DE SAUDE ' || n, health, 'un', 8.50, 8.50),
      (r, 'LEITE DA MESMA NOTA ' || n, 'laticinios', 'un', 5.49, 5.49);
    perform pg_temp.confirm_as_read(r, '[]');

    n := n + 1;
    insert into public.receipts (store_id, purchased_at, source)
      values (s_big, (d + time '17:30') at time zone 'America/Sao_Paulo', 'ai') returning id into r;
    insert into public.receipt_items (receipt_id, position, raw_description, suggested_category, unit, unit_price, total_price) values
      (r, 0, 'LINHA DE SAUDE ' || n, null, 'un', 8.50, 8.50),
      (r, 1, 'LEITE DA MESMA NOTA ' || n, 'laticinios', 'un', 5.49, 5.49);
    perform pg_temp.confirm_as_read(r, jsonb_build_array(
      jsonb_build_object('id', (select id from public.receipt_items where receipt_id = r and position = 0),
        'new_product', jsonb_build_object('name', 'Produto de saúde ' || n, 'category', health))));
  end loop;

  -- Loja com nome de farmácia (com acento, sem acento, colado, em qualquer caixa), numa nota sem remédio
  -- reconhecido: nada, nem os mesmos três itens. Da rede Pague Menos, a razão social e o nome de fachada; e
  -- um nome com "supermercado" que também diz farmácia (os outros pedaços não têm exceção).
  foreach pharmacy in array array[
    'RAIA DROGASIL S/A', 'EMPREENDIMENTOS PAGUE MENOS S/A', 'DIMED S/A - DISTRIBUIDORA DE MEDICAMENTOS',
    'Farmácia São João', 'PANVEL', 'Pharmapele Manipulação', 'PagueMenos', 'pague-menos',
    'FARMACIAS PAGUE MENOS', 'Farmácia do Supermercado Pague Menos'
  ] loop
    n := n + 1;
    insert into public.stores (name, cnpj) values (pharmacy, '700000000000' || n) returning id into s;
    insert into public.receipts (store_id, purchased_at, source)
      values (s, (d + time '18:00') at time zone 'America/Sao_Paulo', 'ai') returning id into r;
    insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price) values
      (r, 'SAL DE FRUTA ENO', 'temperos', 'un', 3.50, 3.50),
      (r, 'AGUA OXIGENADA 10V', 'bebidas', 'un', 4.50, 4.50),
      (r, 'OLEO MINERAL 100ML', 'oleos', 'un', 9.90, 9.90);
    perform pg_temp.confirm_as_read(r, '[]');
  end loop;

  -- "Pague Menos" também é nome de supermercado (uma rede do interior de São Paulo, e outros pelo país):
  -- quando o nome diz que é mercado (SUPERMERC, MERCADO ou ALIMENT), a loja compartilha como qualquer outra.
  foreach pharmacy in array array[
    'PAGUE MENOS COMERCIO DE PRODUTOS ALIMENTICIOS LTDA', 'SUPERMERCADO PAGUE MENOS', 'SUPERMERC PAGUE MENOS LTDA', 'Mercado Pague-Menos'
  ] loop
    n := n + 1;
    insert into public.stores (name, cnpj) values (pharmacy, '710000000000' || n) returning id into s;
    insert into public.receipts (store_id, purchased_at, source)
      values (s, (d + time '18:30') at time zone 'America/Sao_Paulo', 'ai') returning id into r;
    insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
      values (r, 'FEIJAO CARIOCA 1KG', 'graos', 'un', 7.90, 7.90);
    perform pg_temp.confirm_as_read(r, '[]');
  end loop;

  -- O teto por nota: com 301 linhas, nada; com 300, todas.
  insert into public.receipts (store_id, purchased_at, source)
    values (s_big, (d + time '19:00') at time zone 'America/Sao_Paulo', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, position, raw_description, suggested_category, unit, unit_price, total_price)
    select r, g, 'ITEM ALEM DO TETO ' || g, 'graos', 'un', 1 + g / 100.0, 1 + g / 100.0 from generate_series(1, 301) as g;
  perform pg_temp.confirm_as_read(r, '[]');
  insert into public.receipts (store_id, purchased_at, source)
    values (s_big, (d + time '20:00') at time zone 'America/Sao_Paulo', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, position, raw_description, suggested_category, unit, unit_price, total_price)
    select r, g, 'ITEM NO TETO ' || g, 'graos', 'un', 1 + g / 100.0, 1 + g / 100.0 from generate_series(1, 300) as g;
  perform pg_temp.confirm_as_read(r, '[]');

  -- A compra de HOJE (QR code): entra na base, mas ninguém a lê antes de amanhã.
  insert into public.receipts (store_id, access_key, source)
    values (s_ata, '352610' || ata || repeat('0', 23) || '9', 'qrcode') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'CAFE PILAO 500G', 'cafe_cha', 'un', 18.90, 18.90);
  perform pg_temp.confirm_as_read(r, '[]');

  -- A compra de ONTEM confirmada hoje (QR code, noutro mercado de São Paulo): o que segura a linha é o dia da
  -- GRAVAÇÃO, não o da compra. Também só amanhã.
  insert into public.receipts (store_id, purchased_at, access_key, source)
    values (s_other, (today - 1 + time '19:00') at time zone 'America/Sao_Paulo', '352610' || '99888777000166' || repeat('0', 23) || '4', 'qrcode')
    returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'CAFE PILAO 500G', 'cafe_cha', 'un', 17.90, 17.90);
  perform pg_temp.confirm_as_read(r, '[]');
end $$;

reset role;
do $$
declare
  today constant date := current_setting('test.sp_today')::date;
  d constant date := today - 10;
  ata constant text := '11222333000181';
begin
  -- Tudo o que foi gravado hoje passa a ser lido amanhã, seja a compra de há 10 dias, de ontem ou de hoje.
  assert (select count(*) from public.shared_prices where visible_on <> today + 1) = 0,
    'every row written today becomes readable tomorrow, whatever its purchase day';
  -- Do QR: o arroz (uma linha, o preço da última), a banana e a maçã, no dia de São Paulo das 22:30, com o
  -- estado da chave. Da foto: o leite, no dia da 00:30, sem estado. E os três itens da nota sem remédio.
  assert (select array_agg(item_key || ' ' || unit || ' ' || seen_on || ' ' || unit_price || ' ' || coalesce(store_uf, '-') order by item_key)
            from public.shared_prices where store_cnpj = ata)
    = array[
      'AGUA OXIGENADA 10V un ' || d || ' 4.5000 35',
      'ARROZ T JOAO 5KG un ' || d || ' 21.9000 35',
      'BANANA PRATA kg ' || d || ' 6.9900 35',
      'CAFE PILAO 500G un ' || today || ' 18.9000 35',
      'LEITE ITALAC 1L un ' || (d + 1) || ' 4.5900 -',
      'MACA GALA kg ' || d || ' 8.9000 35',
      'OLEO MINERAL 100ML un ' || d || ' 9.9000 35',
      'SAL DE FRUTA ENO un ' || d || ' 3.5000 35'
    ],
    'what is shared from the store: lines of the allowlist, on the São Paulo day, with the state of the access key';
  assert (select bool_and(store_name = 'ATACADAO MOOCA') from public.shared_prices where store_cnpj = ata), 'each row carries the printed store name';
  assert (select array_agg(item_key || ' ' || unit || ' ' || seen_on || ' ' || unit_price || ' ' || coalesce(store_uf, '-') || ' ' || store_name order by item_key)
            from public.shared_prices where store_cnpj = '99888777000166')
    = array['CAFE PILAO 500G un ' || (today - 1) || ' 17.9000 35 SUPER OUTRO', 'OLEO LIZA 900ML un ' || d || ' 7.4900 - SUPER OUTRO'],
    'a photo without an access key shares under the store CNPJ, without a state; a receipt confirmed after its day, on its purchase day';
  assert (select store_name from public.shared_prices where store_cnpj = '44555666000199') = rtrim(repeat('ABCDEFGHI ', 12)),
    'the store name is trimmed and cut at 120 characters';
  -- Zero, chave vazia, "outros" (o biscoito e o remédio que o app não reconheceu), higiene, categoria fora da
  -- lista de um dos dois lados, linha sem categoria, chave comprida, nota à mão, mercado sem CNPJ, CNPJ que
  -- não é o da chave, data no futuro, rascunho, nota com linha de remédio e loja com nome de farmácia: nada.
  assert (select count(*) from public.shared_prices where item_key ~ '(SERTRALINA|OREO|SHAMPOO|MUSSARELA|NESTLE|TOMATE|AGULHINHA|DIPIRONA|SEM PISTA)') = 0,
    'a line outside the allowlist is never shared: unrecognised medicine, hygiene, "outros", no category, a key that is too long';
  assert (select count(*) from public.shared_prices where item_key ~ '^(SAL DE FRUTA ENO|AGUA OXIGENADA 10V|OLEO MINERAL 100ML) [0-9]+$') = 0,
    'a receipt with a medicine line shares nothing, not even its lines of market categories';
  -- Suplemento e primeiros socorros: a linha fica na casa, o resto da nota entra (duas notas de cada, quatro leites).
  assert (select count(*) from public.shared_prices where item_key like 'LINHA DE SAUDE%') = 0, 'a supplements or first-aid line is never shared';
  assert (select count(*) from public.shared_prices where store_cnpj = '55444333000122' and item_key ~ '^LEITE DA MESMA NOTA 1[3-6]$' and unit_price = 5.49) = 4,
    'but it does not keep the rest of its receipt at home';
  assert (select count(*) from public.shared_prices where store_cnpj like '7000000000%') = 0, 'a store named like a pharmacy shares nothing';
  assert (select array_agg(store_name order by store_cnpj) from public.shared_prices where store_cnpj like '7100000000%' and item_key = 'FEIJAO CARIOCA 1KG')
    = array['PAGUE MENOS COMERCIO DE PRODUTOS ALIMENTICIOS LTDA', 'SUPERMERCADO PAGUE MENOS', 'SUPERMERC PAGUE MENOS LTDA', 'Mercado Pague-Menos'],
    'a supermarket called Pague Menos shares like any other store';
  assert (select count(*) from public.shared_prices where item_key like 'ITEM ALEM DO TETO%') = 0, 'a receipt with more than 300 lines shares nothing';
  assert (select count(*) from public.shared_prices where store_cnpj = '55444333000122' and item_key like 'ITEM NO TETO%') = 300, 'one with 300 lines shares them all';
  -- O atacado, o outro mercado, a loja de nome comprido, as 300 do teto, os quatro leites e os quatro Pague Menos.
  assert (select count(*) from public.shared_prices) = 8 + 2 + 1 + 300 + 4 + 4, 'nothing else was shared';

  -- O dia vira só para a banana: como se a nota da Paula tivesse sido confirmada ontem, a linha já pode ser lida.
  update public.shared_prices set visible_on = today where item_key = 'BANANA PRATA';
end $$;

-- Quico: o mesmo arroz e a mesma banana, no mesmo atacado, no mesmo dia de compra, por outros preços e com
-- outro nome de loja; e o mesmo café de hoje, lido por foto (sem estado).
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_q', false) \gset
select public.create_household('Casa do Quico', 'Quico') \gset
do $$
declare
  d constant date := current_setting('test.sp_today')::date - 10;
  ata constant text := '11222333000181';
  s uuid;
  r uuid;
begin
  insert into public.stores (name, cnpj) values ('ATACADAO MOOCA LJ 12', ata) returning id into s;
  insert into public.receipts (store_id, purchased_at, access_key, source)
    values (s, (d + time '09:00') at time zone 'America/Sao_Paulo', '352610' || ata || repeat('0', 23) || '7', 'qrcode') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price) values
    (r, 'Arroz T. João 5kg', 'graos', 'un', 23.50, 23.50),
    (r, 'BANANA PRATA', 'hortifruti', 'kg', 7.49, 7.49);
  perform pg_temp.confirm_as_read(r, '[]');

  insert into public.receipts (store_id, source) values (s, 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'CAFE PILAO 500G', 'cafe_cha', 'un', 19.50, 19.50);
  perform pg_temp.confirm_as_read(r, '[]');
end $$;

reset role;
do $$
declare
  today constant date := current_setting('test.sp_today')::date;
  ata constant text := '11222333000181';
begin
  assert (select count(*) from public.shared_prices where item_key = 'ARROZ T JOAO 5KG') = 1, 'two households, same item, store and day: ONE row';
  -- O arroz foi gravado hoje pela Paula: ninguém leu ainda, e vale a última gravação, preço e nome (uma
  -- confirmação honesta conserta uma falsa), mesmo sendo compra de há 10 dias. O dia em que passa a ser lida
  -- não anda.
  assert (select unit_price || ' ' || store_name || ' ' || visible_on from public.shared_prices where item_key = 'ARROZ T JOAO 5KG')
    = '23.5000 ATACADAO MOOCA LJ 12 ' || (today + 1), 'a row nobody can read yet takes the newer write, and its day of becoming readable stays';
  -- A banana já pode ser lida: se mudasse, quem a observa saberia que outra casa acabou de confirmar uma
  -- nota. A MESMA confirmação que trocou o arroz a deixa como está: preço, nome, estado e dia.
  assert (select unit_price || ' ' || store_name || ' ' || store_uf || ' ' || visible_on from public.shared_prices where item_key = 'BANANA PRATA')
    = '6.9900 ATACADAO MOOCA 35 ' || today, 'a row that is already readable never changes';
  -- O café de hoje no atacado: a última gravação, e o estado que a foto não traz continua o que a linha já tinha.
  assert (select count(*) from public.shared_prices where item_key = 'CAFE PILAO 500G' and store_cnpj = ata) = 1, 'today too: ONE row';
  assert (select unit_price || ' ' || store_name || ' ' || store_uf || ' ' || seen_on from public.shared_prices where item_key = 'CAFE PILAO 500G' and store_cnpj = ata)
    = '19.5000 ATACADAO MOOCA LJ 12 35 ' || today, 'on the row of today the newer write is the price and the name';
  assert (select count(*) from public.shared_prices) = 8 + 2 + 1 + 300 + 4 + 4, 'and no row more';
end $$;

-- Saulo comprou outro arroz (tem apelido, mas não o do arroz da Paula). A loja dele veio sem nome da leitura.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_s', false) \gset
select public.create_household('Casa do Saulo', 'Saulo') \gset
do $$
declare
  ata constant text := '11222333000181';
  s uuid;
  r uuid;
  i uuid;
begin
  insert into public.receipts (source) values ('manual') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, unit, unit_price, total_price)
    values (r, 'ARROZ CAMIL 5KG', 'un', 24.00, 24.00) returning id into i;
  perform pg_temp.confirm_as_read(r, jsonb_build_array(
    jsonb_build_object('id', i, 'new_product', jsonb_build_object('name', 'Arroz', 'category', 'graos'))));
  assert (select count(*) from public.product_aliases) = 1, 'S has an alias of its own';

  -- O nome que o app inventa quando a leitura não trouxe nenhum não troca o nome de verdade; numa linha
  -- nova, vai ele mesmo.
  insert into public.stores (name, cnpj) values ('CNPJ ' || ata, ata) returning id into s;
  insert into public.receipts (store_id, source) values (s, 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price) values
    (r, 'CAFE PILAO 500G', 'cafe_cha', 'un', 20.00, 20.00),
    (r, 'MACARRAO RENATA 500G', 'graos', 'un', 3.99, 3.99);
  perform pg_temp.confirm_as_read(r, '[]');
  -- Tem nota confirmada e o atacado entre os mercados dele, mas não a descrição do arroz da Paula.
  assert (select count(*) from public.shared_latest_prices()) = 0, 'a household without that description sees nothing';
end $$;

-- As linhas para a leitura, postas direto (como servidor): o arroz em vários mercados, dias e estados.
reset role;
do $$
declare
  today constant date := current_setting('test.sp_today')::date;
  ata constant text := '11222333000181';
begin
  assert (select unit_price || ' ' || store_name from public.shared_prices where item_key = 'CAFE PILAO 500G' and store_cnpj = ata) = '20.0000 ATACADAO MOOCA LJ 12',
    'the placeholder name does not replace a real one (the price is still the newer)';
  assert (select store_name || ' ' || coalesce(store_uf, '-') from public.shared_prices where item_key = 'MACARRAO RENATA 500G') = 'CNPJ ' || ata || ' -',
    'and on a new row it is accepted';

  -- A última coluna é o dia em que a linha passa a ser lida: o seguinte ao da gravação. Quase todas como a
  -- nota confirmada no próprio dia da compra; as outras são o que se testa.
  insert into public.shared_prices (store_cnpj, store_uf, store_name, item_key, unit, seen_on, unit_price, visible_on) values
    -- No atacado: a de há 3 dias é mais nova que a de há 6 (as duas já podem ser lidas) e que a de há 10;
    -- outra unidade é outra linha.
    (ata, '35', 'ATACADAO MOOCA', 'ARROZ T JOAO 5KG', 'un', today - 6, 22.00, today - 5),
    (ata, '35', 'ATACADAO MOOCA', 'ARROZ T JOAO 5KG', 'un', today - 3, 24.10, today - 2),
    (ata, '35', 'ATACADAO MOOCA', 'ARROZ T JOAO 5KG', 'kg', today - 5, 4.80, today - 4),
    -- Ninguém lê ainda: a compra de anteontem e a de ontem gravadas HOJE (o que conta é o dia da gravação), a
    -- de hoje, e uma de amanhã. Mais novas e mais baratas que a de há 3 dias, que continua sendo a que se vê.
    (ata, '35', 'ATACADAO MOOCA', 'ARROZ T JOAO 5KG', 'un', today - 2, 2.00, today + 1),
    (ata, '35', 'ATACADAO MOOCA', 'ARROZ T JOAO 5KG', 'un', today - 1, 1.50, today + 1),
    (ata, '35', 'ATACADAO MOOCA', 'ARROZ T JOAO 5KG', 'un', today, 1.00, today + 1),
    (ata, '35', 'ATACADAO MOOCA', 'ARROZ T JOAO 5KG', 'un', today + 1, 0.50, today + 2),
    -- Os 90 dias contam do dia da COMPRA: há 91 dias é velho demais, mesmo gravado há pouco (a nota
    -- confirmada com atraso). Há exatamente 90: ainda vale (e é o mais barato de São Paulo).
    ('99888777000166', '35', 'SUPER OUTRO', 'ARROZ T JOAO 5KG', 'un', today - 91, 10.00, today - 5),
    ('60000000000108', '35', 'MERCADO SP 8', 'ARROZ T JOAO 5KG', 'un', today - 90, 15.00, today - 89),
    -- No Rio e num mercado sem estado (só fotos): mais baratos, mas não para quem compra em São Paulo.
    ('60000000000201', '33', 'MERCADO RJ', 'ARROZ T JOAO 5KG', 'un', today - 2, 9.00, today - 1),
    ('60000000000301', null, 'MERCADO SEM ESTADO', 'ARROZ T JOAO 5KG', 'un', today - 2, 8.00, today - 1),
    -- Gravada ontem, lida a partir de hoje: o primeiro dia em que aparece.
    ('60000000000101', '35', 'MERCADO SP 1', 'ARROZ T JOAO 5KG', 'kg', today - 4, 5.10, today),
    -- No MERCADO SP 2 (22 reais há 2 dias, logo abaixo): uma linha mais nova sem estado (nota lida por foto),
    -- que para quem não compra ali não conta, e uma de hoje, que ninguém lê.
    ('60000000000102', null, 'MERCADO SP 2', 'ARROZ T JOAO 5KG', 'un', today - 1, 1.50, today),
    ('60000000000102', '35', 'MERCADO SP 2', 'ARROZ T JOAO 5KG', 'un', today, 1.00, today + 1),
    -- Na padaria que vai ser mercado da Rita: sem estado, há exatamente 90 dias (vale); e há 91 (velho demais).
    ('12345678000195', null, 'PADARIA DA RITA', 'ARROZ T JOAO 5KG', 'un', today - 90, 14.00, today - 89),
    ('12345678000195', '35', 'PADARIA DA RITA', 'ARROZ T JOAO 5KG', 'kg', today - 91, 3.00, today - 90);
  -- Sete mercados de São Paulo, de 21 a 27 reais.
  insert into public.shared_prices (store_cnpj, store_uf, store_name, item_key, unit, seen_on, unit_price, visible_on)
    select '6000000000010' || g, '35', 'MERCADO SP ' || g, 'ARROZ T JOAO 5KG', 'un', today - 2, 20 + g, today - 1 from generate_series(1, 7) as g;

  -- A linha nunca pode ser lida no dia da compra, nem antes: o banco recusa, venha de onde vier.
  begin
    insert into public.shared_prices (store_cnpj, store_uf, store_name, item_key, unit, seen_on, unit_price, visible_on)
      values (ata, '35', 'ATACADAO MOOCA', 'ARROZ T JOAO 5KG', 'l', today - 1, 3.00, today - 1);
    raise exception 'FAIL: a row readable on its own purchase day';
  exception when check_violation then null;
  end;
end $$;

-- Rita tem a descrição do arroz e o atacado entre os mercados dela.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_r', false) \gset
select public.create_household('Casa da Rita', 'Rita') \gset
do $$
declare
  today constant date := current_setting('test.sp_today')::date;
  ata constant text := '11222333000181';
  s_ata uuid;
  s_bakery uuid;
  r uuid;
  i uuid;
  p uuid;
  c uuid;
  seen record;
begin
  assert (select count(*) from public.shared_latest_prices()) = 0, 'a household without the description sees nothing';

  -- Um membro grava os próprios produtos, apelidos e mercados (é a regra de sempre). Sem nota confirmada
  -- nenhuma, ainda assim não vê nada.
  insert into public.products (name, category) values ('Arroz', 'graos') returning id into p;
  insert into public.product_aliases (alias, product_id) values ('ARROZ T JOAO 5KG', p);
  insert into public.stores (name, cnpj) values ('Atacadão da Rita', ata) returning id into s_ata;
  assert (select count(*) from public.shared_latest_prices()) = 0, 'a household with no confirmed receipt sees nothing';

  -- Com uma nota confirmada (digitada, que não compartilha nada): os preços do atacado, que é mercado dela.
  -- Dos outros mercados, nada: ela não tem nota lida em estado nenhum.
  insert into public.receipts (source) values ('manual') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, unit, unit_price, total_price)
    values (r, 'arroz t.joão 5kg', 'un', 26.00, 26.00) returning id into i;
  perform pg_temp.confirm_as_read(r, jsonb_build_array(jsonb_build_object('id', i, 'product_id', p)));
  assert (select array_agg(store_cnpj || ' ' || unit || ' ' || unit_price || ' ' || seen_on || ' ' || mine order by unit) from public.shared_latest_prices())
    = array[ata || ' kg 4.8000 ' || (today - 5) || ' true', ata || ' un 24.1000 ' || (today - 3) || ' true'],
    'in her own stores: the newest READABLE row per store and unit, never one written today (whatever its purchase day) or dated ahead; nothing from other stores without a state';
  select * into seen from public.shared_latest_prices() where unit = 'un';
  assert seen.product_id = p and seen.store_name = 'ATACADAO MOOCA' and seen.store_uf = '35', 'her product, the store name and state as shared';
  -- O que volta é só isso: nada de casa, pessoa, nota ou hora, nem o dia em que a linha passou a ser lida
  -- (visible_on não sai do banco: diria em que dia a nota foi confirmada).
  assert (select array_agg(k order by k) from jsonb_object_keys(to_jsonb(seen)) as k)
    = array['mine', 'product_id', 'seen_on', 'store_cnpj', 'store_name', 'store_uf', 'unit', 'unit_price'], 'the answer has only these columns';
  assert (select proargnames from pg_proc where oid = 'public.shared_latest_prices()'::regprocedure)
    = array['product_id', 'store_cnpj', 'store_name', 'store_uf', 'unit', 'unit_price', 'seen_on', 'mine'],
    'and the function declares no other column';
  perform set_config('test.sp_product_r', p::text, false);

  -- O estado vem só de nota LIDA e CONFIRMADA: um rascunho do QR code do Rio e uma nota digitada com chave
  -- do Rio não abrem os mercados de lá.
  insert into public.receipts (access_key, source) values ('332610' || '60000000000201' || repeat('0', 24), 'qrcode');
  insert into public.receipts (access_key, source) values ('332610' || '60000000000201' || repeat('0', 23) || '1', 'manual') returning id into r;
  perform pg_temp.confirm_as_read(r, '[]');
  assert (select count(*) from public.shared_latest_prices() where not mine) = 0, 'a draft, or a hand-typed receipt, gives the household no state';

  -- Uma nota lida em São Paulo (a chave começa com 35), na padaria: agora também os outros mercados do
  -- estado, no máximo os 5 mais baratos de cada produto e unidade. Os do Rio e o sem estado não, por mais
  -- baratos que sejam; e a linha sem estado só conta no mercado da própria casa (a padaria, agora).
  insert into public.stores (name, cnpj) values ('Padaria do bairro', '12345678000195') returning id into s_bakery;
  insert into public.receipts (store_id, purchased_at, access_key, source)
    values (s_bakery, (today - 20 + time '08:00') at time zone 'America/Sao_Paulo', '352610' || '12345678000195' || repeat('0', 24), 'qrcode') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'PAO FRANCES', 'padaria', 'kg', 17.90, 17.90);
  perform pg_temp.confirm_as_read(r, '[]');
  assert (select array_agg(store_name || ' ' || unit || ' ' || unit_price || ' ' || seen_on || ' ' || mine order by mine desc, unit, unit_price) from public.shared_latest_prices())
    = array[
      'ATACADAO MOOCA kg 4.8000 ' || (today - 5) || ' true',
      'PADARIA DA RITA un 14.0000 ' || (today - 90) || ' true',
      'ATACADAO MOOCA un 24.1000 ' || (today - 3) || ' true',
      'MERCADO SP 1 kg 5.1000 ' || (today - 4) || ' false',
      'MERCADO SP 8 un 15.0000 ' || (today - 90) || ' false',
      'MERCADO SP 1 un 21.0000 ' || (today - 2) || ' false',
      'MERCADO SP 2 un 22.0000 ' || (today - 2) || ' false',
      'MERCADO SP 3 un 23.0000 ' || (today - 2) || ' false',
      'MERCADO SP 4 un 24.0000 ' || (today - 2) || ' false'
    ],
    'her own stores first, then the 5 cheapest of her state per product and unit; 90 days still count, 91 do not';

  -- Outra descrição do mesmo produto, e o café como outro produto (um membro grava os próprios apelidos; só a
  -- chave exata recebe preço: é informação de mercado, e não há como listar a tabela).
  insert into public.products (name, category) values ('Café', 'cafe_cha') returning id into c;
  insert into public.product_aliases (alias, product_id) values ('ARROZ TIO JOAO TP1 5KG', p), ('CAFE PILAO 500G', c);
  begin
    insert into public.product_aliases (alias, product_id) values ('arroz%', p);
    raise exception 'FAIL: an alias that is not a normalised key';
  exception when check_violation then null;
  end;
  -- O café foi comprado HOJE por três casas no atacado, e ONTEM no SUPER OUTRO, numa nota confirmada hoje; e
  -- há arroz gravado hoje no atacado, de hoje e de dias que já passaram: quem pergunta hoje não vê nenhum.
  assert (select count(*) from public.shared_latest_prices() where product_id = c or seen_on >= today) = 0, 'nothing bought or written today is visible today';
  perform set_config('test.sp_product_c', c::text, false);

  -- O macarrão que o Saulo gravou hoje com o nome inventado e sem estado: a Rita confirma, no mesmo dia, uma
  -- nota do QR code do mesmo atacado. (Sem produto: não vira preço próprio dela nem apelido.)
  insert into public.receipts (store_id, access_key, source) values (s_ata, '352610' || ata || repeat('0', 23) || '5', 'qrcode') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'MACARRAO RENATA 500G', 'graos', 'un', 4.29, 4.29);
  perform pg_temp.confirm_as_read(r, '[]');
end $$;

reset role;
do $$
declare
  today constant date := current_setting('test.sp_today')::date;
begin
  -- A outra descrição do mesmo produto, mais nova, no MERCADO SP 1: é ela o preço do produto ali.
  insert into public.shared_prices (store_cnpj, store_uf, store_name, item_key, unit, seen_on, unit_price, visible_on)
    values ('60000000000101', '35', 'MERCADO SP 1', 'ARROZ TIO JOAO TP1 5KG', 'un', today - 1, 25.00, today);
  -- A linha que ainda não pode ser lida aceita o nome de verdade e o estado no lugar do nome inventado e do
  -- estado vazio (e o preço mais novo): é a nota de ontem com leitura ruim, consertada no mesmo dia.
  assert (select unit_price || ' ' || store_name || ' ' || store_uf || ' ' || visible_on from public.shared_prices where item_key = 'MACARRAO RENATA 500G')
    = '4.2900 Atacadão da Rita 35 ' || (today + 1), 'before it is readable, the real name and the state replace the placeholder';

  -- O dia vira para o café. A linha da compra de ontem (SUPER OUTRO), gravada hoje, passa a poder ser lida
  -- sem mudar em mais nada; a da compra de "hoje" no atacado passa a ser de ontem.
  update public.shared_prices set visible_on = today where item_key = 'CAFE PILAO 500G' and store_cnpj = '99888777000166';
  update public.shared_prices set seen_on = today - 1, visible_on = today where item_key = 'CAFE PILAO 500G' and store_cnpj = '11222333000181';
end $$;

set role authenticated;
do $$
declare
  today constant date := current_setting('test.sp_today')::date;
  ata constant text := '11222333000181';
  p constant uuid := current_setting('test.sp_product_r')::uuid;
  c constant uuid := current_setting('test.sp_product_c')::uuid;
  s_ata constant uuid := (select id from public.stores where cnpj = ata);
  r uuid;
  i uuid;
begin
  -- Um rascunho da casa com o arroz, no atacado, de ontem: rascunho não é preço próprio e não esconde nada.
  insert into public.receipts (store_id, purchased_at, source)
    values (s_ata, (today - 1 + time '10:00') at time zone 'America/Sao_Paulo', 'manual') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, product_id, unit, unit_price, total_price)
    values (r, 'arroz no rascunho', p, 'un', 23.00, 23.00);
  -- Uma nota confirmada da casa com o arroz no atacado, ontem, sem valor (preço zero: a leitura não trouxe o
  -- valor): zero não é preço, e a compra sem valor não esconde nenhuma linha (a conta abaixo segue igual).
  insert into public.receipts (store_id, purchased_at, source)
    values (s_ata, (today - 1 + time '11:00') at time zone 'America/Sao_Paulo', 'manual') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, unit, unit_price, total_price)
    values (r, 'arroz sem valor', 'un', 0, 0) returning id into i;
  perform pg_temp.confirm_as_read(r, jsonb_build_array(jsonb_build_object('id', i, 'product_id', p)));

  assert (select array_agg(store_name || ' ' || unit || ' ' || unit_price || ' ' || seen_on || ' ' || mine order by mine desc, unit, unit_price, seen_on desc) from public.shared_latest_prices())
    = array[
      'ATACADAO MOOCA kg 4.8000 ' || (today - 5) || ' true',
      'PADARIA DA RITA un 14.0000 ' || (today - 90) || ' true',
      -- O café, a partir do dia seguinte: com o preço e o nome da última gravação.
      'ATACADAO MOOCA LJ 12 un 20.0000 ' || (today - 1) || ' true',
      'ATACADAO MOOCA un 24.1000 ' || (today - 3) || ' true',
      'MERCADO SP 1 kg 5.1000 ' || (today - 4) || ' false',
      'MERCADO SP 8 un 15.0000 ' || (today - 90) || ' false',
      -- O café comprado ontem no SUPER OUTRO: no dia em que foi confirmado não aparecia; virado o dia, aparece.
      'SUPER OUTRO un 17.9000 ' || (today - 1) || ' false',
      'MERCADO SP 2 un 22.0000 ' || (today - 2) || ' false',
      'MERCADO SP 3 un 23.0000 ' || (today - 2) || ' false',
      'MERCADO SP 4 un 24.0000 ' || (today - 2) || ' false',
      -- A descrição mais nova é o preço do produto no MERCADO SP 1; empatado com o MERCADO SP 5, fica o visto por último.
      'MERCADO SP 1 un 25.0000 ' || (today - 1) || ' false'
    ],
    'one row per product, store and unit: the newest among the descriptions of the product; a row shows from the day after it was written';
  assert (select bool_and(product_id in (p, c)) from public.shared_latest_prices()), 'always for a product of the caller';

  -- O que a casa já sabe fica de fora, aqui mesmo no banco: com preço PRÓPRIO do produto num mercado dela com
  -- aquele CNPJ, no mesmo dia ou depois, a linha é a compra dela ou notícia mais velha. Uma compra de há 5
  -- dias (digitada: preço próprio é o de qualquer nota) tira a linha de há 5 dias, em qualquer unidade, e
  -- deixa a de há 3.
  insert into public.receipts (store_id, purchased_at, source)
    values (s_ata, (today - 5 + time '10:00') at time zone 'America/Sao_Paulo', 'manual') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, unit, unit_price, total_price)
    values (r, 'arroz a granel', 'un', 23.00, 23.00) returning id into i;
  perform pg_temp.confirm_as_read(r, jsonb_build_array(jsonb_build_object('id', i, 'product_id', p)));
  assert (select array_agg(store_name || ' ' || unit || ' ' || unit_price order by unit_price) from public.shared_latest_prices() where mine and product_id = p)
    = array['PADARIA DA RITA un 14.0000', 'ATACADAO MOOCA un 24.1000'],
    'an own purchase on the same day or later hides the row, in that store only; an older one does not';
  -- O dia da compra é o de São Paulo: às 23:30 de há 4 dias (em UTC já é o dia seguinte) ainda é mais velha
  -- que a linha de há 3.
  insert into public.receipts (store_id, purchased_at, source)
    values (s_ata, (today - 4 + time '23:30') at time zone 'America/Sao_Paulo', 'manual') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, unit, unit_price, total_price)
    values (r, 'arroz a granel', 'un', 23.00, 23.00) returning id into i;
  perform pg_temp.confirm_as_read(r, jsonb_build_array(jsonb_build_object('id', i, 'product_id', p)));
  assert (select count(*) from public.shared_latest_prices() where mine and product_id = p and store_cnpj = ata) = 1, 'the day of the own purchase is the São Paulo day';
  -- A compra de ontem tira o que sobrava do arroz no atacado. Só daquele produto, naquele mercado: o café
  -- dali (visto ontem também) e os outros mercados continuam.
  insert into public.receipts (store_id, purchased_at, source)
    values (s_ata, (today - 1 + time '12:00') at time zone 'America/Sao_Paulo', 'manual') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, unit, unit_price, total_price)
    values (r, 'arroz a granel', 'un', 23.00, 23.00) returning id into i;
  perform pg_temp.confirm_as_read(r, jsonb_build_array(jsonb_build_object('id', i, 'product_id', p)));
  assert (select array_agg(store_name || ' ' || unit_price order by unit_price) from public.shared_latest_prices() where mine)
    = array['PADARIA DA RITA 14.0000', 'ATACADAO MOOCA LJ 12 20.0000'], 'nothing of that product in that store is left; another product there, and another store, stay';
  assert (select count(*) from public.shared_latest_prices() where not mine) = 7, 'and the other stores are untouched by it';

  -- Pedindo a casa de outra pessoa no cabeçalho: nenhuma casa, nenhuma linha.
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.sp_house_p'))::text, true);
  assert public.current_household_id() is null and (select count(*) from public.shared_latest_prices()) = 0, 'a forged household header reads nothing';
end $$;

-- Úrsula tem o mesmo arroz, comprado no Rio (a chave começa com 33): vê o mercado do Rio, e nenhum de São Paulo.
select set_config('request.jwt.claim.sub', :'user_u', false) \gset
select public.create_household('Casa da Úrsula', 'Úrsula') \gset
do $$
declare
  today constant date := current_setting('test.sp_today')::date;
  s uuid;
  r uuid;
  i uuid;
begin
  insert into public.stores (name, cnpj) values ('MERCADO CARIOCA', '33444555000177') returning id into s;
  insert into public.receipts (store_id, purchased_at, access_key, source)
    values (s, (today - 6 + time '10:00') at time zone 'America/Sao_Paulo', '332610' || '33444555000177' || repeat('0', 24), 'qrcode') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'ARROZ T.JOAO 5KG', 'graos', 'un', 27.00, 27.00) returning id into i;
  perform pg_temp.confirm_as_read(r, jsonb_build_array(
    jsonb_build_object('id', i, 'new_product', jsonb_build_object('name', 'Arroz', 'category', 'graos'))));
  -- A compra dela mesma também está na base, e não volta para ela.
  assert (select array_agg(store_name || ' ' || store_uf || ' ' || unit_price || ' ' || mine) from public.shared_latest_prices())
    = array['MERCADO RJ 33 9.0000 false'], 'only stores of the state where the household buys, and never its own purchase';
end $$;

-- Tina não tem casa: nada.
select set_config('request.jwt.claim.sub', :'user_t', false) \gset
do $$
begin
  assert public.current_household_id() is null, 'T has no household';
  assert (select count(*) from public.shared_latest_prices()) = 0, 'no household, no rows';
  -- O cartão da aba Família só pergunta se o compartilhamento existe: o sim não depende da casa.
  assert public.shared_prices_available() is true, 'a signed-in person learns that sharing exists';
end $$;

-- Sem entrar, nem a função, nem a pergunta do cartão.
set role anon;
do $$
begin
  perform public.shared_latest_prices();
  raise exception 'FAIL: anon read the shared prices';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.shared_prices_available();
  raise exception 'FAIL: anon asked whether sharing exists';
exception when insufficient_privilege then null;
end $$;

-- A tabela: ninguém do app lê nem grava, nem com casa, nem sem entrar.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_r', false) \gset
do $$
declare
  stmt text;
begin
  foreach stmt in array array[
    'select 1 from public.shared_prices',
    $q$insert into public.shared_prices values ('11222333000181', '35', 'X', 'X', 'un', current_date, 1, current_date + 1)$q$,
    'update public.shared_prices set unit_price = 1',
    'delete from public.shared_prices'
  ] loop
    begin
      execute stmt;
      raise exception 'FAIL: a member ran: %', stmt;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    perform public.share_receipt_prices();
    raise exception 'FAIL: a member called the trigger function';
  exception when insufficient_privilege then null;
  end;
end $$;
set role anon;
do $$
declare
  stmt text;
begin
  foreach stmt in array array[
    'select 1 from public.shared_prices',
    $q$insert into public.shared_prices values ('11222333000181', '35', 'X', 'X', 'un', current_date, 1, current_date + 1)$q$,
    'update public.shared_prices set unit_price = 1',
    'delete from public.shared_prices'
  ] loop
    begin
      execute stmt;
      raise exception 'FAIL: anon ran: %', stmt;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;
reset role;
do $$
declare
  who text;
  verb text;
begin
  -- Cada permissão conferida sozinha (com uma lista, has_table_privilege diz sim se a pessoa tem qualquer uma).
  foreach verb in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
    foreach who in array array['anon', 'authenticated'] loop
      assert not has_table_privilege(who, 'public.shared_prices', verb), format('%s has no %s on shared_prices', who, verb);
    end loop;
  end loop;
  foreach verb in array array['select', 'insert', 'update', 'delete'] loop
    assert has_table_privilege('service_role', 'public.shared_prices', verb), format('the service role has %s on shared_prices', verb);
  end loop;
  assert (select relrowsecurity from pg_class where oid = 'public.shared_prices'::regclass), 'RLS is on for shared_prices';
  assert (select count(*) from pg_policies where schemaname = 'public' and tablename = 'shared_prices') = 0, 'and no policy opens the table';
  foreach who in array array['public', 'anon', 'authenticated'] loop
    assert not has_function_privilege(who, 'public.share_receipt_prices()', 'execute'), format('%s cannot execute the trigger function', who);
  end loop;
  assert not has_function_privilege('public', 'public.shared_latest_prices()', 'execute'), 'the read function is not open to everyone';
  assert not has_function_privilege('anon', 'public.shared_latest_prices()', 'execute'), 'anon cannot execute the read function';
  assert has_function_privilege('authenticated', 'public.shared_latest_prices()', 'execute'), 'a signed-in person can';
  assert not has_function_privilege('public', 'public.shared_prices_available()', 'execute'), 'the availability question is not open to everyone';
  assert not has_function_privilege('anon', 'public.shared_prices_available()', 'execute'), 'anon cannot ask it';
  assert has_function_privilege('authenticated', 'public.shared_prices_available()', 'execute'), 'a signed-in person can ask it';
  assert (select proconfig from pg_proc where oid = 'public.shared_prices_available()'::regprocedure) @> array['search_path=""'],
    'the availability question has its search_path set';
end $$;

-- Compartilhar nunca derruba a confirmação: com a gravação recusada (uma regra posta aqui só para isso), a
-- nota fica confirmada, com apelido e tudo, e nada dela entra (nem a linha que passaria).
alter table public.shared_prices add constraint test_refuses_item check (item_key <> 'ITEM QUE EMPERRA') not valid;
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
do $$
declare
  d constant date := current_setting('test.sp_today')::date - 2;
  s uuid;
  r uuid;
  i uuid;
begin
  select id into s from public.stores where cnpj = '11222333000181';
  insert into public.receipts (store_id, purchased_at, source)
    values (s, (d + time '10:00') at time zone 'America/Sao_Paulo', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, position, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 0, 'ITEM QUE EMPERRA', 'graos', 'un', 5.00, 5.00);
  insert into public.receipt_items (receipt_id, position, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 1, 'SABAO OMO 1KG', 'limpeza', 'un', 19.90, 19.90) returning id into i;
  perform pg_temp.confirm_as_read(r, jsonb_build_array(
    jsonb_build_object('id', i, 'new_product', jsonb_build_object('name', 'Sabão Omo 1kg', 'category', 'limpeza'))));
  assert (select status from public.receipts where id = r) = 'confirmed', 'a failing share leaves the receipt confirmed';
  assert (select count(*) from public.product_aliases where alias = 'SABAO OMO 1KG') = 1, 'with everything the confirmation does';
  assert (select count(*) from public.latest_prices where store_id = s and unit_price = 19.90) = 1, 'and the household keeps its own price';

  -- Confirmar de novo continua sendo erro, como antes.
  begin
    perform public.confirm_receipt(r, '[]');
    raise exception 'FAIL: receipt confirmed twice';
  exception when unique_violation then null;
  end;
  begin
    perform public.confirm_receipt(current_setting('test.sp_receipt_photo')::uuid, '[]');
    raise exception 'FAIL: receipt confirmed twice';
  exception when unique_violation then null;
  end;

  -- Só a passagem de rascunho para confirmada compartilha: mexer numa nota já confirmada (e gravar o status
  -- de novo, igual) não regrava nada.
  update public.receipt_items set raw_description = 'LEITE DEPOIS DE CONFIRMADA', unit_price = 9.99 where receipt_id = current_setting('test.sp_receipt_photo')::uuid;
  update public.receipts set status = 'confirmed' where id = current_setting('test.sp_receipt_photo')::uuid;

  -- Excluir a nota não retira o que ela deu: nada liga uma coisa à outra.
  delete from public.receipts where id = current_setting('test.sp_receipt_qr')::uuid;
end $$;
reset role;
alter table public.shared_prices drop constraint test_refuses_item;
do $$
declare
  d constant date := current_setting('test.sp_today')::date - 10;
begin
  assert (select count(*) from public.shared_prices where item_key in ('ITEM QUE EMPERRA', 'SABAO OMO 1KG')) = 0,
    'nothing of the receipt whose share failed, not even the line that would pass';
  assert (select count(*) from public.receipts where id = current_setting('test.sp_receipt_qr')::uuid) = 0, 'the receipt is gone';
  assert (select unit_price from public.shared_prices where item_key = 'BANANA PRATA' and seen_on = d) = 6.99, 'and what it shared stays';
  assert (select unit_price from public.shared_prices where item_key = 'LEITE ITALAC 1L') = 4.59
    and (select count(*) from public.shared_prices where item_key = 'LEITE DEPOIS DE CONFIRMADA') = 0,
    'confirming twice, or touching a confirmed receipt, changed nothing';
end $$;
reset time zone;

-- ---------------------------------------------------------------------------
\echo '• preços conferidos pelo servidor: só entra o que a leitura da nota trouxe'
-- Elisa compra no atacado e mexe na nota na revisão; Edu é de outra casa. As leituras são gravadas como o
-- servidor grava (service_role); a casa só passa o id delas na nota.
\set user_e1 '00000000-0000-0000-0000-0000000000e1'
\set user_e2 '00000000-0000-0000-0000-0000000000e2'
\set user_e3 '00000000-0000-0000-0000-0000000000e3'
reset role;
insert into auth.users (id) values (:'user_e1'), (:'user_e2'), (:'user_e3');
truncate public.shared_prices;
set time zone 'UTC';
select set_config('test.rr_today', ((now() at time zone 'America/Sao_Paulo')::date)::text, false) \gset

do $$
declare
  verb text;
begin
  -- A tabela das leituras é só do servidor: o app não lê nem grava, nem com policy, nem com grant.
  foreach verb in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
    assert not has_table_privilege('anon', 'public.receipt_reads', verb), format('anon has no %s on receipt_reads', verb);
    assert not has_table_privilege('authenticated', 'public.receipt_reads', verb), format('authenticated has no %s on receipt_reads', verb);
  end loop;
  foreach verb in array array['select', 'insert', 'update', 'delete'] loop
    assert has_table_privilege('service_role', 'public.receipt_reads', verb), format('the service role has %s on receipt_reads', verb);
  end loop;
  assert (select relrowsecurity from pg_class where oid = 'public.receipt_reads'::regclass), 'RLS is on for receipt_reads';
  assert (select count(*) from pg_policies where schemaname = 'public' and tablename = 'receipt_reads') = 0, 'and no policy opens it';
  -- A nota guarda o id da leitura, e a casa pode gravá-lo (é a nota dela).
  assert has_column_privilege('authenticated', 'public.receipts', 'read_id', 'insert')
    and has_column_privilege('authenticated', 'public.receipts', 'read_id', 'update'), 'a member writes read_id on a receipt';
  -- A limpeza é só do agendador.
  assert not has_function_privilege('public', 'public.forget_receipt_reads()', 'execute'), 'the cleanup is not open to everyone';
  assert not has_function_privilege('anon', 'public.forget_receipt_reads()', 'execute'), 'anon cannot run the cleanup';
  assert not has_function_privilege('authenticated', 'public.forget_receipt_reads()', 'execute'), 'a member cannot run the cleanup';
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', :'user_e2', false) \gset
select set_config('test.rr_house_e2', (public.create_household('Casa do Edu', 'Edu')).id::text, false) \gset
select set_config('request.jwt.claim.sub', :'user_e1', false) \gset
select set_config('test.rr_house_e1', (public.create_household('Casa da Elisa', 'Elisa')).id::text, false) \gset
do $$
declare
  d constant date := current_setting('test.rr_today')::date - 5;
  cnpj constant text := '22333444000155';
  s uuid;
  r uuid;
  k integer := 0;
begin
  -- O mercado com o nome que a Elisa deu; a data da nota, mudada na revisão para três dias antes.
  insert into public.stores (name, cnpj) values ('Meu atacado', cnpj) returning id into s;
  perform set_config('test.rr_store', s::text, false);
  foreach k in array array[1, 2, 3, 4, 5, 6, 7, 8] loop
    insert into public.receipts (store_id, purchased_at, access_key, source)
      values (s, (d - 3 + time '10:00') at time zone 'America/Sao_Paulo', '352610' || cnpj || repeat('0', 23) || k, 'qrcode') returning id into r;
    perform set_config('test.rr_receipt_' || k, r::text, false);
  end loop;

  -- A nota 1, como ficou depois da revisão.
  r := current_setting('test.rr_receipt_1')::uuid;
  insert into public.receipt_items (receipt_id, position, raw_description, suggested_category, quantity, unit, unit_price, total_price) values
    -- Igual ao lido: entra.
    (r, 0, 'LEITE PIRACANJUBA 1L', 'laticinios', 1, 'un', 4.99, 4.99),
    -- Igual ao lido, com outra caixa e outros espaços (a mesma chave): entra.
    (r, 1, 'banana   prata', 'hortifruti', 1, 'kg', 6.99, 6.99),
    -- Preço mudado na revisão (a leitura diz 18,90): fica na casa.
    (r, 2, 'CAFE MELITTA 500G', 'cafe_cha', 1, 'un', 1.50, 1.50),
    -- Descrição redigitada (a leitura diz ACUCAR UNIAO 1KG): fica na casa.
    (r, 3, 'ACUCAR UNIAO 1KG REFINADO', 'doces', 1, 'un', 4.79, 4.79),
    -- Unidade mudada (a leitura diz un): fica na casa.
    (r, 4, 'FEIJAO KICALDO 1KG', 'graos', 1, 'kg', 8.90, 8.90),
    -- Linha que a leitura não trouxe: fica na casa.
    (r, 5, 'ARROZ QUE NINGUEM LEU 5KG', 'graos', 1, 'un', 0.99, 0.99),
    -- Lida, mas fora da lista do que se compartilha: as regras de sempre continuam valendo.
    (r, 6, 'SHAMPOO SEDA 325ML', 'higiene', 1, 'un', 12.90, 12.90);

  -- As notas 2 a 8 têm a mesma linha, igual à da leitura de cada uma.
  foreach k in array array[2, 3, 4, 5, 6, 7, 8] loop
    insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
      values (current_setting('test.rr_receipt_' || k)::uuid, 'OLEO SOYA 900ML ' || k, 'oleos', 'un', 7.49, 7.49);
  end loop;

  -- A casa não alcança as leituras: nem ler, nem gravar.
  begin
    perform 1 from public.receipt_reads;
    raise exception 'FAIL: a member read receipt_reads';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.receipt_reads (household_id, source, store_cnpj, purchased_on, lines)
      values (public.current_household_id(), 'qrcode', cnpj, d, '[{"description": "LEITE FALSO", "unit": "un", "unit_price": 0.01}]');
    raise exception 'FAIL: a member wrote a read';
  exception when insufficient_privilege then null;
  end;
end $$;

-- As leituras, como o servidor as grava: do atacado, com o nome impresso e o dia impresso (d, não o da revisão).
reset role;
set role service_role;
do $$
declare
  d constant date := current_setting('test.rr_today')::date - 5;
  cnpj constant text := '22333444000155';
  hh constant uuid := current_setting('test.rr_house_e1')::uuid;
  key_of text;
  k integer;
  rid uuid;
begin
  insert into public.receipt_reads (household_id, source, access_key, store_cnpj, store_name, purchased_on, lines)
    values (hh, 'qrcode', '352610' || cnpj || repeat('0', 23) || '1', cnpj, 'ATACADAO DO PORTO LTDA', d, jsonb_build_array(
      jsonb_build_object('description', 'LEITE PIRACANJUBA 1L', 'unit', 'un', 'unit_price', 4.99),
      jsonb_build_object('description', 'BANANA PRATA', 'unit', 'kg', 'unit_price', 6.99),
      jsonb_build_object('description', 'CAFE MELITTA 500G', 'unit', 'un', 'unit_price', 18.90),
      jsonb_build_object('description', 'ACUCAR UNIAO 1KG', 'unit', 'un', 'unit_price', 4.79),
      jsonb_build_object('description', 'FEIJAO KICALDO 1KG', 'unit', 'un', 'unit_price', 8.90),
      jsonb_build_object('description', 'SHAMPOO SEDA 325ML', 'unit', 'un', 'unit_price', 12.90)))
    returning id into rid;
  perform set_config('test.rr_read_1', rid::text, false);

  foreach k in array array[3, 4, 5, 6, 7, 8] loop
    key_of := '352610' || cnpj || repeat('0', 23) || k;
    insert into public.receipt_reads (household_id, source, access_key, store_cnpj, store_name, purchased_on, lines)
      values (
        hh, 'qrcode',
        -- 4: a chave é de outro emissor (o CNPJ dela não é o da leitura).
        case when k = 4 then '352610' || '99888777000166' || repeat('0', 23) || k else key_of end,
        -- 5: a leitura não trouxe o CNPJ.
        case when k = 5 then null else cnpj end,
        -- 7: nem o nome (vai o "CNPJ ..." que o app põe no mercado novo).
        case when k = 7 then null else 'ATACADAO DO PORTO LTDA' end,
        -- 6: nem o dia.
        case when k = 6 then null else d end,
        -- 8: linhas que não são objetos (leitura malformada): a confirmação não falha, só nada entra.
        case when k = 8 then '[1, 2]'::jsonb
             else jsonb_build_array(jsonb_build_object('description', 'OLEO SOYA 900ML ' || k, 'unit', 'un', 'unit_price', 7.49)) end)
      returning id into rid;
    perform set_config('test.rr_read_' || k, rid::text, false);
  end loop;

  -- Uma leitura do Edu, de outra casa.
  insert into public.receipt_reads (household_id, source, access_key, store_cnpj, store_name, purchased_on, lines)
    values (current_setting('test.rr_house_e2')::uuid, 'qrcode', '352610' || cnpj || repeat('0', 23) || '9', cnpj, 'ATACADAO DO PORTO LTDA', d,
      jsonb_build_array(jsonb_build_object('description', 'OLEO SOYA 900ML 2', 'unit', 'un', 'unit_price', 7.49)))
    returning id into rid;
  perform set_config('test.rr_read_e2', rid::text, false);
end $$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_e1', false) \gset
do $$
declare
  k integer;
begin
  -- A nota da Elisa não aponta para a leitura de outra casa.
  begin
    update public.receipts set read_id = current_setting('test.rr_read_e2')::uuid where id = current_setting('test.rr_receipt_2')::uuid;
    raise exception 'FAIL: a receipt pointed at the read of another household';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.receipts (source, read_id) values ('qrcode', current_setting('test.rr_read_e2')::uuid);
    raise exception 'FAIL: a receipt created with the read of another household';
  exception when foreign_key_violation then null;
  end;
  -- Nem para um id que não existe.
  begin
    update public.receipts set read_id = gen_random_uuid() where id = current_setting('test.rr_receipt_2')::uuid;
    raise exception 'FAIL: a receipt pointed at a read that does not exist';
  exception when foreign_key_violation then null;
  end;

  -- A nota 2 fica sem leitura (um app antigo, ou uma nota de antes da leitura do servidor).
  foreach k in array array[1, 3, 4, 5, 6, 7, 8] loop
    update public.receipts set read_id = current_setting('test.rr_read_' || k)::uuid where id = current_setting('test.rr_receipt_' || k)::uuid;
  end loop;
  foreach k in array array[1, 2, 3, 4, 5, 6, 7, 8] loop
    perform public.confirm_receipt(current_setting('test.rr_receipt_' || k)::uuid, '[]');
  end loop;
  assert (select count(*) from public.receipts where status = 'confirmed') = 8, 'every receipt is confirmed, shared or not';
end $$;

reset role;
do $$
declare
  today constant date := current_setting('test.rr_today')::date;
  d constant date := today - 5;
  cnpj constant text := '22333444000155';
begin
  -- Da nota 1, só as duas linhas iguais às da leitura; com o nome impresso (não o que a casa deu ao mercado), o
  -- dia impresso (não o da revisão) e o estado da chave.
  assert (select array_agg(item_key || ' ' || unit || ' ' || unit_price || ' ' || seen_on || ' ' || store_uf || ' ' || store_name order by item_key)
            from public.shared_prices where item_key not like 'OLEO SOYA%')
    = array[
      'BANANA PRATA kg 6.9900 ' || d || ' 35 ATACADAO DO PORTO LTDA',
      'LEITE PIRACANJUBA 1L un 4.9900 ' || d || ' 35 ATACADAO DO PORTO LTDA'
    ],
    'only lines equal to the server read are shared, under the printed store name and day';
  assert (select count(*) from public.shared_prices where item_key ~ '(CAFE MELITTA|ACUCAR|FEIJAO|NINGUEM|SHAMPOO)') = 0,
    'an edited price, description or unit, a line the read did not have, and a line outside the allowlist stay at home';
  -- Das notas 2 a 8: a 3 (tudo certo) e a 7 (sem nome impresso: vai o "CNPJ ..."). A 2 não tem leitura, a 4 tem
  -- a chave de outro CNPJ, a 5 não tem CNPJ, a 6 não tem dia e a 8 é malformada.
  assert (select array_agg(item_key || ' ' || store_name || ' ' || seen_on order by item_key) from public.shared_prices where item_key like 'OLEO SOYA%')
    = array['OLEO SOYA 900ML 3 ATACADAO DO PORTO LTDA ' || d, 'OLEO SOYA 900ML 7 CNPJ ' || cnpj || ' ' || d],
    'no read, a key of another issuer, no CNPJ, no day or a malformed read: nothing';
  assert (select count(*) from public.shared_prices) = 4, 'and nothing else';
  -- A leitura serve uma vez: confirmada a nota (compartilhando ou não), o gatilho a apaga, e a nota perde o ponteiro.
  assert (select count(*) from public.receipt_reads where household_id = current_setting('test.rr_house_e1')::uuid) = 0,
    'every read of a confirmed receipt is gone';
  assert (select count(*) from public.receipts where household_id = current_setting('test.rr_house_e1')::uuid and read_id is not null) = 0,
    'and the receipts no longer point at one';
end $$;

-- Mais leituras: farmácia pelo nome impresso e pelo nome que a casa deu, uma leitura em duas notas, a nota que volta a
-- rascunho e é confirmada de novo, e a nota grande (300 itens contra 1000 linhas lidas), cronometrada.
set role service_role;
do $$
declare
  d constant date := current_setting('test.rr_today')::date - 5;
  hh constant uuid := current_setting('test.rr_house_e1')::uuid;
  rid uuid;
  line jsonb;
begin
  insert into public.receipt_reads (household_id, source, store_cnpj, store_name, purchased_on, lines)
    values (hh, 'ai', '33444555000166', 'DROGARIA SAO PAULO S/A', d,
      jsonb_build_array(jsonb_build_object('description', 'AGUA MINERAL 500ML', 'unit', 'un', 'unit_price', 2.00)))
    returning id into rid;
  perform set_config('test.rr_read_c1', rid::text, false);
  insert into public.receipt_reads (household_id, source, store_cnpj, store_name, purchased_on, lines)
    values (hh, 'ai', '44555666000177', 'SUPERMERCADO BOM PRECO', d,
      jsonb_build_array(jsonb_build_object('description', 'AGUA MINERAL 1L', 'unit', 'un', 'unit_price', 3.00)))
    returning id into rid;
  perform set_config('test.rr_read_c2', rid::text, false);
  insert into public.receipt_reads (household_id, source, store_cnpj, store_name, purchased_on, lines)
    values (hh, 'ai', '22333444000155', 'ATACADAO DO PORTO LTDA', d,
      jsonb_build_array(jsonb_build_object('description', 'SUCO DEL VALLE 1L', 'unit', 'un', 'unit_price', 6.00)))
    returning id into rid;
  perform set_config('test.rr_read_reuse', rid::text, false);
  insert into public.receipt_reads (household_id, source, store_cnpj, store_name, purchased_on, lines)
    values (hh, 'ai', '22333444000155', 'ATACADAO DO PORTO LTDA', d,
      jsonb_build_array(jsonb_build_object('description', 'BOLACHA MARIA', 'unit', 'un', 'unit_price', 4.00)))
    returning id into rid;
  perform set_config('test.rr_read_redo', rid::text, false);
  select jsonb_agg(jsonb_build_object('description', 'LINHA LIDA DA NOTA GRANDE ' || g, 'unit', 'un', 'unit_price', 1 + g / 100.0) order by g)
    into line from generate_series(1, 1000) as g;
  insert into public.receipt_reads (household_id, source, store_cnpj, store_name, purchased_on, lines)
    values (hh, 'ai', '55666777000188', 'MERCADO GRANDE DO PORTO', d, line)
    returning id into rid;
  perform set_config('test.rr_read_big', rid::text, false);

  -- Leitura grande demais em bytes: o banco recusa (a função corta cada descrição em 200 letras).
  begin
    insert into public.receipt_reads (household_id, source, lines)
      select hh, 'ai', jsonb_agg(jsonb_build_object('description', repeat('X', 500), 'unit', 'un', 'unit_price', 1))
        from generate_series(1, 1000);
    raise exception 'FAIL: a read of more than 400 kB';
  exception when check_violation then null;
  end;
end $$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_e1', false) \gset
do $$
declare
  d constant date := current_setting('test.rr_today')::date - 5;
  s uuid;
  r uuid;
  started timestamptz;
  took interval;
begin
  -- (c) pelo nome IMPRESSO: a casa chamou a drogaria de "Mercado da rua", e nada entra.
  insert into public.stores (name, cnpj) values ('Mercado da rua', '33444555000166') returning id into s;
  insert into public.receipts (store_id, purchased_at, source, read_id)
    values (s, d + time '10:00', 'ai', current_setting('test.rr_read_c1')::uuid) returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'AGUA MINERAL 500ML', 'bebidas', 'un', 2.00, 2.00);
  perform public.confirm_receipt(r, '[]');
  -- (c) pelo nome que a CASA deu: o impresso diz supermercado, a casa diz farmácia, e nada entra.
  insert into public.stores (name, cnpj) values ('Farmácia do Zé', '44555666000177') returning id into s;
  insert into public.receipts (store_id, purchased_at, source, read_id)
    values (s, d + time '10:00', 'ai', current_setting('test.rr_read_c2')::uuid) returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'AGUA MINERAL 1L', 'bebidas', 'un', 3.00, 3.00);
  perform public.confirm_receipt(r, '[]');

  -- A mesma leitura em duas notas: a primeira confirmada a usa e a apaga; a segunda fica sem leitura.
  select id into s from public.stores where cnpj = '22333444000155';
  insert into public.receipts (store_id, purchased_at, source, read_id)
    values (s, d + time '11:00', 'ai', current_setting('test.rr_read_reuse')::uuid) returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'SUCO DEL VALLE 1L', 'bebidas', 'un', 6.00, 6.00);
  perform set_config('test.rr_reuse_a', r::text, false);
  insert into public.receipts (store_id, purchased_at, source, read_id)
    values (s, d + time '12:00', 'ai', current_setting('test.rr_read_reuse')::uuid) returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'SUCO DEL VALLE 1L', 'bebidas', 'un', 6.00, 6.00);
  perform set_config('test.rr_reuse_b', r::text, false);
  perform public.confirm_receipt(current_setting('test.rr_reuse_a')::uuid, '[]');
  assert (select read_id from public.receipts where id = current_setting('test.rr_reuse_b')::uuid) is null,
    'a read used by one confirmed receipt is gone for the other';

  -- A nota que volta a rascunho e é confirmada de novo.
  insert into public.receipts (store_id, purchased_at, source, read_id)
    values (s, d + time '13:00', 'ai', current_setting('test.rr_read_redo')::uuid) returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
    values (r, 'BOLACHA MARIA', 'snacks', 'un', 4.00, 4.00);
  perform public.confirm_receipt(r, '[]');
  perform set_config('test.rr_redo', r::text, false);

  -- A nota grande: 300 itens (o teto), cada um contra as 1000 linhas da leitura.
  insert into public.stores (name, cnpj) values ('Mercado grande', '55666777000188') returning id into s;
  insert into public.receipts (store_id, purchased_at, source, read_id)
    values (s, d + time '14:00', 'ai', current_setting('test.rr_read_big')::uuid) returning id into r;
  insert into public.receipt_items (receipt_id, position, raw_description, suggested_category, unit, unit_price, total_price)
    select r, g, 'linha lida da nota grande ' || g, 'graos', 'un', 1 + g / 100.0, 1 + g / 100.0 from generate_series(1, 300) as g;
  started := clock_timestamp();
  perform public.confirm_receipt(r, '[]');
  took := clock_timestamp() - started;
  raise notice 'confirmar a nota de 300 itens contra 1000 linhas lidas: % ms', round(extract(epoch from took) * 1000);
  -- Folgado para uma máquina lenta; o par item x linha, que este teste pegaria, levava segundos.
  assert took < interval '1 second', format('the big receipt confirms in under a second (took %s)', took);
end $$;

reset role;
do $$
begin
  assert (select count(*) from public.shared_prices where item_key like 'AGUA MINERAL%') = 0,
    'a pharmacy by its printed name, or by the name the household gave it, shares nothing';
  assert (select count(*) from public.shared_prices where item_key = 'SUCO DEL VALLE 1L') = 1, 'the first receipt with the read shared';
  assert (select count(*) from public.shared_prices where item_key = 'BOLACHA MARIA') = 1, 'the receipt shared on its first confirmation';
  assert (select count(*) from public.shared_prices where item_key like 'LINHA LIDA DA NOTA GRANDE %') = 300, 'the big receipt shared its 300 lines';
  -- Para ver que a segunda confirmação não grava de novo, a linha sai.
  delete from public.shared_prices where item_key in ('BOLACHA MARIA', 'SUCO DEL VALLE 1L');
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_e1', false) \gset
do $$
begin
  perform public.confirm_receipt(current_setting('test.rr_reuse_b')::uuid, '[]');
  update public.receipts set status = 'draft' where id = current_setting('test.rr_redo')::uuid;
  update public.receipts set status = 'confirmed' where id = current_setting('test.rr_redo')::uuid;
  assert (select status from public.receipts where id = current_setting('test.rr_redo')::uuid) = 'confirmed', 'confirmed again';
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.shared_prices where item_key in ('BOLACHA MARIA', 'SUCO DEL VALLE 1L')) = 0,
    'the second receipt of a read, and a second confirmation, share nothing: the read is gone';
  assert (select count(*) from public.receipt_reads where household_id = current_setting('test.rr_house_e1')::uuid) = 0,
    'and no read is left';
end $$;

-- A limpeza: a leitura velha que nenhum rascunho espera sai; a de um rascunho e a recente ficam.
set role service_role;
do $$
declare
  hh constant uuid := current_setting('test.rr_house_e1')::uuid;
  rid uuid;
begin
  insert into public.receipt_reads (household_id, source, lines) values (hh, 'ai', '[]') returning id into rid;
  perform set_config('test.rr_read_draft', rid::text, false);
  insert into public.receipt_reads (household_id, source, lines) values (hh, 'ai', '[]') returning id into rid;
  perform set_config('test.rr_read_orphan', rid::text, false);
  insert into public.receipt_reads (household_id, source, lines) values (hh, 'ai', '[]') returning id into rid;
  perform set_config('test.rr_read_recent', rid::text, false);
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_e1', false) \gset
do $$
declare
  r uuid;
begin
  insert into public.receipts (source, read_id) values ('ai', current_setting('test.rr_read_draft')::uuid) returning id into r;
  perform set_config('test.rr_draft', r::text, false);
end $$;
reset role;
do $$
begin
  update public.receipt_reads set created_at = now() - interval '31 days'
    where household_id in (current_setting('test.rr_house_e1')::uuid, current_setting('test.rr_house_e2')::uuid)
      and id <> current_setting('test.rr_read_recent')::uuid;
  -- A que ficou sem nota e a do Edu (as das notas confirmadas o gatilho já apagou).
  assert public.forget_receipt_reads() = 1 + 1, 'the old reads no draft waits for go';
  assert (select array_agg(id order by id) from public.receipt_reads where household_id = current_setting('test.rr_house_e1')::uuid)
    = (select array_agg(x order by x) from unnest(array[current_setting('test.rr_read_draft')::uuid, current_setting('test.rr_read_recent')::uuid]) as x),
    'the read a draft waits for and the recent one stay';
  assert (select read_id from public.receipts where id = current_setting('test.rr_draft')::uuid) = current_setting('test.rr_read_draft')::uuid,
    'the draft keeps its read';
  -- A leitura do Edu também era velha e de nenhum rascunho.
  assert (select count(*) from public.receipt_reads where household_id = current_setting('test.rr_house_e2')::uuid) = 0, 'the other household too';
end $$;
reset time zone;

-- ---------------------------------------------------------------------------
\echo '• preços compartilhados: nome do mercado sem CPF, e a foto com mercado ou dia trocados na revisão fica na casa'
-- Fábio compra no mercadinho de um MEI (razão social com CPF) e lê notas pela foto, corrigindo algumas na revisão.
\set user_f1 '00000000-0000-0000-0000-0000000001a1'
reset role;
insert into auth.users (id) values (:'user_f1');
truncate public.shared_prices;
set time zone 'UTC';
select set_config('test.cf_today', ((now() at time zone 'America/Sao_Paulo')::date)::text, false) \gset

do $$
declare
  fn text;
  who text;
  cnpj constant text := '66777888000199';
begin
  -- As duas funções novas são só do gatilho (e da limpeza): ninguém de fora as chama.
  foreach fn in array array['public.shared_store_name(text, text)', 'public.access_key_valid(text)'] loop
    foreach who in array array['public', 'anon', 'authenticated'] loop
      assert not has_function_privilege(who, fn, 'execute'), format('%s cannot execute %s', who, fn);
    end loop;
    assert (select proconfig from pg_proc where oid = fn::regprocedure) = array['search_path=""'], format('%s has an empty search_path', fn);
  end loop;
  -- O gatilho recriado guarda os atributos de antes.
  assert (select prosecdef from pg_proc where oid = 'public.share_receipt_prices()'::regprocedure), 'the trigger function is still security definer';
  assert (select proconfig from pg_proc where oid = 'public.share_receipt_prices()'::regprocedure) @> array['search_path=""', 'lock_timeout=200ms'],
    'with an empty search_path and the 200 ms lock_timeout';
  foreach who in array array['public', 'anon', 'authenticated'] loop
    assert not has_function_privilege(who, 'public.share_receipt_prices()', 'execute'), format('%s cannot execute the trigger function', who);
  end loop;

  -- O dígito verificador, conferido com chaves calculadas como o app calcula (accessKeyCheckDigit).
  assert public.access_key_valid('41261066777888000199650010000012341123456798'), 'a key with its check digit (8)';
  assert public.access_key_valid('41261066777888000199650010000012341123456801'), 'a key whose rest is 10 (check digit 1)';
  assert public.access_key_valid('41261066777888000199650010000012341123456810'), 'a key whose rest is 0 or 1 (check digit 0)';
  assert public.access_key_valid('35261099888777000166650010000007771876543228'), 'another valid key';
  assert not public.access_key_valid('41261066777888000199650010000012341123456797'), 'one digit off fails';
  assert not public.access_key_valid('41261066777888000199650010000012341123456789'), 'a swapped pair fails';
  assert not public.access_key_valid('4126106677788800019965001000001234112345679'), '43 digits fail';
  assert not public.access_key_valid(null), 'no key is no valid key';

  -- O nome: sai a sequência de 11 dígitos (junta ou separada, e o "CPF" escrito antes), e o que sobra
  -- em volta dela; o CNPJ (14 dígitos) e o resto do nome ficam como estavam.
  assert public.shared_store_name('JOAO DA SILVA 12345678901', cnpj) = 'JOAO DA SILVA', 'a CPF with no punctuation';
  assert public.shared_store_name('MARIA DE SOUZA 123.456.789-01', cnpj) = 'MARIA DE SOUZA', 'a CPF with dots and a dash';
  assert public.shared_store_name('12345678901 ANA LIMA', cnpj) = 'ANA LIMA', 'a CPF at the start';
  assert public.shared_store_name('MERCADINHO DA ANA - CPF: 123.456.789-01', cnpj) = 'MERCADINHO DA ANA', 'the CPF label and a hanging dash go with it';
  assert public.shared_store_name('JOSE  123456789-01  PEREIRA ME', cnpj) = 'JOSE PEREIRA ME', 'a CPF in the middle';
  assert public.shared_store_name('123.456.789-01', cnpj) = 'CNPJ ' || cnpj, 'only a CPF: the placeholder of the app';
  assert public.shared_store_name('CPF 12345678901 -', cnpj) = 'CNPJ ' || cnpj, 'nothing but the CPF and punctuation: the placeholder';
  assert public.shared_store_name('ATACADAO 11222333000181', cnpj) = 'ATACADAO 11222333000181', 'a CNPJ (14 digits) stays';
  assert public.shared_store_name('ATACADAO 11.222.333/0001-81', cnpj) = 'ATACADAO 11.222.333/0001-81', 'a punctuated CNPJ stays';
  assert public.shared_store_name('LOJA 1234567890', cnpj) = 'LOJA 1234567890', 'ten digits stay';
  -- Outros jeitos de escrever o CPF (uma foto lida pela IA, a página de uma Sefaz) também saem.
  assert public.shared_store_name('JOSE PEREIRA 123.456.789.01', cnpj) = 'JOSE PEREIRA', 'a dot before the check digits';
  assert public.shared_store_name('JOSE PEREIRA 123 456 789 01', cnpj) = 'JOSE PEREIRA', 'a CPF split by spaces';
  assert public.shared_store_name('JOSE PEREIRA 123456789 01', cnpj) = 'JOSE PEREIRA', 'a space before the check digits';
  assert public.shared_store_name('JOSE PEREIRA CPF 123.456.789/01', cnpj) = 'JOSE PEREIRA', 'a slash before the check digits';
  assert public.shared_store_name('JOSE PEREIRA 123.456.789 - 01', cnpj) = 'JOSE PEREIRA', 'a spaced dash before the check digits';
  assert public.shared_store_name('JOSE PEREIRA 123-456-789-01', cnpj) = 'JOSE PEREIRA', 'a CPF split by dashes';
  assert public.shared_store_name('ATACADAO 11 222 333 0001 81', cnpj) = 'ATACADAO 11 222 333 0001 81', 'a CNPJ split by spaces stays';
  assert public.shared_store_name('LOJA (11) 98765-4321', cnpj) = 'LOJA (11) 98765-4321', 'a phone number stays';
  -- Os parênteses ou colchetes que embrulhavam o CPF saem junto; os outros ficam.
  assert public.shared_store_name('JOAO DA SILVA (12345678901)', cnpj) = 'JOAO DA SILVA', 'brackets around the CPF go with it';
  assert public.shared_store_name('JOAO DA SILVA (CPF 123.456.789-01)', cnpj) = 'JOAO DA SILVA', 'brackets around the CPF and its label';
  assert public.shared_store_name('JOAO DA SILVA [123.456.789-01] ME', cnpj) = 'JOAO DA SILVA ME', 'square brackets in the middle';
  assert public.shared_store_name('JOAO (FILIAL) 12345678901', cnpj) = 'JOAO (FILIAL)', 'brackets with a word stay';
  assert public.shared_store_name('SUPER BOM ( )', cnpj) = 'SUPER BOM ( )', 'a name without a CPF keeps its brackets, as before';
  assert public.shared_store_name('CNPJ ' || cnpj, cnpj) = 'CNPJ ' || cnpj, 'the placeholder stays';
  assert public.shared_store_name('  SUPER   BOM LTDA.  ', cnpj) = 'SUPER   BOM LTDA.', 'a name without a CPF is only trimmed, as before';
  assert public.shared_store_name(repeat('ABCDEFGHI ', 11) || '123.456.789-01 FIM', cnpj) = repeat('ABCDEFGHI ', 11) || 'FIM',
    'the CPF goes before the cut at 120 characters';
  assert public.shared_store_name(null, cnpj) = 'CNPJ ' || cnpj and public.shared_store_name('   ', cnpj) = 'CNPJ ' || cnpj, 'no name: the placeholder';
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', :'user_f1', false) \gset
select set_config('test.cf_house', (public.create_household('Casa do Fábio', 'Fábio')).id::text, false) \gset

-- As leituras, como o servidor as grava. Todas do mercadinho (o mesmo CNPJ), do mesmo dia, com uma linha cada.
reset role;
set role service_role;
do $$
declare
  d constant date := current_setting('test.cf_today')::date - 4;
  cnpj constant text := '66777888000199';
  hh constant uuid := current_setting('test.cf_house')::uuid;
  k text;
  rid uuid;
begin
  foreach k in array array['qr', 'ok', 'store', 'hand', 'nostore', 'day', 'midnight', 'badkey', 'badother', 'other', 'onlycpf'] loop
    insert into public.receipt_reads (household_id, source, access_key, store_cnpj, store_name, purchased_on, lines)
      values (
        hh,
        case when k = 'qr' then 'qrcode' else 'ai' end,
        case k
          -- QR code: a chave do link, conferida na página da Sefaz; o dígito verificador nunca foi olhado aqui.
          when 'qr' then '35261066777888000199000000000000000000000002'
          -- Foto com a chave certa (do Paraná).
          when 'ok' then '41261066777888000199650010000012341123456798'
          -- A mesma com um dígito lido errado: não vale (nem estado).
          when 'badkey' then '41261066777888000199650010000012341123456797'
          -- Chave errada que nem é deste mercado: não vale, e por isso também não segura a nota.
          when 'badother' then '35261099888777000166650010000007771876543229'
          -- Chave certa de outro emissor: segura a nota, como antes.
          when 'other' then '35261099888777000166650010000007771876543228'
          else null
        end,
        cnpj,
        case k
          when 'qr' then 'MARIA DE SOUZA 123.456.789-01'
          when 'onlycpf' then '123.456.789-01'
          else 'JOAO DA SILVA 12345678901'
        end,
        d,
        jsonb_build_array(jsonb_build_object('description', 'ITEM DA NOTA ' || upper(k), 'unit', 'un', 'unit_price', 5.00)))
      returning id into rid;
    perform set_config('test.cf_read_' || k, rid::text, false);
  end loop;
end $$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_f1', false) \gset
do $$
declare
  d constant date := current_setting('test.cf_today')::date - 4;
  s_mei uuid;
  s_other uuid;
  s_hand uuid;
  k text;
  s uuid;
  bought timestamptz;
  r uuid;
begin
  insert into public.stores (name, cnpj) values ('Mercadinho do João', '66777888000199') returning id into s_mei;
  -- O mercado que a IA leu errado e a casa trocou na revisão (outro CNPJ), e um criado à mão (sem CNPJ).
  insert into public.stores (name, cnpj) values ('Super da esquina', '77888999000155') returning id into s_other;
  insert into public.stores (name) values ('Feirinha') returning id into s_hand;

  foreach k in array array['qr', 'ok', 'store', 'hand', 'nostore', 'day', 'midnight', 'badkey', 'badother', 'other', 'onlycpf'] loop
    s := case k when 'store' then s_other when 'hand' then s_hand when 'nostore' then null
                -- QR code com o mercado trocado na revisão: continua compartilhando pela leitura.
                when 'qr' then s_other
                else s_mei end;
    bought := case k
            -- A data trocada na revisão: um dia antes.
            when 'day' then (d - 1 + time '10:00') at time zone 'America/Sao_Paulo'
            -- Às 23:30 em São Paulo (em UTC já é o dia seguinte): o dia da nota é o de São Paulo.
            when 'midnight' then (d + time '23:30') at time zone 'America/Sao_Paulo'
            -- QR code com a data trocada na revisão: continua compartilhando pela leitura.
            when 'qr' then (d - 2 + time '10:00') at time zone 'America/Sao_Paulo'
            else (d + time '10:00') at time zone 'America/Sao_Paulo'
          end;
    insert into public.receipts (store_id, purchased_at, source, read_id)
      values (s, bought, case when k = 'qr' then 'qrcode' else 'ai' end, current_setting('test.cf_read_' || k)::uuid)
      returning id into r;
    insert into public.receipt_items (receipt_id, raw_description, suggested_category, unit, unit_price, total_price)
      values (r, 'ITEM DA NOTA ' || upper(k), 'graos', 'un', 5.00, 5.00);
    perform public.confirm_receipt(r, '[]');
  end loop;
end $$;

reset role;
do $$
declare
  today constant date := current_setting('test.cf_today')::date;
  d constant date := today - 4;
begin
  assert (select array_agg(item_key || ' | ' || store_name || ' | ' || coalesce(store_uf, '-') || ' | ' || seen_on order by item_key)
            from public.shared_prices)
    = array[
      -- A chave errada é ignorada: compartilha sem estado.
      'ITEM DA NOTA BADKEY | JOAO DA SILVA | - | ' || d,
      'ITEM DA NOTA BADOTHER | JOAO DA SILVA | - | ' || d,
      'ITEM DA NOTA MIDNIGHT | JOAO DA SILVA | - | ' || d,
      -- A chave certa dá o estado.
      'ITEM DA NOTA OK | JOAO DA SILVA | 41 | ' || d,
      'ITEM DA NOTA ONLYCPF | CNPJ 66777888000199 | - | ' || d,
      -- QR code: o mercado, o dia e a chave da leitura, mesmo com a nota mudada na revisão.
      'ITEM DA NOTA QR | MARIA DE SOUZA | 35 | ' || d
    ],
    'the CPF leaves the store name; a photo shares only with the read''s CNPJ and São Paulo day; a key with a wrong check digit gives no state';
  -- Foto com o mercado trocado (outro CNPJ, ou um sem CNPJ, ou nenhum), com a data trocada, ou com a chave certa
  -- de outro emissor: nada.
  assert (select count(*) from public.shared_prices where item_key ~ 'ITEM DA NOTA (STORE|HAND|NOSTORE|DAY|OTHER)$') = 0,
    'a photo whose store or day was changed in the review stays at home';
  assert (select count(*) from public.shared_prices where store_name ~ '[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}' and store_name !~ '^CNPJ ') = 0,
    'no CPF reached the shared table';
  assert (select count(*) from public.receipt_reads where household_id = current_setting('test.cf_house')::uuid) = 0,
    'every read was used once and deleted, shared or not';
end $$;

-- A limpeza única: o nome com CPF que já estava na base sai limpo. Para valer a conta da própria migração, ela é
-- aplicada de novo aqui, sobre linhas postas direto (como as gravadas antes dela), e tudo é desfeito no fim.
begin;
do $$
declare
  today constant date := current_setting('test.cf_today')::date;
begin
  truncate public.shared_prices;
  insert into public.shared_prices (store_cnpj, store_uf, store_name, item_key, unit, seen_on, unit_price, visible_on) values
    -- Já pode ser lida, com o nome do MEI.
    ('66777888000199', '35', 'JOAO DA SILVA 12345678901', 'ARROZ VELHO', 'un', today - 9, 20.00, today - 8),
    -- Ainda não pode ser lida, com o CPF pontuado.
    ('66777888000199', '35', 'JOAO DA SILVA 123.456.789-01', 'FEIJAO NOVO', 'un', today, 8.00, today + 1),
    -- Só o CPF.
    ('66777888000188', null, '12345678901', 'LEITE SO CPF', 'un', today - 3, 4.00, today - 2),
    -- Sem CPF: não muda.
    ('11222333000181', '35', 'ATACADAO 11222333000181', 'CAFE', 'un', today - 3, 18.00, today - 2),
    ('11222333000181', '35', 'SUPER   BOM LTDA.', 'ACUCAR', 'un', today - 3, 4.00, today - 2);
end $$;
\ir ../../supabase/migrations/20261020120000_shared_prices_fixes.sql
do $$
declare
  today constant date := current_setting('test.cf_today')::date;
begin
  assert (select array_agg(item_key || ' | ' || store_name || ' | ' || coalesce(store_uf, '-') || ' | ' || unit_price || ' | ' || seen_on || ' | ' || visible_on order by item_key)
            from public.shared_prices)
    = array[
      'ACUCAR | SUPER   BOM LTDA. | 35 | 4.0000 | ' || (today - 3) || ' | ' || (today - 2),
      'ARROZ VELHO | JOAO DA SILVA | 35 | 20.0000 | ' || (today - 9) || ' | ' || (today - 8),
      'CAFE | ATACADAO 11222333000181 | 35 | 18.0000 | ' || (today - 3) || ' | ' || (today - 2),
      'FEIJAO NOVO | JOAO DA SILVA | 35 | 8.0000 | ' || today || ' | ' || (today + 1),
      'LEITE SO CPF | CNPJ 66777888000188 | - | 4.0000 | ' || (today - 3) || ' | ' || (today - 2)
    ],
    'the one-time cleanup takes the CPF out of stored names, readable or not, and touches nothing else';
  -- Aplicada de novo, a migração deixa o gatilho como estava.
  assert (select prosecdef from pg_proc where oid = 'public.share_receipt_prices()'::regprocedure)
    and (select proconfig from pg_proc where oid = 'public.share_receipt_prices()'::regprocedure) @> array['search_path=""', 'lock_timeout=200ms'],
    'the trigger function keeps its attributes';
end $$;
rollback;
reset time zone;

-- ---------------------------------------------------------------------------
\echo '• zero não é preço: o item sem valor não vira observação nem último preço'
-- Pri mora sozinha; o leite dela foi comprado com preço e, depois, sem valor.
\set user_p '00000000-0000-0000-0000-00000000001d'
\set user_q '00000000-0000-0000-0000-00000000001e'
reset role;
insert into auth.users (id) values (:'user_p'), (:'user_q');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_q', false) \gset
select (public.create_household('Casa do Quico', 'Quico')).id as hh_q \gset
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
select (public.create_household('Casa da Pri', 'Pri')).id as hh_p \gset

do $$
declare
  store_a uuid;
  store_b uuid;
  leite uuid;
  r uuid;
  i uuid;
  i_zero_b uuid;
begin
  insert into public.stores (name) values ('Mercado A') returning id into store_a;
  insert into public.stores (name) values ('Mercado B') returning id into store_b;
  insert into public.products (name, category) values ('Leite 1L', 'laticinios') returning id into leite;

  -- Mercado A: o leite a R$ 5,90.
  insert into public.receipts (store_id, purchased_at, total, source)
    values (store_a, '2026-10-01 10:00-03', 5.90, 'manual') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, quantity, unit, unit_price, total_price)
    values (r, 'LEITE 1L', 1, 'un', 5.90, 5.90) returning id into i;
  perform public.confirm_receipt(r, jsonb_build_array(jsonb_build_object('id', i, 'product_id', leite)));
  assert (select unit_price from public.latest_prices where product_id = leite and store_id = store_a) = 5.90, 'the real price is the latest price';

  -- Mercado A, uma semana depois: a leitura não pegou o preço do leite.
  insert into public.receipts (store_id, purchased_at, source)
    values (store_a, '2026-10-08 10:00-03', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, quantity, unit, unit_price, total_price)
    values (r, 'LEITE 1L', 2, 'un', 0, 0) returning id into i;
  perform public.confirm_receipt(r, jsonb_build_array(jsonb_build_object('id', i, 'product_id', leite)));

  -- Mercado B: a única compra do leite ficou sem valor.
  insert into public.receipts (store_id, purchased_at, source)
    values (store_b, '2026-10-09 10:00-03', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, raw_description, quantity, unit, unit_price, total_price)
    values (r, 'LEITE 1L', 1, 'un', 0, 0) returning id into i_zero_b;
  perform public.confirm_receipt(r, jsonb_build_array(jsonb_build_object('id', i_zero_b, 'product_id', leite)));

  assert (select count(*) from public.receipt_items where product_id = leite) = 3, 'the lines without value stay on their receipts, linked to the product';
  assert (select count(*) from public.price_observations where product_id = leite) = 1, 'a line without value is not a price observation';
  assert (select count(*) from public.price_observations where unit_price <= 0) = 0, 'no zero in the observations';
  assert (select unit_price from public.latest_prices where product_id = leite and store_id = store_a) = 5.90,
    'the latest price of a store is its latest REAL price, not the zero that came after';
  assert (select purchased_at from public.latest_prices where product_id = leite and store_id = store_a) = '2026-10-01 10:00-03'::timestamptz,
    'with the date of that purchase';
  assert (select count(*) from public.latest_prices where product_id = leite and store_id = store_b) = 0, 'a store with only a line without value has no price';

  -- O valor preenchido depois na nota confirmada passa a ser preço.
  update public.receipt_items set unit_price = 6.50, total_price = 6.50 where id = i_zero_b;
  assert (select unit_price from public.latest_prices where product_id = leite and store_id = store_b) = 6.50, 'a value filled in later becomes a price';
  assert (select count(*) from public.price_observations where product_id = leite) = 2, 'and an observation';

  perform set_config('test.p_leite', leite::text, false);
end $$;

-- Outra casa não vê nada disso: as views seguem com as regras de quem lê.
select set_config('request.jwt.claim.sub', :'user_q', false) \gset
do $$
begin
  assert (select count(*) from public.price_observations) = 0, 'another household sees no observations';
  assert (select count(*) from public.latest_prices) = 0, 'and no latest prices';
end $$;

reset role;
do $$
begin
  assert (select reloptions::text from pg_class where oid = 'public.price_observations'::regclass) like '%security_invoker=true%',
    'price_observations still runs with the reader''s rights';
  assert (select reloptions::text from pg_class where oid = 'public.latest_prices'::regclass) like '%security_invoker=true%',
    'and so does latest_prices';
  assert (select array_agg(attname::text order by attnum) from pg_attribute
            where attrelid = 'public.price_observations'::regclass and attnum > 0 and not attisdropped)
         = array['household_id', 'product_id', 'store_id', 'purchased_at', 'unit_price', 'unit', 'receipt_id'],
    'the columns of price_observations are the same, in the same order';
  assert has_table_privilege('authenticated', 'public.price_observations', 'select')
     and has_table_privilege('authenticated', 'public.latest_prices', 'select'), 'members still read both views';
end $$;

-- ---------------------------------------------------------------------------
\echo '• rodízio de tarefas: a ordem, a vez ao concluir, pular a vez e quem sai da ordem'
-- Rita e Beto moram na Casa do Rodízio, com Lia, Nina, Téo e Bidu (crianças,
-- sem o app) e o pet Rex; Otto mora em outra casa, com o filho Tito.
\set user_r '00000000-0000-0000-0000-000000000041'
\set user_s '00000000-0000-0000-0000-000000000042'
\set user_o '00000000-0000-0000-0000-000000000043'
\set user_t '00000000-0000-0000-0000-000000000044'
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
  assert c.assigned_to = '00000000-0000-0000-0000-000000000042' and c.kid_id is null,
    'a new rotation starts with the first of the order, even if the chore had someone else';

  begin
    perform pg_temp.save_order(dishes, array[beto, rex]);
    raise exception 'FAIL: a pet took part in a rotation';
  exception when check_violation then
    -- Em português: o app mostra o texto do banco como ele vem.
    assert sqlerrm = 'Só pessoas da casa (não pets) entram no rodízio. Confira a ordem e salve de novo.', sqlerrm;
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
  assert c.assigned_to = '00000000-0000-0000-0000-000000000041' and c.kid_id is null, 'the chore is now of the next member';
  -- Toque duplo (ou outro celular) na mesma ocorrência: não passa a vez de novo.
  select * into r from public.complete_chore(dishes, '2026-10-12', '2026-10-12');
  assert not r.completed and r.next_person_id is null, 'a repeated completion passes no turn';
  assert (select assigned_to from public.chores where id = dishes) = '00000000-0000-0000-0000-000000000041', 'the turn passed once';

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
  assert c.assigned_to = '00000000-0000-0000-0000-000000000041' and c.due_on = '2026-10-17' and c.active, 'the date stays';
  assert (select count(*) from public.chore_completions where chore_id = dishes) = 5, 'nothing in the history';
  assert (select balance from public.kid_points where person_id = lia) = 10, 'and no points';
  -- O outro celular ainda mostrava a vez de Beto.
  assert public.skip_chore_turn(dishes, beto) is null, 'a second skip from the old turn does nothing';
  assert (select assigned_to from public.chores where id = dishes) = '00000000-0000-0000-0000-000000000041', 'the turn passed once';
  assert public.skip_chore_turn(dishes, rita) = lia and public.skip_chore_turn(dishes, lia) = beto, 'skipping wraps around too';

  -- p_to: quem a pergunta disse que fica com a vez. A tela leu Beto → Rita → Lia, na vez de Beto ("de Beto para
  -- Rita?"), e outro celular tira Rita da ordem antes do toque: a seguinte passa a ser Lia, que ninguém confirmou, e
  -- nada muda. Com a pessoa que é mesmo a seguinte, passa; sem p_to (nulo, ou fora da chamada, como acima), passa
  -- para quem vier, como antes.
  perform pg_temp.save_order(dishes, array[beto, lia]);
  assert public.skip_chore_turn(dishes, beto, rita) is null, 'a skip to the person the question named, who is no longer next, does nothing';
  select * into c from public.chores where id = dishes;
  assert c.assigned_to = auth.uid() and c.kid_id is null, 'and the turn stays';
  assert public.skip_chore_turn(dishes, beto, lia) = lia, 'a skip to the person who is next passes the turn';
  assert public.skip_chore_turn(dishes, lia, null) = beto, 'a null p_to passes the turn to whoever is next';
  perform pg_temp.save_order(dishes, array[beto, rita, lia]);
  assert (select assigned_to from public.chores where id = dishes) = auth.uid(), 'B is on turn again';

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
  assert (select assigned_to from public.chores where id = dishes) = '00000000-0000-0000-0000-000000000041', 'and keeps the person of the turn';
  update public.chores set recurrence = 'daily' where id = dishes;
end $$;

-- Regravar a ordem nunca move a vez. save_chore_rotation apaga a ordem inteira e grava a nova; o gatilho de quem
-- sai da ordem (chore_rotation_row_left) só roda no fim daquele delete, sem nenhuma linha da ordem, e por isso não
-- passa a vez adiante. Apagado linha a linha, ou com o gatilho antes do delete, a vez de quem continua na ordem
-- (ou de quem fica com a tarefa no fim do rodízio) passaria para o seguinte: estes casos pegam isso.
do $$
declare
  rita uuid := current_setting('test.r_rita')::uuid;
  beto uuid := current_setting('test.r_beto')::uuid;
  lia uuid := current_setting('test.r_lia')::uuid;
  sweep uuid;
  yard uuid;
  c public.chores;
begin
  -- Com um morador primeiro na ordem: Rita, depois Beto.
  sweep := public.save_chore(null, 'Varrer a cozinha', null, 'daily', 1, '2026-10-12', 10, p_people => array[rita, beto]);
  select * into c from public.chores where id = sweep;
  assert c.assigned_to = '00000000-0000-0000-0000-000000000041' and c.kid_id is null, 'the turn starts with R';
  -- a. A mesma ordem, na vez do primeiro: fica com ele.
  perform pg_temp.save_order(sweep, array[rita, beto]);
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = sweep) = array[rita, beto],
    'the same order is saved again';
  select * into c from public.chores where id = sweep;
  assert c.assigned_to = '00000000-0000-0000-0000-000000000041' and c.kid_id is null,
    'saving the same order on the turn of the first (a member) keeps the turn';
  -- b. A mesma ordem, na vez do segundo: fica com ele.
  assert public.skip_chore_turn(sweep, rita) = beto, 'the turn passed to B';
  perform pg_temp.save_order(sweep, array[rita, beto]);
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = sweep) = array[rita, beto],
    'the same order is saved again, on the turn of B';
  select * into c from public.chores where id = sweep;
  assert c.assigned_to = '00000000-0000-0000-0000-000000000042' and c.kid_id is null,
    'saving the same order on the turn of the second keeps the turn';
  -- c. A ordem invertida, na vez do primeiro: a vez não acompanha a posição.
  assert public.skip_chore_turn(sweep, beto) = rita, 'the turn is back with R';
  perform pg_temp.save_order(sweep, array[beto, rita]);
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = sweep) = array[beto, rita],
    'the order is reversed';
  select * into c from public.chores where id = sweep;
  assert c.assigned_to = '00000000-0000-0000-0000-000000000041' and c.kid_id is null,
    'reversing the order keeps the turn of who had it';
  -- d. Encerrar o rodízio na vez do primeiro: a tarefa fica com ele.
  perform pg_temp.save_order(sweep, array[rita, beto]);
  assert (select assigned_to from public.chores where id = sweep) = '00000000-0000-0000-0000-000000000041', 'R still has the turn';
  perform pg_temp.save_order(sweep, '{}');
  assert not exists (select 1 from public.chore_rotation r where r.chore_id = sweep), 'ending the rotation leaves no row of the order';
  select * into c from public.chores where id = sweep;
  assert c.assigned_to = '00000000-0000-0000-0000-000000000041' and c.kid_id is null,
    'ending the rotation on the turn of the first (a member) keeps the chore with the member';

  -- e. O mesmo com quem não tem o app primeiro na ordem (a vez em kid_id): Lia, depois Beto.
  yard := public.save_chore(null, 'Varrer o quintal', null, 'daily', 1, '2026-10-12', 10, p_people => array[lia, beto]);
  select * into c from public.chores where id = yard;
  assert c.assigned_to is null and c.kid_id = lia, 'the turn starts with the kid';
  perform pg_temp.save_order(yard, array[lia, beto]);
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = yard) = array[lia, beto],
    'the same order is saved again, with the kid first';
  select * into c from public.chores where id = yard;
  assert c.assigned_to is null and c.kid_id = lia, 'saving the same order on the turn of the first (a kid) keeps the turn';
  perform pg_temp.save_order(yard, '{}');
  assert not exists (select 1 from public.chore_rotation r where r.chore_id = yard), 'ending the rotation leaves no row of the order, with the kid';
  select * into c from public.chores where id = yard;
  assert c.assigned_to is null and c.kid_id = lia, 'ending the rotation on the turn of the first (a kid) keeps the chore with the kid';

  delete from public.chores where id in (sweep, yard);
end $$;

-- O formulário que mostrou um rodízio e não mexeu na ordem não a manda (p_people nulo): o que outro celular fez com
-- o rodízio nesse meio-tempo fica, e a vez também. Mandada de volta, a ordem que ele mostrou recriaria o rodízio
-- encerrado (com a vez no primeiro, pela regra do rodízio novo) ou desfaria a ordem nova.
do $$
declare
  rita uuid := current_setting('test.r_rita')::uuid;
  beto uuid := current_setting('test.r_beto')::uuid;
  lia uuid := current_setting('test.r_lia')::uuid;
  nina uuid := current_setting('test.r_nina')::uuid;
  shelf uuid;
  c public.chores;
begin
  -- Rita, Beto e Lia; a vez chega a Lia.
  shelf := public.save_chore(null, 'Tirar o pó da estante', null, 'daily', 1, '2026-10-12', 10, p_people => array[rita, beto, lia]);
  assert public.skip_chore_turn(shelf, rita) = beto and public.skip_chore_turn(shelf, beto) = lia, 'the turn is with the kid';
  -- a. Outro celular encerra o rodízio, e a tarefa fica com Lia. Este, que mostrava o rodízio, salva só o título.
  perform pg_temp.save_order(shelf, '{}');
  perform public.save_chore(shelf, 'Tirar o pó da estante e da mesa', null, 'daily', 1, '2026-10-12', 10);
  select * into c from public.chores where id = shelf;
  assert c.title = 'Tirar o pó da estante e da mesa' and c.points = 10, 'the fields of the form are saved';
  assert c.assigned_to is null and c.kid_id = lia, 'a save without the order keeps the holder of a rotation ended elsewhere';
  assert not exists (select 1 from public.chore_rotation r where r.chore_id = shelf), 'and the rotation stays ended';
  -- b. Outro celular cria outro rodízio (Nina, Beto: a vez começa por Nina); este salva só o título.
  perform pg_temp.save_order(shelf, array[nina, beto]);
  perform public.save_chore(shelf, 'Tirar o pó da estante', null, 'daily', 1, '2026-10-12', 10);
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = shelf) = array[nina, beto],
    'a save without the order keeps the order changed elsewhere';
  assert (select kid_id from public.chores where id = shelf) = nina, 'and its turn';
  -- c. Outro celular faz a tarefa "Uma vez" (o rodízio acaba, e Nina fica com ela); este, que a mostrava diária, salva.
  perform public.save_chore(shelf, 'Tirar o pó da estante', null, 'none', 1, '2026-10-12', p_people => '{}');
  perform public.save_chore(shelf, 'Tirar o pó da estante', null, 'daily', 1, '2026-10-12', 10);
  select * into c from public.chores where id = shelf;
  assert c.recurrence = 'daily' and c.assigned_to is null and c.kid_id = nina, 'the recurrence of the form is saved, and the holder stays';
  assert not exists (select 1 from public.chore_rotation r where r.chore_id = shelf), 'and no rotation comes back';
  delete from public.chores where id = shelf;
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
    -- O app já instalado mostra o texto do banco como ele vem: em português, e pedindo para atualizar o app.
    assert sqlerrm = 'Esta tarefa está em rodízio. Atualize o app para trocar o responsável.', sqlerrm;
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

  -- Os pontos do rodízio, na vez de um morador: o app antigo manda 0 (para ele, pontos eram só da tarefa de criança).
  -- A edição passa, com os pontos de antes: são das crianças da ordem, cada uma na sua vez.
  assert was.points = 10 and was.assigned_to = '00000000-0000-0000-0000-000000000041' and was.kid_id is null,
    'the rotation is worth 10 points, on the turn of R';
  update public.chores
    set title = 'Lavar a louça e as panelas', notes = null, recurrence = 'daily', interval_count = 1, due_on = was.due_on,
        assigned_to = '00000000-0000-0000-0000-000000000041', kid_id = null, points = 0
    where id = dishes;
  select * into c from public.chores where id = dishes;
  assert c.title = 'Lavar a louça e as panelas' and c.points = 10 and c.assigned_to = '00000000-0000-0000-0000-000000000041',
    'the old app renames a rotating chore on a member turn, and its points stay';
  -- Os outros valores passam, também na vez do morador.
  update public.chores set title = 'Lavar a louça', points = 12 where id = dishes;
  assert (select points from public.chores where id = dishes) = 12, 'other points are written straight';
  update public.chores set points = 10 where id = dishes;

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
  -- Na vez da criança, os pontos mudam direto na tabela, como sempre (até para 0: aí o app antigo mostra os pontos, e
  -- o 0 foi a pessoa que escolheu).
  update public.chores set points = 15 where id = dishes;
  assert (select points from public.chores where id = dishes) = 15, 'on a kid turn, the points change straight';
  update public.chores set points = 0 where id = dishes;
  assert (select points from public.chores where id = dishes) = 0, 'even to 0';
  update public.chores set points = 10 where id = dishes;

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
  update public.chores set assigned_to = '00000000-0000-0000-0000-000000000041' where id = plain;
  update public.chores set assigned_to = null, kid_id = lia where id = plain;
  update public.chores set kid_id = null where id = plain;
  select * into c from public.chores where id = plain;
  assert c.assigned_to is null and c.kid_id is null, 'a chore without rotation changes its assignee straight in the table';
  -- E os pontos também, até para 0, com um morador nela.
  update public.chores set assigned_to = auth.uid(), points = 10 where id = plain;
  update public.chores set points = 0 where id = plain;
  assert (select points from public.chores where id = plain) = 0, 'a chore without rotation changes its points straight, even to 0';
  update public.chores set assigned_to = null where id = plain;
  -- Nem a que já teve rodízio: acabado, ela volta a ser como as outras.
  perform pg_temp.save_order(plain, array[beto, lia]);
  perform pg_temp.save_order(plain, '{}');
  update public.chores set assigned_to = '00000000-0000-0000-0000-000000000041', kid_id = null where id = plain;
  assert (select assigned_to from public.chores where id = plain) = '00000000-0000-0000-0000-000000000041',
    'nor after its rotation ended';
  delete from public.chores where id = plain;

  -- Pelas funções a vez muda como antes: pular, concluir, o responsável escolhido e a ordem nova.
  assert public.skip_chore_turn(dishes, lia) = beto, 'skipping moves the turn';
  assert (select next_person_id from public.complete_chore(dishes, '2026-10-20', '2026-10-20')) = rita, 'completing moves the turn';
  perform pg_temp.save_turn(dishes, null, lia);
  assert (select kid_id from public.chores where id = dishes) = lia, 'save_chore with a person chosen moves the turn';
  perform pg_temp.save_order(dishes, array[rita, beto]);
  assert (select assigned_to from public.chores where id = dishes) = '00000000-0000-0000-0000-000000000041',
    'a new order from save_chore moves the turn';
  perform pg_temp.save_order(dishes, array[beto, rita, lia]);
  assert (select assigned_to from public.chores where id = dishes) = '00000000-0000-0000-0000-000000000041', 'R is on turn again';
  -- Os pontos pela função (o app novo, que mostra os pontos do rodízio): ela grava o que vier, até 0, na vez do morador.
  perform public.save_chore(ch.id, ch.title, ch.notes, ch.recurrence, ch.interval_count, ch.due_on, p_points => 0)
    from public.chores ch where ch.id = dishes;
  assert (select points from public.chores where id = dishes) = 0, 'save_chore sets the points of a rotation, even to 0';
  perform public.save_chore(ch.id, ch.title, ch.notes, ch.recurrence, ch.interval_count, ch.due_on, p_points => 10, p_people => array[beto, rita, lia])
    from public.chores ch where ch.id = dishes;
  assert (select points from public.chores where id = dishes) = 10, 'and with the order too';
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
  assert c.assigned_to = '00000000-0000-0000-0000-000000000041' and c.kid_id is null and c.points = 10,
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
    p_set_turn => true, p_assigned_to => '00000000-0000-0000-0000-000000000041');
  select * into c from public.chores where id = room;
  assert c.assigned_to = '00000000-0000-0000-0000-000000000041' and c.kid_id is null and c.points = 0, 'a member, and no points';
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
      p_set_turn => true, p_assigned_to => '00000000-0000-0000-0000-000000000043');
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
  assert (select assigned_to from public.chores where id = lamp) = '00000000-0000-0000-0000-000000000041', 'rotating again: the turn is of the first';
  perform public.save_chore(lamp, 'Trocar a lâmpada', null, 'none', 1, '2026-10-12');
  select * into c from public.chores where id = lamp;
  assert c.recurrence = 'none' and c.assigned_to = '00000000-0000-0000-0000-000000000041' and c.kid_id is null,
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
  assert was.assigned_to = '00000000-0000-0000-0000-000000000041' and was.kid_id is null and was.points = 10,
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
      p_set_turn => true, p_assigned_to => '00000000-0000-0000-0000-000000000041');
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
  assert not has_function_privilege('public', 'public.skip_chore_turn(uuid, uuid, uuid)', 'execute'), 'skip_chore_turn is not open to every role';
  assert not has_function_privilege('anon', 'public.skip_chore_turn(uuid, uuid, uuid)', 'execute'), 'anon cannot call skip_chore_turn';
  assert has_function_privilege('authenticated', 'public.skip_chore_turn(uuid, uuid, uuid)', 'execute'), 'members call skip_chore_turn';
  -- Uma função só, com a pessoa que a pergunta nomeou (p_to, que pode ficar de fora da chamada).
  assert to_regprocedure('public.skip_chore_turn(uuid, uuid)') is null
    and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'skip_chore_turn') = 1,
    'skip_chore_turn is one function';
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
  assert c.assigned_to = '00000000-0000-0000-0000-000000000042' and c.kid_id is null, 'and the turn is inside the order: of its first, not of R';
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
  assert c.assigned_to = '00000000-0000-0000-0000-000000000042' and c.kid_id is null, 'the chore stays with whoever is left';
  assert (select next_person_id from public.complete_chore(sweep, '2026-10-12')) is null, 'it is a plain chore again';
  assert (select assigned_to from public.chores where id = sweep) = '00000000-0000-0000-0000-000000000042', 'of the same person';

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
  assert (select assigned_to from public.chores where id = sweep) = '00000000-0000-0000-0000-000000000042', 'the turn stays where it was';
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
  assert (select member_user_id from public.people where id = lia) = '00000000-0000-0000-0000-000000000044', 'the kid has an account now';
  select * into c from public.chores where id = dishes;
  assert c.kid_id is null and c.assigned_to = '00000000-0000-0000-0000-000000000044', 'her turn moved to the account';
  assert (select array_agg(person_id order by position) from public.chore_rotation where chore_id = dishes) = array[rita, lia],
    'and she stays in the order';
  select * into r from public.complete_chore(dishes, c.due_on, c.due_on);
  assert r.completed and r.points = 0 and r.person_id is null and r.next_person_id = rita,
    'with an account she earns no points, and the turn passes to the next (nobody skipped)';
  assert public.skip_chore_turn(dishes, rita) = lia, 'the turn comes back to her as a member';
  assert (select assigned_to from public.chores where id = dishes) = '00000000-0000-0000-0000-000000000044', 'in assigned_to';
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
  assert c.assigned_to = '00000000-0000-0000-0000-000000000042', 'B is on turn';
  insert into public.chores (title, assigned_to) values ('Tarefa do Beto', '00000000-0000-0000-0000-000000000042') returning id into plain;
  -- E um rodízio sem Beto, na vez dele (o responsável salvo sem mexer na ordem).
  insert into public.chores (title, recurrence) values ('Tirar o pó', 'weekly') returning id into dust;
  perform pg_temp.save_order(dust, array[rita, current_setting('test.r_lia')::uuid]);
  perform pg_temp.save_turn(dust, '00000000-0000-0000-0000-000000000042', null);
  perform public.remove_member(current_setting('test.hh_r')::uuid, '00000000-0000-0000-0000-000000000042');
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

-- ---------------------------------------------------------------------------
\echo '• estoque e receita dos remédios: limites das colunas e isolamento entre casas'
-- Paula mora na Casa da Paula e toma Losartana; Quico mora em outra casa.
\set user_p '00000000-0000-0000-0000-000000000050'
\set user_q '00000000-0000-0000-0000-000000000051'
reset role;
insert into auth.users (id) values (:'user_p'), (:'user_q');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_q', false) \gset
select public.create_household('Casa do Quico', 'Quico') \gset
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
select public.create_household('Casa da Paula', 'Paula') \gset

do $$
declare
  m uuid;
  r public.medications;
  bad text;
begin
  -- Remédio sem estoque acompanhado (como todos os de antes): nada contado, 1 por dose, aviso com 7 dias.
  insert into public.medications (person_name, name, times) values ('Paula', 'Losartana', array['08:00']) returning * into r;
  m := r.id;
  perform set_config('test.med_p', m::text, false);
  assert r.stock_count is null and r.stock_counted_on is null and r.prescription_until is null, 'no stock and no prescription by default';
  assert r.dose_units = 1 and r.stock_warn_days = 7, 'one unit per dose and a week of warning by default';

  -- A contagem com o dia dela, meio comprimido por dose, e a receita.
  update public.medications
    set stock_count = 12.5, stock_counted_on = '2026-10-12', dose_units = 0.5, stock_warn_days = 10, prescription_until = '2026-12-20'
    where id = m returning * into r;
  assert r.stock_count = 12.5 and r.stock_counted_on = '2026-10-12' and r.dose_units = 0.5 and r.stock_warn_days = 10
    and r.prescription_until = '2026-12-20', 'stock, dose units, warning days and prescription are stored';
  -- Contado zero (acabou) vale; negativo, não.
  update public.medications set stock_count = 0 where id = m;
  begin
    update public.medications set stock_count = -1 where id = m;
    raise exception 'FAIL: negative stock';
  exception when check_violation then null;
  end;
  begin
    update public.medications set dose_units = 0 where id = m;
    raise exception 'FAIL: a dose that uses nothing';
  exception when check_violation then null;
  end;
  begin
    update public.medications set dose_units = -1 where id = m;
    raise exception 'FAIL: negative dose units';
  exception when check_violation then null;
  end;
  begin
    update public.medications set dose_units = null where id = m;
    raise exception 'FAIL: dose units without a value';
  exception when not_null_violation then null;
  end;
  -- NaN e Infinity não são quantidade (no numeric, NaN é maior que qualquer
  -- número: passaria num ">= 0" sozinho), nem um número sem tamanho de caixa.
  begin
    update public.medications set stock_count = 'NaN' where id = m;
    raise exception 'FAIL: NaN stock';
  exception when check_violation then null;
  end;
  begin
    update public.medications set stock_count = 'Infinity' where id = m;
    raise exception 'FAIL: infinite stock';
  exception when check_violation then null;
  end;
  begin
    update public.medications set stock_count = 1000000 where id = m;
    raise exception 'FAIL: a million units';
  exception when check_violation then null;
  end;
  begin
    update public.medications set dose_units = 'NaN' where id = m;
    raise exception 'FAIL: NaN dose units';
  exception when check_violation then null;
  end;
  begin
    update public.medications set dose_units = 'Infinity' where id = m;
    raise exception 'FAIL: infinite dose units';
  exception when check_violation then null;
  end;
  begin
    update public.medications set dose_units = 1000.5 where id = m;
    raise exception 'FAIL: more than 1000 units per dose';
  exception when check_violation then null;
  end;
  -- O teto deixa passar o que o app grava: duas caixas de 99.999 somadas ("Comprei mais") e 1000 por dose.
  update public.medications set stock_count = 199998, dose_units = 1000 where id = m;
  update public.medications set stock_count = 0, dose_units = 0.5 where id = m;
  -- O aviso vai de 1 a 60 dias.
  update public.medications set stock_warn_days = 1 where id = m;
  update public.medications set stock_warn_days = 60 where id = m;
  begin
    update public.medications set stock_warn_days = 0 where id = m;
    raise exception 'FAIL: warning with zero days';
  exception when check_violation then null;
  end;
  begin
    update public.medications set stock_warn_days = 61 where id = m;
    raise exception 'FAIL: warning with 61 days';
  exception when check_violation then null;
  end;
  -- A contagem e o dia dela andam juntos.
  begin
    update public.medications set stock_counted_on = null where id = m;
    raise exception 'FAIL: a count without its date';
  exception when check_violation then null;
  end;
  begin
    insert into public.medications (person_name, name, times, stock_count) values ('Paula', 'X', array['08:00'], 30);
    raise exception 'FAIL: a new medication counted without a date';
  exception when check_violation then null;
  end;
  begin
    insert into public.medications (person_name, name, times, stock_counted_on) values ('Paula', 'X', array['08:00'], '2026-10-12');
    raise exception 'FAIL: a count date without the count';
  exception when check_violation then null;
  end;
  -- O dia da contagem e a data da receita ficam entre 2000 e 2100: um date aceita 'infinity' e o ano 9999, e a
  -- conta do app, que anda dia a dia a partir do dia da contagem, não terminaria.
  update public.medications set stock_counted_on = '2000-01-01', prescription_until = '2000-01-01' where id = m;
  update public.medications set stock_counted_on = '2100-12-31', prescription_until = '2100-12-31' where id = m;
  foreach bad in array array['infinity', '-infinity', '9999-12-31', '1999-12-31', '2101-01-01'] loop
    begin
      update public.medications set stock_counted_on = bad::date where id = m;
      raise exception 'FAIL: a count dated %', bad;
    exception when check_violation then null;
    end;
    begin
      update public.medications set prescription_until = bad::date where id = m;
      raise exception 'FAIL: a prescription valid until %', bad;
    exception when check_violation then null;
    end;
  end loop;
  begin
    insert into public.medications (person_name, name, times, stock_count, stock_counted_on)
      values ('Paula', 'X', array['08:00'], 30, 'infinity');
    raise exception 'FAIL: a new medication counted on infinity';
  exception when check_violation then null;
  end;
  begin
    insert into public.medications (person_name, name, times, prescription_until) values ('Paula', 'X', array['08:00'], 'infinity');
    raise exception 'FAIL: a new medication with a prescription valid until infinity';
  exception when check_violation then null;
  end;
  select * into r from public.medications where id = m;
  assert r.stock_counted_on = '2100-12-31' and r.prescription_until = '2100-12-31', 'a refused date changes nothing';
  update public.medications set stock_counted_on = '2026-10-12', prescription_until = '2026-12-20' where id = m;
  -- Parar de acompanhar: os dois vazios; a receita não depende do estoque.
  update public.medications set stock_count = null, stock_counted_on = null where id = m returning * into r;
  assert r.stock_count is null and r.prescription_until = '2026-12-20', 'the prescription stays without the stock';
  -- "Comprei mais": 30, contados hoje.
  update public.medications set stock_count = 30, stock_counted_on = '2026-10-12' where id = m;
end $$;

-- Quico, de outra casa: não vê nem mexe no estoque nem na receita da Paula.
select set_config('request.jwt.claim.sub', :'user_q', false) \gset
do $$
declare
  m uuid := current_setting('test.med_p')::uuid;
  changed integer;
begin
  assert (select count(*) from public.medications where id = m) = 0, 'Q does not see the foreign medication';
  assert (select count(*) from public.medications where stock_count is not null or prescription_until is not null) = 0,
    'nor any stock or prescription';
  update public.medications
    set stock_count = 99, stock_counted_on = '2026-10-12', dose_units = 9, stock_warn_days = 60, prescription_until = '2030-01-01'
    where id = m;
  get diagnostics changed = row_count;
  assert changed = 0, 'Q cannot change the foreign stock';
  update public.medications set stock_count = null, stock_counted_on = null, prescription_until = null;
  get diagnostics changed = row_count;
  assert changed = 0, 'not even without naming the medication';
  -- Na própria casa, funciona.
  insert into public.medications (person_name, name, times, stock_count, stock_counted_on) values ('Quico', 'Puran', array['07:00'], 60, '2026-10-12');
  assert (select count(*) from public.medications) = 1, 'Q sees only the own medication';
end $$;

-- Paula de novo: tudo como ela deixou.
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
do $$
declare
  r public.medications;
begin
  select * into r from public.medications where id = current_setting('test.med_p')::uuid;
  assert r.stock_count = 30 and r.stock_counted_on = '2026-10-12' and r.dose_units = 0.5 and r.stock_warn_days = 60
    and r.prescription_until = '2026-12-20', 'the stock and the prescription are untouched by Q';
  assert (select count(*) from public.medications) = 1, 'and P does not see the medication of Q';
end $$;

-- ---------------------------------------------------------------------------
\echo '• lista da farmácia aberta: acha a da casa ou cria uma só'
do $$
declare
  first uuid;
  again uuid;
  market uuid;
  other uuid;
  blank uuid;
begin
  assert (select count(*) from public.shopping_lists) = 0, 'P starts without lists';
  select id into first from public.open_pharmacy_list();
  assert (select name = 'Farmácia' and kind = 'farmacia' and archived_at is null from public.shopping_lists where id = first),
    'creates "Farmácia" when no pharmacy list is open';
  select id into again from public.open_pharmacy_list('Outra');
  assert again = first, 'the open pharmacy list is reused';
  assert (select count(*) from public.shopping_lists) = 1, 'and no second list is created';
  -- A de mercado aberta e a de farmácia arquivada não servem.
  select id into market from public.open_market_list();
  update public.shopping_lists set archived_at = now() where id = first;
  select id into other from public.open_pharmacy_list();
  assert other <> first and other <> market, 'neither an archived pharmacy list nor a market list is reused';
  assert (select kind from public.shopping_lists where id = other) = 'farmacia', 'the new list is a pharmacy list';
  -- Nome em branco (ou nulo): "Farmácia".
  update public.shopping_lists set archived_at = now() where id = other;
  select id into blank from public.open_pharmacy_list('   ');
  assert (select name from public.shopping_lists where id = blank) = 'Farmácia', 'a blank name becomes "Farmácia"';
  update public.shopping_lists set archived_at = now() where id = blank;
  select id into blank from public.open_pharmacy_list(null);
  assert (select name from public.shopping_lists where id = blank) = 'Farmácia', 'a null name becomes "Farmácia"';
  perform set_config('test.pharmacy_p', blank::text, false);
end $$;
-- Quico, de outra casa: ganha a lista dele, nunca a da Paula.
select set_config('request.jwt.claim.sub', :'user_q', false) \gset
do $$
declare
  mine uuid;
begin
  select id into mine from public.open_pharmacy_list();
  assert mine <> current_setting('test.pharmacy_p')::uuid, 'another household never gets the open pharmacy list of P';
  assert (select count(*) from public.shopping_lists) = 1 and (select count(*) from public.shopping_lists where id = mine) = 1,
    'Q sees only the own pharmacy list';
end $$;
-- Sem casa, nada.
reset role;
\set user_r '00000000-0000-0000-0000-000000000052'
insert into auth.users (id) values (:'user_r');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_r', false) \gset
do $$
begin
  perform public.open_pharmacy_list();
  raise exception 'FAIL: pharmacy list without a household';
exception when insufficient_privilege then
  assert sqlerrm = 'sem casa', 'the error says there is no household';
end $$;
-- Anônimo não chama; só quem entrou, pelo grant explícito.
set role anon;
do $$
begin
  perform public.open_pharmacy_list();
  raise exception 'FAIL: anon opened a pharmacy list';
exception when insufficient_privilege then null;
end $$;
reset role;
do $$
begin
  assert not has_function_privilege('anon', 'public.open_pharmacy_list(text)', 'execute'), 'anon cannot execute open_pharmacy_list';
  assert has_function_privilege('authenticated', 'public.open_pharmacy_list(text)', 'execute'), 'members can execute open_pharmacy_list';
  -- Sem acl, vale o padrão do Postgres (execute para public).
  assert (select proacl is not null from pg_proc where oid = 'public.open_pharmacy_list(text)'::regprocedure)
    and not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.open_pharmacy_list(text)'::regprocedure and a.grantee = 0
  ), 'and public has no grant on open_pharmacy_list';
end $$;
reset role;

-- ---------------------------------------------------------------------------
\echo '• "Pôr na lista da farmácia": o item entra uma vez só, em qualquer lista de farmácia aberta'
-- Vera também mora na Casa da Paula: é o outro celular da casa.
\set user_med_v '00000000-0000-0000-0000-000000000053'
insert into auth.users (id) values (:'user_med_v');
insert into public.household_members (household_id, user_id, display_name)
  select m.household_id, :'user_med_v'::uuid, 'Vera' from public.household_members m where m.user_id = :'user_p';
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
do $$
declare
  current uuid := current_setting('test.pharmacy_p')::uuid;
  newer uuid;
  first record;
  again record;
begin
  assert (select count(*) from public.shopping_list_items) = 0, 'P starts without list items';
  -- Paula põe a Losartana: vai para a lista de farmácia aberta, como uma unidade de remédio ainda por comprar.
  select * into first from public.add_to_pharmacy_list('Losartana');
  assert first.added and first.list_id = current and first.list_name = 'Farmácia', 'the item goes to the open pharmacy list';
  assert (
    select i.name = 'Losartana' and i.category = 'medicamentos' and i.quantity = 1 and i.unit = 'un' and i.product_id is null
      and i.checked_at is null
    from public.shopping_list_items i where i.id = first.item_id
  ), 'as one unit of a medication, still to buy';
  -- De novo (outro toque, outro celular): fica o que já estava. Maiúsculas e espaços nas pontas não contam.
  select * into again from public.add_to_pharmacy_list('  LOSARTANA ');
  assert not again.added and again.item_id = first.item_id and again.list_id = current, 'a pending item of the same name is not added again';
  assert (select count(*) from public.shopping_list_items) = 1, 'and nothing else is written';
  -- O item com o nome de quem toma ("Nome — pessoa", como o app o põe quando duas pessoas da casa usam o mesmo
  -- remédio) é o mesmo item. O contrário não: com duas pessoas no remédio, o item só com o nome não diz de quem é.
  insert into public.shopping_list_items (list_id, name, category) values (current, 'Sinvastatina — Paula', 'medicamentos');
  select * into again from public.add_to_pharmacy_list('Sinvastatina', 'Sinvastatina — Paula');
  assert not again.added and again.list_id = current, 'the item with the name of who takes it counts as the same';
  insert into public.shopping_list_items (list_id, name, category) values (current, 'Atenolol', 'medicamentos');
  select * into again from public.add_to_pharmacy_list('Atenolol — Paula', 'Atenolol — Paula');
  assert again.added, 'a pending plain name does not stand for the item that carries the person';
  -- Já comprado (riscado no carrinho): não conta, e o remédio entra de novo.
  update public.shopping_list_items set checked_at = now() where id = first.item_id;
  select * into again from public.add_to_pharmacy_list('Losartana');
  assert again.added and again.item_id <> first.item_id, 'a bought item does not count';
  -- Outra lista de farmácia aberta, mais nova (feita à mão): o que está pendente na mais antiga não entra de
  -- novo, e a resposta diz onde ele está.
  insert into public.shopping_lists (name, kind, created_at) values ('Drogasil', 'farmacia', now() + interval '1 minute') returning id into newer;
  assert (select id from public.open_pharmacy_list()) = newer, 'the newer pharmacy list is the open one';
  select * into again from public.add_to_pharmacy_list('Losartana');
  assert not again.added and again.list_id = current and again.list_name = 'Farmácia', 'pending on an older open pharmacy list: not added again';
  assert (select count(*) from public.shopping_list_items where name = 'Losartana' and checked_at is null) = 1, 'one Losartana still to buy';
  -- O que não está pendente em lista nenhuma vai para a mais nova.
  select * into again from public.add_to_pharmacy_list('Puran T4');
  assert again.added and again.list_id = newer and again.list_name = 'Drogasil', 'a new item goes to the newest open pharmacy list';
  -- Pendente numa lista de mercado, ou numa de farmácia arquivada: não conta.
  insert into public.shopping_list_items (list_id, name, category) values ((select id from public.open_market_list()), 'Omeprazol', 'medicamentos');
  insert into public.shopping_list_items (list_id, name, category)
    values ((select id from public.shopping_lists where kind = 'farmacia' and archived_at is not null limit 1), 'Dipirona', 'medicamentos');
  select * into again from public.add_to_pharmacy_list('Omeprazol');
  assert again.added and again.list_id = newer, 'an item on a market list does not count';
  select * into again from public.add_to_pharmacy_list('Dipirona');
  assert again.added and again.list_id = newer, 'nor one on an archived pharmacy list';
  perform set_config('test.pharmacy_newer', newer::text, false);
end $$;
-- Vera, da mesma casa: acha o que Paula pôs.
select set_config('request.jwt.claim.sub', :'user_med_v', false) \gset
do $$
declare
  again record;
begin
  select * into again from public.add_to_pharmacy_list('puran t4');
  assert not again.added and again.list_id = current_setting('test.pharmacy_newer')::uuid, 'another member of the household finds the pending item';
end $$;
reset role;

-- Dois celulares da casa ao mesmo tempo, com duas sessões de verdade: esta (Paula) e a de Vera, aberta com
-- dblink (vem com o Postgres).
select exists (select 1 from pg_available_extensions where name = 'dblink') as has_dblink \gset
\if :has_dblink
create schema med_race;
create extension dblink schema med_race;
-- Se algo der errado, a sessão de Vera desiste em vez de esperar para sempre.
select format(
  'dbname=%s user=%s port=%s host=''%s''',
  current_database(),
  session_user,
  current_setting('port'),
  case when current_setting('listen_addresses') = '' then split_part(current_setting('unix_socket_directories'), ',', 1) else 'localhost' end
) as med_race_conn \gset
select med_race.dblink_connect('vera', :'med_race_conn') as med_race_connected \gset
select med_race.dblink_exec('vera', 'set statement_timeout = ''30s''') as med_race_timeout \gset
select med_race.dblink_exec('vera', 'set role authenticated') as med_race_role \gset
select set_config('test.med_race_pid', pid::text, false) as med_race_pid
  from med_race.dblink('vera', format('select set_config(''request.jwt.claim.sub'', %L, false), pg_backend_pid()', :'user_med_v')) as t (sub text, pid integer) \gset

-- (a) Paula põe o Enalapril e ainda não terminou; Vera põe o mesmo. Vera espera a trava da casa e, quando Paula
--     termina, acha o item dela: um Enalapril só.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
begin;
select set_config('test.med_race_item', item_id::text, false) as med_race_item from public.add_to_pharmacy_list('Enalapril') \gset
reset role;
select med_race.dblink_send_query('vera', 'select item_id, added from public.add_to_pharmacy_list(''Enalapril'')') as med_race_sent \gset
do $$
declare
  vera integer := current_setting('test.med_race_pid')::integer;
begin
  for i in 1..200 loop
    exit when pg_backend_pid() = any (pg_blocking_pids(vera));
    perform pg_sleep(0.05);
  end loop;
  assert pg_backend_pid() = any (pg_blocking_pids(vera)), 'the second add waits for the household lock of the first';
  assert med_race.dblink_is_busy('vera') = 1, 'and has not answered yet';
end $$;
commit;
do $$
declare
  r record;
begin
  select * into r from med_race.dblink_get_result('vera') as t (item_id uuid, added boolean);
  assert not r.added and r.item_id = current_setting('test.med_race_item')::uuid, 'the second add finds the item of the first';
  assert (select count(*) from public.shopping_list_items where name = 'Enalapril') = 1, 'one Enalapril on the lists';
end $$;
-- (A consulta só termina quando não há mais resultado a ler.)
select count(*) as med_race_drained from med_race.dblink_get_result('vera') as t (item_id uuid, added boolean) \gset

-- (b) Paula põe a Furosemida e ainda não terminou; Vera arquiva a lista em que ela entra. O arquivamento espera o
--     item entrar (a ordem de sempre: pôs, depois arquivou), em vez de o item ir para uma lista que já não aparece.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
begin;
select set_config('test.med_race_list', list_id::text, false) as med_race_list from public.add_to_pharmacy_list('Furosemida') \gset
reset role;
select med_race.dblink_send_query(
  'vera',
  format('update public.shopping_lists set archived_at = now() where id = %L', current_setting('test.med_race_list'))
) as med_race_sent \gset
do $$
declare
  vera integer := current_setting('test.med_race_pid')::integer;
begin
  assert current_setting('test.med_race_list')::uuid = current_setting('test.pharmacy_newer')::uuid, 'the item went to the newest open list';
  for i in 1..200 loop
    exit when pg_backend_pid() = any (pg_blocking_pids(vera));
    perform pg_sleep(0.05);
  end loop;
  assert pg_backend_pid() = any (pg_blocking_pids(vera)), 'archiving the list waits for the add on it';
end $$;
commit;
do $$
declare
  r record;
begin
  select * into r from med_race.dblink_get_result('vera') as t (status text);
  assert r.status = 'UPDATE 1', r.status;
  assert (
    select l.archived_at is not null from public.shopping_lists l where l.id = current_setting('test.med_race_list')::uuid
  ), 'the list was archived after the add';
  assert (select count(*) from public.shopping_list_items where name = 'Furosemida') = 1, 'with the item on it';
end $$;
select count(*) as med_race_drained from med_race.dblink_get_result('vera') as t (status text) \gset

-- (c) Na ordem contrária: Paula arquiva a última lista de farmácia aberta e ainda não terminou; Vera põe a
--     Furosemida (a de antes ficou na lista arquivada). Ela espera o arquivamento e põe o item numa lista nova,
--     aberta.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
begin;
update public.shopping_lists set archived_at = now() where id = current_setting('test.pharmacy_p')::uuid;
reset role;
select med_race.dblink_send_query('vera', 'select list_id, added from public.add_to_pharmacy_list(''Furosemida'')') as med_race_sent \gset
do $$
declare
  vera integer := current_setting('test.med_race_pid')::integer;
begin
  for i in 1..200 loop
    exit when pg_backend_pid() = any (pg_blocking_pids(vera));
    perform pg_sleep(0.05);
  end loop;
  assert pg_backend_pid() = any (pg_blocking_pids(vera)), 'the add waits for the archive of the list it found';
end $$;
commit;
do $$
declare
  r record;
begin
  select * into r from med_race.dblink_get_result('vera') as t (list_id uuid, added boolean);
  assert r.added, 'the item is added';
  assert r.list_id <> all (array[current_setting('test.pharmacy_p')::uuid, current_setting('test.pharmacy_newer')::uuid]),
    'to another list than the archived ones';
  assert (select l.kind = 'farmacia' and l.archived_at is null and l.name = 'Farmácia' from public.shopping_lists l where l.id = r.list_id),
    'a new open pharmacy list';
  assert (select count(*) from public.shopping_list_items where name = 'Furosemida' and list_id = r.list_id and checked_at is null) = 1,
    'with the item on it';
end $$;
select count(*) as med_race_drained from med_race.dblink_get_result('vera') as t (list_id uuid, added boolean) \gset
select med_race.dblink_disconnect('vera') as med_race_closed \gset
drop extension dblink;
drop schema med_race;
\else
\echo '  (este Postgres não tem dblink: as corridas entre duas sessões não rodaram; fica conferido que add_to_pharmacy_list trava a casa e a lista)'
do $$
declare
  src text := (select p.prosrc from pg_proc p where p.oid = 'public.add_to_pharmacy_list(text, text, text)'::regprocedure);
begin
  assert src ~ 'pg_advisory_xact_lock\(hashtextextended\(''open_pharmacy_list:''', 'add_to_pharmacy_list takes the household lock of open_pharmacy_list';
  assert src ~ 'for update', 'and locks the list row before looking for the item';
end $$;
\endif

-- Quico, de outra casa: não vê os itens da Paula, e o dele vai para a lista dele.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_q', false) \gset
do $$
declare
  r record;
begin
  select * into r from public.add_to_pharmacy_list('Losartana');
  assert r.added, 'another household does not see the pending items of P';
  assert (select count(*) from public.shopping_lists where id = r.list_id) = 1, 'and the item goes to an own list';
  assert (select count(*) from public.shopping_list_items) = 1, 'Q sees only the own item';
end $$;
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
do $$
begin
  assert (select count(*) from public.shopping_list_items where name = 'Losartana' and checked_at is null) = 1, 'the item of Q is not on the lists of P';
end $$;
-- Sem casa, nada; anônimo não chama.
select set_config('request.jwt.claim.sub', :'user_r', false) \gset
do $$
begin
  perform public.add_to_pharmacy_list('Losartana');
  raise exception 'FAIL: pharmacy item without a household';
exception when insufficient_privilege then
  assert sqlerrm = 'sem casa', 'the error says there is no household';
end $$;
set role anon;
do $$
begin
  perform public.add_to_pharmacy_list('Losartana');
  raise exception 'FAIL: anon added a pharmacy item';
exception when insufficient_privilege then null;
end $$;
reset role;
do $$
begin
  assert not has_function_privilege('anon', 'public.add_to_pharmacy_list(text, text, text)', 'execute'), 'anon cannot execute add_to_pharmacy_list';
  assert has_function_privilege('authenticated', 'public.add_to_pharmacy_list(text, text, text)', 'execute'), 'members can execute add_to_pharmacy_list';
  assert (select proacl is not null from pg_proc where oid = 'public.add_to_pharmacy_list(text, text, text)'::regprocedure)
    and not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.add_to_pharmacy_list(text, text, text)'::regprocedure and a.grantee = 0
  ), 'and public has no grant on add_to_pharmacy_list';
  assert not (select p.prosecdef from pg_proc p where p.oid = 'public.add_to_pharmacy_list(text, text, text)'::regprocedure),
    'add_to_pharmacy_list runs as the caller (RLS applies)';
end $$;

-- ---------------------------------------------------------------------------
\echo '• remédio salvo por um app de antes do estoque: a regra nova não lê a contagem antiga'
-- O app de antes do estoque salva o remédio sem as colunas dele. Se muda a regra das doses de um remédio com o
-- estoque acompanhado, o banco para de acompanhar o estoque (a contagem antiga, lida com a regra nova desde o dia
-- em que foi feita, pularia sem ninguém ter contado nada). O app de agora sempre grava a contagem refeita.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
do $$
declare
  counted date := current_date - 3;
  m uuid;
  r public.medications;
  change text;
begin
  -- (1) Duas vezes por dia, com o corpo do app de antes (sem o estoque): a contagem sai, a regra nova fica.
  insert into public.medications (person_name, name, times, start_on, stock_count, stock_counted_on)
    values ('Paula', 'Clonazepam', array['08:00'], '2026-01-01', 30, counted) returning id into m;
  update public.medications
    set person_id = null, person_name = 'Paula', name = 'Clonazepam', dosage = null, times = array['08:00', '20:00'], start_on = '2026-01-01',
      end_on = null, notes = null, frequency = 'daily', weekdays = null, interval_days = null, total_doses = null
    where id = m returning * into r;
  assert r.stock_count is null and r.stock_counted_on is null, 'an old app changing the times a day stops following the stock';
  assert r.times = array['08:00', '20:00'], 'and the new rule is saved';
  -- Cada parte da regra conta, e "Cada dose usa" também.
  foreach change in array array[
    'frequency = ''weekdays'', weekdays = array[1]::smallint[]',
    'frequency = ''interval'', interval_days = 2',
    'start_on = ''2026-02-01''',
    'end_on = ''2027-12-31''',
    'total_doses = 500',
    'dose_units = 2'
  ] loop
    insert into public.medications (person_name, name, times, start_on, stock_count, stock_counted_on)
      values ('Paula', 'Clonazepam', array['08:00'], '2026-01-01', 30, counted) returning id into m;
    execute format('update public.medications set %s where id = %L', change, m);
    select * into r from public.medications where id = m;
    assert r.stock_count is null and r.stock_counted_on is null, format('a rule change without a recount (%s) stops following the stock', change);
  end loop;
  -- Contada antes de ontem: já não é a contagem de hoje que o app de agora refaria igual.
  insert into public.medications (person_name, name, times, start_on, stock_count, stock_counted_on)
    values ('Paula', 'Clonazepam', array['08:00'], '2026-01-01', 30, current_date - 2) returning id into m;
  update public.medications set times = array['08:00', '20:00'] where id = m returning * into r;
  assert r.stock_count is null, 'a count from the day before yesterday is not kept under the new rule';

  -- (2) O app de agora faz a mesma mudança e grava a contagem refeita (o que sobrava, contado hoje): fica.
  insert into public.medications (person_name, name, times, start_on, stock_count, stock_counted_on)
    values ('Paula', 'Clonazepam', array['08:00'], '2026-01-01', 30, counted) returning id into m;
  update public.medications set times = array['08:00', '20:00'], stock_count = 27, stock_counted_on = current_date where id = m returning * into r;
  assert r.stock_count = 27 and r.stock_counted_on = current_date and r.times = array['08:00', '20:00'], 'the recount of the current app stays';
  -- Já tinha acabado: o zero no dia em que acabou também fica.
  insert into public.medications (person_name, name, times, start_on, stock_count, stock_counted_on)
    values ('Paula', 'Clonazepam', array['08:00'], '2026-01-01', 2, counted) returning id into m;
  update public.medications set dose_units = 0.5, stock_count = 0, stock_counted_on = counted + 2 where id = m returning * into r;
  assert r.stock_count = 0 and r.stock_counted_on = counted + 2 and r.dose_units = 0.5, 'the zero on the run-out day stays';

  -- (3) Não é regra nova: só o horário (outros horários, ou os mesmos em outra ordem), os dias da semana em outra
  --     ordem, o nome, a dose escrita ou as observações. A contagem fica.
  insert into public.medications (person_name, name, times, start_on, frequency, weekdays, stock_count, stock_counted_on)
    values ('Paula', 'Clonazepam', array['08:00', '20:00'], '2026-01-01', 'weekdays', array[1, 3]::smallint[], 30, counted) returning id into m;
  update public.medications set times = array['21:00', '07:30'] where id = m;
  update public.medications set weekdays = array[3, 1]::smallint[] where id = m;
  update public.medications set name = 'Clonazepam 2 mg', dosage = '1 comprimido', notes = 'à noite' where id = m;
  update public.medications set dose_units = 1, start_on = '2026-01-01', end_on = null, total_doses = null where id = m returning * into r;
  assert r.stock_count = 30 and r.stock_counted_on = counted, 'clock times, weekday order, name, dosage and notes keep the count';
  assert r.times = array['21:00', '07:30'] and r.weekdays = array[3, 1]::smallint[] and r.name = 'Clonazepam 2 mg', 'and are saved';

  -- (4) Contagem zerada (nada a pular), e contagem de hoje ou de ontem (o app de agora refaz a de hoje com os
  --     mesmos valores; à noite no Brasil, o dia do servidor já é o seguinte): ficam.
  for r in
    insert into public.medications (person_name, name, times, start_on, stock_count, stock_counted_on)
      values ('Paula', 'Clonazepam', array['08:00'], '2026-01-01', 0, counted),
        ('Paula', 'Clonazepam', array['08:00'], '2026-01-01', 30, current_date),
        ('Paula', 'Clonazepam', array['08:00'], '2026-01-01', 30, current_date - 1)
      returning *
  loop
    update public.medications set times = array['08:00', '20:00'] where id = r.id;
    assert (select stock_count = r.stock_count and stock_counted_on = r.stock_counted_on from public.medications where id = r.id),
      format('a count of %s on %s is kept', r.stock_count, r.stock_counted_on);
  end loop;
  perform set_config('test.med_old_rule', m::text, false);
end $$;
-- (5) Quem não usa a API não passa pelo gatilho: a service role e as funções do banco (aqui, o dono).
reset role;
do $$
declare
  m uuid;
  r public.medications;
begin
  insert into public.medications (household_id, person_name, name, times, start_on, stock_count, stock_counted_on)
    select household_id, 'Paula', 'Clonazepam', array['08:00'], '2026-01-01', 30, current_date - 3 from public.medications
    where id = current_setting('test.med_old_rule')::uuid
    returning id into m;
  perform set_config('test.med_service', m::text, false);
  update public.medications set times = array['08:00', '20:00'] where id = m returning * into r;
  assert r.stock_count = 30, 'the owner (and so a security definer function) is left alone';
end $$;
set role service_role;
do $$
declare
  r public.medications;
begin
  update public.medications set times = array['08:00', '14:00', '20:00'] where id = current_setting('test.med_service')::uuid returning * into r;
  assert r.stock_count = 30 and r.stock_counted_on = current_date - 3, 'the service role is left alone';
end $$;
reset role;
do $$
begin
  assert not (select p.prosecdef from pg_proc p where p.oid = 'public.medication_rule_without_recount()'::regprocedure),
    'medication_rule_without_recount is security invoker';
  assert (select p.proconfig from pg_proc p where p.oid = 'public.medication_rule_without_recount()'::regprocedure) = array['search_path=""'],
    'with an empty search_path';
  assert not exists (
    select 1 from unnest(array['public', 'anon', 'authenticated']) as who
    where has_function_privilege(who, 'public.medication_rule_without_recount()', 'execute')
  ), 'medication_rule_without_recount is called by no role of the API';
end $$;

-- ---------------------------------------------------------------------------
\echo '• "estou indo ao mercado": a ida, o aviso nos navegadores dos outros e os limites'
\set user_p '00000000-0000-0000-0000-000000000031'
\set user_q '00000000-0000-0000-0000-000000000032'
\set user_r '00000000-0000-0000-0000-000000000033'
\set user_s '00000000-0000-0000-0000-000000000034'
\set user_u '00000000-0000-0000-0000-000000000035'
\set user_t '00000000-0000-0000-0000-000000000036'
reset role;
insert into auth.users (id) values (:'user_p'), (:'user_q'), (:'user_r'), (:'user_s'), (:'user_u'), (:'user_t');
-- Os caracteres que não aparecem vão escritos com escapes (E'\u....'), aqui e na migração: nenhum fica solto no arquivo.
do $$
begin
  assert public.push_text(E'  Ana\n\r\tMaria\u2028da\u202E Silva  ', 40) = 'Ana Maria da Silva', 'one line, no control or direction characters';
  assert public.push_text(E'Ana \n' || repeat('x', 50), 4) = 'Ana', 'cut, and no space left at the end';
  assert public.push_text(null, 40) = '' and public.push_text(E'\n\t', 40) = '', 'nothing left: the caller falls back';
  assert public.push_text(repeat(E'\u202Eab', 100), 40) = left(repeat('ab ', 100), 40), '300 characters with direction overrides: one line, cut at the limit';
  -- Um nome só com caracteres que não aparecem é um nome vazio.
  assert public.push_text(E'\u200B\u200B', 40) = '', 'zero-width spaces only';
  assert public.push_text(E'\u00A0\u00A0', 40) = '', 'no-break spaces only';
  assert public.push_text(E'\u3164', 40) = '' and public.push_text(E'\uFEFF\u2060\u00AD\u061C\u200E', 40) = '', 'fillers, joiners and marks only';
  assert public.push_text(E'\u200D \u200C\uFE0F', 40) = '', 'the joiners that are kept do not make a name on their own';
  assert public.push_text(E'Ana\u00A0Maria', 40) = 'Ana Maria', 'a no-break space becomes a plain one';
  assert public.push_text(E'Ko\u200Btii\u202E: conta', 40) = 'Ko tii : conta', 'zero-width and direction characters do not hide inside a name';
  assert public.push_text(E'a\u2066b\u2069c\u2067', 40) = 'a b c', 'the direction isolates go too';
  assert public.push_text(E'\u034F', 40) = '' and public.push_text(E'\u17B4\u17B5\u2065\uFFF9\uFFFC', 40) = ''
    and public.push_text(E'\U0001D159', 40) = '', 'rarer invisible characters do not make a name either';
  assert public.push_text(E'\u0301', 40) = '', 'a combining accent with no letter under it is not a name';
  assert public.push_text(E'Jose\u0301 A\u0303', 40) = E'Jose\u0301 A\u0303', 'accents typed as combining marks stay on their letters';
  -- A família (homem, mulher, menina) é um emoji só por causa dos U+200D: continua inteira.
  assert public.push_text(E'Casa \U0001F468\u200D\U0001F469\u200D\U0001F467', 40) = E'Casa \U0001F468\u200D\U0001F469\u200D\U0001F467',
    'an emoji sequence keeps its joiners';
  -- Os seletores de variação dos ideogramas (U+E0100–E01EF) e do mongol (U+180B–180D, U+180F) e as marcas que se
  -- combinam fora de U+0300–036F, sozinhos, não fazem um nome: o aviso diz "Alguém da casa".
  assert public.push_text(E'\U000E0100', 40) = '' and public.push_text(E'\U000E01EF\U000E0100', 40) = '', 'ideographic variation selectors only';
  assert public.push_text(E'\u180B', 40) = '' and public.push_text(E'\u180B\u180C\u180D\u180F', 40) = '', 'Mongolian variation selectors only';
  -- O U+180E, entre eles, é o separador de vogais do mongol, e não um seletor: vira espaço, como os de largura zero.
  assert public.push_text(E'A\u180EB', 40) = 'A B', 'the Mongolian vowel separator becomes a space inside a name';
  assert public.push_text(E'\u20D0', 40) = '' and public.push_text(E'\u1AB0\u1DC4\u20D0\uFE20', 40) = '', 'combining marks of the other blocks only';
  assert coalesce(nullif(public.push_text(E' \U000E0100\u180B\u20D0 ', 40), ''), 'Alguém da casa') = 'Alguém da casa', 'so the name falls back';
  -- Os controles de formato que nunca são parte de um nome viram espaço, como os outros invisíveis.
  assert public.push_text(E'\U0001BCA0\U0001D173\U0001D17A\uFFF0\uFFF8', 40) = '', 'format controls only';
  assert public.push_text(E'Ana\U0001D173Maria\uFFF0Silva\U0001BCA3', 40) = 'Ana Maria Silva', 'format controls inside a name become spaces';
  -- Dentro de um nome de verdade, os seletores e as marcas ficam: são parte da letra.
  assert public.push_text(E'\u845B\U000E0100\u98FE', 40) = E'\u845B\U000E0100\u98FE', 'a name with an ideographic variation selector inside keeps it';
  assert public.push_text(E'\u182D\u180B\u1823', 40) = E'\u182D\u180B\u1823', 'and so does a Mongolian name with its variation selector';
  assert public.push_text(E'Zoe\u1DC4 Ana', 40) = E'Zoe\u1DC4 Ana', 'and a letter with a combining mark of another block';
end $$;
-- As permissões vêm da própria migração, e não do padrão do projeto (que o
-- Supabase deixa de aplicar a tabela nova em 30/10/2026). Uma de cada vez: com
-- várias na mesma pergunta, has_table_privilege responde que sim se o papel
-- tiver QUALQUER uma delas.
do $$
declare
  t text;
  p text;
begin
  foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
    foreach t in array array['public.market_trips', 'public.market_trip_log'] loop
      assert not has_table_privilege('anon', t, p), format('anon must not have %s on %s', p, t);
      if p in ('select', 'insert', 'update', 'delete') then
        assert has_table_privilege('service_role', t, p), format('service_role must have %s on %s', p, t);
      end if;
    end loop;
    -- O registro do limite é só da função; nas idas, quem está logado só lê.
    assert not has_table_privilege('authenticated', 'public.market_trip_log', p), format('authenticated must not have %s on market_trip_log', p);
    assert has_table_privilege('authenticated', 'public.market_trips', p) = (p = 'select'),
      format('authenticated must have select and nothing else on market_trips (%s)', p);
  end loop;
  assert (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.market_trips'::regclass, 'public.market_trip_log'::regclass)),
    'row level security on both';
  assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'market_trip_log'), 'and no policy on the log: nobody reads it through the app';
  -- Cada aviso tira do registro o que já fez 24 horas, de todas as casas: pela data, com índice.
  assert exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'market_trip_log' and indexname = 'market_trip_log_created_idx'
      and indexdef like '%USING btree (created_at)'
  ), 'the global purge of the log has an index on created_at';
  -- Encerrar, avisar de novo, sair da casa e arquivar ou apagar a lista tiram da fila os avisos de uma ida
  -- pelo data.reminder: num índice só das linhas do servidor, sem ler a agenda de todos os navegadores.
  assert exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'push_schedule' and indexname = 'push_schedule_server_reminder_idx'
      and indexdef like '%USING btree (((data ->> ''reminder''::text))) WHERE (data ? ''server''::text)'
  ), 'the trip notices are reached through a partial index on data->>reminder, of the server rows only';
end $$;
-- E o planejador o usa nas buscas como as funções as escrevem (com o `data ? 'server'` do índice): o
-- seqscan desligado só tira o empate de uma tabela pequena, e sem o índice o plano seria a leitura inteira.
do $$
declare
  line text;
  plan text := '';
begin
  perform set_config('enable_seqscan', 'off', true);
  for line in execute $sql$
    explain delete from public.push_schedule p
      where p.data ? 'server' and p.data ->> 'reminder' = 'ida:' || '00000000-0000-0000-0000-000000000000'
  $sql$ loop
    plan := plan || line || ' / ';
  end loop;
  assert plan like '%Index Scan using push_schedule_server_reminder_idx%', 'the delete of a trip notices uses the index: ' || plan;
  plan := '';
  for line in execute $sql$
    explain with ended as (select gen_random_uuid() as id)
    delete from public.push_schedule p using ended e where p.data ? 'server' and p.data ->> 'reminder' = 'ida:' || e.id::text
  $sql$ loop
    plan := plan || line || ' / ';
  end loop;
  assert plan like '%Index Scan using push_schedule_server_reminder_idx%', 'and so does the delete of the notices of the trips just ended: ' || plan;
  -- Arquivar a lista e sair da casa encerram as idas num comando e tiram os avisos delas no seguinte, pelos ids.
  -- Com poucas linhas, o planejador pode ler o índice inteiro por bitmap: também só as linhas do servidor.
  plan := '';
  for line in execute $sql$
    explain delete from public.push_schedule p
      using unnest('{00000000-0000-0000-0000-000000000000,00000000-0000-0000-0000-000000000001}'::uuid[]) e(id)
      where p.data ? 'server' and p.data ->> 'reminder' = 'ida:' || e.id::text
  $sql$ loop
    plan := plan || line || ' / ';
  end loop;
  assert plan like '%Index Scan using push_schedule_server_reminder_idx%' or plan like '%Bitmap Index Scan on push_schedule_server_reminder_idx%',
    'and so does the delete of the notices of the trips ended the statement before: ' || plan;
end $$;
set role authenticated;

-- A casa P: Paula (dona, com um nome de exibição hostil), Quim, Rita, Sara e Ugo.
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
select (public.create_household('Casa P', E'Paula\n\r\tMalvada ' || repeat('x', 300))).id as hh_p \gset
select set_config('test.hh_p', :'hh_p', false) \gset
select invite_code as invite_p from public.households where id = :'hh_p' \gset
insert into public.shopping_lists (name, kind) values (E'Compras\ndo mês ' || repeat('y', 300), 'mercado') returning id as list_p1 \gset
insert into public.shopping_lists (name, kind) values ('Farmácia', 'farmacia') returning id as list_p2 \gset
select set_config('test.list_p1', :'list_p1', false) \gset
select set_config('test.list_p2', :'list_p2', false) \gset
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-p1', 'k', 'a', 'UTC') \gset

-- Quim recebe em dois navegadores.
select set_config('request.jwt.claim.sub', :'user_q', false) \gset
select public.join_household(:'invite_p', 'Quim') \gset
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-q1', 'k', 'a', 'UTC') \gset
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-q2', 'k', 'a', 'UTC') \gset

-- Rita desligou "Alguém indo ao mercado" no navegador dela.
select set_config('request.jwt.claim.sub', :'user_r', false) \gset
select public.join_household(:'invite_p', 'Rita') \gset
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-r1', 'k', 'a', 'UTC') \gset
do $$
begin
  assert (select market_trips from public.push_subscriptions), 'a browser that receives Kotii notifications starts with the trips on';
  assert public.set_push_market_trips('https://fcm.googleapis.com/fcm/send/ida-r1', false), 'the owner switches her browser off';
  assert not (select market_trips from public.push_subscriptions), 'and reads it back';
  assert not public.set_push_market_trips('https://fcm.googleapis.com/fcm/send/ida-q1', false), 'a foreign endpoint changes nothing';
end $$;

-- A agenda do navegador de Sara está cheia.
select set_config('request.jwt.claim.sub', :'user_s', false) \gset
select public.join_household(:'invite_p', 'Sara') \gset
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-s1', 'k', 'a', 'UTC') \gset
insert into public.push_schedule (id, subscription_id, title, repeat, hour, minute)
select gen_random_uuid(), (select id from public.push_subscriptions), 'Aviso ' || n, 'daily', 8, 0
from generate_series(1, public.max_push_schedule()) n;

select set_config('request.jwt.claim.sub', :'user_u', false) \gset
select public.join_household(:'invite_p', 'Ugo') \gset
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-u1', 'k', 'a', 'UTC') \gset

-- Outra casa: Téo, e Paula também mora nela.
select set_config('request.jwt.claim.sub', :'user_t', false) \gset
select (public.create_household('Casa T', 'Téo')).id as hh_t \gset
select set_config('test.hh_t', :'hh_t', false) \gset
select invite_code as invite_t from public.households where id = :'hh_t' \gset
insert into public.shopping_lists (name, kind) values ('Mercado', 'mercado') returning id as list_t1 \gset
select set_config('test.list_t1', :'list_t1', false) \gset
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-t1', 'k', 'a', 'UTC') \gset
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
select public.join_household(:'invite_t', 'Paula') \gset

reset role;
do $$
begin
  assert (select count(*) from public.push_subscriptions where endpoint like '%/ida-q1' and market_trips) = 1, 'Rita did not touch the other member browser';
end $$;
set role anon;
do $$
begin
  perform public.announce_market_trip(gen_random_uuid());
  raise exception 'FAIL: anon announced a trip';
exception when insufficient_privilege then null;
end $$;
set role authenticated;

-- Paula avisa, com a casa P aberta.
do $$
declare
  hp uuid := current_setting('test.hh_p')::uuid;
  list uuid := current_setting('test.list_p1')::uuid;
  r jsonb;
  again jsonb;
  closed uuid;
begin
  perform set_config('request.headers', json_build_object('x-household-id', hp)::text, true);
  begin
    perform public.announce_market_trip(current_setting('test.list_t1')::uuid);
    raise exception 'FAIL: announced a list of another household (even one the person lives in)';
  exception when no_data_found then null;
  end;
  begin
    perform public.announce_market_trip(gen_random_uuid());
    raise exception 'FAIL: announced a list that does not exist';
  exception when no_data_found then null;
  end;
  -- Uma lista arquivada (por outro aparelho, com a tela ainda aberta neste) também não serve.
  insert into public.shopping_lists (name) values ('Arquivada') returning id into closed;
  update public.shopping_lists set archived_at = now() where id = closed;
  begin
    perform public.announce_market_trip(closed);
    raise exception 'FAIL: announced an archived list';
  exception when no_data_found then null;
  end;
  assert not exists (select 1 from public.market_trips), 'a refused announcement leaves no trip';

  r := public.announce_market_trip(list);
  assert (r ->> 'repeated')::boolean = false, 'a new trip';
  assert (r ->> 'members')::int = 4, 'four other members';
  assert (r ->> 'notified')::int = 2, 'two of them had a notification queued (Quim once, Ugo; not Rita, not Sara)';
  perform set_config('test.trip_1', r ->> 'trip_id', false);
  assert (select count(*) from public.push_schedule) = 0, 'nothing in the announcer own browser';
  assert (select count(*) from public.market_trips where id = (r ->> 'trip_id')::uuid and user_id = auth.uid() and list_id = list
    and ended_at is null and ends_at = created_at + interval '2 hours') = 1, 'the trip lasts two hours';

  again := public.announce_market_trip(list);
  assert again ->> 'trip_id' = r ->> 'trip_id' and (again ->> 'repeated')::boolean and (again ->> 'notified')::int = 0,
    'within 30 minutes: the same trip, nobody notified again';
  assert (again ->> 'created_at')::timestamptz = (r ->> 'created_at')::timestamptz, 'with the time of the first announcement';
  assert (select count(*) from public.market_trips) = 1, 'and no second trip';
end $$;

reset role;
do $$
declare
  hp uuid := current_setting('test.hh_p')::uuid;
  trip text := current_setting('test.trip_1');
  who text := 'Paula Malvada ' || repeat('x', 26);
  list_name text := 'Compras do mês ' || repeat('y', 45);
  queued public.push_schedule;
begin
  assert (
    select array_agg(s.endpoint order by s.endpoint)
    from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where p.data ? 'server'
  ) = array[
    'https://fcm.googleapis.com/fcm/send/ida-q1', 'https://fcm.googleapis.com/fcm/send/ida-q2', 'https://fcm.googleapis.com/fcm/send/ida-u1'
  ], 'one row per browser of the other members with the option on: not the announcer, not the one who switched it off, not the full one, not the other household (nor the announcer other household), and nothing from the repeat';
  assert (select count(distinct (p.title, p.body, p.data::text, p.repeat)) from public.push_schedule p where p.data ? 'server') = 1,
    'all the same notice (each of them lives in one household: no household name in the title)';
  select * into queued from public.push_schedule p where p.data ? 'server' limit 1;
  assert char_length(who) = 40 and queued.title = who || ' está indo ao mercado', 'title from the stored name: one line, cut at 40';
  assert char_length(list_name) = 60 and queued.body = 'Falta alguma coisa? Ponha na lista “' || list_name || '” agora.',
    'body from the stored list name: one line, cut at 60';
  assert queued.title !~ '[[:cntrl:]]' and queued.body !~ '[[:cntrl:]]', 'no line breaks or control characters';
  assert queued.data = jsonb_build_object('reminder', 'ida:' || trip, 'server', true, 'householdId', hp), 'tagged as a server row of this trip and household';
  assert queued.repeat = 'once' and queued.fire_at <= now() and queued.next_at <= now() and queued.claimed_at is null, 'due right away';
  assert (select display_name from public.market_trips where id = trip::uuid) = who, 'the trip keeps the name that went out';
  assert (select count(*) from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where s.endpoint like '%/ida-s1') = public.max_push_schedule(), 'the full browser was skipped without failing the others';
end $$;

-- A send-push de hoje levaria essas linhas.
set role service_role;
do $$
begin
  assert (
    select array_agg(d.endpoint order by d.endpoint) from public.take_due_pushes(now() + interval '1 second') d
    where d.data ->> 'reminder' = 'ida:' || current_setting('test.trip_1')
  ) = array[
    'https://fcm.googleapis.com/fcm/send/ida-q1', 'https://fcm.googleapis.com/fcm/send/ida-q2', 'https://fcm.googleapis.com/fcm/send/ida-u1'
  ], 'take_due_pushes hands the queued rows to send-push';
end $$;
reset role;
update public.push_schedule set claimed_at = null;
set role authenticated;

-- No navegador de Quim: a poda do app deixa o aviso do servidor; ele não encerra a ida de Paula nem escreve direto.
select set_config('request.jwt.claim.sub', :'user_q', false) \gset
do $$
declare
  trip uuid := current_setting('test.trip_1')::uuid;
  sub uuid := (select id from public.push_subscriptions where endpoint like '%/ida-q1');
begin
  insert into public.push_schedule (id, subscription_id, title, repeat, hour, minute)
  values (gen_random_uuid(), sub, 'Lembrete que o app esqueceu', 'daily', 8, 0);
  assert public.prune_push_schedule(sub, '{}') = 1, 'the prune still removes what the app no longer knows';
  assert (select array_agg(data ->> 'reminder') from public.push_schedule where subscription_id = sub) = array['ida:' || trip],
    'and keeps the row the server queued';

  assert (select count(*) from public.market_trips where id = trip) = 1, 'the household reads the trip';
  assert not public.end_market_trip(trip), 'another member does not end it';
  assert (select ended_at from public.market_trips where id = trip) is null, 'still on';
  begin
    insert into public.market_trips (household_id, list_id, user_id, display_name, ends_at)
    values (current_setting('test.hh_p')::uuid, current_setting('test.list_p1')::uuid, auth.uid(), 'Quim', now() + interval '2 hours');
    raise exception 'FAIL: inserted a trip directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.market_trips set ended_at = now() where id = trip;
    raise exception 'FAIL: updated a trip directly';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.market_trips where id = trip;
    raise exception 'FAIL: deleted a trip directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Ugo desliga a opção: o aviso de ida que estava na fila dele sai, o resto da agenda fica.
select set_config('request.jwt.claim.sub', :'user_u', false) \gset
do $$
declare
  sub uuid := (select id from public.push_subscriptions);
begin
  insert into public.push_schedule (id, subscription_id, title, repeat, hour, minute)
  values (gen_random_uuid(), sub, 'Lembrete do Ugo', 'daily', 8, 0);
  assert public.set_push_market_trips('https://fcm.googleapis.com/fcm/send/ida-u1', false), 'switched off';
  assert (select array_agg(title) from public.push_schedule) = array['Lembrete do Ugo'], 'the queued trip notice left, the reminder stayed';
  assert public.set_push_market_trips('https://fcm.googleapis.com/fcm/send/ida-u1', true), 'and on again';
  delete from public.push_schedule;
end $$;

-- A outra casa não lê as idas da casa P, nem pedindo por ela.
select set_config('request.jwt.claim.sub', :'user_t', false) \gset
do $$
begin
  assert (select count(*) from public.market_trips) = 0, 'another household does not read the trips';
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_p'))::text, true);
  assert (select count(*) from public.market_trips) = 0, 'nor by asking for that household';
  assert not public.end_market_trip(current_setting('test.trip_1')::uuid), 'nor ends them';
  assert (select count(*) from public.push_schedule) = 0, 'and got no notice';
end $$;

-- Paula encerra: vale para a casa toda, e o que não saiu deixa a fila.
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
do $$
declare
  trip uuid := current_setting('test.trip_1')::uuid;
  r jsonb;
begin
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_p'))::text, true);
  assert public.end_market_trip(trip), 'the author ends the trip';
  assert (select ended_at from public.market_trips where id = trip) is not null, 'ended for everyone';
  assert not public.end_market_trip(trip), 'ending twice does nothing';

  -- Uma lista de farmácia: o aviso não fala em mercado.
  r := public.announce_market_trip(current_setting('test.list_p2')::uuid);
  assert (r ->> 'repeated')::boolean = false and (r ->> 'notified')::int = 2, 'another list is another trip';
  perform set_config('test.trip_2', r ->> 'trip_id', false);
end $$;
reset role;
do $$
begin
  assert not exists (select 1 from public.push_schedule where data ->> 'reminder' = 'ida:' || current_setting('test.trip_1')),
    'the undelivered notices of the ended trip are gone';
  assert (select count(*) from public.push_schedule where data ->> 'reminder' = 'ida:' || current_setting('test.trip_2')
    and title like '% está indo às compras' and body = 'Falta alguma coisa? Ponha na lista “Farmácia” agora.') = 3,
    'a list that is not a market one says "às compras"';
  assert (select count(*) from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where s.endpoint like '%/ida-s1') = public.max_push_schedule(), 'the other browsers kept their schedule';
end $$;

-- Ugo é tirado da casa: o aviso que ainda não saiu para ele some, e os próximos não vão.
set role authenticated;
do $$
declare
  hp uuid := current_setting('test.hh_p')::uuid;
  r jsonb;
begin
  perform set_config('request.headers', json_build_object('x-household-id', hp)::text, true);
  perform public.remove_member(hp, '00000000-0000-0000-0000-000000000035');
  -- A ida da lista de mercado foi encerrada: avisar de novo é uma ida nova.
  r := public.announce_market_trip(current_setting('test.list_p1')::uuid);
  assert (r ->> 'repeated')::boolean = false and (r ->> 'members')::int = 3 and (r ->> 'notified')::int = 1,
    'after an ended trip a new one starts, only for who still lives in the household';
  perform set_config('test.trip_3', r ->> 'trip_id', false);
end $$;
reset role;
do $$
begin
  assert not exists (
    select 1 from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where s.endpoint like '%/ida-u1'
  ), 'the removed member lost the queued notice and got no new one';
  assert (select count(*) from public.push_schedule where data ->> 'reminder' = 'ida:' || current_setting('test.trip_3')) = 2,
    'the new trip went to the two browsers of the member that is left with the option on';
  -- Meia hora depois (as idas de até agora ficam 31 minutos mais velhas).
  update public.market_trips set created_at = created_at - interval '31 minutes';
end $$;

-- Até 5 idas novas por pessoa, por casa, em 24 horas.
set role authenticated;
do $$
declare
  hp uuid := current_setting('test.hh_p')::uuid;
  r jsonb;
begin
  perform set_config('request.headers', json_build_object('x-household-id', hp)::text, true);
  r := public.announce_market_trip(current_setting('test.list_p1')::uuid);
  assert (r ->> 'repeated')::boolean = false and r ->> 'trip_id' <> current_setting('test.trip_3'), 'after 30 minutes: a new trip (the fourth)';
  r := public.announce_market_trip(current_setting('test.list_p2')::uuid);
  assert (r ->> 'repeated')::boolean = false and r ->> 'trip_id' <> current_setting('test.trip_2'), 'and the fifth';
  assert (select count(*) from public.market_trips where user_id = auth.uid()) = 5, 'five trips in the day';
  begin
    perform 1 from public.market_trip_log;
    raise exception 'FAIL: a member read the log of announcements';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  -- O limite conta deste registro: uma linha por ida nova (o aviso repetido e os recusados não entram).
  assert (select count(*) from public.market_trip_log
    where user_id = '00000000-0000-0000-0000-000000000031' and household_id = current_setting('test.hh_p')::uuid) = 5
    and (select count(*) from public.market_trip_log) = 5, 'one log row per new trip, with its person and household';
end $$;
update public.market_trips set created_at = created_at - interval '31 minutes';
select count(*) as queued_before from public.push_schedule where data ? 'server' \gset
select set_config('test.queued_before', :'queued_before', false) \gset
set role authenticated;
do $$
declare
  r jsonb;
begin
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_p'))::text, true);
  begin
    perform public.announce_market_trip(current_setting('test.list_p1')::uuid);
    raise exception 'FAIL: a sixth trip in 24 hours';
  exception when sqlstate 'NK005' then null;
  end;
  assert (select count(*) from public.market_trips where user_id = auth.uid()) = 5, 'the refused one left no trip';

  -- O limite é por casa: na casa T, Paula ainda avisa, e só quem mora lá recebe.
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_t'))::text, true);
  begin
    perform public.announce_market_trip(current_setting('test.list_p1')::uuid);
    raise exception 'FAIL: announced a list of the household that is not open';
  exception when no_data_found then null;
  end;
  r := public.announce_market_trip(current_setting('test.list_t1')::uuid);
  assert (r ->> 'members')::int = 1 and (r ->> 'notified')::int = 1, 'in the other household: its one other member';
  perform set_config('test.trip_t', r ->> 'trip_id', false);
end $$;
reset role;
do $$
begin
  assert (
    select array_agg(s.endpoint) from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where p.data ->> 'reminder' = 'ida:' || current_setting('test.trip_t')
  ) = array['https://fcm.googleapis.com/fcm/send/ida-t1'], 'only the member of the household the announcer is in';
  assert (select title from public.push_schedule where data ->> 'reminder' = 'ida:' || current_setting('test.trip_t'))
    = 'Paula está indo ao mercado', 'with the name she has in that household';
  assert (select count(*) from public.push_schedule where data ? 'server') = current_setting('test.queued_before')::int + 1,
    'the refused announcement queued nothing';
  assert (select count(*) from public.market_trip_log) = 6, 'nor a log row: five in one household, one in the other';
  -- O primeiro aviso faz mais de 24 horas: volta a caber um.
  update public.market_trip_log set created_at = now() - interval '25 hours'
    where id = (
      select g.id from public.market_trip_log g
      where g.household_id = current_setting('test.hh_p')::uuid
      order by g.created_at
      limit 1
    );
end $$;
set role authenticated;
do $$
declare
  r jsonb;
begin
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_p'))::text, true);
  r := public.announce_market_trip(current_setting('test.list_p1')::uuid);
  assert (r ->> 'repeated')::boolean = false, 'an announcement older than 24 hours no longer counts';
  perform set_config('test.trip_p6', r ->> 'trip_id', false);
end $$;
reset role;
do $$
begin
  assert not exists (select 1 from public.market_trip_log where created_at <= now() - interval '24 hours'),
    'and it left the log in that same call';
  assert (select count(*) from public.market_trip_log where household_id = current_setting('test.hh_p')::uuid) = 5
    and (select count(*) from public.market_trip_log where household_id = current_setting('test.hh_t')::uuid) = 1,
    'the day is full again in this household; the other one keeps its own count';
end $$;
set role authenticated;

-- Téo avisa na casa T: Paula mora em duas casas, então o aviso dela diz de qual é.
select set_config('request.jwt.claim.sub', :'user_t', false) \gset
do $$
declare
  r jsonb;
begin
  r := public.announce_market_trip(current_setting('test.list_t1')::uuid);
  assert (r ->> 'members')::int = 1 and (r ->> 'notified')::int = 1, 'Téo tells the household he shares with Paula';
  perform set_config('test.trip_t2', r ->> 'trip_id', false);
end $$;
reset role;
do $$
begin
  assert (
    select array_agg(s.endpoint || ' > ' || p.title)
    from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where p.data ->> 'reminder' = 'ida:' || current_setting('test.trip_t2')
  ) = array['https://fcm.googleapis.com/fcm/send/ida-p1 > Téo está indo ao mercado · Casa T'],
    'who lives in more than one household reads which one it is';
end $$;
set role authenticated;

-- Quem saiu da casa não avisa nela; sozinha numa casa, não há quem avisar (nem ida).
select set_config('request.jwt.claim.sub', :'user_u', false) \gset
do $$
declare
  r jsonb;
  list uuid;
begin
  begin
    perform public.announce_market_trip(current_setting('test.list_p1')::uuid);
    raise exception 'FAIL: announced without a household';
  exception when insufficient_privilege then
    assert sqlerrm = 'sem casa', 'the same error the other functions give without a household';
  end;
  perform public.create_household('Casa U', 'Ugo');
  insert into public.shopping_lists (name) values ('Mercado') returning id into list;
  r := public.announce_market_trip(list);
  assert r ->> 'trip_id' is null and (r ->> 'members')::int = 0 and (r ->> 'notified')::int = 0, 'nobody to tell';
  assert not exists (select 1 from public.market_trips), 'and no trip';
end $$;

-- A lista apagada leva as idas dela.
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
do $$
begin
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_p'))::text, true);
  delete from public.shopping_lists where id = current_setting('test.list_p2')::uuid;
  assert not exists (select 1 from public.market_trips where id = current_setting('test.trip_2')::uuid), 'the trips go with the list';
  assert exists (select 1 from public.market_trips where id = current_setting('test.trip_3')::uuid), 'the other list keeps its own';
end $$;

-- ...mas não leva a conta do dia. Quim avisa cinco listas e apaga cada uma em seguida: o sexto aviso não passa.
select set_config('request.jwt.claim.sub', :'user_q', false) \gset
do $$
declare
  list uuid;
  r jsonb;
begin
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_p'))::text, true);
  for n in 1..5 loop
    insert into public.shopping_lists (name) values ('Lista ' || n) returning id into list;
    r := public.announce_market_trip(list);
    assert (r ->> 'repeated')::boolean = false and r ->> 'trip_id' is not null, 'each new list is a new trip';
    delete from public.shopping_lists where id = list;
  end loop;
  assert not exists (select 1 from public.market_trips where user_id = auth.uid()), 'his trips went with their lists';
  insert into public.shopping_lists (name) values ('Lista 6') returning id into list;
  perform set_config('test.list_q6', list::text, false);
  begin
    perform public.announce_market_trip(list);
    raise exception 'FAIL: deleting the lists gave the announcements of the day back';
  exception when sqlstate 'NK005' then null;
  end;
end $$;

-- O limite é de cada pessoa: Rita avisa. O nome dela e o da lista dela não têm nada que se veja.
select set_config('request.jwt.claim.sub', :'user_r', false) \gset
do $$
declare
  list uuid;
  r jsonb;
begin
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_p'))::text, true);
  update public.household_members set display_name = E'\u200B\u00A0\u3164' where user_id = auth.uid();
  insert into public.shopping_lists (name, kind) values (E'\u2060\uFEFF', 'mercado') returning id into list;
  r := public.announce_market_trip(list);
  assert (r ->> 'repeated')::boolean = false and (r ->> 'members')::int = 3 and (r ->> 'notified')::int = 2,
    'another person of the household is not held by his limit';
  perform set_config('test.trip_r', r ->> 'trip_id', false);
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where p.data ->> 'reminder' = 'ida:' || current_setting('test.trip_r') and s.endpoint like '%/ida-q_'
      and p.title = 'Alguém da casa está indo ao mercado' and p.body = 'Falta alguma coisa? Ponha na lista agora.') = 2,
    'nothing to see in the name: "Alguém da casa", and the list goes without its name';
  assert (select display_name from public.market_trips where id = current_setting('test.trip_r')::uuid) = 'Alguém da casa',
    'and the banner says the same';
end $$;
set role authenticated;

-- E de cada casa: Quim entra na casa T e avisa lá.
select set_config('request.jwt.claim.sub', :'user_q', false) \gset
select public.join_household(:'invite_t', 'Quim') \gset
do $$
declare
  r jsonb;
begin
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_t'))::text, true);
  r := public.announce_market_trip(current_setting('test.list_t1')::uuid);
  assert (r ->> 'repeated')::boolean = false and (r ->> 'members')::int = 2 and (r ->> 'notified')::int = 2,
    'in another household he still announces';
  perform set_config('test.trip_qt', r ->> 'trip_id', false);
end $$;

-- Um dia depois, os avisos de Quim na casa P saem do registro e ele volta a avisar lá.
reset role;
update public.market_trip_log set created_at = created_at - interval '24 hours'
  where user_id = :'user_q' and household_id = :'hh_p';
set role authenticated;
do $$
declare
  list uuid;
  r jsonb;
begin
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_p'))::text, true);
  r := public.announce_market_trip(current_setting('test.list_q6')::uuid);
  assert (r ->> 'repeated')::boolean = false, 'after 24 hours he announces again';
  perform set_config('test.trip_q6', r ->> 'trip_id', false);
  -- Outra lista, avisada e encerrada em seguida (para adiante: sair da casa não mexe na ida que já tinha acabado).
  insert into public.shopping_lists (name) values ('Lista 7') returning id into list;
  r := public.announce_market_trip(list);
  assert public.end_market_trip((r ->> 'trip_id')::uuid), 'he ends one of his trips himself';
  perform set_config('test.trip_q7', r ->> 'trip_id', false);
  perform set_config('test.q7_ended', (select ended_at::text from public.market_trips where id = (r ->> 'trip_id')::uuid), false);
end $$;
reset role;
do $$
declare
  hp uuid := current_setting('test.hh_p')::uuid;
  quim uuid := '00000000-0000-0000-0000-000000000032';
begin
  assert not exists (select 1 from public.market_trip_log where created_at <= now() - interval '24 hours'),
    'what is older than 24 hours left the log';
  assert (select count(*) from public.market_trip_log where user_id = quim and household_id = hp) = 2
    and (select count(*) from public.market_trip_log where user_id = quim and household_id <> hp) = 1
    and (select count(*) from public.market_trip_log where user_id <> quim and household_id = hp) = 6,
    'only his old rows left: his other household and the other people keep theirs';
end $$;

-- A inscrição de um navegador some no meio do aviso (a pessoa saiu da conta naquele instante). Este
-- gatilho, só do teste, apaga a do segundo navegador de Quim na hora em que a linha dele vai entrar.
create function public.test_subscription_vanishes()
returns trigger
language plpgsql
as $$
begin
  delete from public.push_subscriptions s where s.id = new.subscription_id and s.endpoint like '%/ida-q2';
  return new;
end;
$$;
create trigger a_test_subscription_vanishes
  before insert on public.push_schedule
  for each row execute function public.test_subscription_vanishes();
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_t', false) \gset
do $$
declare
  list uuid;
  r jsonb;
begin
  insert into public.shopping_lists (name) values ('Feira') returning id into list;
  r := public.announce_market_trip(list);
  assert (r ->> 'members')::int = 2 and (r ->> 'notified')::int = 2,
    'the browser that vanished does not stop the announcement: Paula and Quim (in his other browser) are told';
  perform set_config('test.trip_t3', r ->> 'trip_id', false);
end $$;
reset role;
drop trigger a_test_subscription_vanishes on public.push_schedule;
drop function public.test_subscription_vanishes();
do $$
begin
  assert (
    select array_agg(s.endpoint order by s.endpoint)
    from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where p.data ->> 'reminder' = 'ida:' || current_setting('test.trip_t3')
  ) = array['https://fcm.googleapis.com/fcm/send/ida-p1', 'https://fcm.googleapis.com/fcm/send/ida-q1'],
    'one row for each browser that was still there';

  -- Antes de Quim sair da casa P: o aviso de Rita espera nos dois navegadores dele, e o dele, no de Paula.
  assert (select count(*) from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where s.endpoint like '%/ida-q_' and p.data ->> 'reminder' = 'ida:' || current_setting('test.trip_r')) = 2,
    'the announcement of another member waits in his browsers';
  assert exists (select 1 from public.push_schedule where data ->> 'reminder' = 'ida:' || current_setting('test.trip_q6')),
    'and his own waits in the browser of another member';
end $$;

-- Mais uma ida de Quim na casa P, em outra lista, com o aviso dela na fila de Paula: ele sai com duas idas valendo ali.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_q', false) \gset
do $$
declare
  list uuid;
  r jsonb;
begin
  perform set_config('request.headers', json_build_object('x-household-id', current_setting('test.hh_p'))::text, true);
  insert into public.shopping_lists (name) values ('Lista 8') returning id into list;
  r := public.announce_market_trip(list);
  assert (r ->> 'notified')::int = 1, 'Paula is told about his other trip';
  perform set_config('test.trip_q8', r ->> 'trip_id', false);
end $$;
reset role;

-- Quem encerra várias idas trava todas antes de tirar da fila o primeiro aviso (sair da casa, arquivar a
-- lista). Com uma ida e os avisos dela de cada vez, a saída de um morador e o arquivamento de uma lista
-- podiam esperar um pelo outro: um segurava o aviso que o outro ia tirar e esperava a ida que o outro já
-- tinha travado, e o banco derrubava um dos dois. Este gatilho, só do teste, confere a ordem: quando sai
-- da fila o aviso de uma ida já encerrada, nenhuma ida do mesmo grupo (a mesma pessoa na mesma casa, ou a
-- mesma lista) ainda vale.
create function public.test_trips_before_notices()
returns trigger
language plpgsql
as $$
declare
  trip public.market_trips;
begin
  select * into trip from public.market_trips t where old.data ? 'server' and 'ida:' || t.id::text = old.data ->> 'reminder';
  if trip.ended_at is not null and exists (
    select 1 from public.market_trips t
    where t.household_id = trip.household_id and t.ended_at is null
      and case current_setting('test.trips_first') when 'list' then t.list_id = trip.list_id else t.user_id = trip.user_id end
  ) then
    raise exception 'FAIL: a trip notice left the queue while another trip of the same % was still on', current_setting('test.trips_first');
  end if;
  return old;
end;
$$;
create trigger a_test_trips_before_notices
  before delete on public.push_schedule
  for each row execute function public.test_trips_before_notices();
select set_config('test.trips_first', 'person', false) \gset

-- Quim sai da casa P. As idas dele ali acabam para todos, com os avisos delas que não saíram, e os avisos
-- da casa P deixam a fila dos navegadores dele. Na casa T, onde ele continua, nada muda.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_q', false) \gset
do $$
begin
  -- Um lembrete da casa P que o app dele agendou: desse o gatilho não cuida (o app refaz a própria agenda).
  insert into public.push_schedule (id, subscription_id, title, repeat, hour, minute, data)
  values (
    gen_random_uuid(), (select id from public.push_subscriptions where endpoint like '%/ida-q1'), 'Contas a pagar', 'daily', 8, 0,
    jsonb_build_object('reminder', 'bills', 'householdId', current_setting('test.hh_p'))
  );
  assert public.leave_household(current_setting('test.hh_p')::uuid) ->> 'status' = 'left', 'Quim leaves the household';
end $$;
reset role;
drop trigger a_test_trips_before_notices on public.push_schedule;
do $$
declare
  hp text := current_setting('test.hh_p');
  quim uuid := '00000000-0000-0000-0000-000000000032';
begin
  assert (select ended_at from public.market_trips where id = current_setting('test.trip_q6')::uuid) is not null,
    'the trip of who left is over for everyone';
  assert not exists (select 1 from public.push_schedule where data ->> 'reminder' = 'ida:' || current_setting('test.trip_q6')),
    'with its notices that had not gone out';
  assert (select ended_at from public.market_trips where id = current_setting('test.trip_q8')::uuid) is not null
    and not exists (select 1 from public.push_schedule where data ->> 'reminder' = 'ida:' || current_setting('test.trip_q8')),
    'and so is his trip of the other list, with its notice';
  assert (select ended_at::text from public.market_trips where id = current_setting('test.trip_q7')::uuid) = current_setting('test.q7_ended'),
    'the trip he had already ended keeps the time it ended';
  -- A ida de Paula na lista de mercado é a do último aviso dela ali (cada aviso novo encerrou o anterior).
  assert (select ended_at from public.market_trips where id = current_setting('test.trip_r')::uuid) is null
    and (select ended_at from public.market_trips where id = current_setting('test.trip_p6')::uuid) is null,
    'the trips of the others are not touched';
  assert not exists (
    select 1 from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where s.user_id = quim and p.data ? 'server' and p.data ->> 'householdId' = hp
  ), 'the notices of that household left his browsers';
  assert exists (
    select 1 from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where s.user_id = quim and p.title = 'Contas a pagar' and p.data ->> 'householdId' = hp
  ), 'the reminder his own app scheduled is left to the app, as before';
  assert exists (
    select 1 from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where s.endpoint like '%/ida-p1' and p.data ->> 'reminder' = 'ida:' || current_setting('test.trip_r')
  ), 'who stays keeps hers';
  -- Na casa T, onde ele continua.
  assert (select ended_at from public.market_trips where id = current_setting('test.trip_qt')::uuid) is null,
    'in the household he is still in, his trip goes on';
  assert (select count(*) from public.push_schedule where data ->> 'reminder' = 'ida:' || current_setting('test.trip_qt')) = 2,
    'with its notices';
  assert (
    select array_agg(p.data ->> 'reminder')
    from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where s.user_id = quim and p.data ? 'server'
  ) = array['ida:' || current_setting('test.trip_t3')], 'and what that household queued for him is still there';
end $$;

-- Tirada da casa pela dona, a ida de Rita acaba do mesmo jeito.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_p', false) \gset
do $$
declare
  hp uuid := current_setting('test.hh_p')::uuid;
begin
  perform set_config('request.headers', json_build_object('x-household-id', hp)::text, true);
  assert exists (select 1 from public.push_schedule where data ->> 'reminder' = 'ida:' || current_setting('test.trip_r')), 'before: her notice waits in the owner browser';
  perform public.remove_member(hp, '00000000-0000-0000-0000-000000000033');
  assert (select ended_at from public.market_trips where id = current_setting('test.trip_r')::uuid) is not null,
    'removed by the owner: her trip is over too';
  assert not exists (select 1 from public.push_schedule where data ->> 'reminder' = 'ida:' || current_setting('test.trip_r')),
    'and its notice left the queue';
end $$;

-- Apagar a casa inteira, com idas valendo, passa pelo mesmo gatilho e leva as idas e o registro dela.
reset role;
delete from public.households where id = :'hh_t';
do $$
begin
  assert not exists (select 1 from public.market_trips where id = current_setting('test.trip_qt')::uuid), 'the trips go with the household';
  assert (select count(distinct household_id) from public.market_trip_log) = 1, 'and so does its log';
end $$;
delete from public.push_subscriptions where endpoint like '%/ida-%';
do $$
begin
  assert not exists (select 1 from public.push_schedule where data ? 'server'), 'the queued notices go with the browsers';
end $$;

-- Avisar de novo a mesma lista depois dos 30 minutos, com a ida ainda valendo, encerra a ida anterior
-- da pessoa: sem isso, "Encerrar" acabaria só com a nova e a antiga voltaria à faixa até as 2 horas.
-- Casa V: Vera avisa, Vito também mora nela; cada um recebe no seu navegador.
\set user_v '00000000-0000-0000-0000-000000000037'
\set user_w '00000000-0000-0000-0000-000000000038'
insert into auth.users (id) values (:'user_v'), (:'user_w');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_v', false) \gset
select (public.create_household('Casa V', 'Vera')).id as hh_v \gset
select invite_code as invite_v from public.households where id = :'hh_v' \gset
insert into public.shopping_lists (name, kind) values ('Mercado', 'mercado') returning id as list_v1 \gset
insert into public.shopping_lists (name, kind) values ('Farmácia', 'farmacia') returning id as list_v2 \gset
select set_config('test.list_v1', :'list_v1', false) \gset
select set_config('test.list_v2', :'list_v2', false) \gset
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-v1', 'k', 'a', 'UTC') \gset
select set_config('request.jwt.claim.sub', :'user_w', false) \gset
select public.join_household(:'invite_v', 'Vito') \gset
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-w1', 'k', 'a', 'UTC') \gset
do $$
declare
  r jsonb;
begin
  -- A ida de outra pessoa, na mesma lista.
  r := public.announce_market_trip(current_setting('test.list_v1')::uuid);
  perform set_config('test.trip_w', r ->> 'trip_id', false);
end $$;
select set_config('request.jwt.claim.sub', :'user_v', false) \gset
do $$
declare
  r jsonb;
begin
  -- A ida da mesma pessoa, em outra lista.
  r := public.announce_market_trip(current_setting('test.list_v2')::uuid);
  perform set_config('test.trip_v2', r ->> 'trip_id', false);
  r := public.announce_market_trip(current_setting('test.list_v1')::uuid);
  perform set_config('test.trip_v1a', r ->> 'trip_id', false);
end $$;
-- Quarenta minutos depois (o aviso dela ainda está na fila do navegador de Vito).
select current_setting('test.trip_v1a') as trip_v1a \gset
reset role;
update public.market_trips set created_at = created_at - interval '40 minutes' where id = :'trip_v1a';
set role authenticated;
do $$
declare
  list uuid := current_setting('test.list_v1')::uuid;
  old uuid := current_setting('test.trip_v1a')::uuid;
  r jsonb;
begin
  r := public.announce_market_trip(list);
  assert (r ->> 'repeated')::boolean = false and (r ->> 'notified')::int = 1 and (r ->> 'trip_id')::uuid <> old,
    'after 30 minutes, with the trip still on: a new trip, and the household is told again';
  perform set_config('test.trip_v1b', r ->> 'trip_id', false);
  assert (select ended_at from public.market_trips where id = old) is not null, 'the earlier trip of the same list is over';
  assert (
    select array_agg(t.id) from public.market_trips t
    where t.user_id = auth.uid() and t.list_id = list and t.ended_at is null
  ) = array[(r ->> 'trip_id')::uuid], 'only the new one is on for her and this list';
end $$;
reset role;
do $$
begin
  assert not exists (select 1 from public.push_schedule where data ->> 'reminder' = 'ida:' || current_setting('test.trip_v1a')),
    'the notice of the earlier trip left the queue';
  assert (
    select array_agg(s.endpoint) from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where p.data ->> 'reminder' = 'ida:' || current_setting('test.trip_v1b')
  ) = array['https://fcm.googleapis.com/fcm/send/ida-w1'], 'the new one is queued';
  assert (select ended_at from public.market_trips where id = current_setting('test.trip_w')::uuid) is null
    and exists (select 1 from public.push_schedule where data ->> 'reminder' = 'ida:' || current_setting('test.trip_w')),
    'the trip of another person on the same list is untouched, with its notice';
  assert (select ended_at from public.market_trips where id = current_setting('test.trip_v2')::uuid) is null
    and exists (select 1 from public.push_schedule where data ->> 'reminder' = 'ida:' || current_setting('test.trip_v2')),
    'and so is her trip of another list';
end $$;
set role authenticated;
do $$
declare
  list uuid := current_setting('test.list_v1')::uuid;
begin
  assert public.end_market_trip(current_setting('test.trip_v1b')::uuid), 'she ends the new trip';
  assert not exists (
    select 1 from public.market_trips t where t.user_id = auth.uid() and t.list_id = list and t.ended_at is null
  ), 'and none of hers on this list is left on: the earlier one does not come back';
  assert (select ended_at from public.market_trips where id = current_setting('test.trip_w')::uuid) is null,
    'the one of Vito goes on';
end $$;
reset role;
delete from public.households where id = :'hh_v';
delete from public.push_subscriptions where endpoint like '%/ida-%';

-- Arquivar a lista encerra as idas dela, com os avisos que ainda não saíram; apagá-la leva as idas e os
-- avisos delas. Sem isso, o aviso ia para os outros com o nome de uma lista fechada (ou que nem existe), e
-- quem avisou não tinha mais o "Encerrar" para tirá-lo da fila. Casa X: Xênia avisa (Yuri também); Yuri e Zeca recebem.
\set user_x '00000000-0000-0000-0000-000000000039'
\set user_y '00000000-0000-0000-0000-00000000003a'
\set user_z '00000000-0000-0000-0000-00000000003b'
insert into auth.users (id) values (:'user_x'), (:'user_y'), (:'user_z');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_x', false) \gset
select (public.create_household('Casa X', 'Xênia')).id as hh_x \gset
select invite_code as invite_x from public.households where id = :'hh_x' \gset
insert into public.shopping_lists (name, kind) values ('Mercado', 'mercado') returning id as list_x1 \gset
insert into public.shopping_lists (name, kind) values ('Feira', 'mercado') returning id as list_x2 \gset
insert into public.shopping_lists (name, kind) values ('Farmácia', 'farmacia') returning id as list_x3 \gset
select set_config('test.list_x1', :'list_x1', false) \gset
select set_config('test.list_x2', :'list_x2', false) \gset
select set_config('test.list_x3', :'list_x3', false) \gset
select set_config('request.jwt.claim.sub', :'user_y', false) \gset
select public.join_household(:'invite_x', 'Yuri') \gset
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-y1', 'k', 'a', 'UTC') \gset
select set_config('request.jwt.claim.sub', :'user_z', false) \gset
select public.join_household(:'invite_x', 'Zeca') \gset
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-z1', 'k', 'a', 'UTC') \gset
select set_config('request.jwt.claim.sub', :'user_x', false) \gset
do $$
declare
  r jsonb;
begin
  r := public.announce_market_trip(current_setting('test.list_x1')::uuid);
  assert (r ->> 'notified')::int = 2, 'Yuri and Zeca are told';
  perform set_config('test.trip_x1', r ->> 'trip_id', false);
  r := public.announce_market_trip(current_setting('test.list_x2')::uuid);
  assert (r ->> 'notified')::int = 2, 'and told of the other list too';
  perform set_config('test.trip_x2', r ->> 'trip_id', false);
end $$;
-- Yuri também avisa o "Mercado" (Xênia não tem navegador inscrito: só Zeca recebe). A lista fica com duas idas valendo.
select set_config('request.jwt.claim.sub', :'user_y', false) \gset
do $$
declare
  r jsonb;
begin
  r := public.announce_market_trip(current_setting('test.list_x1')::uuid);
  assert (r ->> 'notified')::int = 1, 'Zeca is told of the trip of Yuri';
  perform set_config('test.trip_y1', r ->> 'trip_id', false);
end $$;
-- Arquivar a lista também encerra as duas antes de tirar o primeiro aviso da fila (o gatilho de teste confere).
reset role;
create trigger a_test_trips_before_notices
  before delete on public.push_schedule
  for each row execute function public.test_trips_before_notices();
select set_config('test.trips_first', 'list', false) \gset
set role authenticated;
-- Yuri arquiva o "Mercado" logo depois (a compra já foi feita, ou era a lista errada), antes de os avisos saírem.
do $$
begin
  update public.shopping_lists set archived_at = now() where id = current_setting('test.list_x1')::uuid;
  assert (select ended_at from public.market_trips where id = current_setting('test.trip_x1')::uuid) is not null,
    'archiving the list ends its trip, for everyone';
  assert (select ended_at from public.market_trips where id = current_setting('test.trip_y1')::uuid) is not null,
    'and the trip of anyone else on that list';
  -- Renomear outra lista, ou arquivar uma que não tem ida, não mexe em nada.
  update public.shopping_lists set name = 'Feira de sábado' where id = current_setting('test.list_x2')::uuid;
  update public.shopping_lists set archived_at = now() where id = current_setting('test.list_x3')::uuid;
  assert (select ended_at from public.market_trips where id = current_setting('test.trip_x2')::uuid) is null,
    'renaming a list, or archiving another one, leaves the trip on';
end $$;
reset role;
drop trigger a_test_trips_before_notices on public.push_schedule;
drop function public.test_trips_before_notices();
set role authenticated;
-- Desarquivar a lista não traz a ida de volta (nem mexe em outra).
do $$
begin
  update public.shopping_lists set archived_at = null where id = current_setting('test.list_x1')::uuid;
  assert (select ended_at from public.market_trips where id = current_setting('test.trip_x1')::uuid) is not null,
    'unarchiving does not bring the trip back';
  assert (select ended_at from public.market_trips where id = current_setting('test.trip_x2')::uuid) is null, 'nor touches another one';
end $$;
reset role;
do $$
begin
  assert not exists (
    select 1 from public.push_schedule
    where data ->> 'reminder' in ('ida:' || current_setting('test.trip_x1'), 'ida:' || current_setting('test.trip_y1'))
  ), 'the notices of the archived list that had not gone out left the queue';
  assert (select count(*) from public.push_schedule where data ->> 'reminder' = 'ida:' || current_setting('test.trip_x2')) = 2,
    'the notices of the other list are still queued';
end $$;
-- Xênia apaga a "Feira": a ida vai com a lista (o FK), e os avisos dela também.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_x', false) \gset
do $$
begin
  delete from public.shopping_lists where id = current_setting('test.list_x2')::uuid;
  assert not exists (select 1 from public.market_trips where id = current_setting('test.trip_x2')::uuid), 'the trip went with the list';
end $$;
reset role;
do $$
begin
  assert not exists (select 1 from public.push_schedule where data ->> 'reminder' = 'ida:' || current_setting('test.trip_x2')),
    'and its notices did not stay in the queue without a trip';
  assert not exists (
    select 1 from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where s.endpoint like '%/ida-%' and p.data ? 'server'
  ), 'nothing of Casa X is left in the queue';
end $$;

-- A inscrição nova de um navegador que desligou "Alguém indo ao mercado" nasce desligada, no mesmo pedido
-- (o quinto argumento de register_push_subscription): sem um segundo pedido, que podia se perder e deixar
-- a inscrição nova ligada. A linha que já existe fica como está, e a chamada de quatro argumentos (a dos
-- apps já instalados) continua a mesma.
do $$
declare
  fn regprocedure := 'public.register_push_subscription(text, text, text, text, boolean)'::regprocedure;
begin
  -- Sem valor padrão: com ele, a chamada do PostgREST com os quatro nomes ficaria ambígua.
  assert (select pronargdefaults from pg_proc where oid = fn) = 0, 'no default on p_market_trips';
  assert (select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = fn),
    'security definer with an empty search_path, as the four-argument one';
  assert not has_function_privilege('anon', fn, 'execute') and has_function_privilege('authenticated', fn, 'execute'),
    'for a signed-in person only';
end $$;
set role anon;
do $$
begin
  perform public.register_push_subscription('https://fcm.googleapis.com/fcm/send/x', 'k', 'a', 'UTC', false);
  raise exception 'FAIL: anon registered a browser';
exception when insufficient_privilege then null;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '', false) \gset
do $$
begin
  perform public.register_push_subscription('https://fcm.googleapis.com/fcm/send/x', 'k', 'a', 'UTC', false);
  raise exception 'FAIL: registered without a user';
exception when insufficient_privilege then null;
end $$;
-- Zeca tem um navegador ligado que depois passa para a conta de Yuri (outra pessoa entrou no mesmo navegador).
select set_config('request.jwt.claim.sub', :'user_z', false) \gset
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-z2', 'k', 'a', 'UTC') \gset
select set_config('request.jwt.claim.sub', :'user_y', false) \gset
do $$
declare
  y1 uuid := (select id from public.push_subscriptions where endpoint like '%/ida-y1');
  y2 uuid;
  y3 uuid;
  y4 uuid;
  z2 uuid;
begin
  begin
    perform public.register_push_subscription('https://evil.example/fcm/send/x', 'k', 'a', 'UTC', false);
    raise exception 'FAIL: registered an endpoint outside the push services';
  exception when invalid_parameter_value then null;
  end;
  -- Yuri tinha desligado a opção, e a inscrição dele foi trocada (send-push apaga a que o serviço de push
  -- recusa; sair e entrar na conta também): a nova nasce desligada.
  y2 := public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-y2', 'k', 'a', 'UTC', false);
  assert not (select market_trips from public.push_subscriptions where id = y2), 'a new subscription asked off is born off';
  -- A linha que já existe fica como está: o valor do navegador pode ser velho, e a escolha guardada, mais nova.
  assert public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-y2', 'k2', 'a', 'UTC', true) = y2,
    'same browser, same subscription';
  assert not (select market_trips from public.push_subscriptions where id = y2), 'an existing row off is not switched on';
  assert (select p256dh from public.push_subscriptions where id = y2) = 'k2', 'the keys are still updated';
  assert public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-y1', 'k', 'a', 'UTC', false) = y1
    and (select market_trips from public.push_subscriptions where id = y1), 'an existing row on is not switched off';
  -- Pedindo ligado, nasce ligada.
  y3 := public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-y3', 'k', 'a', 'UTC', true);
  assert (select market_trips from public.push_subscriptions where id = y3), 'a new subscription asked on is born on';
  -- A chamada de quatro argumentos é a de sempre: a nova nasce ligada, a que existe fica como está.
  y4 := public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-y4', 'k', 'a', 'UTC');
  assert (select market_trips from public.push_subscriptions where id = y4), 'four arguments: a new one is born on';
  assert public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-y2', 'k', 'a', 'UTC') = y2
    and not (select market_trips from public.push_subscriptions where id = y2), 'four arguments: an existing row stays as it is';
  -- O navegador que era de Zeca: a inscrição dele sai, e a de Yuri é nova, então nasce com a escolha.
  z2 := public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ida-z2', 'k', 'a', 'UTC', false);
  assert (select user_id from public.push_subscriptions where id = z2) = auth.uid()
    and not (select market_trips from public.push_subscriptions where id = z2), 'a browser taken over from another account is new: born off';
end $$;
-- Xênia avisa: os navegadores que nasceram desligados ficam de fora.
select set_config('request.jwt.claim.sub', :'user_x', false) \gset
do $$
declare
  r jsonb;
begin
  r := public.announce_market_trip(current_setting('test.list_x1')::uuid);
  assert (r ->> 'repeated')::boolean = false and (r ->> 'members')::int = 2 and (r ->> 'notified')::int = 2, 'a new trip, both told';
  perform set_config('test.trip_x3', r ->> 'trip_id', false);
end $$;
reset role;
do $$
begin
  assert (
    select array_agg(s.endpoint order by s.endpoint)
    from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where p.data ->> 'reminder' = 'ida:' || current_setting('test.trip_x3')
  ) = array[
    'https://fcm.googleapis.com/fcm/send/ida-y1', 'https://fcm.googleapis.com/fcm/send/ida-y3',
    'https://fcm.googleapis.com/fcm/send/ida-y4', 'https://fcm.googleapis.com/fcm/send/ida-z1'
  ], 'the browsers born off got nothing';
end $$;
-- Com só os navegadores que nasceram desligados, Yuri não conta entre os avisados (meia hora depois, outro aviso).
delete from public.push_subscriptions
  where endpoint in ('https://fcm.googleapis.com/fcm/send/ida-y1', 'https://fcm.googleapis.com/fcm/send/ida-y3', 'https://fcm.googleapis.com/fcm/send/ida-y4');
update public.market_trips set created_at = created_at - interval '31 minutes' where household_id = :'hh_x';
set role authenticated;
do $$
declare
  r jsonb;
begin
  r := public.announce_market_trip(current_setting('test.list_x1')::uuid);
  assert (r ->> 'repeated')::boolean = false and (r ->> 'members')::int = 2 and (r ->> 'notified')::int = 1,
    'only Zeca: Yuri has only browsers born off';
end $$;
reset role;
delete from public.households where id = :'hh_x';
delete from public.push_subscriptions where endpoint like '%/ida-%';

-- A opção em quem já estava inscrito quando a migração chega: o navegador sem nada agendado (a pessoa
-- desligou todos os avisos) começa com ela desligada; o que tem aviso agendado, ligada. Para valer a
-- conta da própria migração, ela é aplicada de novo aqui, sobre o banco de antes dela e com dados, e
-- tudo é desfeito no fim.
begin;
drop trigger household_members_end_market_trips on public.household_members;
drop trigger shopping_lists_end_market_trips on public.shopping_lists;
drop trigger market_trips_gone on public.market_trips;
drop function public.member_left_market_trips(), public.announce_market_trip(uuid), public.end_market_trip(uuid),
  public.set_push_market_trips(text, boolean), public.push_text(text, int), public.max_market_trips(),
  public.list_archived_market_trips(), public.market_trip_gone(),
  public.register_push_subscription(text, text, text, text, boolean);
drop index public.push_schedule_server_reminder_idx;
drop table public.market_trips, public.market_trip_log;
alter table public.push_subscriptions drop column market_trips;
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  (:'user_p', 'https://fcm.googleapis.com/fcm/send/antes-com-aviso', 'k', 'a'),
  (:'user_p', 'https://fcm.googleapis.com/fcm/send/antes-sem-aviso', 'k', 'a');
insert into public.push_schedule (id, subscription_id, title, repeat, hour, minute)
select gen_random_uuid(), s.id, 'Contas a pagar', 'daily', 8, 0
from public.push_subscriptions s where s.endpoint like '%/antes-com-aviso';
-- O banco de testes dá tudo a todos nas tabelas novas (stubs.sql), como a Supabase fazia até 30/10/2026: sem
-- isso (desfeito no rollback), as permissões das tabelas recriadas são só as que a migração escreve, e a falta
-- de um grant aparece aqui.
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
\ir ../../supabase/migrations/20261012220000_market_trips.sql
do $$
declare
  t text;
  p text;
begin
  foreach p in array array['select', 'insert', 'update', 'delete'] loop
    foreach t in array array['public.market_trips', 'public.market_trip_log'] loop
      assert not has_table_privilege('anon', t, p), format('written by the migration: anon has no %s on %s', p, t);
      assert has_table_privilege('service_role', t, p), format('written by the migration: service_role has %s on %s', p, t);
    end loop;
    assert not has_table_privilege('authenticated', 'public.market_trip_log', p), format('written by the migration: authenticated has no %s on the log', p);
    assert has_table_privilege('authenticated', 'public.market_trips', p) = (p = 'select'),
      format('written by the migration: authenticated only reads market_trips (%s)', p);
  end loop;
  assert (select market_trips from public.push_subscriptions where endpoint like '%/antes-com-aviso'),
    'a browser with a notice scheduled starts with the option on';
  assert not (select market_trips from public.push_subscriptions where endpoint like '%/antes-sem-aviso'),
    'a browser with every notice off does not start receiving this one';
  assert (select count(*) from public.push_schedule p join public.push_subscriptions s on s.id = p.subscription_id
    where s.endpoint like '%/antes-%') = 1, 'and the schedule is as it was';
end $$;
rollback;

-- ---------------------------------------------------------------------------
\echo '• "Acabou" na despensa: add_to_list só põe o item numa lista aberta da casa, uma vez'
-- Casa D (Dora) e Casa E (Edu), cada uma com as suas listas.
\set user_dl '00000000-0000-0000-0000-0000000000d1'
\set user_el '00000000-0000-0000-0000-0000000000d2'
insert into auth.users (id) values (:'user_dl'), (:'user_el');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_el', false) \gset
select (public.create_household('Casa E', 'Edu')).id as hh_el \gset
insert into public.shopping_lists (name, kind) values ('Do Edu', 'mercado') returning id as list_el \gset
select set_config('test.list_el', :'list_el', false) \gset
select set_config('request.jwt.claim.sub', :'user_dl', false) \gset
select (public.create_household('Casa D', 'Dora')).id as hh_dl \gset
insert into public.shopping_lists (name, kind) values ('Feira', 'mercado') returning id as list_dl \gset
insert into public.shopping_lists (name, kind, archived_at) values ('Antiga', 'mercado', now()) returning id as list_dl_old \gset
select set_config('test.list_dl', :'list_dl', false) \gset
select set_config('test.list_dl_old', :'list_dl_old', false) \gset
do $$
declare
  feira uuid := current_setting('test.list_dl')::uuid;
  first record;
  again record;
begin
  select * into first from public.add_to_list(feira, '  Arroz ', 'mercearia', null, 2, 'un');
  assert first.added and first.list_id = feira and first.list_name = 'Feira', 'the item goes to the open list';
  assert (
    select i.name = 'Arroz' and i.category = 'mercearia' and i.quantity = 2 and i.unit = 'un' and i.checked_at is null
    from public.shopping_list_items i where i.id = first.item_id
  ), 'with its name trimmed, category and quantity';
  select * into again from public.add_to_list(feira, 'ARROZ', 'mercearia');
  assert not again.added and again.item_id = first.item_id, 'pending with the same name: not added again';
  update public.shopping_list_items set checked_at = now() where id = first.item_id;
  select * into again from public.add_to_list(feira, 'Arroz', 'mercearia');
  assert again.added and again.item_id <> first.item_id, 'already in the cart: it goes in again';
  begin
    perform public.add_to_list(current_setting('test.list_dl_old')::uuid, 'Feijão', 'mercearia');
    raise exception 'FAIL: an item went into an archived list';
  exception when no_data_found then null;
  end;
  begin
    perform public.add_to_list(current_setting('test.list_el')::uuid, 'Feijão', 'mercearia');
    raise exception 'FAIL: an item went into another house''s list';
  exception when no_data_found then null;
  end;
  assert not exists (select 1 from public.shopping_list_items where name = 'Feijão'), 'and nothing was written';
end $$;
reset role;
-- Edu não viu nada da Casa D, e a lista dele ficou vazia.
select count(*) = 0 as el_empty from public.shopping_list_items where list_id = :'list_el' \gset
\if :el_empty
\else
  \echo 'FAIL: the other house''s list got an item'
  select 1/0;
\endif
do $$
begin
  assert not has_function_privilege('anon', 'public.add_to_list(uuid, text, text, uuid, numeric, text)', 'execute'), 'anon cannot execute add_to_list';
  assert has_function_privilege('authenticated', 'public.add_to_list(uuid, text, text, uuid, numeric, text)', 'execute'), 'members can execute add_to_list';
  assert not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.add_to_list(uuid, text, text, uuid, numeric, text)'::regprocedure and a.grantee = 0
  ), 'and public has no grant on add_to_list';
end $$;
delete from public.households where id in (:'hh_dl', :'hh_el');

-- ---------------------------------------------------------------------------
\echo '• nota confirmada corrigida: data, mercado e total ficam na casa, e a base comum não muda'
-- Caio confirma uma nota do QR code (que compartilha) e depois corrige a data, o mercado e o total, como o app
-- faz (uma coisa por vez, só na nota confirmada). Nina, de outra casa, não alcança a nota dele.
\set user_nc1 '00000000-0000-0000-0000-0000000001c1'
\set user_nc2 '00000000-0000-0000-0000-0000000001c2'
reset role;
insert into auth.users (id) values (:'user_nc1'), (:'user_nc2');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_nc2', false) \gset
select set_config('test.nc_house_2', (public.create_household('Casa da Nina', 'Nina')).id::text, false) \gset
select set_config('request.jwt.claim.sub', :'user_nc1', false) \gset
select set_config('test.nc_house_1', (public.create_household('Casa do Caio', 'Caio')).id::text, false) \gset
do $$
declare
  today constant date := (now() at time zone 'America/Sao_Paulo')::date;
  cnpj constant text := '44555666000177';
  s uuid;
  r uuid;
begin
  insert into public.stores (name, cnpj) values ('Mercadinho da esquina', cnpj) returning id into s;
  perform set_config('test.nc_store', s::text, false);
  -- O mercado certo, que a casa já tinha (sem CNPJ, criado à mão).
  insert into public.stores (name) values ('Feira de domingo') returning id into s;
  perform set_config('test.nc_store_right', s::text, false);
  insert into public.receipts (store_id, purchased_at, access_key, source, total)
    values (current_setting('test.nc_store')::uuid, (today - 2 + time '10:00') at time zone 'America/Sao_Paulo',
      '352610' || cnpj || repeat('0', 23) || '1', 'qrcode', 14.48)
    returning id into r;
  perform set_config('test.nc_receipt', r::text, false);
  insert into public.receipt_items (receipt_id, position, raw_description, suggested_category, quantity, unit, unit_price, total_price) values
    (r, 0, 'LEITE NC INTEGRAL 1L', 'laticinios', 1, 'un', 5.49, 5.49),
    (r, 1, 'PAO NC FRANCES', 'padaria', 1, 'kg', 8.99, 8.99);
end $$;

reset role;
set role service_role;
do $$
declare
  today constant date := (now() at time zone 'America/Sao_Paulo')::date;
  cnpj constant text := '44555666000177';
  rid uuid;
begin
  insert into public.receipt_reads (household_id, source, access_key, store_cnpj, store_name, purchased_on, lines)
    values (current_setting('test.nc_house_1')::uuid, 'qrcode', '352610' || cnpj || repeat('0', 23) || '1', cnpj, 'MERCADINHO DA ESQUINA LTDA', today - 2,
      jsonb_build_array(
        jsonb_build_object('description', 'LEITE NC INTEGRAL 1L', 'unit', 'un', 'unit_price', 5.49),
        jsonb_build_object('description', 'PAO NC FRANCES', 'unit', 'kg', 'unit_price', 8.99)))
    returning id into rid;
  perform set_config('test.nc_read', rid::text, false);
end $$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_nc1', false) \gset
do $$
begin
  update public.receipts set read_id = current_setting('test.nc_read')::uuid where id = current_setting('test.nc_receipt')::uuid;
  perform public.confirm_receipt(current_setting('test.nc_receipt')::uuid, '[]');
end $$;

-- A base comum depois da confirmação, como ficou: é com ela que o resto é comparado.
reset role;
select set_config('test.nc_shared', (
  select md5(coalesce(string_agg(sp::text, '|' order by sp.store_cnpj, sp.item_key, sp.unit, sp.seen_on), '')) from public.shared_prices sp
), false) \gset
do $$
declare
  today constant date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  assert (select array_agg(item_key || ' ' || unit_price || ' ' || seen_on || ' ' || store_name order by item_key)
            from public.shared_prices where item_key like '% NC %')
    = array[
      'LEITE NC INTEGRAL 1L 5.4900 ' || (today - 2) || ' MERCADINHO DA ESQUINA LTDA',
      'PAO NC FRANCES 8.9900 ' || (today - 2) || ' MERCADINHO DA ESQUINA LTDA'
    ],
    'the confirmation shared the two lines, as read';
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', :'user_nc1', false) \gset
do $$
declare
  today constant date := (now() at time zone 'America/Sao_Paulo')::date;
  r constant uuid := current_setting('test.nc_receipt')::uuid;
  n integer;
begin
  -- A data, o mercado e o total, um de cada vez e só na nota confirmada (o filtro do app): o banco aceita os três.
  update public.receipts set purchased_at = (today - 9 + time '12:00') at time zone 'America/Sao_Paulo' where id = r and status = 'confirmed';
  get diagnostics n = row_count;
  assert n = 1, 'the purchase date of a confirmed receipt can be corrected';
  update public.receipts set store_id = current_setting('test.nc_store_right')::uuid where id = r and status = 'confirmed';
  get diagnostics n = row_count;
  assert n = 1, 'and its store';
  update public.receipts set total = 20.00 where id = r and status = 'confirmed';
  get diagnostics n = row_count;
  assert n = 1, 'and its total';
  -- Também um mercado novo, criado na hora, e "sem total".
  insert into public.stores (name) values ('Hortifruti novo');
  update public.receipts set store_id = (select id from public.stores where name = 'Hortifruti novo'), total = null where id = r and status = 'confirmed';
  update public.receipts set store_id = current_setting('test.nc_store_right')::uuid, total = 20.00 where id = r and status = 'confirmed';
  -- Nem regravar o status de uma nota já confirmada passa pelo gatilho (ele só olha a passagem de rascunho para confirmada).
  update public.receipts set status = 'confirmed' where id = r;
  assert (select (purchased_at at time zone 'America/Sao_Paulo')::date = today - 9 and store_id = current_setting('test.nc_store_right')::uuid
                 and total = 20.00 and status = 'confirmed' and read_id is null
            from public.receipts where id = r),
    'the receipt keeps the corrections, still confirmed and without a read';
end $$;

-- Nina, de outra casa, não acha a nota do Caio para corrigir.
select set_config('request.jwt.claim.sub', :'user_nc2', false) \gset
do $$
declare
  n integer;
begin
  update public.receipts set purchased_at = now(), total = 1 where id = current_setting('test.nc_receipt')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'a member of another household cannot correct the receipt';
end $$;

reset role;
do $$
begin
  assert (
    select md5(coalesce(string_agg(sp::text, '|' order by sp.store_cnpj, sp.item_key, sp.unit, sp.seen_on), '')) from public.shared_prices sp
  ) = current_setting('test.nc_shared'),
    'correcting a confirmed receipt adds nothing to the shared prices and changes no line (day, store name, price)';
  assert (select (purchased_at at time zone 'America/Sao_Paulo')::date from public.receipts where id = current_setting('test.nc_receipt')::uuid)
    = (now() at time zone 'America/Sao_Paulo')::date - 9,
    'and the other household did not change it';
  assert (select count(*) from public.receipt_reads where household_id = current_setting('test.nc_house_1')::uuid) = 0,
    'there is no read left to share again';
end $$;
delete from public.households where id in (current_setting('test.nc_house_1')::uuid, current_setting('test.nc_house_2')::uuid);

-- ---------------------------------------------------------------------------
\echo '• Termos: cada pessoa grava e lê só o próprio aceite, uma vez por versão'
\set user_t1 '00000000-0000-0000-0000-0000000001b1'
\set user_t2 '00000000-0000-0000-0000-0000000001b2'
insert into auth.users (id) values (:'user_t1'), (:'user_t2');
set role anon;
do $$
begin
  perform public.accept_terms('2026-10-20');
  raise exception 'FAIL: anon accepted the terms';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform 1 from public.terms_acceptances;
  raise exception 'FAIL: anon read the acceptances';
exception when insufficient_privilege then null;
end $$;
set role authenticated;
-- Sem conta (sem o sub do token), a função não grava nada.
select set_config('request.jwt.claim.sub', '', false) \gset
do $$
begin
  perform public.accept_terms('2026-10-20');
  raise exception 'FAIL: accepted without an account';
exception when insufficient_privilege then null;
end $$;
select set_config('request.jwt.claim.sub', :'user_t1', false) \gset
do $$
declare
  first_at timestamptz;
begin
  assert (select count(*) from public.terms_acceptances) = 0, 'nothing accepted yet';
  perform public.accept_terms('2026-10-20');
  select accepted_at into first_at from public.terms_acceptances where version = '2026-10-20';
  assert first_at is not null, 'the acceptance is there, with the server time';
  -- Repetir não duplica nem muda a hora do primeiro aceite.
  perform public.accept_terms('2026-10-20');
  assert (select count(*) from public.terms_acceptances) = 1, 'accepting again does not add a row';
  assert (select accepted_at from public.terms_acceptances where version = '2026-10-20') = first_at, 'nor change its time';
  perform public.accept_terms('2026-10-19');
  assert (select array_agg(version order by version) from public.terms_acceptances) = array['2026-10-19', '2026-10-20'],
    'another version is another row';
  begin
    perform public.accept_terms('qualquer coisa');
    raise exception 'FAIL: a version that is not a date';
  exception when check_violation then null;
  end;
  -- Direto na tabela, nada: nem gravar, nem mudar a hora, nem apagar.
  begin
    insert into public.terms_acceptances (user_id, version) values (auth.uid(), '2026-01-01');
    raise exception 'FAIL: inserted an acceptance directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.terms_acceptances set accepted_at = now() - interval '1 year';
    raise exception 'FAIL: changed an acceptance';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.terms_acceptances;
    raise exception 'FAIL: deleted an acceptance';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', :'user_t2', false) \gset
do $$
begin
  assert (select count(*) from public.terms_acceptances) = 0, 'the other person sees none of the first one''s acceptances';
  perform public.accept_terms('2026-10-20');
  assert (select count(*) from public.terms_acceptances) = 1 and (select user_id from public.terms_acceptances) = auth.uid(),
    'and records only their own';
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.terms_acceptances where user_id = '00000000-0000-0000-0000-0000000001b1') = 2, 'first person: two versions';
  assert (select count(*) from public.terms_acceptances where user_id = '00000000-0000-0000-0000-0000000001b2') = 1, 'second person: one';
  assert not has_function_privilege('anon', 'public.accept_terms(text)', 'execute'), 'anon cannot execute accept_terms';
  assert has_function_privilege('authenticated', 'public.accept_terms(text)', 'execute'), 'people can execute accept_terms';
  assert not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.accept_terms(text)'::regprocedure and a.grantee = 0
  ), 'and public has no grant on accept_terms';
  assert (select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.accept_terms(text)'::regprocedure),
    'security definer with a fixed search_path';
end $$;
-- A conta apagada leva os aceites dela.
delete from auth.users where id = :'user_t1';
select count(*) = 1 as terms_cascade from public.terms_acceptances \gset
\if :terms_cascade
\else
  \echo 'FAIL: the deleted account''s acceptances stayed'
  select 1/0;
\endif
delete from auth.users where id = :'user_t2';

-- ---------------------------------------------------------------------------
\echo '• apagar a conta: sai de cada casa, a casa em que é a última some, os acertos ficam como ex-morador'
\set user_d1 '00000000-0000-0000-0000-0000000001d1'
\set user_d2 '00000000-0000-0000-0000-0000000001d2'
\set user_d3 '00000000-0000-0000-0000-0000000001d3'
insert into auth.users (id) values (:'user_d1'), (:'user_d2'), (:'user_d3');
set role authenticated;
-- Dani cria a casa que divide com Elo (e é a responsável) e outra só dela.
select set_config('request.jwt.claim.sub', :'user_d1', false) \gset
select (public.create_household('Casa Dividida', 'Dani')).id as hh_d_shared \gset
select (public.create_household('Casa da Dani', 'Dani')).id as hh_d_solo \gset
select invite_code as invite_d from public.households where id = :'hh_d_shared' \gset
select set_config('request.jwt.claim.sub', :'user_d2', false) \gset
select public.join_household(:'invite_d', 'Elo') \gset
-- Iuri (outra conta, outra casa): nada dele muda.
select set_config('request.jwt.claim.sub', :'user_d3', false) \gset
select (public.create_household('Casa do Iuri', 'Iuri')).id as hh_d_other \gset
insert into public.shopping_lists (name) values ('Do Iuri');
select set_config('test.hh_d_shared', :'hh_d_shared', false) \gset
select set_config('test.hh_d_solo', :'hh_d_solo', false) \gset
select set_config('test.hh_d_other', :'hh_d_other', false) \gset

select set_config('request.jwt.claim.sub', :'user_d1', false) \gset
select set_config('request.headers', json_build_object('x-household-id', :'hh_d_shared')::text, false) \gset
insert into public.shopping_lists (name) values ('Feira da Dani');
insert into public.expenses (description, amount, spent_on) values ('Gás', 120, '2026-10-05');
insert into public.settlements (month, from_user, to_user, amount) values ('2026-10', :'user_d1', :'user_d2', 30);
insert into public.settlements (month, from_user, to_user, amount) values ('2026-10', :'user_d2', :'user_d1', 10);
insert into storage.objects (bucket_id, name) values ('receipts', :'hh_d_shared' || '/nota-da-dani.jpg');
select set_config('request.headers', json_build_object('x-household-id', :'hh_d_solo')::text, false) \gset
insert into public.shopping_lists (name) values ('Só da Dani');
insert into storage.objects (bucket_id, name) values ('receipts', :'hh_d_solo' || '/nota-sozinha.jpg');
do $$
declare
  preview record;
begin
  -- O que o app mostra antes: a casa dividida passa adiante, a dela é apagada.
  assert (select count(*) from public.account_deletion_preview()) = 2, 'both households of Dani';
  select * into preview from public.account_deletion_preview() p where p.id = current_setting('test.hh_d_shared')::uuid;
  assert not preview.last and preview.role = 'owner' and not preview.finance, 'shared: Elo stays, Dani is the owner, no advisor';
  select * into preview from public.account_deletion_preview() p where p.id = current_setting('test.hh_d_solo')::uuid;
  assert preview.last, 'solo: Dani is the last one';
  begin
    perform public.delete_account_data(auth.uid(), '{}');
    raise exception 'FAIL: app user called delete_account_data';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.leave_household_as(auth.uid(), current_setting('test.hh_d_shared')::uuid, true);
    raise exception 'FAIL: app user called leave_household_as';
  exception when insufficient_privilege then null;
  end;
  perform public.register_push_subscription('https://fcm.googleapis.com/fcm/send/dani', 'k', 'a', 'UTC');
end $$;
select set_config('request.headers', '', false) \gset
reset role;
-- O consultor da Dani na casa dividida, e o que só ela tem.
insert into public.beta_access (user_id, household_id, feature) values (:'user_d1', :'hh_d_shared', 'finance');
insert into public.fin_connections (user_id, household_id, label, pluggy_item_id) values (:'user_d1', :'hh_d_shared', 'Banco', 'item-dani');
insert into public.household_sessions (session_id, user_id, household_id) values ('sessao-dani', :'user_d1', :'hh_d_shared');
insert into public.join_attempts (user_id, failed) values (:'user_d1', 2);
insert into public.push_schedule (id, subscription_id, title, repeat, hour, minute, next_at)
  select gen_random_uuid(), s.id, 'Remédio', 'daily', 8, 0, now() from public.push_subscriptions s where s.user_id = :'user_d1';
set role anon;
do $$
begin
  perform public.account_deletion_preview();
  raise exception 'FAIL: anon called account_deletion_preview';
exception when insufficient_privilege then null;
end $$;
set role service_role;
select set_config('request.jwt.claim.sub', '', false) \gset
do $$
declare
  dani uuid := '00000000-0000-0000-0000-0000000001d1';
  shared uuid := current_setting('test.hh_d_shared')::uuid;
  solo uuid := current_setting('test.hh_d_solo')::uuid;
  result jsonb;
begin
  assert has_function_privilege('service_role', 'public.delete_account_data(uuid, uuid[])', 'execute'), 'the secret key calls it';
  -- Sem o aviso de que a casa dela será apagada: nada muda. (Com a casa dividida na lista, a ordem das
  -- casas, pelo id, decidiria entre NK001 e NK011; o bloco da Jade cobre o NK011.)
  begin
    perform public.delete_account_data(dani, '{}');
    raise exception 'FAIL: deleted a household the app did not announce';
  exception when sqlstate 'NK001' then null;
  end;
  assert (select count(*) from public.household_members where user_id = dani) = 2, 'unconfirmed: Dani is still in both';
  assert exists (select 1 from public.households where id = solo), 'unconfirmed: her household stays';
  result := public.delete_account_data(dani, array[solo]);
  assert result -> 'deleted' = jsonb_build_array(solo), 'her household was deleted';
  assert result -> 'left' = jsonb_build_array(shared), 'she left the shared one';
end $$;
reset role;
-- Por fim, o Auth apaga o usuário: nada mais o segura.
delete from auth.users where id = :'user_d1';
do $$
declare
  dani uuid := '00000000-0000-0000-0000-0000000001d1';
  elo uuid := '00000000-0000-0000-0000-0000000001d2';
  shared uuid := current_setting('test.hh_d_shared')::uuid;
  solo uuid := current_setting('test.hh_d_solo')::uuid;
begin
  assert not exists (select 1 from auth.users where id = dani), 'Dani is gone from auth';
  assert not exists (select 1 from public.households where id = solo), 'her household is gone';
  assert not exists (select 1 from public.shopping_lists where name = 'Só da Dani'), 'with its data';
  assert exists (select 1 from public.household_file_cleanup where household_id = solo), 'its photos are queued';
  -- A casa dividida fica com Elo, com o que Dani registrou.
  assert (select created_by from public.households where id = shared) = elo, 'Elo now owns the shared household';
  assert (select role from public.household_members where household_id = shared and user_id = elo) = 'owner', 'Elo is the owner';
  assert exists (select 1 from public.shopping_lists where household_id = shared and name = 'Feira da Dani'), 'her list stays';
  assert (select paid_by from public.expenses where household_id = shared and description = 'Gás') is null, 'her expense stays, without the payer';
  assert (select count(*) from public.settlements where household_id = shared) = 2, 'the settlements stay';
  assert exists (
    select 1 from public.settlements where household_id = shared and from_user is null and to_user = elo and amount = 30
  ), 'Dani paid Elo: now from a former resident';
  assert exists (
    select 1 from public.settlements where household_id = shared and from_user = elo and to_user is null and amount = 10
  ), 'Elo paid Dani: now to a former resident';
  assert exists (
    select 1 from public.people where household_id = shared and name = 'Dani' and member_user_id is null
  ), 'her health record became a dependent';
  -- A foto fica com a casa, sem dono.
  assert (
    select owner is null and owner_id is null from storage.objects where name = shared::text || '/nota-da-dani.jpg'
  ), 'the photo stays with the household, without an owner';
  assert not exists (select 1 from public.beta_access where user_id = dani), 'the advisor is gone';
  assert not exists (select 1 from public.fin_connections where user_id = dani), 'with her banks';
  assert not exists (select 1 from public.push_subscriptions where user_id = dani), 'her browser subscriptions are gone';
  assert not exists (select 1 from public.push_schedule where title = 'Remédio'), 'with the schedule';
  assert not exists (select 1 from public.household_sessions where user_id = dani), 'her sessions are gone';
  assert not exists (select 1 from public.join_attempts where user_id = dani), 'her invite attempts are gone';
  -- Ninguém mais muda.
  assert exists (select 1 from public.household_members where user_id = elo and household_id = shared), 'Elo stays';
  assert exists (select 1 from public.shopping_lists where name = 'Do Iuri'), 'other households are untouched';
  assert exists (select 1 from auth.users where id = elo), 'Elo is still in auth';
end $$;
set role service_role;
do $$
declare
  result jsonb;
begin
  -- Iuri, sozinho na casa dele, sem o aviso de que ela seria apagada: nada muda.
  begin
    perform public.delete_account_data('00000000-0000-0000-0000-0000000001d3'::uuid, '{}');
    raise exception 'FAIL: deleted Iuri''s household without the warning';
  exception when sqlstate 'NK001' then null;
  end;
  assert exists (select 1 from public.households where id = current_setting('test.hh_d_other')::uuid), 'Iuri keeps his household';
  assert exists (select 1 from public.shopping_lists where name = 'Do Iuri'), 'with his list';
  -- Quem já não tem casa nenhuma (segunda tentativa depois de uma falha no Auth): nada a fazer, sem erro.
  result := public.delete_account_data('00000000-0000-0000-0000-0000000001d1'::uuid, '{}');
  assert result = jsonb_build_object('deleted', '[]'::jsonb, 'left', '[]'::jsonb), 'nothing left to do';
end $$;
reset role;
delete from public.household_file_cleanup where household_id = :'hh_d_solo';
delete from public.households where id in (:'hh_d_shared', :'hh_d_other');

\echo '• apagar a conta: o created_by que sobrou passa adiante e a casa sem ninguém sai, senão o Auth não apaga'
-- Dados de antes de a saída passar a casa adiante: Fabi é só moradora, mas o created_by de três casas ainda
-- é dela. Na do Gil, ele é o responsável (e Hana, a moradora mais antiga); na da Hana e do Ivo, ninguém é
-- responsável (vale o mais antigo, Ivo); a terceira não tem ninguém. Sem passar adiante e apagar, o
-- created_by (on delete restrict) seguraria a conta no Auth.
\set user_d4 '00000000-0000-0000-0000-0000000001d4'
\set user_d5 '00000000-0000-0000-0000-0000000001d5'
\set user_d6 '00000000-0000-0000-0000-0000000001d6'
\set user_d7 '00000000-0000-0000-0000-0000000001d7'
reset role;
insert into auth.users (id) values (:'user_d4'), (:'user_d5'), (:'user_d6'), (:'user_d7');
insert into public.households (name, invite_code, created_by) values ('Casa do Gil', 'DELGIL', :'user_d4')
  returning id as hh_d_gil \gset
insert into public.households (name, invite_code, created_by) values ('Casa sem responsável', 'DELSEM', :'user_d4')
  returning id as hh_d_noowner \gset
insert into public.households (name, invite_code, created_by) values ('Casa vazia', 'DELVAZ', :'user_d4')
  returning id as hh_d_empty \gset
insert into public.household_members (household_id, user_id, display_name, role, joined_at) values
  (:'hh_d_gil', :'user_d6', 'Hana', 'member', now() - interval '3 days'),
  (:'hh_d_gil', :'user_d5', 'Gil', 'owner', now() - interval '2 days'),
  (:'hh_d_gil', :'user_d4', 'Fabi', 'member', now() - interval '1 day'),
  (:'hh_d_noowner', :'user_d7', 'Ivo', 'member', now() - interval '2 days'),
  (:'hh_d_noowner', :'user_d6', 'Hana', 'member', now() - interval '1 day'),
  (:'hh_d_noowner', :'user_d4', 'Fabi', 'member', now());
select set_config('test.hh_d_gil', :'hh_d_gil', false) \gset
select set_config('test.hh_d_noowner', :'hh_d_noowner', false) \gset
select set_config('test.hh_d_empty', :'hh_d_empty', false) \gset
set role service_role;
do $$
declare
  fabi uuid := '00000000-0000-0000-0000-0000000001d4';
  gil_house uuid := current_setting('test.hh_d_gil')::uuid;
  noowner uuid := current_setting('test.hh_d_noowner')::uuid;
  empty uuid := current_setting('test.hh_d_empty')::uuid;
  result jsonb;
begin
  -- Nenhuma casa em que ela é a última: o app não avisou nada, e não precisava.
  result := public.delete_account_data(fabi, '{}');
  -- Na ordem do id (a mesma para quem apagar ao mesmo tempo), e não na de quando ela entrou.
  assert result -> 'left' = (select jsonb_agg(h order by h) from unnest(array[gil_house, noowner]) h),
    'Fabi left both households she lives in, in id order';
  assert result -> 'deleted' = jsonb_build_array(empty), 'the household with nobody in it is reported as deleted';
end $$;
reset role;
do $$
declare
  gil uuid := '00000000-0000-0000-0000-0000000001d5';
  ivo uuid := '00000000-0000-0000-0000-0000000001d7';
  gil_house uuid := current_setting('test.hh_d_gil')::uuid;
  noowner uuid := current_setting('test.hh_d_noowner')::uuid;
  empty uuid := current_setting('test.hh_d_empty')::uuid;
begin
  assert (select created_by from public.households where id = gil_house) = gil, 'goes to the owner, not the oldest member';
  assert (select created_by from public.households where id = noowner) = ivo, 'without an owner, to the oldest member';
  assert not exists (select 1 from public.households where id = empty), 'the empty household is gone';
  assert exists (select 1 from public.household_file_cleanup where household_id = empty), 'with its photos queued';
  assert (select count(*) from public.household_members where household_id = gil_house) = 2, 'Gil and Hana stay';
  assert (select count(*) from public.household_members where household_id = noowner) = 2, 'Ivo and Hana stay';
end $$;
-- Nada mais segura a conta: o Auth apaga.
delete from auth.users where id = :'user_d4';
do $$
begin
  assert not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000001d4'), 'Fabi is gone from auth';
end $$;
delete from public.household_file_cleanup where household_id = :'hh_d_empty';
delete from public.households where id in (:'hh_d_gil', :'hh_d_noowner');

\echo '• apagar a conta: a casa avisada como apagada que ganhou um morador desfaz tudo (NK011)'
-- Jade é a única da casa dela quando abre a tela; antes de ela confirmar, Kai entra com o código.
\set user_d8 '00000000-0000-0000-0000-0000000001d8'
\set user_d9 '00000000-0000-0000-0000-0000000001d9'
reset role;
insert into auth.users (id) values (:'user_d8'), (:'user_d9');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_d8', false) \gset
select (public.create_household('Praia da Jade', 'Jade')).id as hh_d_jade \gset
select invite_code as invite_jade from public.households where id = :'hh_d_jade' \gset
select set_config('request.headers', json_build_object('x-household-id', :'hh_d_jade')::text, false) \gset
insert into public.shopping_lists (name) values ('Lista da Jade');
select set_config('test.hh_d_jade', :'hh_d_jade', false) \gset
do $$
begin
  assert (select p.last from public.account_deletion_preview() p where p.id = current_setting('test.hh_d_jade')::uuid),
    'the screen says Jade is the last one';
end $$;
select set_config('request.headers', '', false) \gset
select set_config('request.jwt.claim.sub', :'user_d9', false) \gset
select public.join_household(:'invite_jade', 'Kai') \gset
set role service_role;
select set_config('request.jwt.claim.sub', '', false) \gset
do $$
declare
  jade uuid := '00000000-0000-0000-0000-0000000001d8';
  praia uuid := current_setting('test.hh_d_jade')::uuid;
begin
  begin
    perform public.delete_account_data(jade, array[praia]);
    raise exception 'FAIL: handed over a household the app said would be deleted';
  exception when sqlstate 'NK011' then null;
  end;
end $$;
reset role;
do $$
declare
  jade uuid := '00000000-0000-0000-0000-0000000001d8';
  kai uuid := '00000000-0000-0000-0000-0000000001d9';
  praia uuid := current_setting('test.hh_d_jade')::uuid;
begin
  assert exists (select 1 from public.household_members where household_id = praia and user_id = jade and role = 'owner'),
    'Jade is still in her household, as the owner';
  assert (select created_by from public.households where id = praia) = jade, 'the household is still hers';
  assert exists (select 1 from public.household_members where household_id = praia and user_id = kai), 'Kai stays';
  assert exists (select 1 from public.shopping_lists where household_id = praia and name = 'Lista da Jade'), 'her list stays';
  assert not exists (select 1 from public.household_file_cleanup where household_id = praia), 'no photos queued';
end $$;

\echo '• apagar a conta: até 5 tentativas de senha por hora por conta, só pela chave secreta'
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_d8', false) \gset
do $$
begin
  begin
    perform public.count_account_deletion_attempt(auth.uid());
    raise exception 'FAIL: app user counted an attempt';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.clear_account_deletion_attempts(auth.uid());
    raise exception 'FAIL: app user cleared the attempts';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.account_deletion_attempts;
    raise exception 'FAIL: app user read the attempts';
  exception when insufficient_privilege then null;
  end;
end $$;
set role anon;
do $$
begin
  perform public.count_account_deletion_attempt('00000000-0000-0000-0000-0000000001d8'::uuid);
  raise exception 'FAIL: anon counted an attempt';
exception when insufficient_privilege then null;
end $$;
set role service_role;
select set_config('request.jwt.claim.sub', '', false) \gset
do $$
declare
  jade uuid := '00000000-0000-0000-0000-0000000001d8';
  kai uuid := '00000000-0000-0000-0000-0000000001d9';
begin
  for i in 1..5 loop
    assert public.count_account_deletion_attempt(jade), format('attempt %s is allowed', i);
  end loop;
  assert not public.count_account_deletion_attempt(jade), 'the sixth in the hour is refused';
  assert not public.count_account_deletion_attempt(jade), 'and so is the seventh';
  assert public.count_account_deletion_attempt(kai), 'another account has its own count';
end $$;
reset role;
do $$
begin
  assert (select attempts from public.account_deletion_attempts where user_id = '00000000-0000-0000-0000-0000000001d8') = 5,
    'a refused try does not count';
end $$;
-- Uma hora depois da primeira, a contagem recomeça.
update public.account_deletion_attempts set window_started_at = now() - interval '61 minutes' where user_id = :'user_d8';
set role service_role;
do $$
begin
  assert public.count_account_deletion_attempt('00000000-0000-0000-0000-0000000001d8'::uuid), 'a new hour starts over';
end $$;
reset role;
do $$
declare
  jade uuid := '00000000-0000-0000-0000-0000000001d8';
begin
  assert (select attempts from public.account_deletion_attempts where user_id = jade) = 1, 'counting this one';
  assert (select window_started_at from public.account_deletion_attempts where user_id = jade) > now() - interval '1 minute',
    'and the hour starts now';
end $$;
-- A senha certa zera, e só a dela.
set role service_role;
select public.clear_account_deletion_attempts(:'user_d8') \gset
reset role;
do $$
begin
  assert not exists (select 1 from public.account_deletion_attempts where user_id = '00000000-0000-0000-0000-0000000001d8'),
    'the right password clears the count';
  assert exists (select 1 from public.account_deletion_attempts where user_id = '00000000-0000-0000-0000-0000000001d9'), 'only hers';
end $$;
-- A contagem sai com a conta.
delete from public.households where id = :'hh_d_jade';
delete from auth.users where id = :'user_d9';
do $$
begin
  assert not exists (select 1 from public.account_deletion_attempts where user_id = '00000000-0000-0000-0000-0000000001d9'),
    'the count goes with the account';
end $$;
delete from auth.users where id = :'user_d8';

-- ---------------------------------------------------------------------------
\echo '• "Marca preferida" no item da lista: só quem escolhe liga, e o que já estava (ou vem sem a coluna) fica sem'
-- Bia (Casa da Bia) põe itens como o app de antes (sem a coluna), pelo "Acabou" (add_to_list) e liga a marca de
-- um. Rui, de outra casa, não vê nem muda a escolha dela.
\set user_bp1 '00000000-0000-0000-0000-0000000002a1'
\set user_bp2 '00000000-0000-0000-0000-0000000002a2'
insert into auth.users (id) values (:'user_bp1'), (:'user_bp2');
do $$
begin
  assert (
    select c.is_nullable = 'NO' and c.column_default = 'false' and c.data_type = 'boolean'
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'shopping_list_items' and c.column_name = 'brand_preferred'
  ), 'brand_preferred is a boolean, not null, false by default';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_bp2', false) \gset
select (public.create_household('Casa do Rui', 'Rui')).id as hh_bp2 \gset
select set_config('request.jwt.claim.sub', :'user_bp1', false) \gset
select (public.create_household('Casa da Bia', 'Bia')).id as hh_bp1 \gset
insert into public.shopping_lists (name, kind) values ('Mercado', 'mercado') returning id as list_bp1 \gset
select set_config('test.list_bp1', :'list_bp1', false) \gset
do $$
declare
  list uuid := current_setting('test.list_bp1')::uuid;
  legacy uuid;
  pantry uuid;
  chosen uuid;
begin
  -- O app de antes grava sem a coluna: o item com o nome do produto não vira escolha de marca.
  insert into public.shopping_list_items (list_id, name, category) values (list, 'Leite IL Desnatado', 'laticinios')
    returning id into legacy;
  assert not (select brand_preferred from public.shopping_list_items where id = legacy), 'an item written without the column is not brand preferred';
  select item_id into pantry from public.add_to_list(list, 'Ovo Doninho Caipira', 'ovos');
  assert not (select brand_preferred from public.shopping_list_items where id = pantry), 'nor one put by add_to_list';
  -- Ligar nos detalhes do item grava a escolha, e desligar a tira.
  update public.shopping_list_items set brand_preferred = true where id = legacy;
  assert (select brand_preferred from public.shopping_list_items where id = legacy), 'a member turns it on';
  update public.shopping_list_items set brand_preferred = false where id = legacy;
  assert not (select brand_preferred from public.shopping_list_items where id = legacy), 'and off';
  insert into public.shopping_list_items (list_id, name, category, brand_preferred) values (list, 'Café Pilão', 'mercearia', true)
    returning id into chosen;
  assert (select brand_preferred from public.shopping_list_items where id = chosen), 'an item can be added with it on';
  update public.shopping_list_items set brand_preferred = true where id = legacy;
  begin
    update public.shopping_list_items set brand_preferred = null where id = legacy;
    raise exception 'FAIL: brand_preferred took a null';
  exception when not_null_violation then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', :'user_bp2', false) \gset
do $$
declare
  touched int;
begin
  assert not exists (select 1 from public.shopping_list_items where list_id = current_setting('test.list_bp1')::uuid),
    'another house does not see the items';
  update public.shopping_list_items set brand_preferred = false where list_id = current_setting('test.list_bp1')::uuid;
  get diagnostics touched = row_count;
  assert touched = 0, 'nor changes the brand choice';
end $$;
reset role;
do $$
begin
  assert (
    select count(*) filter (where brand_preferred) = 2 and count(*) = 3
    from public.shopping_list_items where list_id = current_setting('test.list_bp1')::uuid
  ), 'Bia''s choices stay as she left them';
end $$;
delete from public.households where id in (:'hh_bp1', :'hh_bp2');
delete from auth.users where id in (:'user_bp1', :'user_bp2');

-- ---------------------------------------------------------------------------
\echo '• item genérico da leitura por foto: na linha da casa, com tamanho limitado, fora da leitura e dos preços comuns'
-- Fábio lê uma nota pela foto (a função grava as linhas com o JWT dele, como aqui) e confirma; Gabi, de outra
-- casa, não vê nem muda o genérico das linhas dele.
\set user_g1 '00000000-0000-0000-0000-0000000001f1'
\set user_g2 '00000000-0000-0000-0000-0000000001f2'
reset role;
insert into auth.users (id) values (:'user_g1'), (:'user_g2');
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_g2', false) \gset
select (public.create_household('Casa da Gabi', 'Gabi')).id as hh_g2 \gset
select set_config('request.jwt.claim.sub', :'user_g1', false) \gset
select (public.create_household('Casa do Fábio', 'Fábio')).id as hh_g1 \gset
do $$
declare
  r uuid;
  i_cafe uuid;
  i_gilete uuid;
  i_mentos uuid;
begin
  insert into public.receipts (purchased_at, source) values ('2026-10-21 10:00-03', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, position, raw_description, suggested_name, suggested_category, generic_name, quantity, unit, unit_price, total_price)
    values (r, 0, 'CAF TORR MOIDO 3COR 500G', 'Café Torrado e Moído 3 Corações 500g', 'cafe_cha', 'café em pó', 1, 'un', 18.9, 18.9)
    returning id into i_cafe;
  insert into public.receipt_items (receipt_id, position, raw_description, generic_name, quantity, unit, unit_price, total_price)
    values (r, 1, 'GILLETTE APARELHO', 'aparelho de barbear', 1, 'un', 24.9, 24.9)
    returning id into i_gilete;
  -- A IA não soube: nulo, como nas notas do QR e nas de antes.
  insert into public.receipt_items (receipt_id, position, raw_description, quantity, unit, unit_price, total_price)
    values (r, 2, 'PASTILHA MENTOS 30MIN', 1, 'un', 3.5, 3.5)
    returning id into i_mentos;
  assert (select array_agg(generic_name order by position) from public.receipt_items where receipt_id = r)
    = array['café em pó', 'aparelho de barbear', null], 'the lines keep the generic name, or null';
  assert (select count(*) from public.receipt_items where receipt_id = r and generic_name is null) = 1, 'null by default';

  -- Comprido demais (a descrição inteira repetida) ou vazio: o banco recusa.
  begin
    insert into public.receipt_items (receipt_id, raw_description, generic_name, unit_price, total_price)
      values (r, 'LINHA', repeat('a', 61), 1, 1);
    raise exception 'FAIL: generic name longer than 60';
  exception when check_violation then null;
  end;
  begin
    update public.receipt_items set generic_name = '' where id = i_mentos;
    raise exception 'FAIL: empty generic name';
  exception when check_violation then null;
  end;
  insert into public.receipt_items (receipt_id, position, raw_description, generic_name, unit_price, total_price)
    values (r, 3, 'LINHA', repeat('a', 60), 1, 1);
  delete from public.receipt_items where receipt_id = r and position = 3;

  -- Confirmar não mexe no genérico.
  perform public.confirm_receipt(r, jsonb_build_array(
    jsonb_build_object('id', i_cafe, 'new_product', jsonb_build_object('name', 'Café 3 Corações 500g', 'category', 'cafe_cha')),
    jsonb_build_object('id', i_gilete),
    jsonb_build_object('id', i_mentos)));
  assert (select status from public.receipts where id = r) = 'confirmed', 'confirmed';
  assert (select generic_name from public.receipt_items where id = i_cafe) = 'café em pó', 'the confirmation keeps it';
  perform set_config('test.g_receipt', r::text, false);
end $$;

select set_config('request.jwt.claim.sub', :'user_g2', false) \gset
do $$
declare
  n integer;
begin
  assert not exists (select 1 from public.receipt_items where generic_name is not null), 'Gabi sees no line of the other house';
  update public.receipt_items set generic_name = 'outra coisa' where receipt_id = current_setting('test.g_receipt')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'and changes none';
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.receipt_items where generic_name = 'outra coisa') = 0, 'nothing changed';
  -- Só a linha da casa: a leitura do servidor e a base comum de preços não têm o genérico.
  assert not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and column_name = 'generic_name' and table_name <> 'receipt_items'
  ), 'no other table or view carries the generic name';
  assert not exists (select 1 from public.receipt_reads where lines::text like '%generic%'), 'nor the server reads';
end $$;
delete from public.households where id in (:'hh_g1', :'hh_g2');
delete from auth.users where id in (:'user_g1', :'user_g2');

-- ---------------------------------------------------------------------------
\echo '• item tirado da lista não volta pelo envio repetido de quem o pôs'
-- Lia põe itens com o id do aparelho, como a fila da lista. A resposta se perde e o aparelho manda de novo depois
-- que o item saiu da lista (tirado, levado pelo "Limpar" ou com a lista apagada): o envio repetido dá certo, sem
-- erro, e o item não volta.
\set user_t1 '00000000-0000-0000-0000-0000000002b1'
insert into auth.users (id) values (:'user_t1');
do $$
begin
  assert (select relrowsecurity from pg_class where oid = 'public.shopping_list_item_tombstones'::regclass),
    'the tombstones have RLS on';
  assert not has_table_privilege('authenticated', 'public.shopping_list_item_tombstones', 'select')
    and not has_table_privilege('authenticated', 'public.shopping_list_item_tombstones', 'insert')
    and not has_table_privilege('anon', 'public.shopping_list_item_tombstones', 'select'),
    'no API role reads or writes the tombstones';
  assert not has_function_privilege('authenticated', 'public.forget_list_item_tombstones()', 'execute')
    and not has_function_privilege('anon', 'public.forget_list_item_tombstones()', 'execute'),
    'nor runs the cleanup';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_t1', false) \gset
select (public.create_household('Casa da Lia', 'Lia')).id as hh_t1 \gset
insert into public.shopping_lists (name, kind) values ('Mercado', 'mercado') returning id as list_t1 \gset
insert into public.shopping_lists (name, kind) values ('Festa', 'outros') returning id as list_t2 \gset
select set_config('test.list_t1', :'list_t1', false) \gset
select set_config('test.list_t2', :'list_t2', false) \gset
do $$
declare
  list uuid := current_setting('test.list_t1')::uuid;
  party uuid := current_setting('test.list_t2')::uuid;
  removed uuid := gen_random_uuid();
  bought uuid := gen_random_uuid();
  kept uuid := gen_random_uuid();
  balloons uuid := gen_random_uuid();
  n integer;
begin
  insert into public.shopping_list_items (id, list_id, name, category, toggle_token)
    values (removed, list, 'Leite', 'laticinios', gen_random_uuid()),
           (bought, list, 'Pão', 'padaria', gen_random_uuid()),
           (kept, list, 'Café', 'cafe_cha', gen_random_uuid()),
           (balloons, party, 'Balões', 'outros', gen_random_uuid());
  -- A resposta da primeira tentativa se perdeu, mas o item está lá: o envio repetido bate no id (23505), que o app
  -- entende como "já foi".
  begin
    insert into public.shopping_list_items (id, list_id, name, category) values (kept, list, 'Café', 'cafe_cha');
    raise exception 'FAIL: a live id was inserted twice';
  exception when unique_violation then null;
  end;
  -- Tirado da lista ("Remover da lista"): o envio repetido não o põe de volta.
  delete from public.shopping_list_items where id = removed;
  insert into public.shopping_list_items (id, list_id, name, category) values (removed, list, 'Leite', 'laticinios');
  get diagnostics n = row_count;
  assert n = 0, 'a removed item is not inserted again';
  assert not exists (select 1 from public.shopping_list_items where id = removed), 'and is not back on the list';
  -- Comprado e levado pelo "Limpar".
  update public.shopping_list_items set checked_at = now() where id = bought;
  assert public.clear_checked_items(
    list, array[bought], array(select toggle_token from public.shopping_list_items where id = bought)
  ) = 1, 'the cart is cleared';
  insert into public.shopping_list_items (id, list_id, name, category) values (bought, list, 'Pão', 'padaria');
  assert not exists (select 1 from public.shopping_list_items where id = bought), 'a bought item does not come back';
  -- A lista apagada leva os itens: o envio repetido, para a lista que não existe mais, passa sem erro (antes dava
  -- erro de chave) e não põe nada.
  delete from public.shopping_lists where id = party;
  insert into public.shopping_list_items (id, list_id, name, category) values (balloons, party, 'Balões', 'outros');
  get diagnostics n = row_count;
  assert n = 0, 'nor one whose list was deleted';
  assert not exists (select 1 from public.shopping_list_items where id = balloons), 'which stays gone';
  -- O resto da lista continua como estava, e um item novo entra normalmente (pela fila ou pelo "Acabou").
  assert exists (select 1 from public.shopping_list_items where id = kept), 'the other item stays';
  insert into public.shopping_list_items (id, list_id, name, category) values (gen_random_uuid(), list, 'Ovos', 'outros');
  get diagnostics n = row_count;
  assert n = 1, 'a new item goes in';
  assert (select item_id is not null from public.add_to_list(list, 'Arroz', 'graos')), 'add_to_list still works';
  begin
    perform 1 from public.shopping_list_item_tombstones;
    raise exception 'FAIL: a member read the tombstones';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.shopping_list_item_tombstones;
    raise exception 'FAIL: a member cleared the tombstones';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.shopping_list_item_tombstones) >= 3, 'the removed ids are remembered';
  assert (select count(*) = 3 from public.shopping_list_items where list_id = current_setting('test.list_t1')::uuid),
    'the list has café, ovos, arroz and nothing that came back';
  -- Depois de 30 dias o banco esquece (a fila do aparelho não guarda o envio por tanto tempo).
  update public.shopping_list_item_tombstones set deleted_at = now() - interval '31 days';
  insert into public.shopping_list_item_tombstones (id) values (gen_random_uuid());
  assert public.forget_list_item_tombstones() >= 3, 'the cleanup forgets what is older than 30 days';
  assert (select count(*) from public.shopping_list_item_tombstones) = 1, 'and keeps the recent ones';
end $$;
-- Apagar a casa apaga os itens (que viram lápides) sem travar.
delete from public.households where id = :'hh_t1';
do $$
begin
  assert not exists (select 1 from public.shopping_list_items where list_id = current_setting('test.list_t1')::uuid),
    'the household and its items are gone';
  assert (select count(*) from public.shopping_list_item_tombstones) >= 4, 'and their ids are remembered';
end $$;
delete from public.shopping_list_item_tombstones;
delete from auth.users where id = :'user_t1';

-- ---------------------------------------------------------------------------
\echo '• código do produto na nota: a casa aprende a abreviação de cada mercado e o código de barras'
-- Nina confirma notas de dois mercados com CNPJ e de uma loja criada à mão; a próxima nota acha o produto pelo
-- código. Otto, de outra casa, não vê nem usa o que a casa dela aprendeu.
\set user_sc1 '00000000-0000-0000-0000-0000000002c1'
\set user_sc2 '00000000-0000-0000-0000-0000000002c2'
reset role;
insert into auth.users (id) values (:'user_sc1'), (:'user_sc2');
do $$
begin
  assert (
    select c.is_nullable = 'YES' and c.column_default is null and c.data_type = 'text'
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'receipt_items' and c.column_name = 'store_code'
  ), 'store_code is a text column, null by default';

  -- A chave do código: maiúsculas, sem acento, só letras e dígitos, de 1 a 60.
  assert public.store_code_key(' 250474 ') = '250474', 'spaces go';
  assert public.store_code_key('(Código: 250474)') = 'CODIGO250474', 'accents and punctuation go, letters stay';
  assert public.store_code_key('ab-12/ç') = 'AB12C', 'upper case, the cedilla goes';
  assert public.store_code_key('ß1') = '1', 'a letter that does not decompose goes (JavaScript would make it SS)';
  assert public.store_code_key(repeat('9', 60)) = repeat('9', 60), 'up to 60';
  assert public.store_code_key(repeat('9', 61)) is null, 'longer is not a code';
  assert public.store_code_key('') is null and public.store_code_key(' -/ ') is null and public.store_code_key(null) is null,
    'empty is not a code';

  -- O código de barras: 14 dígitos com o verificador certo, fora das faixas de uso restrito.
  assert public.gtin_key('7891000100103') = '07891000100103', 'a valid EAN-13';
  assert public.gtin_key('7891000100104') is null, 'wrong check digit';
  assert public.gtin_key('96385074') = '00000096385074', 'a valid EAN-8';
  assert public.gtin_key('01234565') is null, 'an EAN-8 starting with 0 is restricted';
  assert public.gtin_key('20000004') is null, 'an EAN-8 starting with 2 too';
  assert public.gtin_key('2000000000008') is null, 'an EAN-13 starting with 2 is in-store / variable weight';
  assert public.gtin_key('036000291452') = '00036000291452', 'a valid UPC-A, with zeros ahead';
  assert public.gtin_key('212345678992') is null and public.gtin_key('0212345678992') is null,
    'a UPC-A of number system 2 (EAN-13 starting with 02) is variable weight';
  assert public.gtin_key('412345678996') is null, 'a UPC-A of number system 4 (EAN-13 starting with 04) is in-store';
  assert public.gtin_key('9800000000007') is null and public.gtin_key('9900000000004') is null, 'coupons';
  assert public.gtin_key('17891000100100') = '17891000100100', 'a valid GTIN-14';
  assert public.gtin_key('97891000100106') is null, 'a GTIN-14 starting with 9 is variable weight';
  assert public.gtin_key('07891000100103') = '07891000100103', 'the key of a key is itself';
  assert public.gtin_key('789100010010A') is null and public.gtin_key('ABC') is null, 'letters';
  assert public.gtin_key('250474') is null and public.gtin_key('1234567890') is null, 'other lengths';
  assert public.gtin_key(null) is null and public.gtin_key(' 7891000100103') is null, 'only the bare digits';

  -- Quem usa: as funções que rodam com as permissões de quem chama.
  assert has_function_privilege('authenticated', 'public.store_code_key(text)', 'execute')
    and has_function_privilege('authenticated', 'public.gtin_key(text)', 'execute')
    and has_function_privilege('authenticated', 'public.match_store_codes(text, text[])', 'execute'),
    'members run the key functions and the match';
  assert not has_function_privilege('anon', 'public.store_code_key(text)', 'execute')
    and not has_function_privilege('anon', 'public.gtin_key(text)', 'execute')
    and not has_function_privilege('anon', 'public.match_store_codes(text, text[])', 'execute'),
    'anon does not';
  assert (select relrowsecurity from pg_class where oid = 'public.product_store_codes'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.product_barcodes'::regclass), 'both tables have RLS on';
  assert has_table_privilege('authenticated', 'public.product_store_codes', 'select')
    and has_table_privilege('authenticated', 'public.product_store_codes', 'insert')
    and has_table_privilege('authenticated', 'public.product_store_codes', 'update')
    and has_table_privilege('authenticated', 'public.product_store_codes', 'delete')
    and has_table_privilege('authenticated', 'public.product_barcodes', 'select')
    and has_table_privilege('authenticated', 'public.product_barcodes', 'insert')
    and has_table_privilege('authenticated', 'public.product_barcodes', 'update')
    and has_table_privilege('authenticated', 'public.product_barcodes', 'delete'), 'members manage what their house learned';
  assert not has_table_privilege('anon', 'public.product_store_codes', 'select')
    and not has_table_privilege('anon', 'public.product_barcodes', 'select')
    and not has_table_privilege('authenticated', 'public.product_store_codes', 'truncate')
    and not has_table_privilege('authenticated', 'public.product_barcodes', 'truncate'), 'anon reads nothing, nobody truncates';
  assert has_table_privilege('service_role', 'public.product_store_codes', 'select')
    and has_table_privilege('service_role', 'public.product_barcodes', 'insert'), 'the service role has them';
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', :'user_sc2', false) \gset
select (public.create_household('Casa do Otto', 'Otto')).id as hh_sc2 \gset
select set_config('request.jwt.claim.sub', :'user_sc1', false) \gset
select (public.create_household('Casa da Nina', 'Nina')).id as hh_sc1 \gset
select set_config('test.hh_sc1', :'hh_sc1', false) \gset
do $$
declare
  m1 uuid;
  m2 uuid;
  hand uuid;
  r uuid;
  i_banana uuid;
  i_leite uuid;
  i_sacola uuid;
  i_pao uuid;
  i_old uuid;
  p_banana uuid;
  p_nanica uuid;
  p_leite uuid;
  p_desnatado uuid;
  p_pao uuid;
begin
  insert into public.stores (name, cnpj) values ('Mercado Bom', '11222333000181') returning id into m1;
  insert into public.stores (name, cnpj) values ('Mercado Dois', '22333444000155') returning id into m2;
  insert into public.stores (name) values ('Feira da esquina') returning id into hand;

  -- A coluna: só a chave (maiúsculas e dígitos, de 1 a 60), ou nula.
  insert into public.receipts (store_id, purchased_at, source) values (m1, '2026-10-01 10:00-03', 'ai') returning id into r;
  begin
    insert into public.receipt_items (receipt_id, raw_description, store_code, unit_price, total_price) values (r, 'X', 'abc', 1, 1);
    raise exception 'FAIL: lower case store code';
  exception when check_violation then null;
  end;
  begin
    insert into public.receipt_items (receipt_id, raw_description, store_code, unit_price, total_price) values (r, 'X', '', 1, 1);
    raise exception 'FAIL: empty store code';
  exception when check_violation then null;
  end;
  begin
    insert into public.receipt_items (receipt_id, raw_description, store_code, unit_price, total_price) values (r, 'X', '25 04', 1, 1);
    raise exception 'FAIL: store code with a space';
  exception when check_violation then null;
  end;
  begin
    insert into public.receipt_items (receipt_id, raw_description, store_code, unit_price, total_price) values (r, 'X', repeat('A', 61), 1, 1);
    raise exception 'FAIL: store code longer than 60';
  exception when check_violation then null;
  end;
  insert into public.receipt_items (receipt_id, raw_description, store_code, unit_price, total_price) values (r, 'X', repeat('A', 60), 1, 1);
  delete from public.receipt_items where receipt_id = r;

  -- Primeira nota, no Mercado Bom: banana pelo código do mercado, leite pelo código de barras, a sacola sem
  -- produto e o pão sem código; uma linha gravada como o app de antes (sem a coluna).
  insert into public.receipt_items (receipt_id, position, raw_description, store_code, unit_price, total_price)
    values (r, 0, 'BANANA PRATA', '250474', 6, 3.21) returning id into i_banana;
  insert into public.receipt_items (receipt_id, position, raw_description, store_code, unit_price, total_price)
    values (r, 1, 'LEITE ITALAC 1L', '7891000100103', 4.59, 4.59) returning id into i_leite;
  insert into public.receipt_items (receipt_id, position, raw_description, store_code, unit_price, total_price)
    values (r, 2, 'SACOLA PLASTICA', '999', 0.1, 0.1) returning id into i_sacola;
  insert into public.receipt_items (receipt_id, position, raw_description, unit_price, total_price)
    values (r, 3, 'PAO FRANCES KG', 16.9, 5.49) returning id into i_pao;
  assert (select store_code from public.receipt_items where id = i_pao) is null, 'a line written without the column has no code';
  perform public.confirm_receipt(r, jsonb_build_array(
    jsonb_build_object('id', i_banana, 'new_product', jsonb_build_object('name', 'Banana prata', 'category', 'hortifruti')),
    jsonb_build_object('id', i_leite, 'new_product', jsonb_build_object('name', 'Leite Italac 1L', 'category', 'laticinios')),
    jsonb_build_object('id', i_sacola),
    jsonb_build_object('id', i_pao, 'new_product', jsonb_build_object('name', 'Pão francês', 'category', 'padaria'))));
  select id into p_banana from public.products where name = 'Banana prata';
  select id into p_leite from public.products where name = 'Leite Italac 1L';
  select id into p_pao from public.products where name = 'Pão francês';
  assert (select status from public.receipts where id = r) = 'confirmed', 'confirmed';
  -- O que confirm_receipt já fazia continua: os produtos ligados e os apelidos aprendidos.
  assert (select product_id from public.receipt_items where id = i_banana) = p_banana, 'the line has its product';
  assert (select product_id from public.receipt_items where id = i_sacola) is null, 'the bag has none';
  assert (select array_agg(alias order by alias) from public.product_aliases)
    = array['BANANA PRATA', 'LEITE ITALAC 1L', 'PAO FRANCES KG'], 'the aliases are learned as before';
  -- E o novo: o código de cada linha com produto e código, no mercado da nota.
  assert (select array_agg(store_cnpj || ':' || store_code || '=' || product_id::text order by store_code) from public.product_store_codes)
    = array['11222333000181:250474=' || p_banana, '11222333000181:7891000100103=' || p_leite],
    'the market learns the code of each line with a product (not the bag)';
  assert (select array_agg(gtin || '=' || product_id::text) from public.product_barcodes) = array['07891000100103=' || p_leite],
    'and the barcode, in 14 digits; 250474 is not one';
  assert (select household_id from public.product_store_codes limit 1) = current_setting('test.hh_sc1')::uuid, 'for the house';
  assert (select learned_from = 'BANANA PRATA' and not ambiguous from public.product_store_codes where store_code = '250474'),
    'the code remembers the description that taught it, and is not ambiguous';
  -- A descrição guardada é a do apelido (normalize_alias), e só ela.
  begin
    update public.product_store_codes set learned_from = 'banana prata' where store_code = '250474';
    raise exception 'FAIL: learned_from not normalized';
  exception when check_violation then null;
  end;

  -- Uma data fixa no passado: a confirmação de agora roda na mesma transação, e now() não andaria.
  update public.product_store_codes set updated_at = '2000-01-01';
  update public.product_barcodes set updated_at = '2000-01-01';

  -- Segunda nota, no mesmo mercado: a mesma descrição, e a pessoa diz que é outra banana. É uma correção:
  -- o produto troca, e o código continua valendo.
  insert into public.receipts (store_id, purchased_at, source) values (m1, '2026-10-08 10:00-03', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, position, raw_description, store_code, unit_price, total_price)
    values (r, 0, 'Banana  Prata', '250474', 5, 2.5) returning id into i_banana;
  perform public.confirm_receipt(r, jsonb_build_array(
    jsonb_build_object('id', i_banana, 'new_product', jsonb_build_object('name', 'Banana nanica', 'category', 'hortifruti'))));
  select id into p_nanica from public.products where name = 'Banana nanica';
  assert (select product_id from public.product_store_codes where store_cnpj = '11222333000181' and store_code = '250474') = p_nanica,
    'the same description with another product is a correction: the product changes';
  assert not (select ambiguous from public.product_store_codes where store_code = '250474'), 'and the code is not ambiguous';
  assert (select updated_at from public.product_store_codes where store_code = '250474') > '2000-01-01', 'and the date moves';
  assert (select updated_at from public.product_barcodes where gtin = '07891000100103') = '2000-01-01',
    'the barcode this receipt did not have stays as it was';
  assert (select count(*) from public.product_store_codes) = 2, 'one row per market and code';

  -- O mercado muda o texto do mesmo produto: o código guarda a descrição nova e não fica ambíguo.
  insert into public.receipts (store_id, purchased_at, source) values (m1, '2026-10-08 18:00-03', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, position, raw_description, store_code, unit_price, total_price)
    values (r, 0, 'BANANA NAN KG', '250474', 5, 2.5) returning id into i_banana;
  perform public.confirm_receipt(r, jsonb_build_array(jsonb_build_object('id', i_banana, 'product_id', p_nanica)));
  assert (select product_id = p_nanica and learned_from = 'BANANA NAN KG' and not ambiguous
          from public.product_store_codes where store_code = '250474'),
    'the same product with a new description keeps the code';

  -- Terceira, na loja criada à mão (sem CNPJ): só o código de barras ensina, e o último vence nele também.
  insert into public.receipts (store_id, purchased_at, source) values (hand, '2026-10-09 10:00-03', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, position, raw_description, store_code, unit_price, total_price)
    values (r, 0, 'LEITE DESN 1L', '7891000100103', 4.99, 4.99) returning id into i_leite;
  insert into public.receipt_items (receipt_id, position, raw_description, store_code, unit_price, total_price)
    values (r, 1, 'OVOS BRANCOS DZ', 'X1', 9.9, 9.9) returning id into i_old;
  perform public.confirm_receipt(r, jsonb_build_array(
    jsonb_build_object('id', i_leite, 'new_product', jsonb_build_object('name', 'Leite desnatado 1L', 'category', 'laticinios')),
    jsonb_build_object('id', i_old, 'new_product', jsonb_build_object('name', 'Ovos', 'category', 'outros'))));
  select id into p_desnatado from public.products where name = 'Leite desnatado 1L';
  assert (select count(*) from public.product_store_codes) = 2, 'no market code without a CNPJ';
  assert (select product_id from public.product_barcodes where gtin = '07891000100103') = p_desnatado, 'the barcode follows the last receipt';
  assert (select updated_at from public.product_barcodes where gtin = '07891000100103') > '2000-01-01', 'and its date moves';
  assert (select count(*) from public.product_barcodes) = 1, 'X1 is not a barcode';

  -- A próxima nota: o código do mercado vence; sem ele, o código de barras; sem CNPJ, só o de barras.
  assert (
    select jsonb_object_agg(code, product_id)
    from public.match_store_codes('11222333000181', array['250474', '7891000100103', '999', 'X1', ' 250474', null])
  ) = jsonb_build_object('250474', p_nanica, '7891000100103', p_leite, ' 250474', p_nanica),
    'in the first market: the market codes (the code comes back as it was sent)';
  assert (
    select jsonb_object_agg(code, product_id) from public.match_store_codes('22333444000155', array['250474', '7891000100103'])
  ) = jsonb_build_object('7891000100103', p_desnatado), 'in another market: only the barcode';
  assert (
    select jsonb_object_agg(code, product_id) from public.match_store_codes(null, array['250474', '7891000100103', '07891000100103'])
  ) = jsonb_build_object('7891000100103', p_desnatado, '07891000100103', p_desnatado), 'without a CNPJ: only the barcode';
  assert not exists (select 1 from public.match_store_codes('11222333000181', '{}')), 'no codes, nothing';
  perform set_config('test.sc_banana', p_banana::text, false);
  perform set_config('test.sc_nanica', p_nanica::text, false);
  perform set_config('test.sc_leite', p_leite::text, false);
  perform set_config('test.sc_desnatado', p_desnatado::text, false);
end $$;

-- Otto, de outra casa: não vê, não usa e não grava no que a casa da Nina aprendeu.
select set_config('request.jwt.claim.sub', :'user_sc2', false) \gset
do $$
declare
  n integer;
begin
  assert not exists (select 1 from public.match_store_codes('11222333000181', array['250474', '7891000100103'])),
    'another house matches nothing';
  assert not exists (select 1 from public.product_store_codes) and not exists (select 1 from public.product_barcodes),
    'and sees nothing';
  update public.product_store_codes set store_code = 'OUTRO';
  get diagnostics n = row_count;
  assert n = 0, 'nor changes it';
  delete from public.product_barcodes;
  get diagnostics n = row_count;
  assert n = 0, 'nor deletes it';
  begin
    insert into public.product_barcodes (household_id, gtin, product_id)
      values (current_setting('test.hh_sc1')::uuid, '00000096385074', current_setting('test.sc_leite')::uuid);
    raise exception 'FAIL: wrote into another house';
  exception when insufficient_privilege or foreign_key_violation then null;
  end;
end $$;
set role anon;
do $$
begin
  perform public.match_store_codes('11222333000181', array['250474']);
  raise exception 'FAIL: anon matched store codes';
exception when insufficient_privilege then null;
end $$;

-- Juntar produtos leva os códigos para o que fica; apagar um produto leva os dele.
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_sc1', false) \gset
do $$
declare
  p_banana uuid := current_setting('test.sc_banana')::uuid;
  p_nanica uuid := current_setting('test.sc_nanica')::uuid;
  p_leite uuid := current_setting('test.sc_leite')::uuid;
  p_desnatado uuid := current_setting('test.sc_desnatado')::uuid;
begin
  -- Um código de barras só para o produto que vai sumir.
  insert into public.product_barcodes (gtin, product_id) values ('00000096385074', p_nanica);
  begin
    insert into public.product_barcodes (gtin, product_id) values ('7891000100103', p_leite);
    raise exception 'FAIL: barcode not in 14 digits';
  exception when check_violation then null;
  end;
  begin
    insert into public.product_barcodes (gtin, product_id) values ('02000000000008', p_leite);
    raise exception 'FAIL: restricted barcode';
  exception when check_violation then null;
  end;
  perform public.merge_products(p_banana, p_nanica);
  assert (select product_id from public.product_store_codes where store_code = '250474') = p_banana, 'the market code moves';
  assert (select product_id from public.product_barcodes where gtin = '00000096385074') = p_banana, 'and the barcode';
  perform public.merge_products(p_leite, p_desnatado);
  assert (select product_id from public.product_barcodes where gtin = '07891000100103') = p_leite, 'the barcode of the merged product moves';
  assert not exists (select 1 from public.product_store_codes where product_id in (p_nanica, p_desnatado))
    and not exists (select 1 from public.product_barcodes where product_id in (p_nanica, p_desnatado)), 'nothing points to the gone ones';
  assert (select count(*) from public.product_store_codes) = 2 and (select count(*) from public.product_barcodes) = 2, 'nothing was lost';

  delete from public.products where id = p_banana;
  assert not exists (select 1 from public.product_store_codes where store_code = '250474')
    and not exists (select 1 from public.product_barcodes where gtin = '00000096385074'), 'a deleted product takes its codes';
  assert (select count(*) from public.product_store_codes) = 1, 'and only its codes';
end $$;

-- O mercadinho que usa o mesmo código para itens diferentes (o 1 para todo o hortifruti a granel): o código
-- fica ambíguo e deixa de valer; vale o código de barras, depois o apelido de cada descrição.
do $$
declare
  m uuid;
  r uuid;
  i_a uuid;
  i_b uuid;
  p_tomate uuid;
  p_cebola uuid;
  p_alface uuid;
  p_couve uuid;
  p_cola uuid;
  p_guarana uuid;
begin
  select id into m from public.stores where cnpj = '22333444000155';

  -- Na mesma nota: TOMATE KG e CEBOLA KG, os dois com o código 1. A segunda linha vê a primeira.
  insert into public.receipts (store_id, purchased_at, source) values (m, '2026-10-10 10:00-03', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, position, raw_description, store_code, unit_price, total_price)
    values (r, 0, 'TOMATE KG', '1', 8, 4) returning id into i_a;
  insert into public.receipt_items (receipt_id, position, raw_description, store_code, unit_price, total_price)
    values (r, 1, 'CEBOLA KG', '1', 6, 3) returning id into i_b;
  perform public.confirm_receipt(r, jsonb_build_array(
    jsonb_build_object('id', i_a, 'new_product', jsonb_build_object('name', 'Tomate', 'category', 'hortifruti')),
    jsonb_build_object('id', i_b, 'new_product', jsonb_build_object('name', 'Cebola', 'category', 'hortifruti'))));
  select id into p_tomate from public.products where name = 'Tomate';
  select id into p_cebola from public.products where name = 'Cebola';
  assert (select ambiguous and product_id = p_cebola and learned_from = 'CEBOLA KG'
          from public.product_store_codes where store_cnpj = '22333444000155' and store_code = '1'),
    'one code for two products in one receipt is ambiguous (keeping the last product and description)';
  assert not exists (select 1 from public.match_store_codes('22333444000155', array['1'])), 'and the match skips it';
  assert (select product_id from public.product_aliases where alias = 'TOMATE KG') = p_tomate
    and (select product_id from public.product_aliases where alias = 'CEBOLA KG') = p_cebola,
    'each description keeps its own alias';

  -- Em notas diferentes: ALFACE UN e depois COUVE MACO com o código 2.
  insert into public.receipts (store_id, purchased_at, source) values (m, '2026-10-11 10:00-03', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, position, raw_description, store_code, unit_price, total_price)
    values (r, 0, 'ALFACE UN', '2', 3, 3) returning id into i_a;
  perform public.confirm_receipt(r, jsonb_build_array(
    jsonb_build_object('id', i_a, 'new_product', jsonb_build_object('name', 'Alface', 'category', 'hortifruti'))));
  select id into p_alface from public.products where name = 'Alface';
  assert (select jsonb_object_agg(code, product_id) from public.match_store_codes('22333444000155', array['2']))
    = jsonb_build_object('2', p_alface), 'one receipt alone teaches the code';
  insert into public.receipts (store_id, purchased_at, source) values (m, '2026-10-12 10:00-03', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, position, raw_description, store_code, unit_price, total_price)
    values (r, 0, 'COUVE MACO', '2', 4, 4) returning id into i_b;
  perform public.confirm_receipt(r, jsonb_build_array(
    jsonb_build_object('id', i_b, 'new_product', jsonb_build_object('name', 'Couve', 'category', 'hortifruti'))));
  select id into p_couve from public.products where name = 'Couve';
  assert (select ambiguous and product_id = p_couve from public.product_store_codes where store_code = '2'),
    'another description with another product, in a later receipt, is ambiguous too';
  assert not exists (select 1 from public.match_store_codes('22333444000155', array['2'])), 'and the match skips it';
  assert (select product_id from public.product_aliases where alias = 'ALFACE UN') = p_alface
    and (select product_id from public.product_aliases where alias = 'COUVE MACO') = p_couve,
    'each description keeps its own alias';

  -- Uma vez ambíguo, sempre: nem o mesmo produto com a mesma descrição nem uma correção tiram a marca.
  insert into public.receipts (store_id, purchased_at, source) values (m, '2026-10-13 10:00-03', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, position, raw_description, store_code, unit_price, total_price)
    values (r, 0, 'COUVE MACO', '2', 4, 4) returning id into i_a;
  insert into public.receipt_items (receipt_id, position, raw_description, store_code, unit_price, total_price)
    values (r, 1, 'CEBOLA KG', '1', 6, 3) returning id into i_b;
  perform public.confirm_receipt(r, jsonb_build_array(
    jsonb_build_object('id', i_a, 'product_id', p_couve),
    jsonb_build_object('id', i_b, 'product_id', p_tomate)));
  assert (select bool_and(ambiguous) from public.product_store_codes where store_cnpj = '22333444000155' and store_code in ('1', '2')),
    'a later confirmation does not clear the mark';
  assert not exists (select 1 from public.match_store_codes('22333444000155', array['1', '2'])), 'and the match keeps skipping them';

  -- O código de barras: o último vence nele. Ambíguo naquele mercado, o código não dá produto ali (um código
  -- genérico pode passar na conta do GTIN por acaso); nos outros mercados, o código de barras vale.
  insert into public.receipts (store_id, purchased_at, source) values (m, '2026-10-14 10:00-03', 'ai') returning id into r;
  insert into public.receipt_items (receipt_id, position, raw_description, store_code, unit_price, total_price)
    values (r, 0, 'REFRI COLA 2L', '7896005800010', 9, 9) returning id into i_a;
  insert into public.receipt_items (receipt_id, position, raw_description, store_code, unit_price, total_price)
    values (r, 1, 'REFRI GUARANA 2L', '7896005800010', 8, 8) returning id into i_b;
  perform public.confirm_receipt(r, jsonb_build_array(
    jsonb_build_object('id', i_a, 'new_product', jsonb_build_object('name', 'Refrigerante de cola', 'category', 'bebidas')),
    jsonb_build_object('id', i_b, 'new_product', jsonb_build_object('name', 'Guaraná', 'category', 'bebidas'))));
  select id into p_cola from public.products where name = 'Refrigerante de cola';
  select id into p_guarana from public.products where name = 'Guaraná';
  assert (select ambiguous from public.product_store_codes where store_code = '7896005800010'), 'the market code is ambiguous';
  assert (select product_id from public.product_barcodes where gtin = '07896005800010') = p_guarana, 'the barcode: the last one wins';
  assert not exists (select 1 from public.match_store_codes('22333444000155', array['7896005800010'])),
    'in that market the ambiguous code gives nothing, not even as a barcode';
  assert (select jsonb_object_agg(code, product_id) from public.match_store_codes('11222333000181', array['7896005800010']))
    = jsonb_build_object('7896005800010', p_guarana), 'and in another market too';
end $$;

-- Apagar a casa leva tudo o que ela aprendeu.
reset role;
delete from public.households where id = :'hh_sc1';
do $$
begin
  assert not exists (select 1 from public.product_store_codes where household_id = current_setting('test.hh_sc1')::uuid)
    and not exists (select 1 from public.product_barcodes where household_id = current_setting('test.hh_sc1')::uuid),
    'the household takes its codes along';
end $$;
delete from public.households where id = :'hh_sc2';
delete from auth.users where id in (:'user_sc1', :'user_sc2');

\echo 'OK — todos os testes do banco passaram'

