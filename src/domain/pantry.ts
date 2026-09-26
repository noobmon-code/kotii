import { getCategory } from './categories';
import { addDays, diffDays } from './dates';

export type ExpirySource = 'produto' | 'categoria' | 'manual';

export interface ExpiryEstimate {
  expiresOn: string | null;
  source: Exclude<ExpirySource, 'manual'> | null;
}

/**
 * Validade estimada sem o usuário digitar: validade aprendida do produto
 * (vinda de correções anteriores) ou, na falta dela, o padrão da categoria.
 */
export function estimateExpiry(input: {
  purchasedOn: string;
  category: string;
  productShelfLifeDays?: number | null;
}): ExpiryEstimate {
  if (input.productShelfLifeDays && input.productShelfLifeDays > 0) {
    return { expiresOn: addDays(input.purchasedOn, input.productShelfLifeDays), source: 'produto' };
  }
  const days = getCategory(input.category).shelfLifeDays;
  if (days == null) return { expiresOn: null, source: null };
  return { expiresOn: addDays(input.purchasedOn, days), source: 'categoria' };
}

export const EXPIRING_SOON_DAYS = 3;

export type ExpiryStatus =
  | { kind: 'sem_validade' }
  | { kind: 'vencido'; daysAgo: number }
  | { kind: 'vence_logo'; daysLeft: number }
  | { kind: 'ok'; daysLeft: number };

export function expiryStatus(expiresOn: string | null, today: string): ExpiryStatus {
  if (!expiresOn) return { kind: 'sem_validade' };
  const daysLeft = diffDays(today, expiresOn);
  if (daysLeft < 0) return { kind: 'vencido', daysAgo: -daysLeft };
  if (daysLeft <= EXPIRING_SOON_DAYS) return { kind: 'vence_logo', daysLeft };
  return { kind: 'ok', daysLeft };
}

export function describeExpiry(status: ExpiryStatus): string {
  switch (status.kind) {
    case 'sem_validade':
      return 'Sem validade';
    case 'vencido':
      return status.daysAgo === 0 ? 'Venceu hoje' : `Venceu há ${status.daysAgo} ${status.daysAgo === 1 ? 'dia' : 'dias'}`;
    case 'vence_logo':
      if (status.daysLeft === 0) return 'Vence hoje';
      if (status.daysLeft === 1) return 'Vence amanhã';
      return `Vence em ${status.daysLeft} dias`;
    case 'ok':
      return `Vence em ${status.daysLeft} dias`;
  }
}
