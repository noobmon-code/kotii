-- Marcações feitas sem internet chegam atrasadas. Cada item guarda a hora da
-- última marcação (a do toque, não a da chegada) e uma marcação mais antiga
-- não passa por cima de uma mais nova de outra pessoa.

alter table public.shopping_list_items add column toggled_at timestamptz;

create function public.skip_stale_list_toggle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.toggled_at is not null and old.toggled_at is not null and new.toggled_at < old.toggled_at then
    return null;
  end if;
  return new;
end;
$$;

create trigger shopping_list_items_skip_stale_toggle
  before update on public.shopping_list_items
  for each row execute function public.skip_stale_list_toggle();
