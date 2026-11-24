// O que a nota deixa corrigir em cada momento. Na revisão, tudo. Depois de
// confirmada, o cabeçalho (mercado, data da compra, total e quem pagou), o
// valor do item que ficou sem, o produto de uma linha ("Trocar produto") e o
// item que a leitura perdeu ("Item"): a data errada deixa a nota fora do mês, o
// mercado ou o produto errado estragam o histórico de preço, e o item que faltou
// some dos gastos. A troca de produto e o item que faltou passam pelas funções de
// 20261124180430_confirmed_receipt_items.sql (domain/receiptCorrection), que
// levam junto a despensa da linha. Tirar uma linha e mudar a quantidade, a
// unidade ou a descrição continuam só na revisão. Os preços compartilhados entre
// casas, se a nota deu algum, ficam como estão (o gatilho do banco só
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
  /**
   * Incluir um item que a leitura perdeu. Na revisão, o formulário de sempre; na confirmada, o produto primeiro e
   * depois a quantidade e o valor, por add_confirmed_receipt_item (e só quando o banco tem a função: a tela pergunta
   * antes, useReceiptCorrectionsAvailable).
   */
  addItem: boolean;
  /** Trocar o produto de uma linha já confirmada (change_receipt_item_product); na revisão, o produto se escolhe no item. */
  changeProduct: boolean;
}

/** O que dá para corrigir na nota, pelo status dela. */
export function receiptEditing(status: ReceiptStatus): ReceiptEditing {
  const draft = status === 'draft';
  return { items: draft ? 'all' : 'missingValue', addItem: true, changeProduct: !draft };
}

/**
 * A frase da nota confirmada, a mesma para toda nota. Não diz que a nota deu preço para outras casas: a de
 * farmácia, a com remédio, a sem CNPJ ou dia lido, a digitada à mão e a confirmada antes do compartilhamento
 * nunca deram, e a tela não sabe depois se esta deu (a leitura some na confirmação).
 */
export const CONFIRMED_EDIT_NOTE =
  'O que você corrigir aqui vale só para a casa (gastos, Mercado do mês, histórico de preço e despensa) e não vai para os preços compartilhados entre casas.';

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
