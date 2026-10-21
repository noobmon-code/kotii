-- Leitura por foto: o item genérico de cada linha da nota ("café em pó" para
-- "CAF TORR MOIDO 3COR 500G", "aparelho de barbear" para "GILLETTE
-- APARELHO"), que a IA lê na mesma chamada que já lê a foto. Serve só à
-- revisão da nota, que o usa como mais um nome da linha para casar com a
-- lista de compras (src/domain/listLinks.ts). Fica na linha da casa, com a RLS
-- dela; não vai para receipt_reads nem para os preços compartilhados. Nulo na
-- nota do QR, na manual e na leitura que não soube dizer.
--
-- Ordem: a função parse-receipt grava a coluna e, publicada antes desta
-- migração, grava as linhas sem ela (PGRST204); o app lê a coluna e, sem ela
-- (42703), lê como antes. Qualquer ordem de publicação funciona.

alter table public.receipt_items
  add column generic_name text
    constraint receipt_items_generic_name_check check (char_length(generic_name) between 1 and 60);

comment on column public.receipt_items.generic_name is
  'Item sem marca nem tamanho lido pela IA na foto (ex.: café em pó); só para casar a nota com a lista de compras.';
