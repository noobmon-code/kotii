// Consultor financeiro (beta): avisos sobre os bancos conectados. O MeuPluggy
// atualiza sozinho uma vez por dia e não aceita atualização forçada, então
// banco parado há dias (ou pedindo login) só volta reautorizando por lá.

import type { FinConnection } from '@/lib/types';

/** Mais que isso sem a Pluggy atualizar o banco vira aviso. */
export const STALE_AFTER_DAYS = 2;

const DAY_MS = 86_400_000;

export interface ConnectionWarning {
  connectionId: string;
  label: string;
  kind: 'erro' | 'parado' | 'nunca';
  message: string;
}

const REAUTHORIZE = 'Reautorize no MeuPluggy.';

function statusMessage(label: string, status: string | null): string | null {
  switch (status) {
    case 'LOGIN_ERROR':
      return `${label} pediu uma nova autorização. ${REAUTHORIZE}`;
    case 'OUTDATED':
      return `${label} não conseguiu atualizar na Pluggy. ${REAUTHORIZE}`;
    case 'WAITING_USER_INPUT':
    case 'WAITING_USER_ACTION':
      return `${label} está esperando uma confirmação sua no MeuPluggy.`;
    default:
      return null;
  }
}

/**
 * Um aviso por banco, o mais grave: erro na Pluggy, nunca sincronizado ou
 * sem atualizar há mais de 2 dias ("Inter sem atualizar há 5 dias...").
 */
export function connectionWarnings(
  connections: Pick<FinConnection, 'id' | 'label' | 'status' | 'item_updated_at' | 'last_synced_at'>[],
  now: Date,
): ConnectionWarning[] {
  const out: ConnectionWarning[] = [];
  for (const c of connections) {
    const label = c.label.trim() || 'Banco';
    const error = statusMessage(label, c.status);
    if (error) {
      out.push({ connectionId: c.id, label, kind: 'erro', message: error });
      continue;
    }
    if (!c.last_synced_at) {
      out.push({ connectionId: c.id, label, kind: 'nunca', message: `${label} ainda não sincronizou. Toque em Atualizar.` });
      continue;
    }
    const updated = c.item_updated_at ? Date.parse(c.item_updated_at) : NaN;
    if (Number.isNaN(updated)) continue;
    const age = now.getTime() - updated;
    if (age > STALE_AFTER_DAYS * DAY_MS) {
      const days = Math.floor(age / DAY_MS);
      out.push({ connectionId: c.id, label, kind: 'parado', message: `${label} sem atualizar há ${days} dias. ${REAUTHORIZE}` });
    }
  }
  return out;
}
