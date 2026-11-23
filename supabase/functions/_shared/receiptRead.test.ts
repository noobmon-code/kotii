import { assertEquals } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  forgetReceiptRead,
  insertWithRead,
  MAX_DESCRIPTION,
  MAX_PACK_AMOUNT,
  MAX_PACK_OF,
  MAX_READ_LINES,
  readPack,
  receiptRead,
  saoPauloDay,
  saveReceiptRead,
} from './receiptRead.ts';

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

Deno.test('receiptRead: o código de barras só vai como os 14 dígitos de sharedGtin; outro valor deixa a linha sem ele', () => {
  const line = (gtin: unknown) => ({ description: 'LEITE ITALAC 1L', unit: 'un', unit_price: 4.59, gtin }) as { description: string; unit: string; unit_price: number; gtin?: string };
  const read = receiptRead({
    householdId: 'h1',
    source: 'qrcode',
    accessKey: KEY,
    cnpj: '11222333000181',
    storeName: 'ATACADAO',
    purchasedOn: '2026-10-09',
    lines: [
      line('07891000100103'),
      line('17891000100100'),
      // De 8 ou 12 dígitos (passa na gtin_key, mas pode ser o código interno do mercado).
      line('00000012345670'),
      line('00036000291452'),
      // Sem os zeros à frente, o verificador errado, a faixa da balança, o código interno, número, nada.
      line('7891000100103'),
      line('07891000100104'),
      line('02000000000008'),
      line('250474'),
      line(7891000100103),
      line(null),
      { description: 'SEM CODIGO', unit: 'un', unit_price: 1 },
    ],
  });
  assertEquals(read.lines.map((l) => l.gtin ?? '-'), ['07891000100103', '17891000100100', '-', '-', '-', '-', '-', '-', '-', '-', '-']);
  // A linha sem código de barras vale do mesmo jeito, e sem o campo.
  assertEquals(read.lines.length, 11);
  assertEquals(read.lines.filter((l) => 'gtin' in l).length, 2);
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

Deno.test('readPack: o tamanho da leitura estrita, só em "un" e dentro dos limites do check do banco', () => {
  assertEquals(readPack('CERV SKOL LT 350ML C/12', 'un'), { pack_unit: 'l', pack_amount: 4.2, pack_of: 12 });
  assertEquals(readPack('OVOS C/12', 'un'), { pack_unit: 'un', pack_amount: 12 });
  assertEquals(readPack('ARROZ CAMIL T1 5KG', 'un'), { pack_unit: 'kg', pack_amount: 5 });
  assertEquals(readPack('1 X 350ML', 'un'), { pack_unit: 'l', pack_amount: 0.35 });
  // "AGUA MIN 1 5L" pode ser 1,5 L; "C12" sem a barra é um número que a leitura não explica; por kg, nada.
  assertEquals(readPack('AGUA MIN 1 5L', 'un'), {});
  assertEquals(readPack('CERV BRAHMA 350ML LT C12', 'un'), {});
  assertEquals(readPack('QUEIJO 200G', 'kg'), {});
  assertEquals(readPack('SACOLA', 'un'), {});
  // Os limites: até 100 mil (kg, l ou itens); "de quantos" de 2 a mil, e fora disso só ele sai.
  assertEquals(MAX_PACK_AMOUNT, 100000);
  assertEquals(MAX_PACK_OF, 1000);
  assertEquals(readPack('AREIA 100000KG', 'un'), { pack_unit: 'kg', pack_amount: 100000 });
  assertEquals(readPack('AREIA 100001KG', 'un'), {});
  assertEquals(readPack('COPO 1001X10ML', 'un'), { pack_unit: 'l', pack_amount: 10.01 });
  assertEquals(readPack('RACAO 2,5G', 'un'), { pack_unit: 'kg', pack_amount: 0.0025 });
});

Deno.test('receiptRead: o tamanho só na nota do QR code, só na linha que a Sefaz vendeu como um item só', () => {
  const base = { householdId: 'h1', accessKey: KEY, cnpj: '11222333000181', storeName: 'ATACADAO', purchasedOn: '2026-10-09' };
  const lines = [
    { description: 'CERV SKOL LT 350ML C/12', unit: 'un', unit_price: 39.9, single_unit: true },
    // O fardo (FD): a mesma descrição da lata, e o preço é do fardo todo.
    { description: 'CERV SKOL LT 350ML', unit: 'un', unit_price: 39.9 },
    // Tamanho que veio de fora não conta: só o que o servidor lê aqui.
    { description: 'SACOLA', unit: 'un', unit_price: 0.1, single_unit: true, pack_unit: 'kg', pack_amount: 5 } as {
      description: string;
      unit: string;
      unit_price: number;
      single_unit: boolean;
    },
  ];
  const qr = receiptRead({ ...base, source: 'qrcode', lines });
  assertEquals(qr.lines, [
    { description: 'CERV SKOL LT 350ML C/12', unit: 'un', unit_price: 39.9, pack_unit: 'l', pack_amount: 4.2, pack_of: 12 },
    { description: 'CERV SKOL LT 350ML', unit: 'un', unit_price: 39.9 },
    { description: 'SACOLA', unit: 'un', unit_price: 0.1 },
  ]);
  // single_unit é só entrada: nunca vai para o banco.
  assertEquals(qr.lines.some((line) => 'single_unit' in line), false);
  // A foto (a IA põe "un" também no fardo e na caixa) nunca leva tamanho.
  const photo = receiptRead({ ...base, source: 'ai', lines });
  assertEquals(photo.lines.map((line) => 'pack_unit' in line), [false, false, false]);
});
