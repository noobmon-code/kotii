import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchReceiptItems, fetchStoreCodeMatches, insertReceiptItems } from '../receipts';

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

type Column = 'generic_name' | 'store_code' | 'pack_count';
const VALUES: Record<'generic_name' | 'store_code', string> = { generic_name: 'café em pó', store_code: '7896005800010' };

/**
 * Um banco de mentira para os itens da nota: guarda as colunas de cada leitura e responde como o banco que
 * tem as colunas recentes de `has`, recusando a leitura que fala de uma que ele não tem (a primeira delas,
 * como o Postgres).
 */
function fakeDb(has: Column[], failure?: { code?: string; message: string }) {
  const reads: string[] = [];
  const db = {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          order: async (by: string) => {
            reads.push(columns);
            expect([table, column, value, by]).toEqual(['receipt_items', 'receipt_id', 'r1', 'position']);
            if (failure) return { data: null, error: failure };
            const asked = columns.split(', ');
            const missing = (['generic_name', 'store_code', 'pack_count'] as const).find((c) => asked.includes(c) && !has.includes(c));
            if (missing) return { data: null, error: { code: '42703', message: `column receipt_items.${missing} does not exist` } };
            const extra = Object.fromEntries((['generic_name', 'store_code'] as const).filter((c) => asked.includes(c)).map((c) => [c, VALUES[c]]));
            return { data: [{ ...row, ...extra }], error: null };
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  return { db, reads };
}

const asks = (reads: string[], column: Column) => reads.map((columns) => columns.split(', ').includes(column));

describe('fetchReceiptItems', () => {
  it('lê os itens com o item genérico da leitura por foto e o código do produto na nota', async () => {
    const { db, reads } = fakeDb(['generic_name', 'store_code', 'pack_count']);
    expect(await fetchReceiptItems('r1', db)).toEqual([{ ...row, generic_name: 'café em pó', store_code: '7896005800010' }]);
    expect(reads).toHaveLength(1);
  });

  it('banco de antes das colunas recentes (item genérico, código e embalagem): lê de novo sem as que faltam, e a revisão fica como era', async () => {
    const { db, reads } = fakeDb([]);
    const [item] = await fetchReceiptItems('r1', db);
    expect(item).toEqual(row);
    expect(item.generic_name).toBeUndefined();
    expect(item.store_code).toBeUndefined();
    expect(asks(reads, 'generic_name')).toEqual([true, false, false, false]);
    expect(asks(reads, 'store_code')).toEqual([true, true, false, false]);
    expect(asks(reads, 'pack_count')).toEqual([true, true, true, false]);
  });

  it('banco com o item genérico e sem o código: lê sem o código, com o genérico', async () => {
    const { db, reads } = fakeDb(['generic_name', 'pack_count']);
    expect(await fetchReceiptItems('r1', db)).toEqual([{ ...row, generic_name: 'café em pó' }]);
    expect(asks(reads, 'store_code')).toEqual([true, false]);
    expect(asks(reads, 'generic_name')).toEqual([true, true]);
  });

  it('banco com o código e sem o item genérico: lê sem o genérico, com o código', async () => {
    const { db, reads } = fakeDb(['store_code', 'pack_count']);
    expect(await fetchReceiptItems('r1', db)).toEqual([{ ...row, store_code: '7896005800010' }]);
    expect(asks(reads, 'generic_name')).toEqual([true, false]);
    expect(asks(reads, 'store_code')).toEqual([true, true]);
  });

  it('banco sem pack_count (a embalagem ainda não migrada): lê sem ela, e a nota fica como era', async () => {
    const { db, reads } = fakeDb(['generic_name', 'store_code']);
    const [item] = await fetchReceiptItems('r1', db);
    expect(item).toEqual({ ...row, generic_name: 'café em pó', store_code: '7896005800010' });
    expect(item.pack_count).toBeUndefined();
    expect(asks(reads, 'pack_count')).toEqual([true, false]);
  });

  it('outro erro (sem internet, outra coluna) continua sendo erro, sem segunda tentativa', async () => {
    const offline = { message: 'TypeError: Network request failed' };
    const { db, reads } = fakeDb(['generic_name', 'store_code'], offline);
    await expect(fetchReceiptItems('r1', db)).rejects.toEqual(offline);
    expect(reads).toHaveLength(1);
    const other = { code: '42703', message: 'column receipt_items.suggested_name does not exist' };
    await expect(fetchReceiptItems('r1', fakeDb(['generic_name', 'store_code'], other).db)).rejects.toEqual(other);
  });
});

/** Um banco de mentira para gravar itens: recusa (PGRST204, como o PostgREST) a coluna recente que não tem. */
function fakeInsertDb(has: Column[], failure?: { code?: string; message: string }) {
  const inserts: Record<string, unknown>[][] = [];
  const db = {
    from: (table: string) => ({
      insert: async (batch: Record<string, unknown>[]) => {
        expect(table).toBe('receipt_items');
        inserts.push(batch);
        if (failure) return { error: failure };
        const missing = (['generic_name', 'store_code'] as const).find((c) => c in batch[0] && !has.includes(c));
        return missing
          ? { error: { code: 'PGRST204', message: `Could not find the '${missing}' column of 'receipt_items' in the schema cache` } }
          : { error: null };
      },
    }),
  } as unknown as SupabaseClient;
  return { db, inserts };
}

describe('insertReceiptItems', () => {
  const rows = [
    { receipt_id: 'r1', raw_description: 'LEITE ITALAC 1L', generic_name: null, store_code: '7898080640017' },
    { receipt_id: 'r1', raw_description: 'BANANA PRATA', generic_name: null, store_code: '250474' },
  ];
  const keys = (batch: Record<string, unknown>[]) => Object.keys(batch[0]).sort().join();

  it('grava as linhas com o código numa vez só', async () => {
    const { db, inserts } = fakeInsertDb(['generic_name', 'store_code']);
    expect(await insertReceiptItems(rows, db)).toBeNull();
    expect(inserts).toEqual([rows]);
  });

  it('falta o código: grava de novo sem ele', async () => {
    const { db, inserts } = fakeInsertDb(['generic_name']);
    expect(await insertReceiptItems(rows, db)).toBeNull();
    expect(inserts.map(keys)).toEqual(['generic_name,raw_description,receipt_id,store_code', 'generic_name,raw_description,receipt_id']);
  });

  it('falta o item genérico: grava de novo sem ele, com o código', async () => {
    const { db, inserts } = fakeInsertDb(['store_code']);
    expect(await insertReceiptItems(rows, db)).toBeNull();
    expect(inserts.map(keys)).toEqual(['generic_name,raw_description,receipt_id,store_code', 'raw_description,receipt_id,store_code']);
    expect(inserts[1].map((r) => r.store_code)).toEqual(['7898080640017', '250474']);
  });

  it('faltam os dois: uma tentativa sem cada um, e as linhas ficam como as de antes', async () => {
    const { db, inserts } = fakeInsertDb([]);
    expect(await insertReceiptItems(rows, db)).toBeNull();
    expect(inserts.map(keys)).toEqual([
      'generic_name,raw_description,receipt_id,store_code',
      'raw_description,receipt_id,store_code',
      'raw_description,receipt_id',
    ]);
  });

  it('outro erro (o check do código, a RLS) volta como veio, sem segunda gravação', async () => {
    for (const other of [
      { code: '23514', message: 'new row for relation "receipt_items" violates check constraint "receipt_items_store_code_check"' },
      { code: '42501', message: 'new row violates row-level security policy for table "receipt_items"' },
      { code: 'PGRST204', message: "Could not find the 'suggested_name' column of 'receipt_items' in the schema cache" },
    ]) {
      const { db, inserts } = fakeInsertDb(['generic_name', 'store_code'], other);
      expect(await insertReceiptItems(rows, db)).toEqual(other);
      expect(inserts).toHaveLength(1);
    }
  });
});

describe('fetchStoreCodeMatches', () => {
  const rpcDb = (reply: { data: unknown; error: unknown }) => {
    const calls: unknown[][] = [];
    const db = {
      rpc: async (...args: unknown[]) => {
        calls.push(args);
        return reply;
      },
    } as unknown as SupabaseClient;
    return { db, calls };
  };

  it('pergunta os códigos no mercado da nota', async () => {
    const { db, calls } = rpcDb({ data: [{ code: '250474', product_id: 'p1' }], error: null });
    expect(await fetchStoreCodeMatches('11222333000181', ['250474', '999'], db)).toEqual([{ code: '250474', product_id: 'p1' }]);
    expect(calls).toEqual([['match_store_codes', { p_store_cnpj: '11222333000181', p_codes: ['250474', '999'] }]]);
  });

  it('sem códigos, não pergunta', async () => {
    const { db, calls } = rpcDb({ data: [], error: null });
    expect(await fetchStoreCodeMatches(null, [], db)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('o banco de antes da função: nenhum código aprendido, sem erro para a pessoa', async () => {
    for (const missing of [
      { code: 'PGRST202', message: 'Could not find the function public.match_store_codes(p_codes, p_store_cnpj) in the schema cache' },
      { code: '42883', message: 'function public.match_store_codes(text, text[]) does not exist' },
    ]) {
      expect(await fetchStoreCodeMatches('11222333000181', ['250474'], rpcDb({ data: null, error: missing }).db)).toEqual([]);
    }
  });

  it('outro erro continua sendo erro', async () => {
    const offline = { message: 'TypeError: Network request failed' };
    await expect(fetchStoreCodeMatches(null, ['250474'], rpcDb({ data: null, error: offline }).db)).rejects.toEqual(offline);
  });
});
