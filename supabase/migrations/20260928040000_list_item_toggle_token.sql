-- Marcações feitas sem internet chegam atrasadas. Cada marcação troca o
-- "selo" do item (toggle_token, um uuid novo); o app só grava se o item ainda
-- tem o selo que ele viu no toque. Assim uma marcação que ficou na fila não
-- passa por cima de outra que alguém fez enquanto isso — sem relógio de
-- celular e sem número que dois aparelhos possam repetir.

alter table public.shopping_list_items add column toggle_token uuid not null default gen_random_uuid();

-- Marcação que não trouxe selo novo (outra tela, versão antiga do app) ganha um.
create function public.renew_list_toggle_token()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.checked_at is distinct from old.checked_at and new.toggle_token = old.toggle_token then
    new.toggle_token := gen_random_uuid();
  end if;
  return new;
end;
$$;

create trigger shopping_list_items_renew_toggle_token
  before update on public.shopping_list_items
  for each row execute function public.renew_list_toggle_token();
