-- Mais categorias do financeiro (espelho de src/domain/finance.ts e de
-- supabase/functions/_shared/categories.ts): Alimentação (comer fora e
-- delivery, que antes iam para Lazer), Cuidados pessoais, Viagem (antes em
-- Lazer), Compras e Taxas e juros. Só amplia a lista: nada já gravado muda.

alter domain public.finance_category drop constraint finance_category_check;
alter domain public.finance_category add constraint finance_category_check check (value in (
  'mercado', 'alimentacao', 'casa', 'moradia', 'contas', 'assinaturas', 'saude', 'cuidados',
  'educacao', 'transporte', 'viagem', 'pet', 'lazer', 'compras', 'taxas', 'outros'
));
