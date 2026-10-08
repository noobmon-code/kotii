import type Anthropic from '@anthropic-ai/sdk';
import { assertEquals, assertRejects } from '@std/assert';
import { z } from 'zod';

import { chatStructured } from './chat.ts';
import { ExtractionError, type VisionConfig } from './vision.ts';

const Schema = z.object({ reply: z.string() });

const openRouter: VisionConfig = { provider: 'openrouter', model: 'm', modelEnv: 'NUKE_MODEL', apiKey: 'k' };
const turns = [
  { role: 'user' as const, text: 'Oi' },
  { role: 'assistant' as const, text: 'Olá!' },
  { role: 'user' as const, text: 'O que vence hoje?' },
];
const base = { schema: Schema, schemaName: 'reply', system: 'Você é o Nuke.', turns };

function fakeFetch(status: number, body: unknown, seen: { request?: Record<string, unknown> } = {}) {
  return ((_url: string, init?: RequestInit) => {
    seen.request = JSON.parse(String(init?.body));
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
}

Deno.test('chat: needs a key and a last message from the person', async () => {
  const noKey = await assertRejects(() => chatStructured({ ...base, config: { ...openRouter, apiKey: undefined } }), ExtractionError);
  assertEquals((noKey as ExtractionError).status, 503);
  const endsWithAssistant = await assertRejects(
    () => chatStructured({ ...base, config: openRouter, turns: turns.slice(0, 2) }),
    ExtractionError,
  );
  assertEquals((endsWithAssistant as ExtractionError).status, 400);
});

Deno.test('chat OpenRouter: history first, instructions with the last message; answer validated', async () => {
  const seen: { request?: Record<string, unknown> } = {};
  const body = { choices: [{ finish_reason: 'stop', message: { content: '```json\n{"reply":"Nada vence hoje."}\n```' } }] };
  const result = await chatStructured({ ...base, config: openRouter, fetchImpl: fakeFetch(200, body, seen) });
  assertEquals(result, { reply: 'Nada vence hoje.' });
  const messages = seen.request?.messages as { role: string; content: string }[];
  assertEquals(messages.slice(0, 2), [
    { role: 'user', content: 'Oi' },
    { role: 'assistant', content: 'Olá!' },
  ]);
  assertEquals(messages[2].role, 'user');
  assertEquals(messages[2].content.startsWith('Você é o Nuke.'), true);
  assertEquals(messages[2].content.includes('O que vence hoje?'), true);

  const wrong = { choices: [{ message: { content: '{"texto":"x"}' } }] };
  const err = await assertRejects(() => chatStructured({ ...base, config: openRouter, fetchImpl: fakeFetch(200, wrong) }), ExtractionError);
  assertEquals((err as ExtractionError).status, 502);
  const limited = await assertRejects(
    () => chatStructured({ ...base, config: openRouter, fetchImpl: fakeFetch(200, { error: { code: 429, message: 'x' } }) }),
    ExtractionError,
  );
  assertEquals((limited as ExtractionError).status, 429);
});

Deno.test('chat Anthropic: sends the turns as messages, low effort, fallbacks on Opus 5', async () => {
  let request: Record<string, unknown> = {};
  const client = {
    beta: {
      messages: {
        parse: (params: Record<string, unknown>) => {
          request = params;
          return Promise.resolve({ stop_reason: 'end_turn', parsed_output: { reply: 'Oi!' } });
        },
      },
    },
  } as unknown as Anthropic;
  const config: VisionConfig = { provider: 'anthropic', model: 'claude-opus-5', modelEnv: 'NUKE_MODEL', apiKey: 'k' };
  const result = await chatStructured({ ...base, config, anthropic: client });
  assertEquals(result, { reply: 'Oi!' });
  assertEquals(request.messages, turns.map((t) => ({ role: t.role, content: t.text })));
  assertEquals(request.system, 'Você é o Nuke.');
  assertEquals((request.output_config as { effort: string }).effort, 'low');
  assertEquals(request.fallbacks, 'default');

  const refusing = {
    beta: { messages: { parse: () => Promise.resolve({ stop_reason: 'refusal', parsed_output: null }) } },
  } as unknown as Anthropic;
  const err = await assertRejects(() => chatStructured({ ...base, config, anthropic: refusing }), ExtractionError);
  assertEquals((err as ExtractionError).status, 422);
});

Deno.test('chat Anthropic: refusal fallback only on the models that accept the "default" form', async () => {
  const cases: [string, boolean][] = [
    ['claude-opus-5', true],
    ['claude-fable-5-1', true],
    ['claude-sonnet-5-5', true],
    ['claude-sonnet-5', false],
    ['claude-haiku-4-5', false],
  ];
  for (const [model, expected] of cases) {
    let request: Record<string, unknown> = {};
    const client = {
      beta: {
        messages: {
          parse: (params: Record<string, unknown>) => {
            request = params;
            return Promise.resolve({ stop_reason: 'end_turn', parsed_output: { reply: 'Oi!' } });
          },
        },
      },
    } as unknown as Anthropic;
    const config: VisionConfig = { provider: 'anthropic', model, modelEnv: 'NUKE_MODEL', apiKey: 'k' };
    await chatStructured({ ...base, config, anthropic: client });
    assertEquals(request.fallbacks === 'default', expected, model);
    assertEquals(Array.isArray(request.betas) && request.betas.includes('server-side-fallback-2026-07-01'), expected, model);
    assertEquals('temperature' in request, false, model);
  }
});
