// Chaves de categoria em que a IA classifica os itens da nota.
// Espelho de src/domain/categories.ts (fonte da verdade); o teste
// src/domain/categories.test.ts falha se as duas listas divergirem.
export const CATEGORY_KEYS = [
  'hortifruti',
  'carnes',
  'peixes',
  'laticinios',
  'ovos',
  'padaria',
  'graos',
  'congelados',
  'frios',
  'doces',
  'snacks',
  'temperos',
  'oleos',
  'bebidas',
  'alcoolicas',
  'cafe_cha',
  'limpeza',
  'higiene',
  'papel',
  'bebe',
  'pet',
  'medicamentos',
  'suplementos',
  'primeiros_socorros',
  'outros',
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

// Categorias do financeiro (espelho de src/domain/finance.ts e do domínio
// finance_category no banco); o mesmo teste confere.
export const FINANCE_CATEGORY_KEYS = [
  'mercado',
  'alimentacao',
  'casa',
  'moradia',
  'contas',
  'assinaturas',
  'saude',
  'cuidados',
  'educacao',
  'transporte',
  'viagem',
  'pet',
  'lazer',
  'compras',
  'taxas',
  'outros',
] as const;

export type FinanceCategoryKey = (typeof FINANCE_CATEGORY_KEYS)[number];
