// Finanças > Notas: o histórico das notas confirmadas, em páginas (as mais
// recentes primeiro) e separado por mês. Nenhuma nota some calada: o que
// ainda não veio é contado, com o botão de ver mais. Os rascunhos ("Para
// revisar") são lidos todos, à parte (data/receipts).

import { toISODate } from './dates';
import { monthLabel } from './finance';

/** Quantas notas confirmadas cada página do histórico traz. */
export const RECEIPTS_PAGE = 50;

export interface ReceiptMonthGroup<T> {
  /** "AAAA-MM" */
  month: string;
  /** "Outubro de 2026" */
  title: string;
  receipts: T[];
}

/** O mês da compra, no fuso do aparelho, como no resumo de gastos. */
const monthOf = (purchasedAt: string) => toISODate(new Date(purchasedAt)).slice(0, 7);

/**
 * As notas (já na ordem do histórico, da mais recente para a mais antiga) separadas por mês, na mesma ordem.
 * Uma nota que veio em duas páginas (mudou de data enquanto a pessoa lia) aparece uma vez só, na primeira.
 */
export function receiptsByMonth<T extends { id: string; purchased_at: string }>(receipts: T[]): ReceiptMonthGroup<T>[] {
  const seen = new Set<string>();
  const groups: ReceiptMonthGroup<T>[] = [];
  for (const receipt of receipts) {
    if (seen.has(receipt.id)) continue;
    seen.add(receipt.id);
    const month = monthOf(receipt.purchased_at);
    const last = groups[groups.length - 1];
    if (last?.month === month) last.receipts.push(receipt);
    else {
      const label = monthLabel(month);
      groups.push({ month, title: label.charAt(0).toUpperCase() + label.slice(1), receipts: [receipt] });
    }
  }
  return groups;
}

/**
 * O pé do histórico quando há mais notas do que as que vieram: quantas estão na tela e de quantas, e o que o
 * botão diz. `remaining` é quantas o servidor diz que ainda faltam; null quando ele não contou (aí só se sabe
 * que há mais). null quando não falta nenhuma.
 */
export function receiptsMore(shown: number, remaining: number | null): { note: string | null; button: string } | null {
  if (remaining === 0) return null;
  if (remaining == null) return { note: null, button: 'Ver notas mais antigas' };
  const next = Math.min(remaining, RECEIPTS_PAGE);
  const total = shown + remaining;
  return {
    note: `Mostrando as ${shown} notas mais recentes de ${total}.`,
    button: next === remaining ? (remaining === 1 ? 'Ver a nota mais antiga' : `Ver as ${remaining} notas mais antigas`) : `Ver mais ${next} notas`,
  };
}
