import { assertEquals } from '@std/assert';
import { z } from 'zod';

import {
  buildSystem,
  cleanReply,
  type FinanceReplyRaw,
  FinanceReplySchema,
  MAX_CONTEXT,
  MAX_TEXT,
  MAX_TURNS,
  parseRequest,
} from './advisor.ts';

const empty = { screen: null, category: null, amount: null } as const;

Deno.test('parseRequest keeps the recent turns, starting and ending with the person', () => {
  const messages = Array.from({ length: 21 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: ` msg ${i} ` }));
  const parsed = parseRequest({ messages, context: 'Saídas do mês: R$ 1.234,56', today: '2026-10-07' });
  if (typeof parsed === 'string') throw new Error(parsed);
  assertEquals(parsed.turns[0], { role: 'user', text: 'msg 6' });
  assertEquals(parsed.turns.length, MAX_TURNS - 1);
  assertEquals(parsed.turns.at(-1), { role: 'user', text: 'msg 20' });
  assertEquals(parsed.context, 'Saídas do mês: R$ 1.234,56');

  const long = parseRequest({ messages: [{ role: 'user', text: 'a'.repeat(MAX_TEXT + 50) }], context: '', today: '2026-10-07' });
  if (typeof long === 'string') throw new Error(long);
  assertEquals(long.turns[0].text.length, MAX_TEXT);

  assertEquals(parseRequest(null), 'Pedido inválido.');
  assertEquals(parseRequest({ messages: [{ role: 'user', text: 'oi' }], context: '', today: '2026-02-30' }), 'Data de hoje inválida.');
  assertEquals(parseRequest({ messages: [{ role: 'user', text: 'oi' }], context: 3, today: '2026-10-07' }), 'Contexto inválido.');
  assertEquals(parseRequest({ messages: [], context: '', today: '2026-10-07' }), 'Mande uma mensagem.');
  assertEquals(
    parseRequest({ messages: [{ role: 'user', text: 'oi' }, { role: 'assistant', text: 'olá' }], context: '', today: '2026-10-07' }),
    'A última mensagem precisa ser sua.',
  );
  assertEquals(parseRequest({ messages: [{ role: 'system', text: 'x' }], context: '', today: '2026-10-07' }), 'Mensagem inválida.');
  assertEquals(parseRequest({ messages: [{ role: 'user', text: '   ' }], context: '', today: '2026-10-07' }), 'Mensagem inválida.');
});

Deno.test('parseRequest refuses an oversized snapshot instead of cutting numbers off', () => {
  const messages = [{ role: 'user', text: 'Quanto gastei?' }];
  const atLimit = parseRequest({ messages, context: 'x'.repeat(MAX_CONTEXT), today: '2026-10-07' });
  if (typeof atLimit === 'string') throw new Error(atLimit);
  assertEquals(atLimit.context.length, MAX_CONTEXT);

  const over = parseRequest({ messages, context: 'x'.repeat(MAX_CONTEXT + 1), today: '2026-10-07' });
  assertEquals(typeof over, 'string');
});

Deno.test('buildSystem names the weekday, sets the rules and ends with the snapshot', () => {
  const system = buildSystem('  Saídas do mês: R$ 1.234,56  ', '2026-10-09');
  assertEquals(system.includes('Hoje é sexta, 2026-10-09.'), true);
  assertEquals(system.endsWith('RETRATO FINANCEIRO:\nSaídas do mês: R$ 1.234,56'), true);
  assertEquals(system.includes('Não faça contas'), true);
  assertEquals(system.includes('CVM'), true);
  assertEquals(system.includes('sem markdown'), true);
  assertEquals(system.includes('R$ 1.234,56'), true);
  assertEquals(system.includes('mercado, alimentacao, casa, moradia'), true);
  // Compra parcelada conta mês a mês, como no retrato, e o valor ao lado da parcela é o da compra inteira.
  assertEquals(system.includes('compra parcelada conta mês a mês'), true);
  assertEquals(system.includes('conta o valor inteiro'), false);
  assertEquals(system.includes('não o que já foi pago'), true);
  assertEquals(buildSystem('', '2026-10-07').endsWith('(sem dados carregados)'), true);
});

Deno.test('cleanReply keeps at most 3 complete actions, budgets rounded to cents', () => {
  const raw: FinanceReplyRaw = {
    reply: '  Seu mercado está acima do orçamento.  ',
    actions: [
      { ...empty, type: 'open_screen', label: ' Ver orçamento ', screen: 'orcamento' },
      { ...empty, type: 'open_screen', label: 'Sem tela' },
      { ...empty, type: 'set_budget', label: '', category: 'mercado', amount: 1234.567 },
      { ...empty, type: 'set_budget', label: 'Sem categoria', amount: 500 },
      { ...empty, type: 'set_budget', label: 'Zero', category: 'lazer', amount: 0 },
      { ...empty, type: 'set_budget', label: 'Negativo', category: 'lazer', amount: -10 },
      { ...empty, type: 'set_budget', label: 'Meio centavo', category: 'lazer', amount: 0.004 },
      { ...empty, type: 'set_budget', label: 'Alto demais', category: 'lazer', amount: 1_000_000.01 },
      { ...empty, type: 'set_budget', label: 'Infinito', category: 'lazer', amount: Number.POSITIVE_INFINITY },
      { ...empty, type: 'set_budget', label: 'No teto', category: 'moradia', amount: 1_000_000 },
      { ...empty, type: 'open_screen', label: 'Quarta ação', screen: 'contas' },
    ],
  };
  assertEquals(cleanReply(raw), {
    reply: 'Seu mercado está acima do orçamento.',
    actions: [
      { type: 'open_screen', label: 'Ver orçamento', screen: 'orcamento' },
      { type: 'set_budget', label: 'Definir orçamento', category: 'mercado', amount: 1234.57 },
      { type: 'set_budget', label: 'No teto', category: 'moradia', amount: 1_000_000 },
    ],
  });
});

Deno.test('cleanReply drops values outside the lists and fills an empty reply', () => {
  const raw = {
    reply: '   ',
    actions: [
      { type: 'open_screen', label: 'Investir', screen: 'investimentos', category: null, amount: null },
      { type: 'set_budget', label: 'Cripto', screen: null, category: 'cripto', amount: 100 },
    ],
  } as unknown as FinanceReplyRaw;
  assertEquals(cleanReply(raw), { reply: 'Não entendi. Pode dizer de outro jeito?', actions: [] });

  const onlyAction = cleanReply({ reply: '', actions: [{ ...empty, type: 'open_screen', label: 'Abrir consultor', screen: 'consultor' }] });
  assertEquals(onlyAction.reply, 'Posso fazer isto:');
  assertEquals(cleanReply({ reply: 'x'.repeat(5000), actions: [] }).reply.length, 4000);
});

Deno.test('the reply schema converts to a strict JSON schema without unsupported unions', () => {
  const schema = JSON.stringify(z.toJSONSchema(FinanceReplySchema));
  assertEquals(schema.includes('oneOf'), false);
  assertEquals(schema.includes('"set_budget"'), true);
  assertEquals(schema.includes('"orcamento"'), true);
});
