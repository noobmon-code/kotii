import { assertEquals } from '@std/assert';
import { z } from 'zod';

import {
  buildSystem,
  cleanReply,
  isISODate,
  MAX_TURNS,
  NUKE_OPENROUTER_MODEL,
  nukeConfig,
  type NukeReplyRaw,
  NukeReplySchema,
  parseRequest,
} from './nuke.ts';

const empty = {
  items: null,
  title: null,
  due_on: null,
  recurrence: null,
  description: null,
  amount: null,
  category: null,
  spent_on: null,
  screen: null,
} as const;

Deno.test('isISODate accepts only real calendar dates', () => {
  assertEquals(isISODate('2026-02-28'), true);
  assertEquals(isISODate('2026-02-30'), false);
  assertEquals(isISODate('28/02/2026'), false);
  assertEquals(isISODate(null), false);
});

Deno.test('parseRequest keeps the recent turns, starting with the person and ending with them', () => {
  const messages = Array.from({ length: 21 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: ` msg ${i} ` }));
  const parsed = parseRequest({ messages, context: 'Casa X', today: '2026-09-27' });
  if (typeof parsed === 'string') throw new Error(parsed);
  assertEquals(parsed.turns[0], { role: 'user', text: 'msg 6' });
  assertEquals(parsed.turns.length, MAX_TURNS - 1);
  assertEquals(parsed.turns.at(-1), { role: 'user', text: 'msg 20' });

  assertEquals(parseRequest({ messages: [{ role: 'user', text: 'oi' }], context: '', today: 'hoje' }), 'Data de hoje inválida.');
  assertEquals(
    parseRequest({ messages: [{ role: 'user', text: 'oi' }, { role: 'assistant', text: 'olá' }], context: '', today: '2026-09-27' }),
    'A última mensagem precisa ser sua.',
  );
  assertEquals(parseRequest({ messages: [{ role: 'system', text: 'x' }], context: '', today: '2026-09-27' }), 'Mensagem inválida.');
});

Deno.test('buildSystem names the weekday and carries the household snapshot', () => {
  const system = buildSystem('Tarefas: Limpar filtro', '2026-09-27');
  assertEquals(system.includes('Hoje é domingo, 2026-09-27'), true);
  assertEquals(system.endsWith('Tarefas: Limpar filtro'), true);
});

Deno.test('cleanReply keeps complete actions with defaults and drops the rest', () => {
  const raw: NukeReplyRaw = {
    reply: '  Pronto!  ',
    actions: [
      {
        ...empty,
        type: 'add_to_list',
        label: 'Adicionar 2 itens',
        items: [
          { name: ' Arroz ', quantity: null, unit: null, category: 'graos' },
          { name: '  ', quantity: 1, unit: 'un', category: null },
          { name: 'Banana', quantity: 1.5, unit: 'kg', category: null },
        ],
      },
      { ...empty, type: 'create_chore', label: '', title: 'Trocar filtro', due_on: '2026-02-30', recurrence: null },
      { ...empty, type: 'add_expense', label: 'Registrar', description: 'Feira', amount: 0, category: null, spent_on: null },
      { ...empty, type: 'open_screen', label: 'Ver contas', screen: 'contas' },
      { ...empty, type: 'open_screen', label: 'Ver notas', screen: 'notas' },
    ],
  };
  const { reply, actions } = cleanReply(raw, '2026-09-27');
  assertEquals(reply, 'Pronto!');
  assertEquals(actions, [
    {
      type: 'add_to_list',
      label: 'Adicionar 2 itens',
      items: [
        { name: 'Arroz', quantity: 1, unit: 'un', category: 'graos' },
        { name: 'Banana', quantity: 1.5, unit: 'kg', category: 'outros' },
      ],
    },
    { type: 'create_chore', label: 'Criar tarefa', title: 'Trocar filtro', due_on: '2026-09-27', recurrence: 'none' },
    { type: 'open_screen', label: 'Ver contas', screen: 'contas' },
  ]);
});

Deno.test('the reply schema converts to a strict JSON schema without unsupported unions', () => {
  const schema = JSON.stringify(z.toJSONSchema(NukeReplySchema));
  assertEquals(schema.includes('oneOf'), false);
  assertEquals(schema.includes('"reply"'), true);
});

Deno.test('nukeConfig: with the OpenRouter key, the Nuke uses DeepSeek unless NUKE_* says otherwise', () => {
  const envOf = (vars: Record<string, string>) => (name: string) => vars[name];
  const both = { OPENROUTER_API_KEY: 'or', ANTHROPIC_API_KEY: 'an', RECEIPT_MODEL: 'google/gemma-4-31b-it:free' };

  const deepseek = nukeConfig(envOf(both));
  assertEquals([deepseek.provider, deepseek.model, deepseek.apiKey], ['openrouter', NUKE_OPENROUTER_MODEL, 'or']);
  assertEquals(nukeConfig(envOf({ OPENROUTER_API_KEY: 'or' })).model, 'deepseek/deepseek-v4.1-flash');

  assertEquals(nukeConfig(envOf({ ...both, NUKE_MODEL: 'x/other' })).model, 'x/other');
  assertEquals(nukeConfig(envOf({ ...both, NUKE_PROVIDER: 'anthropic' })).provider, 'anthropic');
  assertEquals(nukeConfig(envOf({ ANTHROPIC_API_KEY: 'an' })).provider, 'anthropic');
});
