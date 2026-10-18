import { assertEquals } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';

import { forgetReceiptRead, MAX_READ_LINES, receiptRead, saoPauloDay, saveReceiptRead } from './receiptRead.ts';

const KEY = '35261011222333000181650010000123451000012347';

Deno.test('saoPauloDay: o dia em São Paulo, não em UTC', () => {
  assertEquals(saoPauloDay('2026-10-10T01:30:00.000Z'), '2026-10-09');
  assertEquals(saoPauloDay('2026-10-10T03:00:00.000Z'), '2026-10-10');
  assertEquals(saoPauloDay('2026-10-10T22:30:00-03:00'), '2026-10-10');
  assertEquals(saoPauloDay(null), null);
  assertEquals(saoPauloDay('ontem'), null);
});

Deno.test('receiptRead: só dígitos válidos, nome aparado, dia AAAA-MM-DD e linhas limpas', () => {
  const read = receiptRead({
    householdId: 'h1',
    source: 'ai',
    accessKey: KEY.slice(0, 22) + ' ' + KEY.slice(22),
    cnpj: '11.222.333/0001-81',
    storeName: '  ATACADAO   MOOCA ',
    purchasedOn: '2026-10-09',
    lines: [
      { description: '  LEITE   ITALAC 1L ', unit: 'un', unit_price: 4.59 },
      { description: '   ', unit: 'un', unit_price: 1 },
      { description: 'SEM PRECO', unit: 'un', unit_price: Number.NaN },
    ],
  });
  assertEquals(read, {
    household_id: 'h1',
    source: 'ai',
    access_key: KEY,
    store_cnpj: '11222333000181',
    store_name: 'ATACADAO MOOCA',
    purchased_on: '2026-10-09',
    lines: [{ description: 'LEITE ITALAC 1L', unit: 'un', unit_price: 4.59 }],
  });
});

Deno.test('receiptRead: chave, CNPJ, nome e dia que não servem ficam vazios', () => {
  const read = receiptRead({
    householdId: 'h1',
    source: 'qrcode',
    accessKey: '123',
    cnpj: '1122233300018',
    storeName: '   ',
    purchasedOn: '09/10/2026',
    lines: Array.from({ length: MAX_READ_LINES + 5 }, (_, i) => ({ description: `ITEM ${i}`, unit: 'un', unit_price: 1 })),
  });
  assertEquals([read.access_key, read.store_cnpj, read.store_name, read.purchased_on], [null, null, null, null]);
  assertEquals(read.lines.length, MAX_READ_LINES);
});

function fakeServer(result: { data: unknown; error: unknown } | Error) {
  const calls: unknown[][] = [];
  const db = {
    from(table: string) {
      calls.push(['from', table]);
      const chain = {
        insert(row: unknown) {
          calls.push(['insert', row]);
          return chain;
        },
        select(columns: string) {
          calls.push(['select', columns]);
          return chain;
        },
        single() {
          return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
        },
        delete() {
          calls.push(['delete']);
          return chain;
        },
        eq(column: string, value: unknown) {
          calls.push(['eq', column, value]);
          return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
        },
      };
      return chain;
    },
  };
  return { calls, factory: () => db as unknown as SupabaseClient };
}

const READ = receiptRead({ householdId: 'h1', source: 'qrcode', accessKey: KEY, cnpj: '11222333000181', storeName: 'X', purchasedOn: '2026-10-09', lines: [] });

Deno.test('saveReceiptRead grava e devolve o id', async () => {
  const server = fakeServer({ data: { id: 'r1' }, error: null });
  assertEquals(await saveReceiptRead(server.factory, READ), 'r1');
  assertEquals(server.calls, [['from', 'receipt_reads'], ['insert', READ], ['select', 'id']]);
});

Deno.test('saveReceiptRead: erro do banco, exceção ou chave secreta faltando viram "sem leitura"', async () => {
  assertEquals(await saveReceiptRead(fakeServer({ data: null, error: { code: '42P01' } }).factory, READ), null);
  assertEquals(await saveReceiptRead(fakeServer(new Error('rede')).factory, READ), null);
  assertEquals(
    await saveReceiptRead(() => {
      throw new Error('Falta a chave do Supabase');
    }, READ),
    null,
  );
});

Deno.test('forgetReceiptRead apaga pelo id e nunca lança', async () => {
  const server = fakeServer({ data: null, error: null });
  await forgetReceiptRead(server.factory, 'r1');
  assertEquals(server.calls, [['from', 'receipt_reads'], ['delete'], ['eq', 'id', 'r1']]);
  await forgetReceiptRead(fakeServer(new Error('rede')).factory, 'r1');
});
