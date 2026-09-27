import { assertEquals, assertRejects } from '@std/assert';

import { QuotaError, refundAiQuota, takeAiQuota } from './aiQuota.ts';

function fakeDb(result: { data: unknown; error: unknown }) {
  const calls: [string, Record<string, unknown>][] = [];
  return {
    calls,
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push([fn, args]);
      return Promise.resolve(result);
    },
  };
}

Deno.test('takeAiQuota lets the call through while there is quota', async () => {
  const db = fakeDb({ data: [{ allowed: true, used: 3, lim: 300 }], error: null });
  await takeAiQuota(db, 'chat');
  assertEquals(db.calls, [['use_ai', { p_kind: 'chat' }]]);
});

Deno.test('takeAiQuota refuses with 429 and a friendly message at the limit', async () => {
  const db = fakeDb({ data: { allowed: false, used: 100, lim: 100 }, error: null });
  const err = await assertRejects(() => takeAiQuota(db, 'photo'), QuotaError);
  assertEquals(err.status, 429);
  assertEquals(err.message.startsWith('A casa já usou as 100 leituras de foto deste mês.'), true);
});

Deno.test('takeAiQuota fails closed with 503 when the quota cannot be checked', async () => {
  const db = fakeDb({ data: null, error: new Error('down') });
  const err = await assertRejects(() => takeAiQuota(db, 'menu'), QuotaError);
  assertEquals(err.status, 503);
});

Deno.test('refundAiQuota gives the use back', async () => {
  const db = fakeDb({ data: null, error: null });
  await refundAiQuota(db, 'menu');
  assertEquals(db.calls, [['refund_ai', { p_kind: 'menu' }]]);
});
