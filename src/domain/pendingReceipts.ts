// Nota pendente: a Sefaz pediu o "não sou robô" e o app não passa por ele. A
// pessoa abre a nota na página oficial, passa pela verificação, tira prints e
// manda pelo leitor de foto, com a chave do QR. Até lá a nota fica guardada no
// aparelho, por pessoa e por casa (data/pendingReceipts): só a chave e o link
// do QR, que estão impressos no papel. Não é uma nota no banco: a revisão, o
// Mercado do mês, Finanças e "Para revisar" continuam só com notas de verdade.

import { monthLabel } from './finance';
import { isValidAccessKey, parseNfceQr } from './nfce';

export interface PendingReceipt {
  accessKey: string;
  /** O link do QR code (abre a nota na Sefaz); null quando só se tem a chave. */
  url: string | null;
  /** A casa aberta quando o QR foi lido: a nota só aparece nela. */
  householdId: string;
  /** Quando ficou pendente (ISO). */
  savedAt: string;
}

/** Quantas pendentes o aparelho guarda por pessoa: passando disso, a mais antiga sai. */
export const MAX_PENDING_RECEIPTS = 20;

function isPending(value: unknown): value is PendingReceipt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accessKey === 'string' &&
    isValidAccessKey(v.accessKey) &&
    (v.url === null || typeof v.url === 'string') &&
    typeof v.householdId === 'string' &&
    v.householdId !== '' &&
    typeof v.savedAt === 'string' &&
    !Number.isNaN(Date.parse(v.savedAt))
  );
}

/** O que estava guardado no aparelho; o que não for uma pendente válida fica de fora (texto corrompido: nenhuma). */
export function parsePendingReceipts(raw: string | null): PendingReceipt[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPending) : [];
  } catch {
    return [];
  }
}

const same = (a: Pick<PendingReceipt, 'householdId' | 'accessKey'>, b: Pick<PendingReceipt, 'householdId' | 'accessKey'>) =>
  a.householdId === b.householdId && a.accessKey === b.accessKey;

/**
 * Guarda a pendente, a mais nova primeiro. A mesma chave na mesma casa não vira outra: fica a de antes (com a
 * data de quando ficou pendente), com o link novo se ela não tinha. Passando de MAX_PENDING_RECEIPTS, a mais
 * antiga sai.
 */
export function withPendingReceipt(list: readonly PendingReceipt[], entry: PendingReceipt): PendingReceipt[] {
  const before = list.find((p) => same(p, entry));
  const kept = before ? { ...before, url: before.url ?? entry.url } : entry;
  return [kept, ...list.filter((p) => !same(p, entry))].slice(0, MAX_PENDING_RECEIPTS);
}

export function withoutPendingReceipt(list: readonly PendingReceipt[], householdId: string, accessKey: string): PendingReceipt[] {
  return list.filter((p) => !same(p, { householdId, accessKey }));
}

/**
 * As pendentes da casa aberta, da mais nova para a mais antiga, menos as que já viraram nota na casa (`inHouse`:
 * as chaves que o banco já tem, lidas pelos prints, pelo QR ou por outra pessoa).
 */
export function pendingOfHousehold(
  list: readonly PendingReceipt[],
  householdId: string | undefined,
  inHouse: ReadonlySet<string> = new Set(),
): PendingReceipt[] {
  if (!householdId) return [];
  return list
    .filter((p) => p.householdId === householdId && !inHouse.has(p.accessKey))
    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
}

/**
 * O link para abrir a nota na Sefaz: só o do próprio QR, num endereço do governo (.gov.br). Um QR que aponta
 * para outro lugar não ganha o botão "Abrir a nota na Sefaz": o app não manda a pessoa para uma página que se
 * passa pela Sefaz.
 */
export function sefazLink(url: string | null): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  return host.endsWith('.gov.br') ? parsed.toString() : null;
}

/** "Compra de outubro de 2026": o mês da emissão vem na chave de acesso. */
export function pendingReceiptSubtitle(accessKey: string): string {
  const qr = parseNfceQr(accessKey);
  const month = Number(qr?.month.slice(5, 7));
  return qr && month >= 1 && month <= 12 ? `Compra de ${monthLabel(qr.month)}` : 'Nota da Sefaz';
}

/** O CNPJ de quem emitiu, de dentro da chave: acha o mercado da casa para dar nome à pendente. */
export function pendingReceiptCnpj(accessKey: string): string {
  return accessKey.slice(6, 20);
}
