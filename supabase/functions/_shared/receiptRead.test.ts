import { assertEquals } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';

import { forgetReceiptRead, insertWithRead, MAX_DESCRIPTION, MAX_READ_LINES, receiptRead, saoPauloDay, saveReceiptRead } from './receiptRead.ts';

const KEY = '35261011222333000181650010000123451000012341';

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

Deno.test('receiptRead: chave e CNPJ com o tamanho certo, mas que não passam no verificador, ficam vazios', () => {
  const read = receiptRead({
    householdId: 'h1',
    source: 'ai',
    accessKey: `${KEY.slice(0, 43)}7`,
    cnpj: '11.222.333/0001-82',
    storeName: 'X',
    purchasedOn: '2026-10-09',
    lines: [],
  });
  assertEquals([read.access_key, read.store_cnpj], [null, null]);
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

Deno.test('receiptRead: descrição comprida é cortada em 200 letras', () => {
  const read = receiptRead({
    householdId: 'h1',
    source: 'ai',
    accessKey: null,
    cnpj: null,
    storeName: null,
    purchasedOn: null,
    lines: [{ description: 'A'.repeat(199) + ' ' + 'B'.repeat(500), unit: 'un', unit_price: 1 }],
  });
  assertEquals(read.lines[0].description, 'A'.repeat(199));
  assertEquals(MAX_DESCRIPTION, 200);
});

Deno.test('insertWithRead: grava com a leitura quando dá', async () => {
  const tries: (string | null)[] = [];
  let dropped = 0;
  const result = await insertWithRead((readId) => {
    tries.push(readId);
    return Promise.resolve({ data: { id: 'n1' }, error: null });
  }, 'r1', () => Promise.resolve(void dropped++));
  assertEquals(result, { data: { id: 'n1' }, error: null, readId: 'r1' });
  assertEquals([tries, dropped], [['r1'], 0]);
});

Deno.test('insertWithRead: leitura recusada (23503, a pessoa trocou de casa) apaga a leitura e grava a nota sem ela', async () => {
  const tries: (string | null)[] = [];
  let dropped = 0;
  const result = await insertWithRead((readId) => {
    tries.push(readId);
    return Promise.resolve(readId ? { data: null, error: { code: '23503' } } : { data: { id: 'n1' }, error: null });
  }, 'r1', () => Promise.resolve(void dropped++));
  assertEquals(result, { data: { id: 'n1' }, error: null, readId: null });
  assertEquals([tries, dropped], [['r1', null], 1]);
});

Deno.test('insertWithRead: outro erro, ou sem leitura, volta como veio, sem nova tentativa', async () => {
  for (const [readId, code] of [['r1', '23505'], [null, '23503']] as const) {
    const tries: (string | null)[] = [];
    const result = await insertWithRead((id) => {
      tries.push(id);
      return Promise.resolve({ data: null, error: { code } });
    }, readId, () => Promise.resolve());
    assertEquals(result, { data: null, error: { code }, readId });
    assertEquals(tries, [readId]);
  }
});
