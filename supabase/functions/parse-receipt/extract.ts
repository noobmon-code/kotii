import { z } from 'zod';

import { CATEGORY_KEYS } from '../_shared/categories.ts';
import { cnpjFromAccessKey, isValidAccessKey, isValidCnpj } from '../_shared/fiscalIds.ts';
import type { ReadLine } from '../_shared/receiptRead.ts';
import { storeCodeKey } from '../_shared/storeCode.ts';

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
      // O código do produto impresso na linha ("Código"), que a casa aprende ao confirmar a nota. Mesma tolerância
      // do generic_name: obrigatório e nullable no schema enviado, sem default; o que não for texto vale null.
      code: z.preprocess((value) => (typeof value === 'string' ? value : null), z.string().nullable()),
      normalized_name: z.string(),
      // O item sem marca nem tamanho ("café em pó"), só para casar com a lista de compras. Pedido no schema, mas um
      // modelo que o esquece (ou manda outra coisa) não derruba a nota: vale null. A tolerância fica só na leitura
      // (preprocess): um .catch() viraria "default" no schema enviado, que a saída estrita de alguns provedores recusa.
      generic_name: z.preprocess((value) => (typeof value === 'string' ? value : null), z.string().nullable()),
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

export const SYSTEM = `Você lê notas fiscais de compra brasileiras (NFC-e, cupom fiscal, DANFE) e devolve os dados estruturados. Cada imagem é a foto do papel ou um print (captura de tela) da página de consulta da nota no site da Sefaz, que mostra a mesma nota em outro leiaute. Os dados alimentam um comparativo de preços entre mercados, então preço e quantidade de cada item precisam bater com o que está na nota.`;

/**
 * Até 6 imagens por nota: a nota comprida, fotografada em partes, e os prints da página da Sefaz (o topo, a lista
 * de itens em até quatro telas e o rodapé). A primeira vai em receipts.image_path e as outras em
 * extra_image_paths, que o banco limita a 5: passar de 6 pede uma migração antes do deploy. O app tem o mesmo
 * limite (src/domain/receiptPhotos.ts; um teste do app confere este número e o do banco).
 */
export const MAX_PHOTOS = 6;

/** O código da recusa por fotos demais: o app mostra a mensagem, que diz o limite. */
export const TOO_MANY_PHOTOS = 'too_many_photos';

/**
 * Quanto as imagens de uma nota podem somar. Vão em base64 (um terço a mais) num pedido só à IA, e o pedido da
 * Anthropic aceita até 32 MB: cada foto tem até MAX_IMAGE_BYTES (_shared/vision.ts), e 6 no máximo, com o texto do pedido, ficariam no limite.
 */
export const MAX_TOTAL_IMAGE_BYTES = 22_000_000;

/**
 * Os caminhos das imagens do pedido: entre 1 e MAX_PHOTOS, todos da pasta da casa. null quando estão certos; senão
 * o corpo do 400 (com o código TOO_MANY_PHOTOS quando são imagens demais).
 */
export function imagePathsError(paths: unknown[], householdId: string): { error: string; code?: string } | null {
  if (paths.length > MAX_PHOTOS) return { error: `Mande até ${MAX_PHOTOS} fotos ou prints por nota.`, code: TOO_MANY_PHOTOS };
  if (!paths.length || paths.some((p) => typeof p !== 'string' || !p.startsWith(`${householdId}/`))) return { error: 'Imagem inválida.' };
  return null;
}

export function instructions(catalog: CatalogProduct[], photos = 1): string {
  const catalogText = catalog.length
    ? catalog.map((p) => `${p.id} | ${p.name}`).join('\n')
    : '(nenhum ainda)';
  const parts =
    photos > 1
      ? `\nA nota veio em ${photos} imagens, em ordem, e todas são partes da mesma nota: fotos do papel, de cima para baixo, ou prints da página da Sefaz (o topo com o mercado, a lista de itens, o rodapé com a data e a chave). As partes podem se sobrepor: um item que aparece no fim de uma imagem e no começo da seguinte entra uma vez só. Junte tudo numa nota só.\n`
      : '';
  return `Extraia os dados desta nota.
${parts}
- A imagem pode ser a foto do papel ou um print da página de consulta da NFC-e no site da Sefaz (com o nome do mercado, os itens, os totais ou a chave de acesso). Os dois são a nota de compra: leia o print como leria o papel. Um print com só uma parte da nota (só os itens, só o topo ou só o rodapé) também é nota: leia o que estiver nele e deixe null o que não aparecer.
- Na página da Sefaz, cada item costuma vir com "Qtde.", "UN", "Vl. Unit." e "Vl. Total": use esses valores. Ignore os dados do consumidor (CPF, nome), os botões e os textos do site.
- No print, a coluna da direita (o "Vl. Total") pode sair cortada na borda da tela. Número cortado, com algum dígito faltando ou pela metade, é ilegível: null. Nunca complete o número.
- items: um por produto, na ordem impressa. Não inclua descontos gerais, troco, formas de pagamento nem tributos.
- Desconto de um item específico entra no total_price dele (valor líquido), também quando vem impresso numa linha separada logo abaixo do item; a linha do desconto não vira item.
- Item cancelado fica de fora, junto com a linha que o cancela (cancelamento, estorno). Nenhum item tem valor negativo.
- raw_description: a descrição exatamente como impressa.
- code: o código do produto impresso na linha, como está na nota: na página da Sefaz, o "Código" do item; no papel, o número que vem antes da descrição, logo depois do número do item (001, 002...). Ex.: "001 7891000100103 LEITE ITALAC 1L" -> "7891000100103"; "002 250474 BANANA PRATA KG" -> "250474"; na página da Sefaz, "(Código: 250474 )" -> "250474", sem a palavra "Código". O número do item (001, 002...) nunca é o código; a linha que só tem o número do item: null. Só o que está impresso e legível: nunca complete nem invente um código. A linha que não mostra código: null.
- normalized_name: nome legível em português com marca e tamanho quando houver. Ex.: "ARROZ T.JOAO TP1 5KG" -> "Arroz Tio João Tipo 1 5kg".
- generic_name: o item como alguém escreveria na lista de compras, em português e em minúsculas, sem marca, tamanho nem embalagem, com o tipo, o sabor ou o corte só quando a nota diz. Ex.: "CAF TORR MOIDO 3COR 500G" -> "café em pó"; "PAP HIG NEVE FD 12X30M" -> "papel higiênico"; "GILLETTE MACH3 APARELHO" -> "aparelho de barbear"; "NESCAU 2.0 400G" -> "achocolatado em pó"; "VEJA MULTIUSO 500ML" -> "limpador multiuso"; "LTE UHT ITALAC DESN 1L" -> "leite desnatado"; "LEITE UHT PARMALAT 1L" -> "leite" (a nota não diz se é integral ou desnatado: não acrescente); "PATINHO MOIDO KG" -> "patinho moído"; "IOG GREGO VIGOR MOR 100G" -> "iogurte grego de morango". Não dá para saber o que é: null.
- quantity/unit: itens pesados usam "kg" com a quantidade pesada (ex.: 0,535 kg de banana); demais usam a unidade impressa, ou "un".
- unit_price: preço por unidade de "unit"; total_price: valor do item.
- Preço ou quantidade que não dá para ler: null. Nunca estime nem invente um número que não está legível na nota.
- matched_product_id: o id de um produto da lista abaixo se for o mesmo produto (mesma marca e mesmo tamanho); senão null. Na dúvida, null.
- purchased_at: data/hora de emissão em ISO 8601; sem fuso impresso, use -03:00.
- total: o valor pago pela nota, já com os descontos ("Valor a pagar", "TOTAL NOTA"). Quando a nota mostra também o total dos produtos antes do desconto, use o valor a pagar.
- cnpj: 14 dígitos do emitente, sem pontuação. access_key: os 44 dígitos da chave de acesso, se visível.
- Outro campo ilegível: null. Não invente valores.
- Se nenhuma imagem for de uma nota de compra (nem foto do papel nem print da nota na Sefaz), is_receipt=false e items vazio.

Produtos já cadastrados (id | nome):
${catalogText}`;
}

export interface CleanItem {
  position: number;
  raw_description: string;
  suggested_name: string;
  suggested_category: string;
  /** O item genérico (genericName), gravado em receipt_items.generic_name; null quando a IA não soube. */
  generic_name: string | null;
  /** O código do produto impresso na linha, pela chave do banco (storeCodeKey), em receipt_items.store_code; null sem código. */
  store_code: string | null;
  product_id: string | null;
  quantity: number;
  unit: (typeof UNITS)[number];
  unit_price: number;
  total_price: number;
}

/** O banco recusa mais que isso (check de receipt_items.generic_name): "papel higiênico" cabe com folga. */
export const MAX_GENERIC_NAME = 60;

/**
 * O item genérico como o banco guarda: sem espaços nas pontas nem repetidos e
 * em minúsculas. Vazio ou comprido demais (a IA repetiu a descrição inteira, com
 * marca e tamanho) vira null: cortar deixaria meia palavra, que casaria errado.
 */
export function genericName(value: string | null | undefined): string | null {
  const name = (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
  return name && name.length <= MAX_GENERIC_NAME ? name : null;
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

/** As unidades em que a NFC-e imprime o preço por unidade com até 4 casas, o que a conta abaixo cobre. */
const COMPUTED_UNITS: ReadonlySet<string> = new Set(['un', 'kg', 'l']);

/**
 * O valor do item que não deu para ler (o "Vl. Total" cortado na borda do
 * print da Sefaz, por exemplo), quando a quantidade e o preço unitário foram
 * lidos: na NFC-e o valor do item é a quantidade vezes o preço unitário, com
 * até 1 centavo de diferença (o caixa arredonda ou trunca). A conta é feita em
 * inteiros (até 4 casas na quantidade e no preço), para o centavo não depender
 * do ponto flutuante. Sem um dos dois, ou em g e ml (preço por grama com mais
 * casas do que a leitura guarda), 0: a revisão pergunta. Quem usa confere a
 * soma com o total da nota (cleanReceipt).
 */
export function lineTotalFromPrinted(quantity: number | null, unit: string, unitPrice: number | null): number {
  if (quantity == null || !(quantity > 0) || unitPrice == null || !(unitPrice > 0) || !COMPUTED_UNITS.has(unit)) return 0;
  const scaledQuantity = Math.round(quantity * 10000);
  const scaledPrice = Math.round(unitPrice * 10000);
  if (!Number.isFinite(scaledQuantity) || !Number.isFinite(scaledPrice)) return 0;
  const product = BigInt(scaledQuantity) * BigInt(scaledPrice);
  return Number((product + 500000n) / 1000000n) / 100;
}

/** Até quanto a soma das linhas pode passar do total da nota (o arredondamento que a revisão também aceita), em centavos. */
const SUM_TOLERANCE_CENTS = 5;

/**
 * Normaliza o que veio da IA para o que o banco aceita: chave e CNPJ só com
 * os dígitos verificadores certos (com a chave válida, o CNPJ é o dela), data
 * válida, quantidades positivas, preço unitário coerente e ids de produto que
 * realmente existem na família (alias exato tem prioridade). Valor do item
 * ilegível (null) é a quantidade vezes o preço unitário, quando os dois foram
 * lidos (lineTotalFromPrinted), o total da nota foi lido, nenhuma outra linha
 * ficou sem valor e a soma das linhas não passa do total (mais o
 * arredondamento de cada conta): um desconto do item que não teve onde entrar
 * ou um número mal lido (642 kg, um preço de pacote em gramas) passa do
 * total, e aí nenhuma conta fica. Sem a conta, o valor
 * vira 0, o "sem valor" que a revisão pergunta à pessoa; linha negativa
 * (cancelamento, desconto que a IA pôs como item) fica de fora. Quantidade
 * ilegível sai do total e do preço unitário; sem o preço unitário, a linha
 * fica de fora de `readLines` (nunca compartilha um preço por kg inventado).
 * O item genérico vai limpo (genericName) para a linha da nota, nunca para a
 * leitura do servidor: ele só serve ao casamento com a lista da casa. O código
 * do produto vai pela chave do banco (storeCodeKey), também só para a linha:
 * o produto que ele já ensinou entra depois, em withStoreCodes.
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

  const receiptTotal = extracted.total != null && extracted.total >= 0 ? round(extracted.total, 2) : null;
  const items: CleanItem[] = [];
  const readLines: ReadLine[] = [];
  const computed: CleanItem[] = [];
  for (const it of extracted.items) {
    const raw = it.raw_description.trim();
    if (!raw) continue;
    // Zerar a linha negativa faria a revisão pedir o preço de um "CANCELAMENTO".
    if ((it.total_price ?? 0) < 0 || (it.unit_price ?? 0) < 0) continue;
    const fromPrinted = it.total_price == null && receiptTotal != null ? lineTotalFromPrinted(it.quantity, it.unit, it.unit_price) : 0;
    const total = it.total_price == null ? fromPrinted : round(it.total_price, 2);
    const quantity = lineQuantity(it.quantity, it.unit, it.unit_price, total);
    const readPrice = it.unit_price != null && it.unit_price > 0 ? it.unit_price : null;
    const unitPrice = readPrice != null ? round(readPrice, 4) : round(total / quantity, 4);
    // Sem preço unitário nem quantidade lidos, o preço é o total sobre 1, que a nota não imprimiu;
    // sem valor nenhum (preço 0), não há o que a leitura guardar.
    if (unitPrice > 0 && (readPrice != null || (it.quantity != null && it.quantity > 0))) {
      readLines.push({ description: raw, unit: it.unit, unit_price: unitPrice });
    }
    const suggested = it.matched_product_id && catalogIds.has(it.matched_product_id) ? it.matched_product_id : null;
    const item: CleanItem = {
      position: items.length,
      raw_description: raw,
      suggested_name: it.normalized_name.trim() || raw,
      suggested_category: it.category,
      generic_name: genericName(it.generic_name),
      // O rótulo que a IA copiou do print ("Código: 250474") sai até o último ":", como afterLabel faz no QR: um
      // código impresso nunca tem ":". Tirar "COD" do começo sem os dois-pontos estragaria um código como "CODA123".
      store_code: storeCodeKey(it.code?.replace(/^.*:/s, '')),
      product_id: aliasMatches.get(raw) ?? suggested,
      quantity,
      unit: it.unit,
      unit_price: unitPrice,
      total_price: total,
    };
    items.push(item);
    if (fromPrinted > 0) computed.push(item);
  }
  // A conferência das contas: a soma de todas as linhas não passa do total da nota; o que passa é desconto que ficou
  // de fora ou número mal lido. Com outra linha ainda sem valor, a soma não confere nada (o valor que falta nela
  // esconderia um desconto perdido), e a revisão pergunta todas.
  if (computed.length && receiptTotal != null) {
    const sumCents = items.reduce((sum, i) => sum + Math.round(i.total_price * 100), 0);
    const unread = items.some((i) => i.total_price === 0 && !computed.includes(i));
    if (unread || sumCents > Math.round(receiptTotal * 100) + SUM_TOLERANCE_CENTS + computed.length) {
      for (const item of computed) item.total_price = 0;
    }
  }

  return {
    storeName: extracted.store_name?.trim() || null,
    cnpj,
    address: extracted.address?.trim() || null,
    purchasedAt,
    accessKey,
    total: receiptTotal,
    items,
    readLines,
  };
}

/**
 * As colunas dos itens que chegaram por migrações recentes: o item genérico
 * (generic_name) e o código do produto na nota (store_code). A função pode ser
 * publicada antes de cada uma.
 */
export const OPTIONAL_ITEM_COLUMNS = ['generic_name', 'store_code'] as const;
export type OptionalItemColumn = (typeof OPTIONAL_ITEM_COLUMNS)[number];

/**
 * A coluna recente que ainda não chegou ao banco (a função publicada antes da
 * migração): o PostgREST recusa a gravação que a traz com PGRST204 ("Could not
 * find the 'store_code' column"), e o Postgres, com 42703. Só vale se a
 * mensagem fala dela, com o nome inteiro (o check "receipt_items_store_code_check"
 * não conta): outra coluna que falte é erro de verdade. null quando não é isso.
 */
export function missingItemColumn(
  error: { code?: string; message?: string } | null | undefined,
  columns: readonly OptionalItemColumn[] = OPTIONAL_ITEM_COLUMNS,
): OptionalItemColumn | null {
  if (!error || (error.code !== 'PGRST204' && error.code !== '42703')) return null;
  const words = (error.message ?? '').split(/[^A-Za-z0-9_]+/);
  return columns.find((column) => words.includes(column)) ?? null;
}

/**
 * Grava os itens da nota com o item genérico e o código e, se o banco ainda não
 * tem uma das colunas, grava de novo sem ela (uma de cada vez: o erro fala de
 * uma só). A nota não se perde por isso: casa com a lista e reconhece os
 * produtos como antes. Qualquer outro erro volta como veio.
 */
export async function insertItems<R extends Partial<Record<OptionalItemColumn, unknown>>, E extends { code?: string; message?: string }>(
  insert: (rows: Partial<R>[]) => PromiseLike<{ error: E | null }>,
  rows: R[],
): Promise<{ error: E | null }> {
  let batch: Partial<R>[] = rows;
  let columns: readonly OptionalItemColumn[] = OPTIONAL_ITEM_COLUMNS;
  for (;;) {
    const result = await insert(batch);
    const missing = missingItemColumn(result.error, columns);
    if (!missing) return result;
    console.warn(`receipt items saved without ${missing}: the column is not in the database yet`);
    columns = columns.filter((column) => column !== missing);
    batch = batch.map(({ [missing]: _dropped, ...row }) => row as Partial<R>);
  }
}

/**
 * Os produtos já aprendidos pelos códigos da nota (match_store_codes), por
 * código. O banco de antes da função (PGRST202, 42883) ou outro erro: nenhum,
 * e a nota fica com o apelido e a sugestão da IA, como antes.
 */
export function storeCodeMatches(
  rows: { code: string; product_id: string }[] | null,
  error: { code?: string; message?: string } | null,
): Map<string, string> {
  if (error) {
    const missing = error.code === 'PGRST202' || error.code === '42883';
    console.warn(missing ? 'match_store_codes is not in the database yet' : `match_store_codes failed: ${error.code ?? 'no code'}`);
    return new Map();
  }
  return new Map((rows ?? []).map((row) => [row.code, row.product_id]));
}

/**
 * O produto que o código da linha já ensinou à casa (do mercado da nota, depois
 * o de barras) vence o apelido e a sugestão da IA: o mercado imprime o mesmo
 * código para o mesmo produto, mesmo quando muda a descrição. O produto é da
 * casa (match_store_codes só vê a dela) e não precisa estar no catálogo que a
 * IA viu. A linha sem código, ou com um que a casa ainda não aprendeu, fica
 * como estava.
 */
export function withStoreCodes(items: CleanItem[], matches: ReadonlyMap<string, string>): CleanItem[] {
  return items.map((item) => {
    const learned = item.store_code ? matches.get(item.store_code) : undefined;
    return learned ? { ...item, product_id: learned } : item;
  });
}

/** Os códigos das linhas, sem repetir: o que se pergunta a match_store_codes. */
export function itemStoreCodes(items: CleanItem[]): string[] {
  return [...new Set(items.flatMap((item) => (item.store_code ? [item.store_code] : [])))];
}

/**
 * Mesmo nome de loja, sem diferença de caixa nem espaços nas pontas. A
 * comparação é feita aqui, e não num ILIKE: o nome lido da nota pode trazer
 * "%", "_" ou "*" (que o PostgREST trata como curinga) e casar com qualquer loja.
 */
export const sameStoreName = (a: string, b: string) => a.trim().toLocaleLowerCase('pt-BR') === b.trim().toLocaleLowerCase('pt-BR');
