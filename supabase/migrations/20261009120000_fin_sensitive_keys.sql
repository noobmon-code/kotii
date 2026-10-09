-- Consultor financeiro (beta): o sigilo de Saúde escolhido pela pessoa não
-- volta atrás. Uma compra que ela pôs em Saúde (ela ou as parecidas) só vai
-- somada para a IA. Antes, trocar a categoria de novo ou desfazer a escolha
-- reescrevia ou apagava a regra e, com ela, o sigilo: o app olhava só a
-- categoria atual. Agora cada match_key que um dia foi Saúde fica marcada
-- aqui, e o app trata como sensível toda compra que casa com uma marca
-- (src/domain/bankRules.ts, chosenSensitive).
--
-- Quem grava é o gatilho de fin_category_rules, não o app: a pessoa só lê as
-- marcas, e trocar ou apagar a regra não apaga a marca. Presa à liberação
-- como as regras: tirá-la ou sair da casa apaga as marcas.
--
-- "Só esta" grava a regra com a chave do lançamento (p:tx-<id>), que muda
-- quando o previsto vira lançado ou o banco é reconectado. Por isso a regra
-- leva também a chave das parecidas da compra (similar_key), e Saúde marca as
-- duas: o sigilo segue a loja ou a pessoa. Na dúvida, marca (as outras
-- compras dali também só vão somadas; a categoria delas não muda).

alter table public.fin_category_rules
  add column similar_key text check (
    similar_key is null
    or similar_key ~ '^doc:[0-9a-f]{64}$'
    or similar_key ~ '^m:[a-z][a-z ]{0,79}$'
  );

create table public.fin_sensitive_keys (
  user_id uuid not null,
  household_id uuid not null,
  beta_feature text not null default 'finance' check (beta_feature = 'finance'),
  match_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, household_id, match_key),
  foreign key (user_id, household_id, beta_feature)
    references public.beta_access (user_id, household_id, feature) on delete cascade
);

alter table public.fin_sensitive_keys enable row level security;
revoke all on public.fin_sensitive_keys from anon, authenticated;
grant select on public.fin_sensitive_keys to authenticated;
grant all on public.fin_sensitive_keys to service_role;

-- Só a dona, só na casa aberta e com a liberação; e só para ler.
create policy "own finance sensitive keys" on public.fin_sensitive_keys for select to authenticated
  using (
    user_id = (select auth.uid())
    and household_id = (select public.current_household_id())
    and (select public.has_beta('finance'))
  );

-- A regra que põe em Saúde deixa a marca na mesma transação. security definer:
-- a pessoa não grava em fin_sensitive_keys, e a linha da regra já passou pela
-- RLS de fin_category_rules (dona, casa aberta, liberação). O limite segura um
-- app com defeito em loop, como o das regras; acima dele a escolha de Saúde é
-- recusada, em vez de ficar sem a marca.
create function public.fin_mark_sensitive_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  missing text[];
begin
  if new.category <> 'saude' then
    return new;
  end if;
  select coalesce(array_agg(distinct mk), '{}') into missing
  from unnest(array_remove(array[new.match_key, new.similar_key], null)) as mk
  where not exists (
    select 1 from public.fin_sensitive_keys k
    where k.user_id = new.user_id and k.household_id = new.household_id and k.match_key = mk
  );
  if cardinality(missing) > 0 and (
    select count(*) from public.fin_sensitive_keys k
    where k.user_id = new.user_id and k.household_id = new.household_id
  ) + cardinality(missing) > 2000 then
    raise exception 'too many finance sensitive keys' using errcode = '54000';
  end if;
  insert into public.fin_sensitive_keys (user_id, household_id, match_key)
  select new.user_id, new.household_id, mk from unnest(missing) as mk
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function public.fin_mark_sensitive_key() from public, anon, authenticated;

create trigger fin_category_rules_sensitive
  after insert or update of category, similar_key on public.fin_category_rules
  for each row execute function public.fin_mark_sensitive_key();

-- O que já está em Saúde hoje. As regras de antes não têm similar_key: a tela
-- do consultor grava de novo as de "Só esta" com a chave das parecidas da
-- compra, que só o app calcula (missingSimilarMarks em src/domain/bankRules.ts).
insert into public.fin_sensitive_keys (user_id, household_id, match_key)
select r.user_id, r.household_id, r.match_key
from public.fin_category_rules r
where r.category = 'saude'
on conflict do nothing;
