-- Despesas médicas para o Imposto de Renda: gastos avulsos e contas (plano de
-- saúde) marcados como dedutíveis, com quem atendeu (nome e CPF/CNPJ, só
-- dígitos) e, nos gastos, o paciente. O relatório do ano sai disso no app.

alter table public.expenses
  add column deductible boolean not null default false,
  add column provider_name text,
  add column provider_doc text check (provider_doc ~ '^([0-9]{11}|[0-9]{14})$'),
  add column patient_id uuid;
alter table public.expenses
  add foreign key (patient_id, household_id)
  references public.people (id, household_id) on delete set null (patient_id);
create index expenses_deductible_idx on public.expenses (household_id, spent_on) where deductible;

alter table public.bills
  add column deductible boolean not null default false,
  add column provider_name text,
  add column provider_doc text check (provider_doc ~ '^([0-9]{11}|[0-9]{14})$');
