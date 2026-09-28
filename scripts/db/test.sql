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
end $$;

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

-- ---------------------------------------------------------------------------
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
end $$;

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
