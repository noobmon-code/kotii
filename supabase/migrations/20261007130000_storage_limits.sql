-- Arquivos: só fotos, de até 5 MB, e sempre na pasta da casa.
--
-- Os buckets não tinham limite de tamanho nem de tipo: a política só
-- confere a pasta, então qualquer morador subia qualquer arquivo de
-- qualquer tamanho. O app manda JPEG reduzido (até ~3,7 MB, o que as
-- funções de leitura aceitam); 5 MB dá folga.
--
-- E as colunas que apontam para arquivos (exames, treinos, dietas,
-- aparelhos, documentos e as fotos das notas) passam a ter o mesmo check
-- que a foto do item da lista já tinha: <casa>/<arquivo>, sem subpasta. A
-- RLS do storage já impedia ler a pasta de outra casa; o check deixa o dado
-- coerente com a limpeza da casa apagada, que só olha a pasta dela.

update storage.buckets
  set file_size_limit = 5 * 1024 * 1024,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  where id in ('receipts', 'health', 'documents');

/** O caminho é um arquivo direto na pasta da casa (<casa>/<arquivo>). */
create function public.is_household_file(p_path text, p_household_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_path like p_household_id::text || '/%' and p_path not like '%/%/%' and p_path <> p_household_id::text || '/';
$$;

/** Todos os caminhos estão na pasta da casa (lista vazia vale). */
create function public.are_household_files(p_paths text[], p_household_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (
    select 1 from unnest(coalesce(p_paths, '{}'::text[])) as f (path)
    where not public.is_household_file(f.path, p_household_id)
  );
$$;

revoke execute on function public.is_household_file(text, uuid), public.are_household_files(text[], uuid) from public, anon;
grant execute on function public.is_household_file(text, uuid), public.are_household_files(text[], uuid) to authenticated, service_role;

alter table public.exams add constraint exams_file_paths_in_household
  check (public.are_household_files(file_paths, household_id));
alter table public.workout_plans add constraint workout_plans_file_paths_in_household
  check (public.are_household_files(file_paths, household_id));
alter table public.diet_plans add constraint diet_plans_file_paths_in_household
  check (public.are_household_files(file_paths, household_id));
alter table public.equipment add constraint equipment_file_paths_in_household
  check (public.are_household_files(file_paths, household_id));
alter table public.documents add constraint documents_file_paths_in_household
  check (public.are_household_files(file_paths, household_id));
alter table public.receipts add constraint receipts_image_path_in_household
  check (image_path is null or public.is_household_file(image_path, household_id));
alter table public.receipts add constraint receipts_extra_image_paths_in_household
  check (public.are_household_files(extra_image_paths, household_id));
