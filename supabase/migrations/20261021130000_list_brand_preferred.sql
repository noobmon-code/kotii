-- "Marca preferida" no item da lista: a pessoa ligou nos detalhes do item que
-- quer aquela marca (a do produto dele). Aí a revisão da nota só tira o item
-- da lista com esse produto, a ligação aprendida ou o mesmo nome; sem ela,
-- qualquer marca do mesmo item serve (domain/sameItem).
--
-- Precisa ser uma escolha guardada, e não deduzida do nome: os itens que já
-- estão nas listas com o nome de um produto ("Leite IL Desnatado", posto por
-- "Comprados recentemente" antes de a lista ficar sem marca) não foram uma
-- escolha de marca e continuam casando com qualquer marca. Por isso o padrão
-- é false, para eles e para o que versões antigas do app gravam sem a coluna.
--
-- A tabela já tem RLS por casa (household_id = current_household_id()) e os
-- grants de tabela inteira: a coluna nova vale para quem já lia e gravava o
-- item, sem política nova.

alter table public.shopping_list_items
  add column brand_preferred boolean not null default false;
