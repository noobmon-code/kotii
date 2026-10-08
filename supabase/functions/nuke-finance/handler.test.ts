import { assertEquals } from '@std/assert';

import type { AiTicket } from '../_shared/aiQuota.ts';
import type { ChatInput } from '../_shared/chat.ts';
import { ExtractionError, type VisionConfig } from '../_shared/vision.ts';
import type { FinanceReplyRaw, FinanceReplySchema } from './advisor.ts';
import { MISSING_KEY_MESSAGE } from './config.ts';
import { financeChatHandler, NOT_ALLOWED_MESSAGE } from './handler.ts';

type RpcResult = { data: unknown; error: unknown };

const config: VisionConfig = { provider: 'anthropic', model: 'claude-haiku-5-5', modelEnv: 'FINANCE_MODEL', apiKey: 'k' };
const body = {
  messages: [{ role: 'user', text: 'Quanto gastei com mercado?' }],
  context: 'Mercado no mês: R$ 812,40',
  today: '2026-10-07',
};
const reply: FinanceReplyRaw = {
  reply: 'Mercado: R$ 812,40 este mês.',
  actions: [{ type: 'open_screen', label: 'Ver orçamento', screen: 'orcamento', category: null, amount: null }],
};

function setup(
  opts: {
    user?: unknown;
    beta?: RpcResult;
    quota?: RpcResult;
    config?: VisionConfig | string;
    chat?: (input: ChatInput<typeof FinanceReplySchema>) => Promise<FinanceReplyRaw>;
  } = {},
) {
  const rpcCalls: [string, Record<string, unknown>][] = [];
  const chatCalls: ChatInput<typeof FinanceReplySchema>[] = [];
  const refunds: AiTicket[] = [];
  const handler = financeChatHandler({
    callerClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: 'user' in opts ? opts.user : { id: 'u1' } } }) },
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push([fn, args]);
        if (fn === 'has_beta') return Promise.resolve(opts.beta ?? { data: true, error: null });
        if (fn === 'use_ai') {
          return Promise.resolve(
            opts.quota ?? { data: [{ allowed: true, used: 1, lim: 100, household: 'h1', usage_month: '2026-10' }], error: null },
          );
        }
        return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
      },
    }),
    config: opts.config ?? config,
    chat: (input) => {
      chatCalls.push(input);
      return opts.chat ? opts.chat(input) : Promise.resolve(reply);
    },
    refund: (ticket) => {
      refunds.push(ticket);
      return Promise.resolve();
    },
  });
  const call = (payload: unknown = body, method = 'POST') =>
    handler(
      new Request('http://localhost/nuke-finance', {
        method,
        headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify(payload) : undefined,
      }),
    );
  return { call, rpcCalls, chatCalls, refunds };
}

Deno.test('answers with the cleaned reply after beta, quota and AI, in that order', async () => {
  const t = setup();
  const res = await t.call();
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals(await res.json(), {
    reply: 'Mercado: R$ 812,40 este mês.',
    actions: [{ type: 'open_screen', label: 'Ver orçamento', screen: 'orcamento' }],
  });
  assertEquals(t.rpcCalls, [
    ['has_beta', { p_feature: 'finance' }],
    ['use_ai', { p_kind: 'finance' }],
  ]);
  assertEquals(t.chatCalls.length, 1);
  assertEquals(t.chatCalls[0].config, config);
  assertEquals(t.chatCalls[0].schemaName, 'finance_reply');
  assertEquals(t.chatCalls[0].turns, [{ role: 'user', text: 'Quanto gastei com mercado?' }]);
  assertEquals(t.chatCalls[0].system.endsWith('Mercado no mês: R$ 812,40'), true);
  assertEquals(t.refunds, []);
});

Deno.test('only POST (and the CORS preflight) is served', async () => {
  const t = setup();
  assertEquals((await t.call(undefined, 'OPTIONS')).status, 200);
  assertEquals((await t.call(undefined, 'GET')).status, 405);
  assertEquals(t.rpcCalls, []);
});

Deno.test('401 without a signed-in person: nothing else runs', async () => {
  const t = setup({ user: null });
  assertEquals((await t.call()).status, 401);
  assertEquals(t.rpcCalls, []);
  assertEquals(t.chatCalls, []);
});

Deno.test('403 without the beta in the open household: no quota spent, no AI', async () => {
  const t = setup({ beta: { data: false, error: null } });
  const res = await t.call();
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, NOT_ALLOWED_MESSAGE);
  assertEquals(t.rpcCalls.map(([fn]) => fn), ['has_beta']);
  assertEquals(t.chatCalls, []);
});

Deno.test('503 when the beta cannot be checked (fails closed)', async () => {
  const t = setup({ beta: { data: null, error: { message: 'down' } } });
  assertEquals((await t.call()).status, 503);
  assertEquals(t.rpcCalls.map(([fn]) => fn), ['has_beta']);
  assertEquals(t.chatCalls, []);
});

Deno.test('503 without the Anthropic key, checked before the quota', async () => {
  const t = setup({ config: MISSING_KEY_MESSAGE });
  const res = await t.call();
  assertEquals(res.status, 503);
  assertEquals((await res.json()).error, MISSING_KEY_MESSAGE);
  assertEquals(t.rpcCalls.map(([fn]) => fn), ['has_beta']);
  assertEquals(t.chatCalls, []);
});

Deno.test('400 for an invalid request, before the quota', async () => {
  const t = setup();
  const res = await t.call({ ...body, context: 'x'.repeat(12001) });
  assertEquals(res.status, 400);
  assertEquals(t.rpcCalls.map(([fn]) => fn), ['has_beta']);
  assertEquals(t.chatCalls, []);
});

Deno.test('quota refusals pass through: 429 at the limit, 403 when use_ai refuses the caller', async () => {
  const full = setup({ quota: { data: [{ allowed: false, used: 100, lim: 100 }], error: null } });
  const res = await full.call();
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error.includes('consultor financeiro'), true);
  assertEquals(full.chatCalls, []);

  const refused = setup({ quota: { data: null, error: { code: '42501', message: 'finance beta not enabled' } } });
  assertEquals((await refused.call()).status, 403);
  assertEquals(refused.chatCalls, []);
});

Deno.test('a failed AI call gives the use back; a refusal (422) still counts', async () => {
  const failed = setup({ chat: () => Promise.reject(new ExtractionError('Não consegui responder agora. Tente de novo.', 502)) });
  assertEquals((await failed.call()).status, 502);
  assertEquals(failed.refunds, [{ kind: 'finance', household: 'h1', month: '2026-10' }]);

  const crashed = setup({ chat: () => Promise.reject(new Error('boom')) });
  assertEquals((await crashed.call()).status, 500);
  assertEquals(crashed.refunds.length, 1);

  const refused = setup({ chat: () => Promise.reject(new ExtractionError('Não posso ajudar com isso.', 422)) });
  assertEquals((await refused.call()).status, 422);
  assertEquals(refused.refunds, []);
});
