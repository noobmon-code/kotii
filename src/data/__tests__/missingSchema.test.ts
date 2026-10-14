import { describe, expect, it } from '@jest/globals';

import { isMissingFunction, isMissingTable } from '../missingSchema';

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
