// As linhas da nota do QR code como o app as põe no rascunho (descrição,
// unidade e preço unitário): é com elas que o banco confere o que a casa
// confirma antes de compartilhar o preço (_shared/receiptRead.ts). Espelho de
// nfceItemsToDraft e normalizeNfceUnit em src/domain/nfce.ts; um teste do app
// (src/domain/__tests__/nfceReadLines.test.ts) falha se os dois divergirem.
// O código do produto (store_code) fica só na linha da casa, para ela aprender
// o produto. Da leitura do servidor e dos preços comuns só vai o código de
// barras (gtin), que quem chama já tirou do código da linha (gtinKey, em
// read.ts): o código interno do mercado nunca vai.
// Sem import: o teste do app lê este arquivo direto.

interface SefazItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  /** O código de barras do código da linha (os 14 dígitos de gtinKey), ou null. */
  gtin?: string | null;
}

const UNITS: Record<string, 'un' | 'kg' | 'g' | 'l' | 'ml'> = {
  KG: 'kg',
  KGS: 'kg',
  G: 'g',
  GR: 'g',
  GRS: 'g',
  L: 'l',
  LT: 'l',
  LTS: 'l',
  ML: 'ml',
};

export function nfceReadLines(items: SefazItem[]): { description: string; unit: string; unit_price: number; gtin?: string }[] {
  return items
    .filter((item) => item.description.trim() && item.totalPrice >= 0)
    .map((item) => {
      const quantity = item.quantity > 0 ? Math.round(item.quantity * 1000) / 1000 : 1;
      const total = Math.round(item.totalPrice * 100) / 100;
      const unitPrice = item.unitPrice > 0 ? Math.round(item.unitPrice * 10000) / 10000 : Math.round((total / quantity) * 10000) / 10000;
      return {
        description: item.description.trim().replace(/\s+/g, ' '),
        unit: UNITS[item.unit.trim().toUpperCase()] ?? 'un',
        unit_price: unitPrice,
        ...(item.gtin ? { gtin: item.gtin } : {}),
      };
    });
}

/** O dia da emissão como a nota mostra ("AAAA-MM-DDTHH:MM:SS" -> "AAAA-MM-DD"), ou null. */
export function nfceReadDay(issuedAtLocal: string | null): string | null {
  const match = issuedAtLocal?.match(/^(\d{4}-\d{2}-\d{2})T/);
  return match ? match[1] : null;
}
