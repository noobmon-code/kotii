-- Casa: aparelhos (garantia, fotos, manutenção recorrente via tarefas) e
-- documentos da família com validade e aviso de renovação.

-- =============================================================================
-- Aparelhos e bens da casa
-- =============================================================================

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category text not null default 'outros' check (category in (
    'eletrodomestico', 'climatizacao', 'eletronico', 'veiculo', 'hidraulica',
    'eletrica', 'seguranca', 'moveis', 'outros'
  )),
  brand text,
  model text,
  serial_number text,
  location text,
  purchased_on date,
  price numeric(12, 2) check (price >= 0),
  store text,
  warranty_until date,
  notes text,
  -- Nota de compra, certificado de garantia, manual, etiqueta com o modelo.
  file_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (id, household_id)
);
create index equipment_household_warranty_idx on public.equipment (household_id, warranty_until);

-- Manutenção é uma tarefa recorrente ligada ao aparelho (reaproveita
-- recorrência, responsável, conclusão e histórico das tarefas).
alter table public.chores add column equipment_id uuid;
alter table public.chores
  add foreign key (equipment_id, household_id)
  references public.equipment (id, household_id) on delete cascade;
create index chores_equipment_idx on public.chores (equipment_id) where equipment_id is not null;

-- =============================================================================
-- Documentos: de uma pessoa (RG, CNH, passaporte...) ou da casa (seguro,
-- contrato, IPTU). person_id nulo = documento da casa.
-- =============================================================================

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.current_household_id()
    references public.households (id) on delete cascade,
  person_id uuid,
  kind text not null default 'outro' check (kind in (
    'rg', 'cpf', 'cnh', 'passaporte', 'titulo_eleitor', 'certidao', 'carteira_trabalho',
    'plano_saude', 'veiculo', 'imovel', 'contrato', 'seguro', 'imposto', 'outro'
  )),
  title text not null check (length(trim(title)) > 0),
  number text,
  issued_on date,
  expires_on date,
  -- Quantos dias antes do vencimento começar a avisar.
  remind_days integer not null default 30 check (remind_days between 0 and 365),
  notes text,
  file_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (person_id, household_id)
    references public.people (id, household_id) on delete cascade
);
create index documents_household_expires_idx on public.documents (household_id, expires_on);

-- =============================================================================
-- RLS
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['equipment', 'documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "household members manage %1$s" on public.%1$I for all to authenticated '
      'using (household_id = (select public.current_household_id())) '
      'with check (household_id = (select public.current_household_id()))',
      t
    );
  end loop;
end;
$$;

-- =============================================================================
-- Storage: fotos de documentos e de aparelhos em documents/<household_id>/<arquivo>
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "household members read documents files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select public.current_household_id())::text
  );

create policy "household members upload documents files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select public.current_household_id())::text
  );

create policy "household members delete documents files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select public.current_household_id())::text
  );
