import { describe, expect, it } from '@jest/globals';

import { isMissingColumn, isMissingFunction, isMissingTable } from '../missingSchema';

// Como o PostgREST e o Postgres respondem quando a migração ainda não chegou ao banco.
const tableNotInCache = { code: 'PGRST205', message: "Could not find the table 'public.product_distinct_pairs' in the schema cache" };
const noRelation = { code: '42P01', message: 'relation "public.product_distinct_pairs" does not exist' };
const functionNotInCache = {
  code: 'PGRST202',
  message: 'Could not find the function public.merge_products(p_keep, p_merge) in the schema cache',
};
const noFunction = { code: '42883', message: 'function public.merge_products(uuid, uuid) does not exist' };

describe('isMissingTable', () => {
  it('reconhece a tabela que o banco ainda não tem, pelo PostgREST e pelo Postgres', () => {
    expect(isMissingTable(tableNotInCache)).toBe(true);
    expect(isMissingTable(noRelation)).toBe(true);
    expect(isMissingTable(tableNotInCache, 'product_distinct_pairs')).toBe(true);
  });

  it('sem o código, só pela mensagem que fala da tabela pedida', () => {
    const rebuilt = new Error(tableNotInCache.message);
    expect(isMissingTable(rebuilt, 'product_distinct_pairs')).toBe(true);
    expect(isMissingTable(new Error(noRelation.message), 'product_distinct_pairs')).toBe(true);
    expect(isMissingTable(rebuilt, 'family_events')).toBe(false);
    expect(isMissingTable(rebuilt)).toBe(false);
  });

  it('outros erros não são tabela faltando', () => {
    const denied = { code: '42501', message: 'new row violates row-level security policy for table "product_distinct_pairs"' };
    expect(isMissingTable(denied, 'product_distinct_pairs')).toBe(false);
    expect(isMissingTable({ message: 'TypeError: Network request failed' }, 'product_distinct_pairs')).toBe(false);
    expect(isMissingTable(functionNotInCache)).toBe(false);
    expect(isMissingTable(null)).toBe(false);
    expect(isMissingTable('PGRST205')).toBe(false);
  });
});

describe('isMissingFunction', () => {
  it('reconhece a função que o banco ainda não tem, pelo PostgREST e pelo Postgres', () => {
    expect(isMissingFunction(functionNotInCache)).toBe(true);
    expect(isMissingFunction(functionNotInCache, 'merge_products')).toBe(true);
    expect(isMissingFunction(noFunction)).toBe(true);
    expect(isMissingFunction(noFunction, 'merge_products')).toBe(true);
  });

  it('o 42883 de outra função, saído de dentro da que existe, não conta para a função pedida', () => {
    expect(isMissingFunction({ code: '42883', message: 'function normalize(text, unknown) does not exist' }, 'merge_products')).toBe(false);
  });

  it('sem o código, só pela mensagem que fala da função pedida', () => {
    expect(isMissingFunction(new Error(functionNotInCache.message), 'merge_products')).toBe(true);
    expect(isMissingFunction(new Error(functionNotInCache.message), 'confirm_receipt')).toBe(false);
    expect(isMissingFunction(new Error(functionNotInCache.message))).toBe(false);
  });

  it('outros erros não são função faltando', () => {
    expect(isMissingFunction({ code: 'P0002', message: 'product not found' }, 'merge_products')).toBe(false);
    expect(isMissingFunction({ code: '42501', message: 'permission denied for function merge_products' }, 'merge_products')).toBe(false);
    expect(isMissingFunction(tableNotInCache)).toBe(false);
    expect(isMissingFunction(undefined)).toBe(false);
  });
});

describe('isMissingColumn', () => {
  // A "Marca preferida" da lista (brand_preferred) e o item genérico da leitura por foto (generic_name).
  const noBrand = { code: '42703', message: 'column shopping_list_items.brand_preferred does not exist' };
  const brandNotInCache = {
    code: 'PGRST204',
    message: "Could not find the 'brand_preferred' column of 'shopping_list_items' in the schema cache",
  };
  const noGeneric = { code: '42703', message: 'column receipt_items.generic_name does not exist' };
  const genericNotInCache = { code: 'PGRST204', message: "Could not find the 'generic_name' column of 'receipt_items' in the schema cache" };

  it('reconhece a coluna que o banco ainda não tem, na leitura (Postgres) e na gravação (PostgREST)', () => {
    expect(isMissingColumn(noBrand, 'brand_preferred')).toBe(true);
    expect(isMissingColumn(brandNotInCache, 'brand_preferred')).toBe(true);
    expect(isMissingColumn(noGeneric, 'generic_name')).toBe(true);
    expect(isMissingColumn(genericNotInCache, 'generic_name')).toBe(true);
  });

  it('sem o código, pela mensagem que fala da coluna', () => {
    expect(isMissingColumn(new Error(noBrand.message), 'brand_preferred')).toBe(true);
    expect(isMissingColumn(new Error(brandNotInCache.message), 'brand_preferred')).toBe(true);
    expect(isMissingColumn(new Error(genericNotInCache.message), 'generic_name')).toBe(true);
  });

  it('só a coluna pedida: outra que falte é erro de verdade', () => {
    expect(isMissingColumn({ code: '42703', message: 'column shopping_list_items.nome does not exist' }, 'brand_preferred')).toBe(false);
    expect(isMissingColumn({ code: '42703', message: 'column receipt_items.suggested_name does not exist' }, 'generic_name')).toBe(false);
    expect(isMissingColumn(noGeneric, 'stock_count')).toBe(false);
    expect(isMissingColumn(noBrand, 'generic_name')).toBe(false);
    // Uma coluna cujo nome contém o pedido não é ele.
    expect(isMissingColumn({ code: '42703', message: 'column receipt_items.generic_name_v2 does not exist' }, 'generic_name')).toBe(false);
    // O cache sem a tabela não é a coluna faltando.
    expect(isMissingColumn({ message: "Could not find the table 'public.generic_name' in the schema cache" }, 'generic_name')).toBe(false);
  });

  it('outros erros com a coluna não são coluna faltando', () => {
    expect(
      isMissingColumn({ code: '23502', message: 'null value in column "brand_preferred" of relation "shopping_list_items" violates not-null constraint' }, 'brand_preferred'),
    ).toBe(false);
    expect(isMissingColumn({ code: '23514', message: 'new row violates check constraint "receipt_items_generic_name_check"' }, 'generic_name')).toBe(
      false,
    );
    expect(isMissingColumn({ message: 'TypeError: Network request failed' }, 'brand_preferred')).toBe(false);
    expect(isMissingColumn(null, 'generic_name')).toBe(false);
  });
});
