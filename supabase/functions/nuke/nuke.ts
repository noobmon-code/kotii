// Regras do Nuke: o que ele responde (schema), como é instruído e como a
// resposta é limpa antes de chegar ao app. Sem rede: testado em nuke.test.ts.

import { z } from 'zod';

import { CATEGORY_KEYS, FINANCE_CATEGORY_KEYS } from '../_shared/categories.ts';
import type { ChatTurn } from '../_shared/chat.ts';

export const SCREENS = [
  'hoje',
  'compras',
  'despensa',
  'tarefas',
  'aparelhos',
  'financas',
  'contas',
  'notas',
  'precos',
  'saude',
  'familia',
] as const;
const UNITS = ['un', 'kg', 'g', 'l', 'ml'] as const;
const RECURRENCES = ['none', 'daily', 'weekly', 'monthly'] as const;
const ACTION_TYPES = ['add_to_list', 'create_chore', 'add_expense', 'open_screen'] as const;

// Um objeto só com campos anuláveis: funciona na saída estruturada da
// Anthropic e na strict da OpenRouter. Cada tipo usa os seus campos.
export const NukeReplySchema = z.object({
  reply: z.string(),
  actions: z.array(
    z.object({
      type: z.enum(ACTION_TYPES),
      label: z.string(),
      items: z
        .array(
          z.object({
            name: z.string(),
            quantity: z.number().nullable(),
            unit: z.enum(UNITS).nullable(),
            category: z.enum(CATEGORY_KEYS).nullable(),
          }),
        )
        .nullable(),
      title: z.string().nullable(),
      due_on: z.string().nullable(),
      recurrence: z.enum(RECURRENCES).nullable(),
      description: z.string().nullable(),
      amount: z.number().nullable(),
      category: z.enum(FINANCE_CATEGORY_KEYS).nullable(),
      spent_on: z.string().nullable(),
      screen: z.enum(SCREENS).nullable(),
    }),
  ),
});

export type NukeReplyRaw = z.infer<typeof NukeReplySchema>;

export type NukeAction =
  | {
      type: 'add_to_list';
      label: string;
      items: { name: string; quantity: number; unit: (typeof UNITS)[number]; category: string }[];
    }
  | { type: 'create_chore'; label: string; title: string; due_on: string; recurrence: (typeof RECURRENCES)[number] }
  | { type: 'add_expense'; label: string; description: string; amount: number; category: string; spent_on: string }
  | { type: 'open_screen'; label: string; screen: (typeof SCREENS)[number] };

export interface NukeRequest {
  turns: ChatTurn[];
  context: string;
  today: string;
}

export const MAX_TURNS = 16;
export const MAX_TEXT = 2000;
export const MAX_CONTEXT = 16000;
const MAX_ACTIONS = 3;
const MAX_ITEMS = 20;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Valida o corpo do pedido. Devolve a mensagem de erro em vez de lançar. */
export function parseRequest(body: unknown): NukeRequest | string {
  if (!body || typeof body !== 'object') return 'Pedido inválido.';
  const { messages, context, today } = body as Record<string, unknown>;
  if (!isISODate(today)) return 'Data de hoje inválida.';
  if (typeof context !== 'string') return 'Contexto inválido.';
  if (!Array.isArray(messages) || messages.length === 0) return 'Mande uma mensagem.';
  const turns: ChatTurn[] = [];
  for (const m of messages.slice(-MAX_TURNS)) {
    const role = (m as { role?: unknown })?.role;
    const text = (m as { text?: unknown })?.text;
    if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string' || !text.trim()) {
      return 'Mensagem inválida.';
    }
    turns.push({ role, text: text.trim().slice(0, MAX_TEXT) });
  }
  // A API exige começar pela pessoa; respostas antigas do Nuke sem a pergunta saem.
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (turns.at(-1)?.role !== 'user') return 'A última mensagem precisa ser sua.';
  return { turns, context: context.slice(0, MAX_CONTEXT), today };
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function buildSystem(context: string, today: string): string {
  const weekday = WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()];
  return `Você é o Nuke, o assistente da casa no app Nooky: um personagem laranja, redondo e simpático. Fala português do Brasil, com calor humano e poucas palavras.

O que você sabe: o RETRATO DA CASA abaixo (dados reais da família, de agora) e o que a pessoa disser. Não invente itens, valores, datas nem nomes. Se algo não está no retrato, diga que não tem esse dado e sugira onde ver no app.

Como responder:
- Texto puro, sem markdown (nada de **, # ou tabelas). Frases curtas; use "• " no começo da linha para listar.
- Até umas 120 palavras, a não ser que a pessoa peça detalhe.
- Dinheiro como R$ 1.234,56; datas como "sexta, 3/10".
- Dicas da casa (limpeza, receitas com o que há na despensa, organização, economia) são bem-vindas. Em saúde, não dê diagnóstico nem mude dose de remédio: oriente procurar o profissional.

Ações: quando a pessoa pedir algo que o app faz, proponha em "actions". Ela confirma com um toque; você não executa nada sozinho, então não diga que já fez.
- add_to_list: itens para a lista de mercado ("items": name, quantity, unit ${UNITS.join('|')}, category).
- create_chore: tarefa da casa ("title", "due_on" AAAA-MM-DD, "recurrence" ${RECURRENCES.join('|')}).
- add_expense: gasto sem nota fiscal ("description", "amount" em reais, "category", "spent_on" AAAA-MM-DD).
- open_screen: abrir uma tela ("screen": ${SCREENS.join(', ')}).
Cada ação tem "label", o texto curto do botão (ex.: "Adicionar 3 itens à lista"). Campos que não são do tipo da ação vão como null. Sem ação útil, "actions" vazio. No máximo ${MAX_ACTIONS} ações.
Categorias de produto: ${CATEGORY_KEYS.join(', ')}.
Categorias de gasto: ${FINANCE_CATEGORY_KEYS.join(', ')}.
Hoje é ${weekday}, ${today}. "Amanhã", "sexta" etc. contam a partir de hoje.

RETRATO DA CASA:
${context.trim() || '(sem dados carregados)'}`;
}

const DEFAULT_LABEL: Record<NukeAction['type'], string> = {
  add_to_list: 'Adicionar à lista',
  create_chore: 'Criar tarefa',
  add_expense: 'Registrar gasto',
  open_screen: 'Abrir',
};

/** Limpa a resposta: texto aparado e só ações completas, com valores padrão. */
export function cleanReply(raw: NukeReplyRaw, today: string): { reply: string; actions: NukeAction[] } {
  const actions: NukeAction[] = [];
  for (const a of raw.actions) {
    if (actions.length >= MAX_ACTIONS) break;
    const label = a.label?.trim() || DEFAULT_LABEL[a.type];
    switch (a.type) {
      case 'add_to_list': {
        const items = (a.items ?? [])
          .map((i) => ({
            name: i.name.trim(),
            quantity: i.quantity && i.quantity > 0 && Number.isFinite(i.quantity) ? i.quantity : 1,
            unit: i.unit ?? 'un',
            category: i.category ?? 'outros',
          }))
          .filter((i) => i.name)
          .slice(0, MAX_ITEMS);
        if (items.length) actions.push({ type: 'add_to_list', label, items });
        break;
      }
      case 'create_chore': {
        const title = a.title?.trim();
        if (title) {
          actions.push({
            type: 'create_chore',
            label,
            title,
            due_on: isISODate(a.due_on) ? a.due_on : today,
            recurrence: a.recurrence ?? 'none',
          });
        }
        break;
      }
      case 'add_expense': {
        const description = a.description?.trim();
        if (description && a.amount && a.amount > 0 && Number.isFinite(a.amount)) {
          actions.push({
            type: 'add_expense',
            label,
            description,
            amount: Math.round(a.amount * 100) / 100,
            category: a.category ?? 'outros',
            spent_on: isISODate(a.spent_on) ? a.spent_on : today,
          });
        }
        break;
      }
      case 'open_screen':
        if (a.screen) actions.push({ type: 'open_screen', label, screen: a.screen });
        break;
    }
  }
  const reply = raw.reply.trim() || (actions.length ? 'Posso fazer isto:' : 'Não entendi. Pode dizer de outro jeito?');
  return { reply: reply.slice(0, 4000), actions };
}
