// O código de barras do produto (GTIN) como o banco o guarda: a regra de
// gtin_key (supabase/migrations/20261021150000_store_codes.sql). Os 14 dígitos
// do código de 8, 12, 13 ou 14 dígitos com o verificador certo, fora das faixas
// de uso restrito (o código da balança, o interno do mercado, cupons), ou null.
// A leitura do servidor (receipt_reads) leva de cada linha só o de 13 ou 14
// dígitos (sharedGtin), que vai para os preços compartilhados: o número
// impresso na embalagem, igual em toda loja. Espelho de gtinKey em
// src/domain/barcode.ts; um teste do app (src/domain/__tests__/barcode.test.ts)
// falha se os dois divergirem.
// Sem import: o teste do app lê este arquivo direto.

/** Começos dos 14 dígitos de uso restrito (EAN-13 com 2, 02 ou 04, 98 ou 99; GTIN-14 com 9). */
const RESTRICTED = ['02', '002', '004', '098', '099', '9'];

/** "7891000100103" -> "07891000100103"; dígito errado, faixa restrita, outro tamanho ou espaço -> null. */
export function gtinKey(code: string | null | undefined): string | null {
  if (typeof code !== 'string' || !/^(\d{8}|\d{12,14})$/.test(code)) return null;
  const g = code.padStart(14, '0');
  let total = 0;
  for (let i = 0; i < 13; i++) total += Number(g[i]) * (i % 2 === 0 ? 3 : 1);
  if ((10 - (total % 10)) % 10 !== Number(g[13])) return null;
  // GTIN-8 (seis zeros à frente): restrito quando o primeiro dos oito é 0 ou 2.
  if (g.startsWith('000000')) return g[6] === '0' || g[6] === '2' ? null : g;
  return RESTRICTED.some((prefix) => g.startsWith(prefix)) ? null : g;
}

/**
 * O código de barras que vai para os preços compartilhados: o de 13 ou 14 dígitos (os 14 de gtinKey sem "00" à
 * frente). O de 8 ou 12 dígitos fica de fora: o código interno do mercado com esse tamanho passa na conta do
 * verificador em 1 de cada 10, e outra casa veria o preço de outro produto. O mesmo filtro está no gatilho
 * (share_receipt_prices). A casa continua aprendendo os de 8 e 12 (product_barcodes, só dela).
 */
export function sharedGtin(code: string | null | undefined): string | null {
  const key = gtinKey(code);
  return key && !key.startsWith('00') ? key : null;
}
