// Consultor financeiro (beta): como uma compra do banco aparece nas listas
// (o resumo do consultor e a página de lançamentos).

import type { BankPurchase } from '@/domain/bankMonth';
import { formatShortDate } from '@/domain/dates';
import { monthLabel } from '@/domain/finance';
import { formatBRL } from '@/domain/money';

export function purchaseTitle(p: BankPurchase): string {
  return p.merchantName ?? p.description;
}

/** "7 out · Nubank cartão · parcela 2 de 10 · previsto" */
export function purchaseDetails(p: BankPurchase, labels: Map<string, string>): string {
  return [
    formatShortDate(p.date),
    labels.get(p.accountId),
    p.installment ? `parcela ${p.installment.number} de ${p.installment.total}` : null,
    p.pending ? 'previsto' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Parcelado: R$ 1.500,00 em 10x, a 1ª em 1 set" (a data estimada pela parcela sai só com o mês). */
export function installmentSummary(p: BankPurchase): string | null {
  const installment = p.installment;
  if (!installment) return null;
  const first = installment.purchaseExact
    ? `a 1ª em ${formatShortDate(installment.purchaseDate)}`
    : `a 1ª por volta de ${monthLabel(installment.purchaseDate.slice(0, 7))}`;
  return `Parcelado: ${formatBRL(installment.purchaseAmount)} em ${installment.total}x, ${first}`;
}
