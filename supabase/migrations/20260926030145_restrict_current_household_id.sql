-- current_household_id() só faz sentido para usuário logado (sem login retorna
-- null). Tira o acesso anônimo à RPC; policies e defaults rodam como
-- authenticated, que mantém o acesso.
revoke execute on function public.current_household_id() from public, anon;
grant execute on function public.current_household_id() to authenticated, service_role;
