// Consultor financeiro (beta): o retrato que vai para o Nuke consultor e as
// ações que ele sugere (a pessoa confirma no app). A IA não faz conta: todo
// número que ela pode citar sai pronto daqui.
//
// Privacidade: nada de CPF, número de conta ou agência, linha de boleto nem
// nome de pessoa (PIX para alguém vira "PIX para pessoa física"; o rótulo
// digitado do banco vira o nome da instituição ou "Banco 1"); saúde,
// doações e religião entram só no total da categoria, sem loja.

import type { FinAccount, FinConnection, FinTransaction } from '@/lib/types';

import { normalizeBankText } from './bankCategories';
import { TRANSFER_WORDS } from './bankClassify';
import { connectionWarnings } from './bankHealth';
import { type KotiiRecord, reconcileWindow, reconciliationInRange, reconciliationTotals } from './bankMatch';
import { safeBankLabels } from './bankNames';
import { categoryRulesOf, type FinCategoryRule } from './bankRules';
import {
  accountLabels,
  type BankInstallment,
  type BankPurchase,
  cardBills,
  currentAccounts,
  futureInstallments,
  groupPurchases,
  monthSummary,
  summarizeRange,
  windowPurchases,
} from './bankMonth';
import { budgetProgress, describeBudget } from './budget';
import { addDays, formatBRDate, toISODate } from './dates';
import { FINANCE_CATEGORIES, type FinanceCategory, getFinanceCategory, monthLabel, monthRange, shiftMonth } from './finance';
import { formatBRL } from './money';

/** O servidor recusa acima de 12.000; aqui sobra folga. */
export const SNAPSHOT_MAX_CHARS = 8000;
export const RECENT_LIMIT = 15;
/** Meses de parcelas comprometidas listados no retrato. */
const INSTALLMENT_MONTHS = 6;
/** Meses somados no total das parcelas comprometidas (todas as que faltam). */
const INSTALLMENT_TOTAL_MONTHS = 120;

export interface FinanceSnapshotInput {
  /** Hoje no aparelho (YYYY-MM-DD). */
  today: string;
  /** Agora, para saber há quanto tempo cada banco não atualiza. */
  now: Date;
  connections: FinConnection[];
  accounts: FinAccount[];
  transactions: FinTransaction[];
  budgets: { category: string; monthly_limit: number }[];
  /**
   * Notas, contas pagas e gastos do Kotii (kotiiRecordsFrom) desde
   * kotiiRecordsStart: a janela e, antes dela, o mês da compra parcelada mais
   * antiga que ainda tem parcela na janela.
   */
  kotiiRecords: KotiiRecord[];
  /** Categorias que a pessoa escolheu (bankRules); sem elas, só as automáticas. */
  categoryRules?: FinCategoryRule[];
  /** O que ela já pôs em Saúde algum dia (fin_sensitive_keys): só entra somado. */
  sensitiveKeys?: string[];
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

/**
 * "parcela 2 de 10 de uma compra de R$ 1.500,00 (a 1ª em terça, 1/9)": o
 * valor é o da compra inteira, não o que já foi pago. A data estimada pela
 * parcela vai só com o mês, como aproximada; a de outro ano, com o ano.
 */
function parcelText(p: BankPurchase & { installment: BankInstallment }, today: string): string {
  const { installment } = p;
  const what = p.autoCategory === 'taxas' ? 'cobrança' : 'compra';
  const day = installment.purchaseDate;
  const first = installment.purchaseExact
    ? `a 1ª em ${day.slice(0, 4) === today.slice(0, 4) ? dayLabel(day) : `${dayLabel(day)}/${day.slice(0, 4)}`}`
    : `a 1ª por volta de ${monthLabel(day.slice(0, 7))}`;
  return `parcela ${installment.number} de ${installment.total} de uma ${what} de ${formatBRL(installment.purchaseAmount)} (${first})`;
}

/** Texto do retrato em linhas curtas (até SNAPSHOT_MAX_CHARS). */
export function buildFinanceSnapshot(input: FinanceSnapshotInput): string {
  const { today } = input;
  const month = today.slice(0, 7);
  const purchases = groupPurchases(
    input.transactions,
    input.accounts,
    undefined,
    categoryRulesOf(input.categoryRules ?? []),
    new Set(input.sensitiveKeys ?? []),
  );
  // O rótulo do banco é digitado pela pessoa e pode ter nome de gente ("Conta da Maria"): aqui vai só a
  // instituição reconhecida ou "Banco 1", "Banco 2"... (a tela continua com o rótulo dela). Os nomes das
  // contas e cartões ("Nubank conta", "Banco 1 cartão") saem destes.
  const safeLabels = safeBankLabels(input.connections);
  const connections = input.connections.map((c) => ({ ...c, label: safeLabels.get(c.id) ?? 'Banco' }));
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

  // Mês atual: a compra pela data dela, a parcela pelo mês dela.
  const current = monthSummary(purchases, month);
  lines.push(
    `No banco em ${monthLabel(month)} (pela data da compra; de compra parcelada, só a parcela do mês): ` +
      `saídas ${formatBRL(current.spending)} em ${count(current.count, 'lançamento', 'lançamentos')}` +
      `${current.pending > 0 ? ` (${formatBRL(current.pending)} ainda previsto, pendente no banco)` : ''}; ` +
      `entradas ${formatBRL(current.income)}; estornos ${formatBRL(current.refunds)} (já abatidos das saídas)` +
      `${current.otherRefunds > 0 ? `; mais ${formatBRL(current.otherRefunds)} em estornos sem a compra correspondente nestes meses (não abatidos)` : ''}.`,
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

  // Parcelas de compras já feitas que ainda vão ser cobradas: do mês atual, só as que o banco não lançou.
  const future = futureInstallments(purchases, today, INSTALLMENT_TOTAL_MONTHS).filter((m) => m.amount > 0);
  const listed = future
    .filter((m) => m.month < shiftMonth(month, INSTALLMENT_MONTHS))
    .map((m) => {
      const parcels = m.month === month ? count(m.parcels.length, 'parcela ainda não lançada', 'parcelas ainda não lançadas') : count(m.parcels.length, 'parcela', 'parcelas');
      return `${monthLabel(m.month)} ${formatBRL(m.amount)} (${parcels})`;
    });
  const futureTotal = Math.round(future.reduce((sum, m) => sum + m.amount, 0) * 100) / 100;
  const futureCount = future.reduce((sum, m) => sum + m.parcels.length, 0);
  lines.push(
    `Parcelas já comprometidas: ${
      future.length
        ? `${listed.join('; ')}${listed.length ? '; ' : ''}no total, ${formatBRL(futureTotal)} em ${count(futureCount, 'parcela', 'parcelas')} até ${monthLabel(future[future.length - 1].month)}`
        : 'nenhuma'
    }.`,
  );

  // Conferência com o Kotii no mês atual (casada na janela inteira, como na tela): cada parcela conta no mês
  // dela, e a nota de uma compra parcelada vale para todas as parcelas.
  const totals = reconciliationTotals(reconciliationInRange(reconcileWindow(purchases, input.kotiiRecords, today), monthRange(month)));
  lines.push(
    `Conferência de ${monthLabel(month)} com o Kotii: ${formatBRL(totals.inKotii)} em ${count(totals.inKotiiCount, 'lançamento', 'lançamentos')} já no Kotii ` +
      `(notas, contas ou gastos; a nota de uma compra parcelada vale para cada parcela); ` +
      `${formatBRL(totals.bankOnly)} em ${count(totals.bankOnlyCount, 'lançamento', 'lançamentos')} só no banco.`,
  );

  // Lançamentos recentes, com apelido t1..t15. Sensíveis ficam só no total da categoria. A parcela aparece
  // no mês dela, com a compra inteira ao lado.
  const recent = windowPurchases(purchases, today)
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
        p.installment ? parcelText({ ...p, installment: p.installment }, today) : null,
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
