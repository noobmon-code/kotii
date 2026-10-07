-- Teto de navegadores inscritos por conta. Cada inscrição podia ter 200
-- avisos agendados, mas o número de inscrições por conta não tinha limite:
-- endereços inventados que casassem com a regra dos serviços de push, aos
-- milhares, fariam a send-push gastar tempo mandando lixo. Uma conta tem
-- até max_push_subscriptions() navegadores; passando disso, o que ficou
-- mais tempo sem abrir o app sai (e a agenda dele junto).

create function public.max_push_subscriptions()
returns int
language sql
immutable
set search_path = ''
as $$ select 10 $$;
revoke execute on function public.max_push_subscriptions() from public, anon;
grant execute on function public.max_push_subscriptions() to authenticated, service_role;

create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_timezone text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz text := 'America/Sao_Paulo';
  sub public.push_subscriptions;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_push_endpoint(p_endpoint) then
    raise exception 'invalid push endpoint' using errcode = '22023';
  end if;
  begin
    perform now() at time zone p_timezone;
    tz := p_timezone;
  exception when others then
    null;
  end;

  select * into sub from public.push_subscriptions s where s.endpoint = p_endpoint for update;
  if found and sub.user_id <> auth.uid() then
    delete from public.push_subscriptions s where s.id = sub.id;
    sub := null;
  end if;

  if sub.id is null then
    -- Navegador novo: os mais antigos além do teto saem.
    delete from public.push_subscriptions s
      where s.id in (
        select o.id from public.push_subscriptions o
        where o.user_id = auth.uid()
        order by o.updated_at desc, o.id
        offset public.max_push_subscriptions() - 1
      );
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, timezone)
    values (auth.uid(), p_endpoint, p_p256dh, p_auth, tz)
    returning * into sub;
    return sub.id;
  end if;

  update public.push_subscriptions s
     set p256dh = p_p256dh, auth = p_auth, timezone = tz, updated_at = now()
   where s.id = sub.id;
  if sub.timezone <> tz then
    -- Mudou de fuso: os avisos diários e semanais passam a tocar na hora de lá.
    update public.push_schedule p
       set next_at = public.push_next_at(p.repeat, p.fire_at, p.hour, p.minute, p.weekday, tz, now())
     where p.subscription_id = sub.id and p.repeat <> 'once';
  end if;
  return sub.id;
end;
$$;
