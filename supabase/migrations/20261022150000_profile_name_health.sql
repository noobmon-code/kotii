-- O nome do perfil também na ficha de saúde (pedido do dono em 22/10/2026, depois de 20261022120000_profiles).
--
-- Salvar o perfil já trocava o nome em todas as casas da pessoa (household_members.display_name). Agora, em cada
-- casa em que o nome muda, a ficha dela (a linha de people com member_user_id = ela) fica com o nome novo, e os
-- remédios dela também (medications.person_name, como o app faz ao renomear uma ficha). O resto da ficha fica.
--
-- 1. Só nas casas em que o nome muda: onde a pessoa já tinha esse nome (salvar só o telefone, por exemplo), a
--    ficha fica como está, e quem deu outro nome à ficha (o nome completo, por exemplo) só o perde quando o nome
--    dela naquela casa muda. Quem ainda tinha um nome diferente em cada casa (entrou com outro nome) passa a ter
--    um só no primeiro "Salvar", e a ficha das casas em que o nome mudou vai junto, mesmo sem mexer no campo.
-- 2. Nome já usado por outra ficha da casa (um dependente, um pet, outro morador; maiúsculas não contam) ganha
--    sufixo ("Ana 2"), a mesma regra de quando a pessoa entra na casa (ensure_member_person). Se até "Ana 20" já
--    existe, a ficha fica com o nome que tinha, e o perfil salva do mesmo jeito.
-- 3. A ficha é só a dela (member_user_id): dependentes, pets e os outros moradores ficam como estão.
--
-- É a save_my_profile de 20261022120000_profiles.sql, com a troca do nome devolvendo as casas em que ele mudou e
-- o laço das fichas no fim.

create or replace function public.save_my_profile(p_name text, p_birth_date date, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  -- Os espaços das pontas saem (os mesmos que o cleanName do app tira).
  v_name text := regexp_replace(coalesce(p_name, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- Só os dígitos; vazio é sem telefone.
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  -- O dia de hoje no Brasil, o mesmo do aparelho.
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  -- As casas em que o nome mudou.
  changed uuid[];
  person uuid;
  candidate text;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'invalid name' using errcode = 'NK012';
  end if;
  if p_birth_date is not null and (p_birth_date < date '1900-01-01' or p_birth_date > v_today) then
    raise exception 'invalid birth date' using errcode = 'NK013';
  end if;
  if v_phone is not null and char_length(v_phone) not in (10, 11) then
    raise exception 'invalid phone' using errcode = 'NK014';
  end if;

  insert into public.profiles as p (user_id, birth_date, phone, updated_at)
  values (me, p_birth_date, v_phone, now())
  on conflict (user_id) do update
    set birth_date = excluded.birth_date, phone = excluded.phone, updated_at = excluded.updated_at;

  -- As linhas dela nas casas, travadas na ordem do id da casa, a mesma da delete_account_data: um "Salvar" ao
  -- mesmo tempo que a conta é apagada em outro aparelho espera, em vez de travar os dois.
  perform 1 from public.household_members m where m.user_id = me order by m.household_id for update;

  -- Um nome por pessoa: o mesmo em todas as casas dela (e só dela).
  with renamed as (
    update public.household_members m set display_name = v_name
      where m.user_id = me and m.display_name is distinct from v_name
      returning m.household_id
  )
  select coalesce(array_agg(r.household_id), '{}') into changed from renamed r;

  -- Nessas casas, a ficha de saúde dela também, na ordem do id da casa. Nome de outra ficha da casa: o seguinte
  -- livre até "<nome> 20" (o índice people_household_name_key é quem diz, também com outra pessoa renomeando
  -- ao mesmo tempo).
  for person in
    select p.id from public.people p
    where p.member_user_id = me and p.household_id = any (changed) and p.name is distinct from v_name
    order by p.household_id
  loop
    for n in 1..20 loop
      candidate := case when n = 1 then v_name else v_name || ' ' || n end;
      begin
        update public.people p set name = candidate where p.id = person;
        exit;
      exception when unique_violation then
        null;
      end;
    end loop;
    -- Os remédios mostram o nome da ficha (e os lembretes também).
    update public.medications md set person_name = p.name
      from public.people p
      where p.id = person and md.person_id = p.id and md.person_name is distinct from p.name;
  end loop;

  return jsonb_build_object('name', v_name, 'birth_date', p_birth_date, 'phone', v_phone);
end;
$$;

revoke execute on function public.save_my_profile(text, date, text) from public, anon, service_role;
grant execute on function public.save_my_profile(text, date, text) to authenticated;
