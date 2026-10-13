-- Prestadores e consertos: quem faz serviço para a casa (diarista,
-- eletricista, técnico da máquina de lavar…) e o que cada um já fez. O contato
-- ficava nas conversas do WhatsApp de uma pessoa só; aqui a casa toda acha o
-- telefone, quanto foi cobrado da última vez e em qual aparelho mexeram.
--
-- Nomes e telefones são de gente de fora da casa: ficam só nestas duas
-- tabelas, com a mesma regra de acesso de tudo o que é da casa. O app não os
-- manda para o Nuke nem os guarda no aparelho para uso sem internet.

create table public.service_providers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  -- O que faz (PROVIDER_TRADES em src/domain/providers.ts; um teste do app
  -- confere que as duas listas são iguais).
  trade text not null default 'outros' check (trade in (
    'diarista', 'eletricista', 'encanador', 'tecnico', 'ar_condicionado', 'pintor', 'pedreiro',
    'marceneiro', 'jardineiro', 'chaveiro', 'dedetizacao', 'mecanico', 'vidraceiro', 'montador', 'outros'
  )),
  -- Como a pessoa digitou.
  phone text check (length(trim(phone)) between 1 and 40),
  -- Só os dígitos, calculados pelo app (normalizePhone): com 55 e DDD quando o
  -- número brasileiro está completo. É dele que saem os links de WhatsApp e
  -- de ligar; telefone que o app não reconheceu fica sem.
  phone_digits text check (phone_digits ~ '^[0-9]{8,15}$'),
  notes text check (length(notes) <= 500),
  -- "Recomendo": sim ou não, sem estrelas.
  recommended boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  constraint service_providers_digits_of_phone check (phone_digits is null or phone is not null)
);
create index service_providers_household_idx on public.service_providers (household_id);

alter table public.service_providers enable row level security;
-- Permissões escritas aqui, sem contar com o padrão do projeto: a partir de
-- 30/10/2026 o Supabase deixa de abrir as tabelas novas do schema public para
-- a API, e esta migração pode ser aplicada depois dessa data (as tabelas que
-- já existem continuam com as permissões delas). Sem isto, o app receberia
-- "permission denied" em toda leitura e gravação. Quem não entrou não tem nada.
revoke all on public.service_providers from anon, authenticated;
grant select, insert, update, delete on public.service_providers to authenticated;
grant all on public.service_providers to service_role;
create policy "household members manage service providers" on public.service_providers for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));

-- Um serviço feito (visita, conserto), num aparelho da casa ou não.
create table public.service_jobs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  provider_id uuid not null,
  equipment_id uuid,
  done_on date not null,
  -- O que foi feito.
  description text not null check (length(trim(description)) between 1 and 200),
  -- Nulo: valor não informado. Zero vale (voltou e não cobrou).
  amount numeric(12, 2) check (amount >= 0),
  -- Garantia do serviço (não a do aparelho).
  warranty_until date,
  notes text check (length(notes) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint service_jobs_warranty check (warranty_until is null or warranty_until >= done_on),
  -- Com a casa na chave: o serviço é sempre da mesma casa de quem fez e do
  -- aparelho. Apagar o prestador apaga o histórico dele (o app avisa antes).
  foreign key (provider_id, household_id)
    references public.service_providers (id, household_id) on delete cascade,
  -- Aparelho apagado: o serviço continua no histórico de quem fez, sem o aparelho.
  foreign key (equipment_id, household_id)
    references public.equipment (id, household_id) on delete set null (equipment_id)
);
create index service_jobs_household_done_idx on public.service_jobs (household_id, done_on desc);
create index service_jobs_provider_idx on public.service_jobs (provider_id, done_on desc);
create index service_jobs_equipment_idx on public.service_jobs (equipment_id, done_on desc) where equipment_id is not null;

alter table public.service_jobs enable row level security;
-- As mesmas permissões escritas de service_providers, pelo mesmo motivo.
revoke all on public.service_jobs from anon, authenticated;
grant select, insert, update, delete on public.service_jobs to authenticated;
grant all on public.service_jobs to service_role;
create policy "household members manage service jobs" on public.service_jobs for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));
