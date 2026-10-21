// O código do produto na linha da nota (o "Código" da NFC-e, o cProd), como o
// banco o guarda em receipt_items.store_code: a regra de store_code_key
// (supabase/migrations/20261021150000_store_codes.sql). Maiúsculas, sem acento,
// só letras e dígitos; vazio ou com mais de 60 caracteres não é código. Usado
// pela leitura do QR (nfce/parse.ts) e pela da foto (parse-receipt). Espelho de
// storeCodeKey em src/domain/storeCode.ts; um teste do app
// (src/domain/__tests__/storeCode.test.ts) falha se os dois divergirem.
// Sem import: o teste do app lê este arquivo direto.

/** O limite do cProd e do check de receipt_items.store_code. */
export const MAX_STORE_CODE = 60;

/**
 * " 250474 " -> "250474"; "ab-12/ç" -> "AB12C"; "" ou "---" -> null. Os acentos
 * saem pela decomposição (NFD) e o que não é letra ASCII nem dígito sai antes
 * das maiúsculas, como no banco: "ß" sai, em vez de virar "SS".
 */
export function storeCodeKey(value: string | null | undefined): string | null {
  const key = (value ?? '').normalize('NFD').replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
  return key && key.length <= MAX_STORE_CODE ? key : null;
}
