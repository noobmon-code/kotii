// Conta acima do normal: o "normal" de uma conta que se repete todo mês é a
// média dos últimos pagamentos, e o app avisa quando um valor vem bem acima
// dele (ao pagar, no boleto guardado, na lista de contas e no histórico).
// Sai tudo dos pagamentos como estão agora: desfazer um pagamento ou pagar
// outro valor muda o resultado na hora.

import { parseBoleto } from './boleto';
import { addMonths } from './dates';
import type { BillRecurrence } from './finance';
import { formatBRL } from './money';

/** O normal é a média de até 6 pagamentos, dos 6 meses antes do vencimento… */
export const USUAL_PAYMENTS = 6;
const USUAL_MONTHS = 6;
/** …e só existe com pelo menos 3. */
const MIN_PAYMENTS = 3;
/** Acima do normal: pelo menos 20% e pelo menos R$ 10,00 a mais (as duas coisas). */
const ABOVE_PERCENT = 20;
const ABOVE_CENTS = 1000;

export const ABOVE_USUAL_LABEL = 'Acima do normal';

export interface UsualPayment {
  due_on: string;
  amount: number;
}

/** Pagamento com a conta dele: as listas trazem os de todas as contas juntos. */
export interface BillUsualPayment extends UsualPayment {
  bill_id: string;
}

export interface UsualBill {
  id: string;
  recurrence: BillRecurrence;
  next_due_on: string;
  active: boolean;
  amount: number | null;
  boleto: string | null;
}

export interface Usual {
  average: number;
  /** Quantos pagamentos entraram na média (de 3 a 6). */
  count: number;
}

export interface UsualComparison {
  kind: 'acima' | 'normal';
  /** Em reais; negativo quando veio abaixo do normal. */
  diff: number;
  /** Inteiro, sobre o normal. */
  percent: number;
}

// As contas são feitas em centavos: 0,1 + 0,2 não pode decidir um aviso.
const cents = (value: number) => Math.round(value * 100);

/** Onde começa a janela do normal de um vencimento. */
const windowStart = (dueOn: string) => addMonths(dueOn, -USUAL_MONTHS);

/**
 * O normal da conta para o vencimento `before`: a média dos pagamentos mais
 * recentes antes dele, pelo vencimento. O pagamento do próprio `before` (o
 * que está sendo julgado) nunca entra.
 */
export function usualAmount(payments: UsualPayment[], { before }: { before: string }): Usual | null {
  const since = windowStart(before);
  // Mês registrado com R$ 0,00 (sem cobrança, isenção) não é pagamento: puxaria o normal para baixo.
  const recent = payments
    .filter((p) => p.due_on >= since && p.due_on < before && p.amount > 0)
    .sort((a, b) => b.due_on.localeCompare(a.due_on))
    .slice(0, USUAL_PAYMENTS);
  if (recent.length < MIN_PAYMENTS) return null;
  const average = Math.round(recent.reduce((sum, p) => sum + cents(p.amount), 0) / recent.length) / 100;
  return average > 0 ? { average, count: recent.length } : null;
}

/** Compara um valor com o normal; null sem valor ou sem normal. Não há aviso de "abaixo". */
export function compareToUsual(amount: number | null | undefined, usual: Usual | null | undefined): UsualComparison | null {
  if (amount == null || !Number.isFinite(amount) || !usual) return null;
  const average = cents(usual.average);
  const diff = cents(amount) - average;
  const above = diff >= ABOVE_CENTS && diff * 100 >= ABOVE_PERCENT * average;
  // "|| 0": um pouco abaixo do normal arredonda para -0.
  return { kind: above ? 'acima' : 'normal', diff: diff / 100, percent: Math.round((diff * 100) / average) || 0 };
}

/**
 * Cada pagamento contra o normal da época dele (os pagamentos de antes), na
 * ordem recebida; null onde ainda não havia normal.
 */
export function judgePayments(payments: UsualPayment[]): (UsualComparison | null)[] {
  return payments.map((p) => compareToUsual(p.amount, usualAmount(payments, { before: p.due_on })));
}

/**
 * Vencimentos do histórico de uma conta que foram pagos acima do normal da
 * época. `complete: false` quando a lista veio cortada (a tela busca só os
 * pagamentos mais recentes): aquele cuja janela começa antes do mais antigo
 * que veio fica sem selo, porque faltaria parte da média dele.
 */
export function paymentsAboveUsual(
  bill: Pick<UsualBill, 'recurrence'>,
  payments: UsualPayment[],
  { complete = true }: { complete?: boolean } = {},
): Set<string> {
  if (bill.recurrence !== 'monthly') return new Set();
  const oldest = complete ? null : payments.reduce<string | null>((min, p) => (min == null || p.due_on < min ? p.due_on : min), null);
  const judged = judgePayments(payments);
  return new Set(
    payments
      .filter((p, index) => judged[index]?.kind === 'acima' && (oldest == null || windowStart(p.due_on) >= oldest))
      .map((p) => p.due_on),
  );
}

/**
 * O histórico como a tela da conta usa. `rows` são os pagamentos que a busca
 * trouxe, do mais novo para o mais antigo, e `total` é quantos a conta tem
 * (a contagem do servidor). Os `limit` primeiros aparecem; todos os que
 * vieram entram na conta do normal; `complete` diz se vieram todos. Sai da
 * contagem, e não do tamanho da página: a conta com exatamente tantos
 * pagamentos quantos a busca traz veio inteira.
 */
export function paymentHistory<T>(rows: T[], total: number, limit: number): { shown: T[]; complete: boolean } {
  return { shown: rows.slice(0, limit), complete: total <= rows.length };
}

/** O normal da conta para o vencimento em aberto. Conta anual ou de uma vez só não tem. */
export function billUsual(bill: Pick<UsualBill, 'id' | 'recurrence' | 'next_due_on'>, payments: BillUsualPayment[]): Usual | null {
  if (bill.recurrence !== 'monthly') return null;
  return usualAmount(
    payments.filter((p) => p.bill_id === bill.id),
    { before: bill.next_due_on },
  );
}

export interface KnownAmount {
  amount: number;
  source: 'boleto' | 'fixo';
}

/** Valor já conhecido do próximo vencimento: o do boleto guardado ou, sem ele, o valor fixo da conta. */
export function knownNextAmount(bill: Pick<UsualBill, 'amount' | 'boleto'>, today: string): KnownAmount | null {
  const boleto = bill.boleto ? (parseBoleto(bill.boleto, today)?.amount ?? null) : null;
  if (boleto != null) return { amount: boleto, source: 'boleto' };
  return bill.amount != null ? { amount: bill.amount, source: 'fixo' } : null;
}

export interface BillAbove {
  known: KnownAmount;
  usual: Usual;
  comparison: UsualComparison;
}

/**
 * O valor fixo que a própria pessoa aumentou só é novidade até o primeiro pagamento exatamente nele:
 * depois disso, avisar "acima do normal" por meses, até a média subir, seria repetir o que ela já sabe.
 * Vale um pagamento da janela do normal (o que todas as telas têm em mãos); um pagamento excepcional,
 * de outro valor, não conta.
 */
function fixedAmountAlreadyPaid(bill: Pick<UsualBill, 'id' | 'next_due_on' | 'amount'>, payments: BillUsualPayment[]): boolean {
  if (bill.amount == null) return false;
  const fixed = cents(bill.amount);
  const since = windowStart(bill.next_due_on);
  return payments.some((p) => p.bill_id === bill.id && p.due_on >= since && p.due_on < bill.next_due_on && cents(p.amount) === fixed);
}

/** O valor já conhecido do próximo vencimento, quando está acima do normal da conta. */
export function billAboveUsual(bill: UsualBill, payments: BillUsualPayment[], today: string): BillAbove | null {
  if (!bill.active) return null;
  const usual = billUsual(bill, payments);
  const known = knownNextAmount(bill, today);
  if (known?.source === 'fixo' && fixedAmountAlreadyPaid(bill, payments)) return null;
  const comparison = compareToUsual(known?.amount, usual);
  return known && usual && comparison?.kind === 'acima' ? { known, usual, comparison } : null;
}

/**
 * Desde quando as listas buscam os pagamentos de todas as contas: os 6 meses
 * da média mais 6, para a conta atrasada (até uns seis meses) não perder o selo.
 */
export function usualPaymentsSince(today: string): string {
  return addMonths(today, -(USUAL_MONTHS * 2));
}

/**
 * Contas que estão acima do normal agora (id da conta → o porquê), a partir
 * dos pagamentos recentes de todas elas (desde usualPaymentsSince). Conta
 * atrasada há mais tempo que essa busca cobre fica de fora: com parte dos
 * pagamentos, a média seria outra.
 */
export function billsAboveUsual(bills: UsualBill[], payments: BillUsualPayment[], today: string): Map<string, BillAbove> {
  const since = usualPaymentsSince(today);
  const above = new Map<string, BillAbove>();
  for (const bill of bills) {
    if (windowStart(bill.next_due_on) < since) continue;
    const judged = billAboveUsual(bill, payments, today);
    if (judged) above.set(bill.id, judged);
  }
  return above;
}

// ---------------------------------------------------------------------------
// Textos

const lastPayments = (count: number) => (count === 1 ? 'do último pagamento' : `dos últimos ${count} pagamentos`);

/** "R$ 85,00 (38%) acima do normal desta conta. A média dos últimos 6 pagamentos é R$ 225,00." */
export function describeAboveUsual(comparison: UsualComparison, usual: Usual): string {
  return `${formatBRL(comparison.diff)} (${comparison.percent}%) acima do normal desta conta. A média ${lastPayments(usual.count)} é ${formatBRL(usual.average)}.`;
}

/** "Média dos últimos 6 pagamentos: R$ 225,00." */
export function describeUsualAverage(usual: Usual): string {
  return `Média ${lastPayments(usual.count)}: ${formatBRL(usual.average)}.`;
}

/** "Normal desta conta: cerca de R$ 225,00 (média dos últimos 6 pagamentos)" */
export function describeUsual(usual: Usual): string {
  return `Normal desta conta: cerca de ${formatBRL(usual.average)} (média ${lastPayments(usual.count)})`;
}

/** "Este boleto veio R$ 310,00: R$ 85,00 (38%) acima do normal desta conta. A média…" */
export function describeBillAbove({ known, usual, comparison }: BillAbove): string {
  const lead = known.source === 'boleto' ? 'Este boleto veio' : 'O valor cadastrado é';
  return `${lead} ${formatBRL(known.amount)}: ${describeAboveUsual(comparison, usual)}`;
}

/** Para o retrato do Nuke, na linha da conta: os números já prontos, sem conta para a IA fazer. */
export function describeAboveForNuke({ known, usual, comparison }: BillAbove): string {
  const boleto = known.source === 'boleto' ? `boleto de ${formatBRL(known.amount)}, ` : '';
  return `${boleto}${formatBRL(comparison.diff)} (${comparison.percent}%) acima do normal: média ${formatBRL(usual.average)} ${lastPayments(usual.count)}`;
}

/** Uma linha para a tela; `above` pede o destaque de aviso. */
export interface UsualNote {
  text: string;
  above: boolean;
}

/**
 * Linha sob "Valor pago", acompanhando o que a pessoa digita: o aviso quando
 * o valor está acima do normal; senão, em conta de valor variável, a média,
 * para conferir com o boleto. É só informação: nunca impede o pagamento.
 */
export function payUsualNote(
  bill: Pick<UsualBill, 'id' | 'recurrence' | 'next_due_on' | 'amount'>,
  payments: BillUsualPayment[],
  amount: number | null,
): UsualNote | null {
  const usual = billUsual(bill, payments);
  if (!usual) return null;
  // O valor fixo da conta, já pago assim antes, não é novidade (ver billAboveUsual).
  const settled = bill.amount != null && amount != null && cents(amount) === cents(bill.amount) && fixedAmountAlreadyPaid(bill, payments);
  const comparison = settled ? null : compareToUsual(amount, usual);
  if (comparison?.kind === 'acima') return { text: describeAboveUsual(comparison, usual), above: true };
  return bill.amount == null ? { text: describeUsualAverage(usual), above: false } : null;
}

/**
 * Linha do topo da tela da conta: o aviso do boleto guardado (ou do valor
 * fixo) acima do normal; senão, em conta de valor variável, o normal atual.
 */
export function billUsualNote(bill: UsualBill, payments: BillUsualPayment[], today: string): UsualNote | null {
  const above = billAboveUsual(bill, payments, today);
  if (above) return { text: describeBillAbove(above), above: true };
  const usual = bill.active && bill.amount == null ? billUsual(bill, payments) : null;
  return usual ? { text: describeUsual(usual), above: false } : null;
}
