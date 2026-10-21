import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchReceiptItems } from '../receipts';

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
jest.mock('@/lib/supabase', () => ({
  supabase: {},
  unwrap: (r: { data: unknown; error: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  },
}));

const row = {
  id: 'i1',
  receipt_id: 'r1',
  position: 0,
  raw_description: 'CAF TORR MOIDO 3COR 500G',
  suggested_name: 'Café Torrado e Moído 3 Corações 500g',
  suggested_category: 'cafe_cha',
  product_id: null,
  quantity: 1,
  unit: 'un',
  unit_price: 18.9,
  total_price: 18.9,
};

/**
 * Um banco de mentira para os itens da nota: guarda as colunas de cada leitura e responde como o banco com a
 * coluna do item genérico (`hasGeneric`) ou como o de antes dela, que recusa a leitura que fala dela.
 */
function fakeDb(hasGeneric: boolean, failure?: { code?: string; message: string }) {
  const reads: string[] = [];
  const db = {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          order: async (by: string) => {
            reads.push(columns);
            expect([table, column, value, by]).toEqual(['receipt_items', 'receipt_id', 'r1', 'position']);
            if (failure) return { data: null, error: failure };
            if (columns.includes('generic_name') && !hasGeneric) {
              return { data: null, error: { code: '42703', message: 'column receipt_items.generic_name does not exist' } };
            }
            return { data: [columns.includes('generic_name') ? { ...row, generic_name: 'café em pó' } : row], error: null };
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  return { db, reads };
}

describe('fetchReceiptItems', () => {
  it('lê os itens com o item genérico da leitura por foto', async () => {
    const { db, reads } = fakeDb(true);
    expect(await fetchReceiptItems('r1', db)).toEqual([{ ...row, generic_name: 'café em pó' }]);
    expect(reads).toHaveLength(1);
  });

  it('banco de antes da coluna: lê de novo sem ela, e a revisão fica como era', async () => {
    const { db, reads } = fakeDb(false);
    const [item] = await fetchReceiptItems('r1', db);
    expect(item).toEqual(row);
    expect(item.generic_name).toBeUndefined();
    expect(reads.map((columns) => columns.includes('generic_name'))).toEqual([true, false]);
  });

  it('outro erro (sem internet, outra coluna) continua sendo erro, sem segunda tentativa', async () => {
    const offline = { message: 'TypeError: Network request failed' };
    const { db, reads } = fakeDb(true, offline);
    await expect(fetchReceiptItems('r1', db)).rejects.toEqual(offline);
    expect(reads).toHaveLength(1);
    const other = { code: '42703', message: 'column receipt_items.suggested_name does not exist' };
    await expect(fetchReceiptItems('r1', fakeDb(true, other).db)).rejects.toEqual(other);
  });
});
