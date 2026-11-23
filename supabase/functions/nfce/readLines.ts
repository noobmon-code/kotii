// As linhas da nota do QR code como o app as põe no rascunho (descrição,
// unidade e preço unitário): é com elas que o banco confere o que a casa
// confirma antes de compartilhar o preço (_shared/receiptRead.ts). Espelho de
// nfceItemsToDraft e normalizeNfceUnit em src/domain/nfce.ts; um teste do app
// (src/domain/__tests__/nfceReadLines.test.ts) falha se os dois divergirem.
// O código do produto (store_code) fica só na linha da casa, para ela aprender
// o produto. Da leitura do servidor e dos preços comuns só vai o código de
// barras (gtin), que quem chama já tirou do código da linha (sharedGtin, em
// read.ts): o código interno do mercado nunca vai.
// Cada linha diz também se a unidade da Sefaz é de um item só (single_unit):
// só essa linha pode levar o tamanho da embalagem (receiptRead, readPack). Ela
// é só da leitura: o rascunho do app não a tem, e o teste compara sem ela.
// Sem import: o teste do app lê este arquivo direto.

interface SefazItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  /** O código de barras do código da linha (os 14 dígitos de sharedGtin), ou null. */
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

// As unidades da Sefaz em que o preço é de um item só (uma unidade, uma peça, uma garrafa, um pote...). Fora delas
// (FD, CX, PCT, DZ, KIT, a página sem a unidade), o preço pode ser do fardo ou da caixa, e a descrição pode dizer só
// o tamanho de cada um ("CERV SKOL LT 350ML" num fardo de 12): a leitura não diz tamanho de embalagem.
const SINGLE_UNITS = new Set([
  'UN', 'UND', 'UNID', 'UNIDADE', 'UNI', 'PC', 'PECA', 'GF', 'GARRAFA', 'FR', 'FRASCO', 'PT', 'POTE', 'VD', 'VIDRO', 'TB', 'TUBO', 'SC', 'SACO', 'LATA',
]);

/** Uma linha lida, como receiptRead a recebe (ReadLineInput em _shared/receiptRead.ts, escrito aqui sem import). */
export type ReadLineInput = { description: string; unit: string; unit_price: number; gtin?: string; single_unit?: boolean };

/** A unidade da Sefaz é de um item só: "UN", "un", "UNID.", "PÇ" (sem acento, sem ponto, em maiúsculas). */
const singleUnit = (unit: string) => SINGLE_UNITS.has(unit.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase());

export function nfceReadLines(items: SefazItem[]): ReadLineInput[] {
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
        ...(singleUnit(item.unit) ? { single_unit: true } : {}),
      };
    });
}

/** O dia da emissão como a nota mostra ("AAAA-MM-DDTHH:MM:SS" -> "AAAA-MM-DD"), ou null. */
export function nfceReadDay(issuedAtLocal: string | null): string | null {
  const match = issuedAtLocal?.match(/^(\d{4}-\d{2}-\d{2})T/);
  return match ? match[1] : null;
}
