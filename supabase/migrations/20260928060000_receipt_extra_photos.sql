-- Nota comprida em várias fotos: a primeira continua em image_path; as
-- outras, em ordem, aqui (até 5 a mais). Sair da casa apaga a pasta inteira.

alter table public.receipts
  add column extra_image_paths text[] not null default '{}' check (cardinality(extra_image_paths) <= 5);
