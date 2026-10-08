// Consultor financeiro (beta): como uma compra do banco aparece nas listas
// (o resumo do consultor e a página de lançamentos).

import type { BankPurchase } from '@/domain/bankMonth';
import { formatShortDate } from '@/domain/dates';
import { formatBRL } from '@/domain/money';

export function purchaseTitle(p: BankPurchase): string {
  return p.merchantName ?? p.description;
}

/** "7 out · Nubank cartão · 3x de R$ 50,00 · previsto" */
export function purchaseDetails(p: BankPurchase, labels: Map<string, string>): string {
  return [
    formatShortDate(p.date),
    labels.get(p.accountId),
    p.installments ? `${p.installments.total}x de ${formatBRL(p.installments.parcel)}` : null,
    p.pending ? 'previsto' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
