// Consultor financeiro (beta): o retrato que vai para o Nuke consultor e as
// ações que ele sugere (a pessoa confirma no app). A IA não faz conta: todo
// número que ela pode citar sai pronto daqui.
//
// Privacidade: nada de CPF, número de conta ou agência, linha de boleto nem
// nome de pessoa (PIX para alguém vira "PIX para pessoa física"); saúde,
// doações e religião entram só no total da categoria, sem loja.

import type { FinAccount, FinConnection, FinTransaction } from '@/lib/types';

import { normalizeBankText } from './bankCategories';
import { TRANSFER_WORDS } from './bankClassify';
import { connectionWarnings } from './bankHealth';
import { matchBankToNooky, type NookyRecord, reconciliationInRange, reconciliationTotals } from './bankMatch';
import {
  accountLabels,
  type BankPurchase,
  cardBills,
  currentAccounts,
  futureInstallments,
  groupPurchases,
  monthSummary,
  summarizeRange,
} from './bankMonth';
import { budgetProgress, describeBudget } from './budget';
import { addDays, formatBRDate, toISODate } from './dates';
import { FINANCE_CATEGORIES, type FinanceCategory, getFinanceCategory, monthLabel, monthRange, shiftMonth } from './finance';
import { formatBRL } from './money';

/** O servidor recusa acima de 12.000; aqui sobra folga. */
export const SNAPSHOT_MAX_CHARS = 8000;
export const RECENT_LIMIT = 15;
/** Meses de parcelas comprometidas no retrato. */
const INSTALLMENT_MONTHS = 6;

export interface FinanceSnapshotInput {
  /** Hoje no aparelho (YYYY-MM-DD). */
  today: string;
  /** Agora, para saber há quanto tempo cada banco não atualiza. */
  now: Date;
  connections: FinConnection[];
  accounts: FinAccount[];
  transactions: FinTransaction[];
  budgets: { category: string; monthly_limit: number }[];
  /** Notas, contas pagas e gastos do Nooky na mesma janela (nookyRecordsFrom). */
  nookyRecords: NookyRecord[];
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "sexta, 3/10" */
export function dayLabel(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  const weekday = WEEKDAYS[new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay()];
  return `${weekday}, ${d}/${m}`;
}

const shortDate = (iso: string) => formatBRDate(iso).slice(0, 5);
/** Dia, no fuso do aparelho, de um instante gravado em UTC (22h30 do dia 7 é 01h30 UTC do dia 8). */
const localDay = (timestamp: string) => toISODate(new Date(timestamp));
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const categoryLabel = (key: FinanceCategory) => getFinanceCategory(key).label;

/**
 * Tira o que pode identificar alguém ou uma conta: máscaras, sequências de
 * dígitos (CPF, conta, agência, boleto) e e-mail.
 */
export function scrubText(text: string): string {
  return text
    .replace(/\S+@\S+/g, ' ')
    .replace(/[•*●∙]+/g, ' ')
    .replace(/[.\-/]*\d[\d.\-/ ]{3,}\d[.\-/]*/g, ' ')
    .replace(/\d{4,}/g, ' ')
    // Sobra de máscara ("***.123.456-**" vira " . - ").
    .replace(/(^|\s)[.\-/()]+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–·]+|[\s\-–·]+$/g, '')
    .slice(0, 40)
    .trim();
}

/** Nome genérico quando o texto do banco pode trazer nome de pessoa. */
function genericLabel(p: BankPurchase, text: string): string {
  const outgoing = p.kind === 'spending';
  if (/\bboleto\b/.test(text)) return outgoing ? 'Boleto pago' : 'Boleto recebido';
  if (/\bsalario\b/.test(text)) return 'Salário';
  if (/\bdeposito\b/.test(text)) return 'Depósito';
  if (/\bsaque\b/.test(text)) return 'Saque';
  return p.kind === 'income' ? 'Entrada' : p.kind === 'refund' ? 'Estorno' : 'Pagamento';
}

/**
 * Como a compra aparece para a IA. Transferência nunca leva nome (pode ser
 * de pessoa, e a descrição do banco costuma trazer CPF e conta). O resto só
 * leva nome quando ele é de loja (BankPurchase.storeName: loja reconhecida
 * pela Pluggy, empresa ou compra com cartão); boleto, depósito e outros
 * textos livres da conta viram um nome genérico.
 */
export function purchaseLabel(p: BankPurchase): string {
  const text = normalizeBankText(p.description);
  const pix = /\bpix\b/.test(text);
  const outgoing = p.kind === 'spending';
  if (p.personTransfer) {
    const how = pix ? 'PIX' : /\bboleto\b/.test(text) ? 'Boleto' : 'Transferência';
    return `${how} ${outgoing ? 'para' : 'de'} pessoa física`;
  }
  if (TRANSFER_WORDS.test(text)) {
    const who = p.merchantCnpj ? (outgoing ? ' para empresa' : ' de empresa') : outgoing ? ' enviado' : ' recebido';
    return pix ? `PIX${who}` : `Transferência${who.replace('enviado', 'enviada').replace('recebido', 'recebida')}`;
  }
  return (p.storeName && scrubText(p.storeName)) || genericLabel(p, text);
}

const KIND_WORD: Partial<Record<BankPurchase['kind'], string>> = {
  spending: 'saída',
  refund: 'estorno',
  income: 'entrada',
};

/** Texto do retrato em linhas curtas (até SNAPSHOT_MAX_CHARS). */
export function buildFinanceSnapshot(input: FinanceSnapshotInput): string {
  const { today } = input;
  const month = today.slice(0, 7);
  const purchases = groupPurchases(input.transactions, input.accounts);
  // O rótulo do banco é digitado pela pessoa: passa pela mesma limpeza.
  const connections = input.connections.map((c) => ({ ...c, label: scrubText(c.label) || 'Banco' }));
  const labels = accountLabels(input.accounts, connections);
  const lines: string[] = [];

  lines.push(`Hoje: ${dayLabel(today)}/${today.slice(0, 4)}. Mês atual: ${monthLabel(month)}.`);
  lines.push(
    connections.length
      ? `Bancos conectados: ${connections
          .map((c) => `${c.label}${c.item_updated_at ? ` (atualizado em ${shortDate(localDay(c.item_updated_at))})` : ''}`)
          .join('; ')}.`
      : 'Nenhum banco conectado ainda.',
  );
  const warnings = connectionWarnings(connections, input.now);
  lines.push(`Avisos dos bancos: ${warnings.length ? warnings.map((w) => w.message).join(' ') : 'nenhum.'}`);

  // Mês atual, pela data da compra.
  const current = monthSummary(purchases, month);
  lines.push(
    `No banco em ${monthLabel(month)} (pela data da compra): saídas ${formatBRL(current.spending)} em ${count(current.count, 'compra', 'compras')}` +
      `${current.pending > 0 ? ` (${formatBRL(current.pending)} ainda previsto, pendente no banco)` : ''}; ` +
      `entradas ${formatBRL(current.income)}; estornos ${formatBRL(current.refunds)} (já abatidos das saídas).`,
  );

  // Categorias x orçamento.
  const budgetLines = budgetProgress(input.budgets, current.byCategory);
  const budgeted = new Set(budgetLines.map((b) => b.category));
  const categoryParts = [
    ...budgetLines.map((b) => `${categoryLabel(b.category)}: ${describeBudget(b)}${b.status === 'estourou' ? ' (passou do orçamento)' : ''}`),
    ...current.byCategory
      .filter((c) => !budgeted.has(c.category))
      .map((c) => `${categoryLabel(c.category)}: ${formatBRL(c.amount)} (sem orçamento)`),
  ];
  lines.push(`Saídas por categoria em ${monthLabel(month)}: ${categoryParts.length ? categoryParts.join('; ') : 'nenhuma'}.`);

  // Comparação: mesmo período do mês passado e os dois meses anteriores inteiros.
  const day = Number(today.slice(8, 10));
  const previous = shiftMonth(month, -1);
  const prevRange = monthRange(previous);
  const prevCut = addDays(prevRange.start, day);
  const prevToDate = summarizeRange(purchases, { start: prevRange.start, end: prevCut < prevRange.end ? prevCut : prevRange.end });
  const currentToDate = summarizeRange(purchases, { start: monthRange(month).start, end: addDays(today, 1) });
  const diff = Math.round((currentToDate.spending - prevToDate.spending) * 100) / 100;
  const prevName = monthLabel(previous).split(' ')[0];
  lines.push(
    `Até hoje: saídas ${formatBRL(currentToDate.spending)}; em ${prevName} até o dia ${day}: ${formatBRL(prevToDate.spending)}` +
      `${diff === 0 ? ' (igual)' : ` (${formatBRL(Math.abs(diff))} a ${diff > 0 ? 'mais' : 'menos'} agora)`}.`,
  );
  const history = [1, 2].map((back) => {
    const m = shiftMonth(month, -back);
    const s = monthSummary(purchases, m);
    const top = s.byCategory
      .slice(0, 3)
      .map((c) => `${categoryLabel(c.category)} ${formatBRL(c.amount)}`)
      .join(', ');
    return `${monthLabel(m)}: saídas ${formatBRL(s.spending)}, entradas ${formatBRL(s.income)}${top ? ` (maiores: ${top})` : ''}`;
  });
  lines.push(`Meses anteriores inteiros: ${history.join('; ')}.`);

  // Saldos e cartões, como o banco informa (sem as contas que sumiram da Pluggy).
  const accounts = currentAccounts(input.accounts, input.connections);
  const balances = accounts
    .filter((a) => a.type === 'BANK')
    .map((a) => `${labels.get(a.id)}: ${a.balance != null ? formatBRL(a.balance) : 'saldo indisponível'}`);
  lines.push(`Saldos das contas: ${balances.length ? balances.join('; ') : 'nenhuma conta corrente'}.`);
  const bills = cardBills(accounts, labels, today).map((b) =>
    [
      `${b.label}: limite usado ${b.amount != null ? `${formatBRL(b.amount)} (fatura aberta mais parcelas a vencer)` : 'não informado'}`,
      b.dueDate ? `vence ${dayLabel(b.dueDate)}` : null,
      b.closeDate ? `fecha ${dayLabel(b.closeDate)}` : null,
      b.minimumPayment != null ? `mínimo ${formatBRL(b.minimumPayment)}` : null,
      b.availableCredit != null ? `limite disponível ${formatBRL(b.availableCredit)}` : null,
    ]
      .filter(Boolean)
      .join(', '),
  );
  lines.push(`Cartões: ${bills.length ? bills.join('; ') : 'nenhum cartão'}.`);

  const future = futureInstallments(purchases, shiftMonth(month, 1), INSTALLMENT_MONTHS).filter((m) => m.amount > 0);
  lines.push(
    `Parcelas já comprometidas nos próximos meses: ${
      future.length ? future.map((m) => `${monthLabel(m.month)} ${formatBRL(m.amount)} (${count(m.parcels.length, 'parcela', 'parcelas')})`).join('; ') : 'nenhuma'
    }.`,
  );

  // Conferência com o Nooky no mês atual (casada na janela inteira, como na tela).
  const totals = reconciliationTotals(reconciliationInRange(matchBankToNooky(purchases, input.nookyRecords), monthRange(month)));
  lines.push(
    `Conferência de ${monthLabel(month)} com o Nooky: ${formatBRL(totals.inNooky)} em ${count(totals.inNookyCount, 'compra', 'compras')} já no Nooky ` +
      `(notas, contas ou gastos); ${formatBRL(totals.bankOnly)} em ${count(totals.bankOnlyCount, 'compra', 'compras')} só no banco.`,
  );

  // Lançamentos recentes, com apelido t1..t15. Sensíveis ficam só no total da categoria.
  const recent = purchases
    .filter((p) => KIND_WORD[p.kind] && !p.sensitive && p.date <= today)
    .slice(0, RECENT_LIMIT)
    .map((p, i) => {
      const parts = [
        `t${i + 1} ${dayLabel(p.date)}`,
        KIND_WORD[p.kind],
        p.kind === 'income' ? null : categoryLabel(p.category),
        purchaseLabel(p),
        formatBRL(p.amount),
        labels.get(p.accountId) ?? null,
        p.installments ? `parcelada em ${p.installments.total}x de ${formatBRL(p.installments.parcel)}` : null,
        p.pending ? 'previsto' : null,
      ];
      return parts.filter(Boolean).join(' · ');
    });

  const head = lines.join('\n');
  const title = 'Lançamentos recentes (o mais novo primeiro):';
  while (recent.length) {
    const text = `${head}\n${title}\n${recent.join('\n')}`;
    if (text.length <= SNAPSHOT_MAX_CHARS) return text;
    recent.pop();
  }
  const text = `${head}\n${title} nenhum.`;
  if (text.length <= SNAPSHOT_MAX_CHARS) return text;
  // Muitos bancos e categorias: corta na última linha que cabe.
  const cut = text.lastIndexOf('\n', SNAPSHOT_MAX_CHARS);
  return text.slice(0, cut > 0 ? cut : SNAPSHOT_MAX_CHARS);
}

// ---------------------------------------------------------------------------
// Conversa e ações

export const FINANCE_SCREENS = ['consultor', 'financas', 'orcamento', 'contas', 'notas'] as const;
export type FinanceScreen = (typeof FINANCE_SCREENS)[number];

export type FinanceAction =
  | { type: 'open_screen'; label: string; screen: FinanceScreen }
  | { type: 'set_budget'; label: string; category: FinanceCategory; amount: number };

export interface FinanceMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Ações sugeridas; `done` e `note` depois que a pessoa confirma. */
  actions?: (FinanceAction & { done?: boolean; note?: string })[];
  /** Resposta que falhou: aparece na conversa, mas não vai para a IA. */
  error?: boolean;
}

export const FINANCE_HISTORY_LIMIT = 12;

/** O que vai para a IA: as últimas falas, sem respostas que falharam. */
export function financeHistoryForApi(
  messages: FinanceMessage[],
  limit = FINANCE_HISTORY_LIMIT,
): { role: 'user' | 'assistant'; text: string }[] {
  return messages
    .filter((m) => !m.error && m.text.trim())
    .slice(-limit)
    .map((m) => ({ role: m.role, text: m.text }));
}

/** Mesmas regras do servidor (nuke-finance/advisor.ts, cleanReply). */
export const MAX_FINANCE_ACTIONS = 3;
export const MAX_BUDGET = 1_000_000;

const DEFAULT_LABEL: Record<FinanceAction['type'], string> = {
  open_screen: 'Abrir',
  set_budget: 'Definir orçamento',
};

const CATEGORY_KEYS = new Set<string>(FINANCE_CATEGORIES.map((c) => c.key));
const isScreen = (value: unknown): value is FinanceScreen => (FINANCE_SCREENS as readonly unknown[]).includes(value);

/** Confere cada ação que veio da função antes de mostrar um botão para ela. */
export function parseFinanceActions(raw: unknown): FinanceAction[] {
  if (!Array.isArray(raw)) return [];
  const out: FinanceAction[] = [];
  for (const a of raw) {
    if (out.length >= MAX_FINANCE_ACTIONS) break;
    if (!a || typeof a !== 'object') continue;
    const label = (typeof a.label === 'string' && a.label.trim()) || '';
    if (a.type === 'open_screen') {
      if (isScreen(a.screen)) out.push({ type: 'open_screen', label: label || DEFAULT_LABEL.open_screen, screen: a.screen });
    } else if (a.type === 'set_budget') {
      const amount = typeof a.amount === 'number' && Number.isFinite(a.amount) ? Math.round(a.amount * 100) / 100 : 0;
      if (typeof a.category === 'string' && CATEGORY_KEYS.has(a.category) && amount > 0 && amount <= MAX_BUDGET) {
        out.push({ type: 'set_budget', label: label || DEFAULT_LABEL.set_budget, category: a.category as FinanceCategory, amount });
      }
    }
  }
  return out;
}

/** Linha de resumo da ação, abaixo do título do botão. */
export function describeFinanceAction(action: FinanceAction): string {
  switch (action.type) {
    case 'set_budget':
      // O orçamento é da casa: o resto da casa também vê o novo limite.
      return `${categoryLabel(action.category)} · ${formatBRL(action.amount)} por mês · vale para a casa toda`;
    case 'open_screen':
      return '';
  }
}

export const FINANCE_SUGGESTIONS = [
  'Como estão meus gastos este mês?',
  'Em que categoria passei do orçamento?',
  'Quanto já está comprometido em parcelas?',
  'Quando vence a fatura do cartão?',
];
