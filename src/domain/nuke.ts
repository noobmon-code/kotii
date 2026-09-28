// Nuke, o assistente da casa: o retrato da casa que vai para a IA, o
// histórico enviado e as ações que ele sugere (a pessoa confirma no app).

import { formatBRDate } from './dates';
import { getFinanceCategory } from './finance';
import { formatBRL, formatQuantity } from './money';

export type NukeScreen =
  | 'hoje'
  | 'compras'
  | 'cardapio'
  | 'despensa'
  | 'tarefas'
  | 'aparelhos'
  | 'financas'
  | 'contas'
  | 'notas'
  | 'precos'
  | 'saude'
  | 'familia';

export type NukeAction =
  | {
      type: 'add_to_list';
      label: string;
      items: { name: string; quantity: number; unit: 'un' | 'kg' | 'g' | 'l' | 'ml'; category: string }[];
    }
  | {
      type: 'create_chore';
      label: string;
      title: string;
      due_on: string;
      recurrence: 'none' | 'daily' | 'weekly' | 'monthly';
    }
  | { type: 'add_expense'; label: string; description: string; amount: number; category: string; spent_on: string }
  | { type: 'open_screen'; label: string; screen: NukeScreen };

export interface NukeMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Ações sugeridas; `done` e `note` depois que a pessoa confirma. */
  actions?: (NukeAction & { done?: boolean; note?: string })[];
  /** Resposta que falhou: aparece na conversa, mas não vai para a IA. */
  error?: boolean;
}

/** Tudo o que o Nuke sabe da casa, já filtrado pelo app. */
export interface NukeSnapshot {
  today: string;
  household: string;
  me: string;
  members: string[];
  doses: { time: string; name: string; person: string; taken: boolean }[];
  chores: { title: string; due_on: string; assignee: string | null }[];
  expiring: { name: string; expires_on: string }[];
  pantry: string[];
  shopping: { list: string; items: { name: string; quantity: number; unit: string }[] }[];
  /** Cardápio de hoje em diante (menuLines). */
  menu?: string[];
  bills: { name: string; amount: number | null; next_due_on: string; autopay: boolean }[];
  spending: {
    month: string;
    total: number;
    byCategory: { category: string; amount: number }[];
    previousMonth: string;
    previousTotal: number;
    /** Limites do mês por categoria (orçamento), se houver. */
    budgets?: { category: string; limit: number; spent: number }[];
  } | null;
  appointments: { starts_at: string; title: string; person: string }[];
  documents: { title: string; status: string }[];
  warranties: { name: string; status: string }[];
}

const LIMIT = 25;

function listOrNone(items: string[], limit = LIMIT): string {
  if (!items.length) return 'nada';
  const shown = items.slice(0, limit).join('; ');
  return items.length > limit ? `${shown}; e mais ${items.length - limit}` : shown;
}

const shortDate = (iso: string) => formatBRDate(iso).slice(0, 5);

/** Texto compacto com o estado da casa, em linhas curtas para a IA ler. */
export function buildNukeContext(s: NukeSnapshot): string {
  const lines = [
    `Casa: ${s.household}. Moradores: ${s.members.map((m) => (m === s.me ? `${m} (quem está falando)` : m)).join(', ')}.`,
    `Hoje: ${formatBRDate(s.today)}.`,
    `Remédios de hoje: ${listOrNone(s.doses.map((d) => `${d.time} ${d.name} (${d.person}) ${d.taken ? 'tomado' : 'pendente'}`))}.`,
    `Tarefas (atrasadas e próximos 7 dias): ${listOrNone(
      s.chores.map((c) => `${c.title} — ${c.due_on < s.today ? 'atrasada desde' : 'vence'} ${shortDate(c.due_on)}${c.assignee ? ` (${c.assignee})` : ''}`),
    )}.`,
    `Despensa vencendo: ${listOrNone(s.expiring.map((p) => `${p.name} (${p.expires_on < s.today ? 'venceu' : 'vence'} ${shortDate(p.expires_on)})`))}.`,
    `Despensa (tem em casa): ${listOrNone(s.pantry, 40)}.`,
    ...(s.shopping.length
      ? s.shopping.map((l) => `Lista "${l.list}" (falta comprar): ${listOrNone(l.items.map((i) => `${i.name} ${formatQuantity(i.quantity, i.unit)}`))}.`)
      : ['Listas de compras: nada pendente.']),
    `Cardápio (hoje e próximos dias): ${listOrNone(s.menu ?? [], 14)}.`,
    `Contas (atrasadas e próximos 30 dias): ${listOrNone(
      s.bills.map(
        (b) =>
          `${b.name} ${b.amount != null ? formatBRL(b.amount) : 'valor varia'} — ${b.next_due_on < s.today ? 'venceu' : 'vence'} ${shortDate(b.next_due_on)}${b.autopay ? ' (débito automático)' : ''}`,
      ),
    )}.`,
  ];
  if (s.spending) {
    const cats = s.spending.byCategory.map((c) => `${getFinanceCategory(c.category).label} ${formatBRL(c.amount)}`);
    lines.push(
      `Gastos de ${s.spending.month} até hoje: ${formatBRL(s.spending.total)} (${listOrNone(cats, 8)}). ${s.spending.previousMonth} inteiro: ${formatBRL(s.spending.previousTotal)}.`,
    );
    if (s.spending.budgets?.length) {
      const budgets = s.spending.budgets.map(
        (b) =>
          `${getFinanceCategory(b.category).label} ${formatBRL(b.spent)} de ${formatBRL(b.limit)}${b.spent > b.limit ? ' (passou)' : ''}`,
      );
      lines.push(`Orçamento de ${s.spending.month}: ${budgets.join('; ')}.`);
    }
  }
  lines.push(
    `Consultas (próximos 14 dias): ${listOrNone(
      s.appointments.map((a) => `${shortDate(a.starts_at.slice(0, 10))} ${a.starts_at.slice(11, 16)} ${a.title} (${a.person})`),
    )}.`,
    `Documentos pedindo atenção: ${listOrNone(s.documents.map((d) => `${d.title} — ${d.status}`))}.`,
    `Garantias acabando: ${listOrNone(s.warranties.map((w) => `${w.name} — ${w.status}`))}.`,
  );
  return lines.join('\n');
}

export const HISTORY_LIMIT = 12;

/** O que vai para a IA: as últimas falas, sem respostas que falharam. */
export function historyForApi(messages: NukeMessage[], limit = HISTORY_LIMIT): { role: 'user' | 'assistant'; text: string }[] {
  return messages
    .filter((m) => !m.error && m.text.trim())
    .slice(-limit)
    .map((m) => ({ role: m.role, text: m.text }));
}

const UNITS = new Set(['un', 'kg', 'g', 'l', 'ml']);
const RECURRENCES = new Set(['none', 'daily', 'weekly', 'monthly']);
const SCREENS = new Set<string>(['hoje', 'compras', 'cardapio', 'despensa', 'tarefas', 'aparelhos', 'financas', 'contas', 'notas', 'precos', 'saude', 'familia']);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Confere cada ação que veio da função antes de mostrar um botão para ela. */
export function parseActions(raw: unknown): NukeAction[] {
  if (!Array.isArray(raw)) return [];
  const out: NukeAction[] = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object' || !isText(a.label)) continue;
    if (a.type === 'add_to_list' && Array.isArray(a.items)) {
      const items = a.items.filter(
        (i: { name?: unknown; quantity?: unknown; unit?: unknown; category?: unknown }) =>
          isText(i?.name) && typeof i.quantity === 'number' && i.quantity > 0 && UNITS.has(String(i.unit)) && isText(i.category),
      );
      if (items.length) out.push({ type: 'add_to_list', label: a.label, items });
    } else if (a.type === 'create_chore' && isText(a.title) && isDate(a.due_on) && RECURRENCES.has(a.recurrence)) {
      out.push({ type: 'create_chore', label: a.label, title: a.title, due_on: a.due_on, recurrence: a.recurrence });
    } else if (
      a.type === 'add_expense' &&
      isText(a.description) &&
      typeof a.amount === 'number' &&
      a.amount > 0 &&
      isText(a.category) &&
      isDate(a.spent_on)
    ) {
      out.push({ type: 'add_expense', label: a.label, description: a.description, amount: a.amount, category: a.category, spent_on: a.spent_on });
    } else if (a.type === 'open_screen' && SCREENS.has(a.screen)) {
      out.push({ type: 'open_screen', label: a.label, screen: a.screen });
    }
  }
  return out;
}

/** Linha de resumo da ação, abaixo do título do botão. */
export function describeAction(action: NukeAction): string {
  switch (action.type) {
    case 'add_to_list':
      return action.items.map((i) => `${i.name} (${formatQuantity(i.quantity, i.unit)})`).join(', ');
    case 'create_chore':
      return `${action.title} · ${formatBRDate(action.due_on)}`;
    case 'add_expense':
      return `${action.description} · ${formatBRL(action.amount)} · ${getFinanceCategory(action.category).label}`;
    case 'open_screen':
      return '';
  }
}

export const NUKE_SUGGESTIONS = [
  'O que pede atenção hoje?',
  'Quanto gastei este mês?',
  'O que dá para cozinhar com o que tem na despensa?',
  'Coloca café e leite na lista',
];
