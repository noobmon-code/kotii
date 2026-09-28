-- Detalhes do item da lista: descrição, prioridade e foto do produto certo.
--
-- A foto fica no bucket "documents", direto na pasta da casa
-- (documents/<casa>/item-<chave>.jpg), como as fotos de aparelhos: as
-- políticas do bucket e a limpeza da casa apagada já valem para ela. O nome
-- começa com item-: a lixeira abaixo só apaga fotos de item, nunca a de uma
-- nota ou de um documento.

alter table public.shopping_list_items
  add column notes text check (notes is null or length(notes) <= 500),
  add column priority text not null default 'normal'
    check (priority in ('normal', 'urgente', 'promocao', 'se_der')),
  add column photo_path text
    check (photo_path is null or (photo_path like (household_id::text || '/item-%') and photo_path not like '%/%/%'));

-- ---------------------------------------------------------------------------
-- Lixeira de fotos: foto trocada ou de item que saiu da lista (removido,
-- carrinho limpo, lista apagada) entra aqui, e o app da casa apaga o arquivo
-- do storage (com a própria permissão) e a linha. Assim nenhum caminho de
-- apagar deixa foto para trás, nem precisa lembrar de apagar.

create table public.storage_trash (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  bucket text not null,
  path text not null,
  created_at timestamptz not null default now()
);
create index storage_trash_household_idx on public.storage_trash (household_id, id);

alter table public.storage_trash enable row level security;
create policy "household members read the photo trash" on public.storage_trash for select to authenticated
  using (household_id = (select public.current_household_id()));
create policy "household members empty the photo trash" on public.storage_trash for delete to authenticated
  using (household_id = (select public.current_household_id()));

create function public.trash_list_item_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.photo_path is null or (tg_op = 'UPDATE' and new.photo_path is not distinct from old.photo_path) then
    return null;
  end if;
  -- Casa sendo apagada: a limpeza da casa leva a pasta inteira.
  if not exists (select 1 from public.households h where h.id = old.household_id) then
    return null;
  end if;
  insert into public.storage_trash (household_id, bucket, path) values (old.household_id, 'documents', old.photo_path);
  return null;
end;
$$;

revoke all on function public.trash_list_item_photo() from public, anon, authenticated;

create trigger shopping_list_items_trash_photo
  after update of photo_path or delete on public.shopping_list_items
  for each row execute function public.trash_list_item_photo();
