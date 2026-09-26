import type Anthropic from '@anthropic-ai/sdk';
import { assertEquals, assertRejects } from '@std/assert';
import { z } from 'zod';

import { ExtractionError, extractStructured, parseModelJson, type VisionConfig, visionConfig } from './vision.ts';

const Schema = z.object({ ok: z.boolean(), items: z.array(z.string()) });
const answer = { ok: true, items: ['a', 'b'] };

const openRouter: VisionConfig = {
  provider: 'openrouter',
  model: 'google/gemma-4-31b-it:free',
  modelEnv: 'RECEIPT_MODEL',
  apiKey: 'k',
};

const images = [
  { base64: 'AAAA', mediaType: 'image/jpeg' as const },
  { base64: 'BBBB', mediaType: 'image/png' as const },
];

const base = { schema: Schema, schemaName: 'test', system: 'Sistema.', prompt: 'Leia.', images, subject: 'a nota' };

function fakeFetch(status: number, body: unknown, seen: { request?: Record<string, unknown> } = {}) {
  return ((_url: string, init?: RequestInit) => {
    seen.request = JSON.parse(String(init?.body));
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
}

Deno.test('visionConfig: OpenRouter key alone selects OpenRouter; prefixes fall back in order', () => {
  const env = (vars: Record<string, string>) => (name: string) => vars[name];

  const onlyOpenRouter = visionConfig(['HEALTH', 'RECEIPT'], env({ OPENROUTER_API_KEY: 'or' }));
  assertEquals(onlyOpenRouter.provider, 'openrouter');
  assertEquals(onlyOpenRouter.model, 'google/gemma-4-31b-it:free');
  assertEquals(onlyOpenRouter.modelEnv, 'HEALTH_MODEL');
  assertEquals(onlyOpenRouter.apiKey, 'or');

  const inherited = visionConfig(
    ['HEALTH', 'RECEIPT'],
    env({ OPENROUTER_API_KEY: 'or', ANTHROPIC_API_KEY: 'an', RECEIPT_PROVIDER: 'anthropic', RECEIPT_MODEL: 'claude-x' }),
  );
  assertEquals(inherited.provider, 'anthropic');
  assertEquals(inherited.model, 'claude-x');
  assertEquals(inherited.modelEnv, 'RECEIPT_MODEL');
  assertEquals(inherited.apiKey, 'an');

  const none = visionConfig(['RECEIPT'], env({}));
  assertEquals(none.provider, 'anthropic');
  assertEquals(none.apiKey, undefined);
});

Deno.test('fails with 503 when no key is configured', async () => {
  const err = await assertRejects(
    () => extractStructured({ ...base, config: { ...openRouter, apiKey: undefined } }),
    ExtractionError,
  );
  assertEquals(err.status, 503);
});

Deno.test('OpenRouter: reads a fenced JSON answer; images and instructions go in one user message', async () => {
  const seen: { request?: Record<string, unknown> } = {};
  const body = { choices: [{ finish_reason: 'stop', message: { content: '```json\n' + JSON.stringify(answer) + '\n```' } }] };
  const result = await extractStructured({ ...base, config: openRouter, fetchImpl: fakeFetch(200, body, seen) });
  assertEquals(result, answer);

  const messages = seen.request?.messages as { role: string; content: { type: string }[] }[];
  assertEquals(seen.request?.model, 'google/gemma-4-31b-it:free');
  assertEquals(messages.map((m) => m.role), ['user'], 'no system role (Gemma rejects it)');
  assertEquals(messages[0].content.map((p) => p.type), ['image_url', 'image_url', 'text']);
  const format = seen.request?.response_format as { json_schema: { name: string; schema: Record<string, unknown> } };
  assertEquals(format.json_schema.name, 'test');
  assertEquals('$schema' in format.json_schema.schema, false);
});

Deno.test('OpenRouter: maps rate limit, missing credits and provider errors inside a 200', async () => {
  const cases: [number, unknown, RegExp, number][] = [
    [429, { error: { code: 429, message: 'rate limited' } }, /Limite/, 429],
    [402, { error: { code: 402, message: 'insufficient credits' } }, /créditos/, 502],
    [200, { error: { code: 400, message: 'bad model' } }, /RECEIPT_MODEL/, 502],
    [500, { error: { code: 500, message: 'boom' } }, /ler a nota/, 502],
  ];
  for (const [status, body, message, expectedStatus] of cases) {
    const err = await assertRejects(
      () => extractStructured({ ...base, config: openRouter, fetchImpl: fakeFetch(status, body) }),
      ExtractionError,
    );
    assertEquals(message.test(err.message), true, err.message);
    assertEquals(err.status, expectedStatus);
  }
});

Deno.test('OpenRouter: rejects answers outside the schema and truncated answers', async () => {
  const wrong = { choices: [{ finish_reason: 'stop', message: { content: '{"ok": true, "items": "nada"}' } }] };
  await assertRejects(
    () => extractStructured({ ...base, config: openRouter, fetchImpl: fakeFetch(200, wrong) }),
    ExtractionError,
  );
  const cut = { choices: [{ finish_reason: 'length', message: { content: '{"ok": tr' } }] };
  const err = await assertRejects(
    () => extractStructured({ ...base, config: openRouter, fetchImpl: fakeFetch(200, cut) }),
    ExtractionError,
  );
  assertEquals(err.status, 422);
});

Deno.test('Anthropic: sends every image and returns the parsed output', async () => {
  let request: { system?: string; messages: { content: { type: string }[] }[] } | undefined;
  const client = {
    beta: {
      messages: {
        parse: (params: typeof request) => {
          request = params;
          return Promise.resolve({ stop_reason: 'end_turn', parsed_output: answer });
        },
      },
    },
  } as unknown as Anthropic;
  const config: VisionConfig = { provider: 'anthropic', model: 'claude-x', modelEnv: 'RECEIPT_MODEL', apiKey: 'k' };
  const result = await extractStructured({ ...base, config, anthropic: client });
  assertEquals(result, answer);
  assertEquals(request?.system, 'Sistema.');
  assertEquals(request?.messages[0].content.map((p) => p.type), ['image', 'image', 'text']);
});

Deno.test('parseModelJson tolerates text around the object', () => {
  assertEquals(parseModelJson('Aqui está:\n{"a": 1}\nPronto.'), { a: 1 });
});
