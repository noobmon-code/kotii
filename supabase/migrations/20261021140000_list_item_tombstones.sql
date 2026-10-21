-- O item tirado da lista não volta pelo envio repetido de quem o pôs.
--
-- A fila da lista sem internet (src/data/market.ts) põe o item com um id
-- gerado no aparelho e manda de novo enquanto não recebe a resposta. Se a
-- tentativa que chegou só perdeu a resposta, o id repetido dá 23505 e o app
-- entende que o item já foi. Mas se, entre essa tentativa e o envio repetido,
-- alguém tirou o item da lista (tirar, "Limpar" o carrinho, a nota confirmada
-- que o levou), o id não existe mais e o envio repetido punha o item de volta,
-- como ainda por comprar. A fila guarda o envio no aparelho e manda quando o
-- app volta a ter conexão, então a janela dura dias.
--
-- Agora o banco lembra por 30 dias (bem mais do que a fila costuma esperar) o
-- id de cada item apagado e ignora, sem erro, a inclusão de um id que já foi
-- apagado (também quando a lista inteira foi apagada: antes o envio repetido
-- dava erro de chave e o app avisava que o item não foi para a lista). Para o app, também para as versões já instaladas, que gravam
-- direto na tabela, o envio repetido deu certo, e o item fica fora da lista.
--
-- Só o pôr da fila manda o id. Os outros caminhos (add_to_list, a reposição
-- de remédios) deixam o banco gerar um id novo, que nunca foi apagado.

-- Só o id e a hora: sem household_id, porque apagar uma casa apaga os itens
-- dela, e uma chave para a casa que está sendo apagada travaria a exclusão.
-- O id sozinho não diz nada de ninguém.
create table public.shopping_list_item_tombstones (
  id uuid primary key,
  deleted_at timestamptz not null default now()
);
create index shopping_list_item_tombstones_deleted_idx on public.shopping_list_item_tombstones (deleted_at);

-- Só os gatilhos abaixo leem e gravam: nenhum papel da API vê a tabela.
alter table public.shopping_list_item_tombstones enable row level security;
revoke all on table public.shopping_list_item_tombstones from public, anon, authenticated;

-- Um comando que apaga vários itens (o "Limpar", a nota confirmada, a lista
-- apagada) grava todos de uma vez.
create function public.remember_deleted_list_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.shopping_list_item_tombstones (id)
    select gone.id from gone_items gone
  on conflict (id) do nothing;
  return null;
end;
$$;

revoke all on function public.remember_deleted_list_items() from public, anon, authenticated;

create trigger shopping_list_items_remember_deleted
  after delete on public.shopping_list_items
  referencing old table as gone_items
  for each statement execute function public.remember_deleted_list_items();

-- Devolver null deixa a linha de fora sem erro: o insert responde como se
-- tivesse dado certo, sem linha nova.
--
-- Antes de olhar as lápides, a trava no item de mesmo id: se alguém o está
-- apagando agora, espera essa exclusão terminar, e a consulta seguinte (com a
-- foto nova do banco) já vê a lápide. Sem a trava, o envio repetido que chega
-- no meio de uma exclusão ainda não gravada não via a lápide e punha o item
-- de volta. Se o item está lá e ninguém o apaga, a trava só segura a exclusão
-- até o insert dar 23505, o "já foi" do app.
create function public.skip_deleted_list_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.shopping_list_items i where i.id = new.id for key share;
  if exists (select 1 from public.shopping_list_item_tombstones t where t.id = new.id) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.skip_deleted_list_item() from public, anon, authenticated;

create trigger shopping_list_items_skip_deleted
  before insert on public.shopping_list_items
  for each row execute function public.skip_deleted_list_item();

-- Esquecer o que passou de 30 dias. Roda uma vez por dia.
create function public.forget_list_item_tombstones()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.shopping_list_item_tombstones t
      where t.deleted_at < now() - interval '30 days'
      returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.forget_list_item_tombstones() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  perform cron.schedule('list-item-tombstones-cleanup', '53 4 * * *', 'select public.forget_list_item_tombstones()');
end;
$$;
