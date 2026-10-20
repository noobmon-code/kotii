// O que a nota deixa corrigir em cada momento. Na revisão, tudo. Depois de
// confirmada, o cabeçalho (mercado, data da compra, total e quem pagou) e o
// valor do item que ficou sem: a data errada deixa a nota fora do mês, e o
// mercado errado estraga o histórico de preço. O que já saiu da nota na
// confirmação fica como está: a despensa, os itens tirados da lista e os preços
// que ela deu para outras casas (o gatilho do banco só compartilha na passagem
// de rascunho para confirmada, e a leitura do servidor some nela).

import { parseBRDate } from './dates';
import { hasReceiptTotal, readReceiptTotal } from './receiptGap';

const cents = (value: number) => Math.round(value * 100);

export type ReceiptStatus = 'draft' | 'confirmed';
export type ReceiptSource = 'ai' | 'manual' | 'qrcode';

export interface ReceiptEditing {
  /** Mercado (escolher outro da casa ou criar um). */
  store: boolean;
  /** Data da compra. */
  date: boolean;
  /** Total da nota. */
  total: boolean;
  /** Quem pagou. */
  payer: boolean;
  /**
   * Os itens: `all` na revisão (descrição, quantidade, valor, produto, despensa, remover); `missingValue` na nota
   * confirmada, onde só o item que ficou sem valor ganha o preço e o total (a quantidade já foi para a despensa).
   */
  items: 'all' | 'missingValue';
  /** Incluir um item que a leitura perdeu: só na revisão (na confirmada, criaria o produto fora do confirm_receipt). */
  addItem: boolean;
}

/** O que dá para corrigir na nota, pelo status dela. */
export function receiptEditing(status: ReceiptStatus): ReceiptEditing {
  const draft = status === 'draft';
  return { store: true, date: true, total: true, payer: true, items: draft ? 'all' : 'missingValue', addItem: draft };
}

/**
 * A frase da nota confirmada. Só a nota lida pelo app (QR code ou foto) pode ter dado preços para outras casas;
 * a digitada à mão nunca dá, e a frase não fala deles.
 */
export function confirmedEditNote(source: ReceiptSource): string {
  const home = 'O que você corrigir aqui vale para a casa: gastos, Mercado do mês e histórico de preço.';
  return source === 'manual' ? home : `${home} Os preços que esta nota já deu para outras casas não mudam.`;
}

export type PurchaseDateChange = { kind: 'invalid' } | { kind: 'same' } | { kind: 'changed'; purchasedAt: string };

/**
 * A data digitada (dd/mm/aaaa) contra o dia da nota (aaaa-mm-dd). Vai como meio-dia local: a data não "vira" ao
 * converter para UTC. O mesmo dia não grava nada (na nota confirmada, cada gravação refaz preços e gastos).
 */
export function purchaseDateChange(typed: string, currentDay: string): PurchaseDateChange {
  const iso = parseBRDate(typed);
  if (!iso) return { kind: 'invalid' };
  if (iso === currentDay) return { kind: 'same' };
  return { kind: 'changed', purchasedAt: new Date(`${iso}T12:00:00`).toISOString() };
}

export const INVALID_DATE = { title: 'Data inválida', message: 'Use o formato dd/mm/aaaa.' };

export type TotalChange = { kind: 'invalid'; title: string; message: string } | { kind: 'same' } | { kind: 'changed'; total: number | null };

/**
 * O total digitado na nota confirmada contra o que ela tem: em branco (ou zero) é "sem total", como na revisão;
 * o mesmo valor, ao centavo, não grava nada.
 */
export function receiptTotalChange(typed: string, current: number | null): TotalChange {
  const result = readReceiptTotal(typed);
  if (!result.ok) return { kind: 'invalid', title: result.title, message: result.message };
  const before = hasReceiptTotal(current) ? cents(current) : null;
  const after = result.total == null ? null : cents(result.total);
  return before === after ? { kind: 'same' } : { kind: 'changed', total: result.total };
}

/** A nota confirmada que sumiu (excluída em outro aparelho) antes de a correção chegar. */
export const CORRECTION_NOT_SAVED = { title: 'Correção não salva', message: 'Esta nota não existe mais.' };
