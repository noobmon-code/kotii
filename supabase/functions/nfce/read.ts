// O que a busca da nota (sefaz.ts) vira em receipt_reads, ou null quando ela
// não vale como leitura do servidor. Sem rede: testado em read.test.ts.

import { type ReceiptRead, receiptRead } from '../_shared/receiptRead.ts';
import { isOfficialRead } from './official.ts';
import { nfceReadDay, nfceReadLines } from './readLines.ts';
import type { Lookup } from './sefaz.ts';
import { accessKeyFromQr } from './uf.ts';

/**
 * A leitura da casa para a busca que deu certo. Null sem casa aberta, ou quando
 * algum endereço do caminho não é de consulta oficial (official.ts). A chave
 * do link do QR só vale quando a página mostra a mesma; senão fica sem chave
 * (e a linha compartilhada, sem estado). O CNPJ é o da página, ou o da chave
 * conferida, como o app faz com o mercado.
 */
export function nfceRead(result: Extract<Lookup, { kind: 'ok' }>, qrUrl: string, householdId: unknown): ReceiptRead | null {
  if (typeof householdId !== 'string' || !householdId) return null;
  if (!isOfficialRead(result.fetched, result.pageUrl)) return null;
  const linkKey = accessKeyFromQr(qrUrl);
  const accessKey = linkKey && linkKey === result.accessKey ? linkKey : null;
  const { page } = result;
  return receiptRead({
    householdId,
    source: 'qrcode',
    accessKey,
    cnpj: page.store.cnpj ?? accessKey?.slice(6, 20) ?? null,
    storeName: page.store.name,
    purchasedOn: nfceReadDay(page.issuedAtLocal),
    lines: nfceReadLines(page.items),
  });
}
