// A nota que não fecha: itens que a leitura deixou sem valor e a diferença
// entre o total da nota e a soma dos itens. O app pergunta e sugere; quem
// decide é a pessoa, e nada é preenchido sozinho. As contas são em centavos
// (0,1 + 0,2 não pode decidir um aviso) e as frases da tela saem todas daqui.

import type { Unit } from '@/lib/types';
import { formatBRL, formatQuantity, parseMoney } from './money';
import { hasNoValue, unitPriceFromTotal } from './receiptItem';

/** Até 5 centavos entre a soma dos itens e o total da nota é arredondamento: não vira aviso nem sugestão. */
export const TOTAL_TOLERANCE_CENTS = 5;

const cents = (value: number) => Math.round(value * 100);

/** O item da nota, com o que as contas e as frases precisam dele. */
export interface GapLine {
  id: string;
  raw_description: string;
  quantity: number;
  unit: Unit;
  unit_price: number;
  total_price: number;
}

/** O que "Usar" grava: o mesmo item, com o total que falta e o preço unitário que sai da quantidade dele. */
export type GapValues = Omit<GapLine, 'id'>;

export interface GapSuggestion {
  itemId: string;
  /** O que falta para o total da nota, em reais. */
  amount: number;
  values: GapValues;
}

export interface ReceiptGap {
  /** Soma dos itens, em reais. */
  itemsTotal: number;
  /** Total da nota menos a soma dos itens, em centavos: negativo quando a soma passa do total, null sem total. */
  missingCents: number | null;
  /** Os itens sem valor (total zerado), na ordem da nota. */
  unpriced: string[];
  /** Só com um item sem valor e o total da nota acima da soma dos outros: o que falta pode ser o valor dele. */
  suggestion: GapSuggestion | null;
}

/**
 * A nota conferida. A sugestão existe só quando a conta tem uma resposta só:
 * com dois itens sem valor não dá para saber quanto é de cada um, e sem total
 * (ou com a soma já no total, ou acima dele) não falta nada.
 */
export function receiptGap(total: number | null, lines: GapLine[]): ReceiptGap {
  const sumCents = lines.reduce((sum, line) => sum + cents(line.total_price), 0);
  const missingCents = total == null ? null : cents(total) - sumCents;
  const unpriced = lines.filter(hasNoValue);
  const only = unpriced.length === 1 ? unpriced[0] : null;
  return {
    itemsTotal: sumCents / 100,
    missingCents,
    unpriced: unpriced.map((line) => line.id),
    suggestion: only && missingCents != null && missingCents > TOTAL_TOLERANCE_CENTS ? suggest(only, missingCents) : null,
  };
}

function suggest(line: GapLine, missingCents: number): GapSuggestion {
  const amount = missingCents / 100;
  return {
    itemId: line.id,
    amount,
    values: {
      raw_description: line.raw_description,
      quantity: line.quantity,
      unit: line.unit,
      // A mesma conta do formulário quando a pessoa digita só o total (domain/receiptItem).
      unit_price: unitPriceFromTotal(amount, line.quantity),
      total_price: amount,
    },
  };
}

// ---------------------------------------------------------------------------
// Frases

const itemCount = (count: number) => (count === 1 ? '1 item' : `${count} itens`);

/** "Falta R$ 1,50" (um real e cinquenta), "Faltam R$ 12,90" e "Faltam R$ 0,50" (cinquenta centavos). */
const missingText = (missing: number) => `${(missing >= 100 && missing < 200) || missing === 1 ? 'Falta' : 'Faltam'} ${formatBRL(missing / 100)}`;

/**
 * Os avisos do cabeçalho da nota, um selo cada: o que é a diferença e, quando
 * falta valor, quantos itens estão sem. Dentro da tolerância, ou sem total,
 * não há o que dizer.
 */
export function gapNotices(gap: ReceiptGap): string[] {
  const missing = gap.missingCents;
  if (missing == null || Math.abs(missing) <= TOTAL_TOLERANCE_CENTS) return [];
  if (missing < 0) return [`A soma dos itens passa do total em ${formatBRL(-missing / 100)}. Pode ser desconto.`];
  const less = `${missingText(missing)}: a soma dos itens é menor que o total da nota.`;
  return gap.unpriced.length ? [less, `${itemCount(gap.unpriced.length)} sem valor.`] : [less];
}

/** No lugar do valor do item que não tem um. */
export const UNPRICED_LABEL = 'sem valor';
export const FILL_VALUE_LABEL = 'Preencher valor';
export const SAVE_VALUE_LABEL = 'Salvar valor';
export const LEAVE_UNPRICED_LABEL = 'Deixar sem valor';

const UNPRICED_QUESTION = 'Sem valor: a leitura não pegou o preço deste item.';
/** Na nota digitada à mão não houve leitura. */
const UNPRICED_QUESTION_MANUAL = 'Sem valor: este item está sem preço.';
/** O total da nota já vem com o desconto; o valor impresso em cada item, não. */
const DISCOUNT_CAVEAT = 'Se a nota teve desconto, o valor impresso do item é maior.';

/** O que a nota pergunta no item sem valor: a frase, os botões e, com sugestão, a ressalva do desconto. */
export interface UnpricedPrompt {
  /** null na nota já confirmada e sem sugestão: ali o item só oferece "Preencher". */
  text: string | null;
  suggestion: GapSuggestion | null;
  /** "Usar R$ 12,90". */
  useLabel: string | null;
  fillLabel: string;
  /** "Deixar sem valor" é uma resposta da revisão: a nota confirmada já ficou assim. */
  leaveLabel: string | null;
  caveat: string | null;
}

/**
 * A pergunta de um item, ou null se ele tem valor ou se a pessoa já respondeu
 * "Deixar sem valor" nesta revisão (`left`; não é guardado, e abrir a nota de
 * novo pergunta de novo). Um brinde e um valor que a leitura perdeu são iguais
 * nos dados: por isso é pergunta, e a sugestão nunca é gravada sem o toque.
 */
export function unpricedPrompt(
  gap: ReceiptGap,
  itemId: string,
  receipt: { status: 'draft' | 'confirmed'; source: 'ai' | 'manual' | 'qrcode' },
  left?: ReadonlySet<string>,
): UnpricedPrompt | null {
  if (!gap.unpriced.includes(itemId)) return null;
  const draft = receipt.status === 'draft';
  if (draft && left?.has(itemId)) return null;
  const suggestion = gap.suggestion?.itemId === itemId ? gap.suggestion : null;
  const question = receipt.source === 'manual' ? UNPRICED_QUESTION_MANUAL : UNPRICED_QUESTION;
  return {
    text: suggestion
      ? `${missingText(cents(suggestion.amount))} para o total da nota. Pode ser o valor deste item.`
      : draft
        ? question
        : null,
    suggestion,
    useLabel: suggestion ? `Usar ${formatBRL(suggestion.amount)}` : null,
    fillLabel: draft ? FILL_VALUE_LABEL : 'Preencher',
    leaveLabel: draft ? LEAVE_UNPRICED_LABEL : null,
    caveat: suggestion ? DISCOUNT_CAVEAT : null,
  };
}

/** Os itens sem valor que a pessoa nem preencheu nem deixou assim de propósito: a confirmação pergunta por eles. */
export function pendingUnpriced(gap: ReceiptGap, left: ReadonlySet<string>): string[] {
  return gap.unpriced.filter((id) => !left.has(id));
}

/** A pergunta de "Confirmar nota" com itens ainda sem valor. */
export function confirmUnpricedQuestion(count: number): { title: string; message: string; confirmLabel: string } {
  const one = count === 1;
  return {
    title: `${itemCount(count)} ${one ? 'está' : 'estão'} sem valor`,
    message: `${one ? 'Ele entra' : 'Eles entram'} como R$ 0,00 nos gastos e não ${one ? 'conta' : 'contam'} no histórico de preço. Confirmar assim mesmo?`,
    confirmLabel: 'Confirmar',
  };
}

/** "2 un × R$ 4,30"; sem valor e sem preço unitário, só a quantidade ("2 un"), em vez de "× R$ 0,00". */
export function quantityText(line: Pick<GapLine, 'quantity' | 'unit' | 'unit_price' | 'total_price'>): string {
  const quantity = formatQuantity(line.quantity, line.unit);
  return hasNoValue(line) && !(line.unit_price > 0) ? quantity : `${quantity} × ${formatBRL(line.unit_price)}`;
}

// ---------------------------------------------------------------------------
// O total da nota, que na revisão dá para corrigir (a leitura também erra o total)

export const RECEIPT_TOTAL_LABEL = 'Total da nota';
export const RECEIPT_TOTAL_HINT = 'O valor pago, já com os descontos. Em branco, a nota fica sem total.';
export const SAVE_TOTAL_LABEL = 'Salvar total';

/** O que a linha do total mostra: o valor, ou o convite para informar um (nunca é obrigatório). */
export function receiptTotalText(total: number | null): string {
  return total == null ? 'informar' : formatBRL(total);
}

/** O total como o campo abre: "1234,50", que o parseMoney lê de volta igual. */
export function receiptTotalField(total: number | null): string {
  return total == null ? '' : total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
}

export type ReceiptTotalResult = { ok: true; total: number | null } | { ok: false; message: string };

/** O total digitado: em branco é "sem total" (null); o que não dá para ler avisa, em vez de apagar o total. */
export function readReceiptTotal(input: string): ReceiptTotalResult {
  if (!input.trim()) return { ok: true, total: null };
  const total = parseMoney(input);
  if (total == null) return { ok: false, message: 'Confira o total da nota, ou deixe em branco.' };
  return { ok: true, total: cents(total) / 100 };
}
