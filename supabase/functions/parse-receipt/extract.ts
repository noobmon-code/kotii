import { z } from 'zod';

import { CATEGORY_KEYS } from '../_shared/categories.ts';
import { cnpjFromAccessKey, isValidAccessKey, isValidCnpj } from '../_shared/fiscalIds.ts';
import type { ReadLine } from '../_shared/receiptRead.ts';

export const UNITS = ['un', 'kg', 'g', 'l', 'ml'] as const;

export const ExtractedReceiptSchema = z.object({
  is_receipt: z.boolean(),
  store_name: z.string().nullable(),
  cnpj: z.string().nullable(),
  address: z.string().nullable(),
  purchased_at: z.string().nullable(),
  access_key: z.string().nullable(),
  total: z.number().nullable(),
  items: z.array(
    z.object({
      raw_description: z.string(),
      normalized_name: z.string(),
      category: z.enum(CATEGORY_KEYS),
      // Número ilegível vem null, nos dois provedores: exigir número derrubava a
      // nota inteira (OpenRouter) ou fazia o modelo inventar um (saída estrita).
      quantity: z.number().nullable(),
      unit: z.enum(UNITS),
      unit_price: z.number().nullable(),
      total_price: z.number().nullable(),
      matched_product_id: z.string().nullable(),
    }),
  ),
});
export type ExtractedReceipt = z.infer<typeof ExtractedReceiptSchema>;

export interface CatalogProduct {
  id: string;
  name: string;
}

/** Quantos produtos da casa vão para a IA: a lista entra no pedido e custa a cada leitura. */
export const CATALOG_LIMIT = 400;

/** Quantas notas da casa, das mais novas, contam como "mais comprados" (umas mil linhas). */
export const BOUGHT_RECEIPTS = 50;

/** Uma nota como a busca do catálogo a traz: os itens com o produto (objeto, muitos para um; a lista que o tipo promete também serve). */
export interface BoughtReceipt {
  receipt_items: { position: number; product: CatalogProduct | CatalogProduct[] | null }[] | null;
}

/**
 * Os produtos das linhas de nota, da nota mais nova para a mais antiga e, em
 * cada nota, na ordem impressa, com repetição: o `bought` de `promptCatalog`.
 * Linha sem produto fica de fora.
 */
export function boughtProducts(receipts: BoughtReceipt[]): CatalogProduct[] {
  return receipts.flatMap((receipt) =>
    [...(receipt.receipt_items ?? [])].sort((a, b) => a.position - b.position).flatMap((line) => line.product ?? [])
  );
}

/**
 * Os produtos da casa que a IA vê, até `limit`: primeiro os mais comprados nas
 * linhas de nota mais novas (`bought`, da mais nova para a mais antiga, com
 * repetição; no empate, o comprado por último), depois os cadastrados por
 * último (`newest`). Em ordem alfabética, os do fim do alfabeto nunca eram
 * reconhecidos numa casa com mais de `limit` produtos.
 */
export function promptCatalog(bought: CatalogProduct[], newest: CatalogProduct[], limit = CATALOG_LIMIT): CatalogProduct[] {
  const tally = new Map<string, { product: CatalogProduct; count: number; latest: number }>();
  bought.forEach((product, index) => {
    const seen = tally.get(product.id);
    if (seen) seen.count++;
    else tally.set(product.id, { product, count: 1, latest: index });
  });
  const ranked = [...tally.values()].sort((a, b) => b.count - a.count || a.latest - b.latest).map((t) => t.product);
  const chosen = new Map<string, CatalogProduct>();
  for (const product of [...ranked, ...newest]) {
    if (chosen.size >= limit) break;
    if (!chosen.has(product.id)) chosen.set(product.id, product);
  }
  return [...chosen.values()];
}

export const SYSTEM = `Você lê fotos de notas fiscais de compra brasileiras (NFC-e, cupom fiscal, DANFE) e devolve os dados estruturados. Os dados alimentam um comparativo de preços entre mercados, então preço e quantidade de cada item precisam bater com o impresso.`;

/** Até 4 fotos por nota (nota comprida, fotografada em partes). */
export const MAX_PHOTOS = 4;

export function instructions(catalog: CatalogProduct[], photos = 1): string {
  const catalogText = catalog.length
    ? catalog.map((p) => `${p.id} | ${p.name}`).join('\n')
    : '(nenhum ainda)';
  const parts =
    photos > 1
      ? `\nA nota veio em ${photos} fotos, em ordem, de cima para baixo. As partes podem se sobrepor: um item que aparece no fim de uma foto e no começo da seguinte entra uma vez só. Junte tudo numa nota só.\n`
      : '';
  return `Extraia os dados desta nota.
${parts}
- items: um por produto, na ordem impressa. Não inclua descontos gerais, troco, formas de pagamento nem tributos.
- Desconto de um item específico entra no total_price dele (valor líquido), também quando vem impresso numa linha separada logo abaixo do item; a linha do desconto não vira item.
- Item cancelado fica de fora, junto com a linha que o cancela (cancelamento, estorno). Nenhum item tem valor negativo.
- raw_description: a descrição exatamente como impressa.
- normalized_name: nome legível em português com marca e tamanho quando houver. Ex.: "ARROZ T.JOAO TP1 5KG" -> "Arroz Tio João Tipo 1 5kg".
- quantity/unit: itens pesados usam "kg" com a quantidade pesada (ex.: 0,535 kg de banana); demais usam a unidade impressa, ou "un".
- unit_price: preço por unidade de "unit"; total_price: valor do item.
- Preço ou quantidade que não dá para ler: null. Nunca estime nem invente um número que não está legível na nota.
- matched_product_id: o id de um produto da lista abaixo se for o mesmo produto (mesma marca e mesmo tamanho); senão null. Na dúvida, null.
- purchased_at: data/hora de emissão em ISO 8601; sem fuso impresso, use -03:00.
- cnpj: 14 dígitos do emitente, sem pontuação. access_key: os 44 dígitos da chave de acesso, se visível.
- Outro campo ilegível: null. Não invente valores.
- Se a imagem não for uma nota de compra, is_receipt=false e items vazio.

Produtos já cadastrados (id | nome):
${catalogText}`;
}

export interface CleanItem {
  position: number;
  raw_description: string;
  suggested_name: string;
  suggested_category: string;
  product_id: string | null;
  quantity: number;
  unit: (typeof UNITS)[number];
  unit_price: number;
  total_price: number;
}

export interface CleanReceipt {
  storeName: string | null;
  cnpj: string | null;
  address: string | null;
  purchasedAt: string | null;
  accessKey: string | null;
  total: number | null;
  items: CleanItem[];
  /**
   * As linhas para a leitura do servidor (receipt_reads): só as de preço
   * unitário lido na nota, ou tirado do total e da quantidade lida, maior que
   * zero. A linha sem os dois fica no rascunho com 1 × total, mas esse preço
   * não foi impresso e não pode ir para a base comum.
   */
  readLines: ReadLine[];
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * A quantidade da linha: a lida; sem ela, a que sai do total e do preço
 * unitário lidos (inteira em "un", em que um desconto deixa a conta quebrada);
 * sem nenhum dos dois, 1.
 */
function lineQuantity(quantity: number | null, unit: (typeof UNITS)[number], unitPrice: number | null, total: number): number {
  if (quantity != null && quantity > 0) return round(quantity, 3);
  if (unitPrice == null || !(unitPrice > 0) || !(total > 0)) return 1;
  const derived = unit === 'un' ? Math.round(total / unitPrice) : round(total / unitPrice, 3);
  return derived > 0 ? derived : 1;
}

/**
 * Normaliza o que veio da IA para o que o banco aceita: chave e CNPJ só com
 * os dígitos verificadores certos (com a chave válida, o CNPJ é o dela), data
 * válida, quantidades positivas, preço unitário coerente e ids de produto que
 * realmente existem na família (alias exato tem prioridade). Preço ilegível
 * (null) vira 0, o "sem valor" que a revisão pergunta à pessoa; linha negativa
 * (cancelamento, desconto que a IA pôs como item) fica de fora. Quantidade
 * ilegível sai do total e do preço unitário; sem o preço unitário, a linha
 * fica de fora de `readLines` (nunca compartilha um preço por kg inventado).
 */
export function cleanReceipt(
  extracted: ExtractedReceipt,
  catalogIds: Set<string>,
  aliasMatches: Map<string, string>,
): CleanReceipt {
  const digits = (s: string | null) => (s ?? '').replace(/\D/g, '');
  const readKey = digits(extracted.access_key);
  const accessKey = isValidAccessKey(readKey) ? readKey : null;
  const readCnpj = digits(extracted.cnpj);
  const cnpj = cnpjFromAccessKey(accessKey) ?? (isValidCnpj(readCnpj) ? readCnpj : null);
  const purchasedAt =
    extracted.purchased_at && !Number.isNaN(Date.parse(extracted.purchased_at))
      ? new Date(extracted.purchased_at).toISOString()
      : null;

  const items: CleanItem[] = [];
  const readLines: ReadLine[] = [];
  for (const it of extracted.items) {
    const raw = it.raw_description.trim();
    if (!raw) continue;
    // Zerar a linha negativa faria a revisão pedir o preço de um "CANCELAMENTO".
    if ((it.total_price ?? 0) < 0 || (it.unit_price ?? 0) < 0) continue;
    const total = it.total_price == null ? 0 : round(it.total_price, 2);
    const quantity = lineQuantity(it.quantity, it.unit, it.unit_price, total);
    const readPrice = it.unit_price != null && it.unit_price > 0 ? it.unit_price : null;
    const unitPrice = readPrice != null ? round(readPrice, 4) : round(total / quantity, 4);
    // Sem preço unitário nem quantidade lidos, o preço é o total sobre 1, que a nota não imprimiu;
    // sem valor nenhum (preço 0), não há o que a leitura guardar.
    if (unitPrice > 0 && (readPrice != null || (it.quantity != null && it.quantity > 0))) {
      readLines.push({ description: raw, unit: it.unit, unit_price: unitPrice });
    }
    const suggested = it.matched_product_id && catalogIds.has(it.matched_product_id) ? it.matched_product_id : null;
    items.push({
      position: items.length,
      raw_description: raw,
      suggested_name: it.normalized_name.trim() || raw,
      suggested_category: it.category,
      product_id: aliasMatches.get(raw) ?? suggested,
      quantity,
      unit: it.unit,
      unit_price: unitPrice,
      total_price: total,
    });
  }

  return {
    storeName: extracted.store_name?.trim() || null,
    cnpj,
    address: extracted.address?.trim() || null,
    purchasedAt,
    accessKey,
    total: extracted.total != null && extracted.total >= 0 ? round(extracted.total, 2) : null,
    items,
    readLines,
  };
}

/**
 * Mesmo nome de loja, sem diferença de caixa nem espaços nas pontas. A
 * comparação é feita aqui, e não num ILIKE: o nome lido da nota pode trazer
 * "%", "_" ou "*" (que o PostgREST trata como curinga) e casar com qualquer loja.
 */
export const sameStoreName = (a: string, b: string) => a.trim().toLocaleLowerCase('pt-BR') === b.trim().toLocaleLowerCase('pt-BR');
