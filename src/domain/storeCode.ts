// O código do produto na linha da nota (o "Código" da NFC-e, o cProd): o
// número que aquele mercado dá ao produto (250474 para a BANANA PRATA) ou, no
// produto embalado, muitas vezes o próprio código de barras. A nota confirmada
// ensina à casa o produto de cada código (no mercado da nota e, quando é um
// código de barras, em qualquer mercado), e a próxima nota já vem com ele:
// o código vence o apelido da descrição e a sugestão da IA.
//
// A chave é a de store_code_key no banco
// (supabase/migrations/20261021150000_store_codes.sql), a única que vale lá; o
// que o app grava já passa por ela. Espelho de
// supabase/functions/_shared/storeCode.ts (a leitura do QR e a da foto); um
// teste (src/domain/__tests__/storeCode.test.ts) falha se os dois divergirem.

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
