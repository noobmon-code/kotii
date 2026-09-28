// Financeiro: categorias, contas a pagar e o resumo de gastos do mês, que
// junta notas fiscais confirmadas, contas pagas e gastos avulsos.

import type { IconName } from './categories';
import { addDays, diffDays, formatBRDate } from './dates';
import { formatBRL } from './money';

export type FinanceCategory =
  | 'mercado'
  | 'casa'
  | 'moradia'
  | 'contas'
  | 'assinaturas'
  | 'saude'
  | 'educacao'
  | 'transporte'
  | 'pet'
  | 'lazer'
  | 'outros';

/** Espelho do domínio finance_category no banco. */
export const FINANCE_CATEGORIES: { key: FinanceCategory; label: string; icon: IconName }[] = [
  { key: 'mercado', label: 'Mercado', icon: 'cart-outline' },
  { key: 'casa', label: 'Limpeza e higiene', icon: 'spray-bottle' },
  { key: 'moradia', label: 'Moradia', icon: 'home-city-outline' },
  { key: 'contas', label: 'Contas da casa', icon: 'lightning-bolt-outline' },
  { key: 'assinaturas', label: 'Assinaturas', icon: 'play-box-multiple-outline' },
  { key: 'saude', label: 'Saúde', icon: 'medical-bag' },
  { key: 'educacao', label: 'Educação', icon: 'school-outline' },
  { key: 'transporte', label: 'Transporte', icon: 'car-outline' },
  { key: 'pet', label: 'Pet', icon: 'paw' },
  { key: 'lazer', label: 'Lazer', icon: 'party-popper' },
  { key: 'outros', label: 'Outros', icon: 'dots-horizontal-circle-outline' },
];

export function getFinanceCategory(key: string) {
  return FINANCE_CATEGORIES.find((c) => c.key === key) ?? FINANCE_CATEGORIES[FINANCE_CATEGORIES.length - 1];
}

const FROM_PRODUCT: Partial<Record<string, FinanceCategory>> = {
  limpeza: 'casa',
  higiene: 'casa',
  papel: 'casa',
  bebe: 'casa',
  pet: 'pet',
  medicamentos: 'saude',
  suplementos: 'saude',
  primeiros_socorros: 'saude',
  outros: 'outros',
};

/** Categoria de produto da nota (hortifruti, limpeza…) -> categoria do financeiro. */
export function financeCategoryOfProduct(productCategory: string | null | undefined): FinanceCategory {
  if (!productCategory) return 'mercado';
  return FROM_PRODUCT[productCategory] ?? 'mercado';
}

// ---------------------------------------------------------------------------
// Contas a pagar

export type BillRecurrence = 'monthly' | 'yearly' | 'once';

export const BILL_RECURRENCES: { value: BillRecurrence; label: string }[] = [
  { value: 'monthly', label: 'Todo mês' },
  { value: 'yearly', label: 'Todo ano' },
  { value: 'once', label: 'Uma vez' },
];

export type BillStatus = { kind: 'atrasada'; days: number } | { kind: 'hoje' } | { kind: 'proxima'; days: number };

export function billStatus(nextDueOn: string, today: string): BillStatus {
  const days = diffDays(today, nextDueOn);
  if (days < 0) return { kind: 'atrasada', days: -days };
  if (days === 0) return { kind: 'hoje' };
  return { kind: 'proxima', days };
}

export function describeBillStatus(status: BillStatus, nextDueOn: string): string {
  switch (status.kind) {
    case 'atrasada':
      return status.days === 1 ? 'Venceu ontem' : `Venceu há ${status.days} dias`;
    case 'hoje':
      return 'Vence hoje';
    case 'proxima':
      return status.days === 1 ? 'Vence amanhã' : status.days <= 7 ? `Vence em ${status.days} dias` : `Vence ${formatBRDate(nextDueOn)}`;
  }
}

export interface BillLike {
  next_due_on: string;
  active: boolean;
  amount: number | null;
}

/** Atrasadas e as que vencem nos próximos `days` dias, da mais urgente. */
export function billsDueSoon<T extends BillLike>(bills: T[], today: string, days = 3): T[] {
  return bills
    .filter((b) => b.active && diffDays(today, b.next_due_on) <= days)
    .sort((a, b) => a.next_due_on.localeCompare(b.next_due_on));
}

/** Quanto ainda vence até o fim do mês (contas de valor variável ficam de fora e são contadas). */
export function stillToPay<T extends BillLike>(bills: T[], today: string): { amount: number; variable: number } {
  const monthEnd = monthRange(today.slice(0, 7)).end;
  const due = bills.filter((b) => b.active && b.next_due_on < monthEnd);
  return {
    amount: round2(due.reduce((sum, b) => sum + (b.amount ?? 0), 0)),
    variable: due.filter((b) => b.amount == null).length,
  };
}

// ---------------------------------------------------------------------------
// Meses

const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "2026-09" -> { start: "2026-09-01", end: "2026-10-01" } (end exclusivo). */
export function monthRange(month: string): { start: string; end: string } {
  return { start: `${month}-01`, end: `${shiftMonth(month, 1)}-01` };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} de ${y}`;
}

export function monthShortLabel(month: string): string {
  return MONTHS_SHORT[Number(month.slice(5, 7)) - 1];
}

// ---------------------------------------------------------------------------
// Lançamentos e resumo

export type EntrySource = 'nota' | 'conta' | 'gasto';

export interface Entry {
  id: string;
  source: EntrySource;
  /** Id da nota, da conta ou do gasto, para abrir o detalhe. */
  refId: string;
  date: string;
  amount: number;
  category: FinanceCategory;
  description: string;
  /** Morador que pagou (divisão de gastos). */
  paidBy?: string | null;
}

export interface ReceiptForSpending {
  id: string;
  purchased_at_date: string;
  total: number | null;
  store_name: string | null;
  items: { total_price: number; category: string | null }[];
  paid_by?: string | null;
}

export interface PaymentForSpending {
  id: string;
  bill_id: string;
  paid_on: string;
  amount: number;
  bill_name: string;
  bill_category: string;
  paid_by?: string | null;
}

export interface ExpenseForSpending {
  id: string;
  spent_on: string;
  amount: number;
  category: string;
  description: string;
  paid_by?: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Tudo que saiu do bolso, como lançamentos. Uma nota vira um lançamento por
 * categoria (o arroz vai para Mercado, o detergente para Limpeza); nota sem
 * itens usa o total. Quando o total cobrado difere da soma dos itens
 * (desconto, item que a leitura perdeu), as categorias são ajustadas na
 * proporção para somar o total.
 */
export function buildEntries(
  receipts: ReceiptForSpending[],
  payments: PaymentForSpending[],
  expenses: ExpenseForSpending[],
): Entry[] {
  const entries: Entry[] = [];
  for (const r of receipts) {
    const store = r.store_name ?? 'Nota fiscal';
    if (!r.items.length) {
      if (r.total) entries.push({ id: `nota-${r.id}`, source: 'nota', refId: r.id, date: r.purchased_at_date, amount: r.total, category: 'mercado', description: store, paidBy: r.paid_by });
      continue;
    }
    const byCategory = new Map<FinanceCategory, number>();
    for (const item of r.items) {
      const category = financeCategoryOfProduct(item.category);
      byCategory.set(category, (byCategory.get(category) ?? 0) + item.total_price);
    }
    const itemsSum = [...byCategory.values()].reduce((sum, v) => sum + v, 0);
    const charged = r.total && r.total > 0 ? r.total : itemsSum;
    if (itemsSum <= 0) {
      if (charged > 0) entries.push({ id: `nota-${r.id}`, source: 'nota', refId: r.id, date: r.purchased_at_date, amount: round2(charged), category: 'mercado', description: store, paidBy: r.paid_by });
      continue;
    }
    const parts = [...byCategory].map(([category, amount]) => ({ category, amount: round2((amount * charged) / itemsSum) }));
    // Sobra do arredondamento vai para a maior parte: a nota soma exatamente o total.
    const largest = parts.reduce((a, b) => (b.amount > a.amount ? b : a));
    largest.amount = round2(largest.amount + charged - parts.reduce((sum, p) => sum + p.amount, 0));
    for (const { category, amount } of parts) {
      entries.push({ id: `nota-${r.id}-${category}`, source: 'nota', refId: r.id, date: r.purchased_at_date, amount, category, description: store, paidBy: r.paid_by });
    }
  }
  for (const p of payments) {
    entries.push({
      id: `conta-${p.id}`,
      source: 'conta',
      refId: p.bill_id,
      date: p.paid_on,
      amount: p.amount,
      category: getFinanceCategory(p.bill_category).key,
      description: p.bill_name,
      paidBy: p.paid_by,
    });
  }
  for (const e of expenses) {
    entries.push({
      id: `gasto-${e.id}`,
      source: 'gasto',
      refId: e.id,
      date: e.spent_on,
      amount: e.amount,
      category: getFinanceCategory(e.category).key,
      description: e.description,
      paidBy: e.paid_by,
    });
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
}

export interface Summary {
  total: number;
  byCategory: { category: FinanceCategory; amount: number }[];
  /** Maiores gastos por mercado/conta/descrição, do maior para o menor. */
  byPlace: { name: string; amount: number }[];
}

export function summarize(entries: Entry[], range: { start: string; end: string }): Summary {
  const inRange = entries.filter((e) => e.date >= range.start && e.date < range.end);
  const byCategory = new Map<FinanceCategory, number>();
  const byPlace = new Map<string, number>();
  for (const e of inRange) {
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
    byPlace.set(e.description, (byPlace.get(e.description) ?? 0) + e.amount);
  }
  const sorted = <K>(m: Map<K, number>) => [...m.entries()].map(([k, v]) => [k, round2(v)] as const).sort((a, b) => b[1] - a[1]);
  return {
    total: round2(inRange.reduce((sum, e) => sum + e.amount, 0)),
    byCategory: sorted(byCategory).map(([category, amount]) => ({ category, amount })),
    byPlace: sorted(byPlace).map(([name, amount]) => ({ name, amount })),
  };
}

/** Total de cada mês, do mais antigo para o mais recente. */
export function monthlyTotals(entries: Entry[], months: string[]): { month: string; total: number }[] {
  return months.map((month) => ({ month, total: summarize(entries, monthRange(month)).total }));
}

export interface PreviousMonth {
  month: string;
  amount: number;
  /** Preenchido no mês corrente: o anterior só conta até este dia. */
  uptoDay: number | null;
}

/**
 * Gasto do mês anterior para comparar. No mês corrente compara só até o
 * mesmo dia: mês pela metade contra mês cheio sempre parece economia.
 */
export function previousMonth(entries: Entry[], month: string, today: string): PreviousMonth {
  const previous = shiftMonth(month, -1);
  const range = monthRange(previous);
  if (today.slice(0, 7) !== month) return { month: previous, amount: summarize(entries, range).total, uptoDay: null };
  const day = Number(today.slice(8, 10));
  const cut = addDays(range.start, day);
  if (cut >= range.end) return { month: previous, amount: summarize(entries, range).total, uptoDay: null };
  return { month: previous, amount: summarize(entries, { start: range.start, end: cut }).total, uptoDay: day };
}

export function describeMonthDelta(current: number, previous: PreviousMonth): string | null {
  if (previous.amount <= 0) return null;
  const name = MONTHS[Number(previous.month.slice(5, 7)) - 1];
  const when = previous.uptoDay ? `até o dia ${previous.uptoDay} de ${name}` : `em ${name}`;
  const diff = round2(current - previous.amount);
  if (diff === 0) return `Igual ao gasto ${when}`;
  return `${formatBRL(Math.abs(diff))} a ${diff > 0 ? 'mais' : 'menos'} que ${when}`;
}
