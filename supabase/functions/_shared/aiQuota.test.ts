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
  const db = fakeDb({ data: [{ allowed: true, used: 3, lim: 300, household: 'h1', usage_month: '2026-09' }], error: null });
  assertEquals(await takeAiQuota(db, 'chat'), { kind: 'chat', household: 'h1', month: '2026-09' });
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

Deno.test('refundAiQuota gives the use back to the month and household it counted in', async () => {
  const service = fakeDb({ data: null, error: null });
  await refundAiQuota({ kind: 'menu', household: 'h1', month: '2026-09' }, service);
  assertEquals(service.calls, [['refund_ai', { p_household: 'h1', p_month: '2026-09', p_kind: 'menu' }]]);
});

Deno.test('takeAiQuota counts the finance chat apart, with its own limit message', async () => {
  const ok = fakeDb({ data: [{ allowed: true, used: 1, lim: 100, household: 'h1', usage_month: '2026-10' }], error: null });
  assertEquals(await takeAiQuota(ok, 'finance'), { kind: 'finance', household: 'h1', month: '2026-10' });
  assertEquals(ok.calls, [['use_ai', { p_kind: 'finance' }]]);

  const full = fakeDb({ data: [{ allowed: false, used: 100, lim: 100 }], error: null });
  const err = await assertRejects(() => takeAiQuota(full, 'finance'), QuotaError);
  assertEquals(err.status, 429);
  assertEquals(err.message.startsWith('Você já usou as 100 mensagens com o consultor financeiro deste mês.'), true);
});

Deno.test('takeAiQuota answers 403 when use_ai refuses the caller (no beta access)', async () => {
  const db = fakeDb({ data: null, error: { code: '42501', message: 'finance beta not enabled' } });
  const err = await assertRejects(() => takeAiQuota(db, 'finance'), QuotaError);
  assertEquals(err.status, 403);
});
