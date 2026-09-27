-- Marcações feitas sem internet chegam atrasadas. Cada item tem uma versão
-- que o banco aumenta a cada marcação; o app só grava se o item ainda está na
-- versão que ele viu no toque. Assim uma marcação que ficou na fila não passa
-- por cima de outra que alguém fez enquanto isso — sem depender do relógio
-- dos celulares.

alter table public.shopping_list_items add column toggle_version integer not null default 0;

create function public.bump_list_toggle_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.checked_at is distinct from old.checked_at then
    new.toggle_version := old.toggle_version + 1;
  end if;
  return new;
end;
$$;

create trigger shopping_list_items_bump_toggle_version
  before update on public.shopping_list_items
  for each row execute function public.bump_list_toggle_version();
