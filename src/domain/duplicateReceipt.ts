// Nota repetida: a mesma compra lida duas vezes (pela foto e pelo QR, ou por
// duas pessoas da casa) dobraria os gastos e a despensa. A revisão do rascunho
// avisa quando a casa já tem uma nota CONFIRMADA do mesmo mercado, no mesmo dia
// de São Paulo e com o mesmo total. É só um aviso: a pessoa decide, como nos
// produtos parecidos (duas compras iguais no mesmo dia acontecem).

import { formatBRDate } from './dates';
import { formatBRL } from './money';
import { saoPauloDay } from './sharedPrices';

/** Uma nota, com o que a comparação usa. */
export interface ReceiptFingerprint {
  id: string;
  storeId: string | null;
  /** O CNPJ do mercado da nota, quando a casa o tem. */
  storeCnpj: string | null;
  storeName: string | null;
  purchasedAt: string;
  total: number | null;
}

/** A diferença de total que ainda conta como o mesmo total (arredondamento da leitura), em centavos. */
export const SAME_TOTAL_CENTS = 5;

const cents = (value: number) => Math.round(value * 100);

function sameStore(a: ReceiptFingerprint, b: ReceiptFingerprint): boolean {
  if (a.storeId && a.storeId === b.storeId) return true;
  // Duas lojas da casa com o mesmo CNPJ (uma criada pelo QR, outra à mão) são o mesmo mercado.
  return Boolean(a.storeCnpj) && a.storeCnpj === b.storeCnpj;
}

function sameTotal(a: number | null, b: number | null): boolean {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(cents(a) - cents(b)) <= SAME_TOTAL_CENTS;
}

/**
 * A nota confirmada que parece a mesma compra do rascunho: mesmo mercado (o id ou o CNPJ), mesmo dia em São Paulo
 * (onde quer que o celular esteja) e total com até SAME_TOTAL_CENTS de diferença. Sem total de um dos lados, ou
 * sem mercado, não há como dizer: nenhuma. A própria nota não conta. Havendo várias, a de horário mais perto.
 */
export function findDuplicateReceipt(draft: ReceiptFingerprint, confirmed: readonly ReceiptFingerprint[]): ReceiptFingerprint | null {
  const day = saoPauloDay(draft.purchasedAt);
  if (!day) return null;
  const at = Date.parse(draft.purchasedAt);
  const matches = confirmed.filter(
    (other) => other.id !== draft.id && sameStore(draft, other) && saoPauloDay(other.purchasedAt) === day && sameTotal(draft.total, other.total),
  );
  matches.sort((a, b) => Math.abs(Date.parse(a.purchasedAt) - at) - Math.abs(Date.parse(b.purchasedAt) - at));
  return matches[0] ?? null;
}

/** "Parece que esta compra já foi registrada: Assaí, 10/06/2026, R$ 62,90". */
export function duplicateReceiptNotice(other: ReceiptFingerprint): string {
  const parts = [other.storeName ?? 'o mesmo mercado', formatBRDate(saoPauloDay(other.purchasedAt)), formatBRL(other.total ?? 0)];
  return `Parece que esta compra já foi registrada: ${parts.join(', ')}.`;
}
