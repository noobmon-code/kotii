import { assertEquals, assertRejects } from '@std/assert';

import { type ExtractedReceipt, ExtractionError } from './extract.ts';
import { extractWithOpenRouter, parseModelJson } from './openrouter.ts';

const receipt: ExtractedReceipt = {
  is_receipt: true,
  store_name: 'Mercado Bom',
  cnpj: '12345678000199',
  address: null,
  purchased_at: '2026-09-20T10:15:00-03:00',
  access_key: null,
  total: 25,
  items: [
    {
      raw_description: 'ARROZ T.JOAO 5KG',
      normalized_name: 'Arroz Tio João 5kg',
      category: 'graos',
      quantity: 1,
      unit: 'un',
      unit_price: 25,
      total_price: 25,
      matched_product_id: null,
    },
  ],
};

function fakeFetch(status: number, body: unknown, seen: { request?: Record<string, unknown> } = {}) {
  return ((_url: string, init?: RequestInit) => {
    seen.request = JSON.parse(String(init?.body));
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
}

const base = { apiKey: 'k', model: 'google/gemma-4-31b-it:free', imageBase64: 'AAAA', mediaType: 'image/jpeg' as const, catalog: [] };

Deno.test('reads a fenced JSON answer and sends image + instructions in the user message', async () => {
  const seen: { request?: Record<string, unknown> } = {};
  const answer = { choices: [{ finish_reason: 'stop', message: { content: '```json\n' + JSON.stringify(receipt) + '\n```' } }] };
  const result = await extractWithOpenRouter({ ...base, fetchImpl: fakeFetch(200, answer, seen) });
  assertEquals(result, receipt);

  const messages = seen.request?.messages as { role: string; content: { type: string }[] }[];
  assertEquals(seen.request?.model, 'google/gemma-4-31b-it:free');
  assertEquals(messages.map((m) => m.role), ['user'], 'no system role (Gemma rejects it)');
  assertEquals(messages[0].content.map((p) => p.type), ['image_url', 'text']);
});

Deno.test('maps rate limit, missing credits and provider errors inside a 200', async () => {
  const cases: [number, unknown, RegExp, number][] = [
    [429, { error: { code: 429, message: 'rate limited' } }, /Limite/, 429],
    [402, { error: { code: 402, message: 'insufficient credits' } }, /créditos/, 502],
    [200, { error: { code: 400, message: 'bad model' } }, /RECEIPT_MODEL/, 502],
  ];
  for (const [status, body, message, expectedStatus] of cases) {
    const err = await assertRejects(
      () => extractWithOpenRouter({ ...base, fetchImpl: fakeFetch(status, body) }),
      ExtractionError,
    );
    assertEquals(message.test(err.message), true, err.message);
    assertEquals(err.status, expectedStatus);
  }
});

Deno.test('rejects answers outside the schema', async () => {
  const answer = { choices: [{ finish_reason: 'stop', message: { content: '{"is_receipt": true, "items": "nada"}' } }] };
  await assertRejects(() => extractWithOpenRouter({ ...base, fetchImpl: fakeFetch(200, answer) }), ExtractionError);
});

Deno.test('parseModelJson tolerates text around the object', () => {
  assertEquals(parseModelJson('Aqui está:\n{"a": 1}\nPronto.'), { a: 1 });
});
