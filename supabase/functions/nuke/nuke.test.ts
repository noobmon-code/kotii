import { assertEquals } from '@std/assert';
import { z } from 'zod';

import {
  buildMenuSystem,
  buildSystem,
  cleanMenu,
  cleanReply,
  isISODate,
  MAX_TURNS,
  MenuSchema,
  type NukeReplyRaw,
  NukeReplySchema,
  parseMenuRequest,
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

Deno.test('parseMenuRequest validates the week and trims the preferences', () => {
  const ok = parseMenuRequest({ context: 'Casa X', today: '2026-09-27', weekStart: '2026-09-28', preferences: '  sem carne vermelha ' });
  assertEquals(ok, { context: 'Casa X', today: '2026-09-27', weekStart: '2026-09-28', preferences: 'sem carne vermelha' });
  assertEquals(parseMenuRequest({ context: '', today: '2026-09-27', weekStart: 'segunda' }), 'Semana inválida.');
  assertEquals(parseMenuRequest({ context: '', today: '2026-09-27', weekStart: '2026-09-28', preferences: 3 }), 'Preferências inválidas.');
});

Deno.test('buildMenuSystem lists the 7 dates of the week and carries the snapshot', () => {
  const system = buildMenuSystem('CARDÁPIO: segunda almoço Lasanha', '2026-09-27', '2026-09-28');
  assertEquals(system.includes('de 2026-09-28 a 2026-10-04'), true);
  assertEquals(system.includes('CARDÁPIO: segunda almoço Lasanha'), true);
});

Deno.test('cleanMenu keeps the week in order, one entry per day, and clean shopping items', () => {
  const menu = cleanMenu(
    {
      days: [
        { date: '2026-09-29', lunch: ' Frango   grelhado com salada ', dinner: null },
        { date: '2026-09-28', lunch: 'Lasanha', dinner: 'Sopa de legumes' },
        { date: '2026-09-28', lunch: 'Outra lasanha', dinner: null },
        { date: '2026-10-05', lunch: 'Fora da semana', dinner: null },
        { date: '2026-09-30', lunch: '  ', dinner: null },
      ],
      shopping: [
        { name: 'Frango', quantity: 1.5, unit: 'kg', category: 'carnes' },
        { name: 'frango', quantity: 1, unit: 'kg', category: 'carnes' },
        { name: 'Alface', quantity: null, unit: null, category: null },
        { name: ' ', quantity: 1, unit: 'un', category: 'outros' },
      ],
      note: ' Usei o frango que vence logo. ',
    },
    '2026-09-28',
  );
  assertEquals(menu.days, [
    { date: '2026-09-28', lunch: 'Lasanha', dinner: 'Sopa de legumes' },
    { date: '2026-09-29', lunch: 'Frango grelhado com salada', dinner: null },
  ]);
  assertEquals(menu.shopping, [
    { name: 'Frango', quantity: 1.5, unit: 'kg', category: 'carnes' },
    { name: 'Alface', quantity: 1, unit: 'un', category: 'outros' },
  ]);
  assertEquals(menu.note, 'Usei o frango que vence logo.');
});

Deno.test('the menu schema converts to a strict JSON schema', () => {
  const schema = z.toJSONSchema(MenuSchema) as { properties: Record<string, unknown> };
  assertEquals(Object.keys(schema.properties), ['days', 'shopping', 'note']);
});
