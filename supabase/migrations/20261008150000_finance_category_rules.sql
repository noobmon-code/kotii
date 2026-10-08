-- Consultor financeiro (beta): categorias que a pessoa escolhe para os
-- lançamentos do banco ("ajudar" a categorizar o que caiu em Outros). Valem
-- só para ela, na casa em que tem a liberação, e passam na frente da
-- categoria automática na tela e no retrato do Nuke (src/domain/bankRules.ts).
--
-- match_key diz a que a escolha vale:
--   p:tx-<id> / p:parc-<id>  uma compra só (a chave estável da compra);
--   doc:<hash>               todo PIX ou transferência para a mesma pessoa
--                            (o hash do CPF que a função finance grava, nunca o nome);
--   m:<texto>                toda compra com o mesmo nome de loja ou descrição
--                            (minúsculas, sem acento nem números).
--
-- Diferente de fin_transactions, aqui quem grava é o app (a própria pessoa).
-- Presa à liberação como os bancos: tirá-la ou sair da casa apaga as escolhas.

create table public.fin_category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  household_id uuid not null default public.current_household_id(),
  beta_feature text not null default 'finance' check (beta_feature = 'finance'),
  match_key text not null check (
    match_key ~ '^p:(tx|parc)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or match_key ~ '^doc:[0-9a-f]{64}$'
    or match_key ~ '^m:[a-z][a-z ]{0,79}$'
  ),
  category public.finance_category not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, household_id, match_key),
  foreign key (user_id, household_id, beta_feature)
    references public.beta_access (user_id, household_id, feature) on delete cascade
);

alter table public.fin_category_rules enable row level security;
revoke all on public.fin_category_rules from anon, authenticated;
grant select, insert, update, delete on public.fin_category_rules to authenticated;
grant all on public.fin_category_rules to service_role;

-- Só a dona, só na casa aberta e com a liberação; não dá para gravar em nome de outra pessoa ou casa.
create policy "own finance category rules" on public.fin_category_rules for all to authenticated
  using (
    user_id = (select auth.uid())
    and household_id = (select public.current_household_id())
    and (select public.has_beta('finance'))
  )
  with check (
    user_id = (select auth.uid())
    and household_id = (select public.current_household_id())
    and (select public.has_beta('finance'))
  );

-- Muitas escolhas não fazem sentido para uma pessoa; o limite segura um app com defeito em loop.
create function public.fin_category_rules_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.fin_category_rules r
      where r.user_id = new.user_id and r.household_id = new.household_id) >= 2000 then
    raise exception 'too many finance category rules' using errcode = '54000';
  end if;
  return new;
end;
$$;

create trigger fin_category_rules_cap
  before insert on public.fin_category_rules
  for each row execute function public.fin_category_rules_cap();
