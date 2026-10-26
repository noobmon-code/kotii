// O que a nota deixa corrigir em cada momento. Na revisão, tudo. Depois de
// confirmada, o cabeçalho (mercado, data da compra, total e quem pagou) e o
// valor do item que ficou sem: a data errada deixa a nota fora do mês, e o
// mercado errado estraga o histórico de preço. O que já saiu da nota na
// confirmação fica como está: a despensa, os itens tirados da lista e os preços
// compartilhados entre casas, se ela deu algum (o gatilho do banco só
// compartilha na passagem de rascunho para confirmada, e a leitura do servidor
// some nela).

import { parseBRDate } from './dates';
import { hasReceiptTotal, readReceiptTotal } from './receiptGap';

const cents = (value: number) => Math.round(value * 100);

export type ReceiptStatus = 'draft' | 'confirmed';

/** O que muda entre a revisão e a nota confirmada. O cabeçalho (mercado, data, total e quem pagou) se corrige nas duas. */
export interface ReceiptEditing {
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
  return { items: draft ? 'all' : 'missingValue', addItem: draft };
}

/**
 * A frase da nota confirmada, a mesma para toda nota. Não diz que a nota deu preço para outras casas: a de
 * farmácia, a com remédio, a sem CNPJ ou dia lido, a digitada à mão e a confirmada antes do compartilhamento
 * nunca deram, e a tela não sabe depois se esta deu (a leitura some na confirmação).
 */
export const CONFIRMED_EDIT_NOTE =
  'O que você corrigir aqui vale só para a casa (gastos, Mercado do mês e histórico de preço) e não vai para os preços compartilhados entre casas.';

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

/** A nota que sumiu (excluída em outro aparelho): a tela que a mostrava diz isto, no lugar dela. */
export const RECEIPT_GONE = 'Esta nota não existe mais.';
/** A nota confirmada que sumiu (excluída em outro aparelho) antes de a correção chegar. */
export const CORRECTION_NOT_SAVED = { title: 'Correção não salva', message: RECEIPT_GONE };
