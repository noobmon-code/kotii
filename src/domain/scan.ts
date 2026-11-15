// O "Escanear" da tela Hoje: uma câmera só, que lê sozinha o QR code da nota e o código de barras de um produto,
// e em que a foto vai para a IA dizer se é nota, produto ou prateleira. Aqui ficam as regras e os textos: o que um
// código lido é, quando a foto espera a próxima parte, o que a função respondeu, os produtos achados (que se juntam
// até a pessoa dizer para onde vão) e as linhas que eles viram na despensa e na lista. Sem React nem Supabase.

import { gtinKey } from './barcode';
import { CATEGORIES } from './categories';
import { genericItem } from './genericItem';
import { parseNfceQr } from './nfce';
import { estimateExpiry } from './pantry';
import { MAX_RECEIPT_PHOTOS } from './receiptPhotos';

/** `tudo`: a câmera da tela Hoje (nota ou produto). `despensa`: o que a casa já tem, só produtos, direto para a despensa. */
export type ScanMode = 'tudo' | 'despensa';

/** O modo pedido na URL (?para=despensa); o que não for isso é a câmera de sempre. */
export function scanModeFromParam(value: string | string[] | undefined): ScanMode {
  return (Array.isArray(value) ? value[0] : value) === 'despensa' ? 'despensa' : 'tudo';
}

/** Os códigos que a câmera procura: o QR da nota e os códigos de barras de produto. */
export const SCAN_BARCODE_TYPES = ['qr', 'ean13', 'ean8', 'upc_a'] as const;

/** Um código lido que serve para alguma coisa. */
export type ScanCode = { kind: 'nota'; text: string; accessKey: string } | { kind: 'produto'; gtin: string };

/**
 * O que a câmera leu: o QR de uma NFC-e é uma nota, o código de barras com o dígito certo é um produto. O resto
 * (o QR de propaganda da embalagem, o código interno do mercado, um número qualquer) não é nada: a câmera segue lendo.
 */
export function readScanCode(data: string | null | undefined): ScanCode | null {
  const text = (data ?? '').trim();
  if (!text) return null;
  const qr = parseNfceQr(text);
  if (qr) return { kind: 'nota', text, accessKey: qr.accessKey };
  const gtin = gtinKey(text);
  return gtin ? { kind: 'produto', gtin } : null;
}

/** O que a tela tem na hora: o modo e quantos produtos já achou e ainda não guardou. */
export interface ScanState {
  mode: ScanMode;
  found: number;
}

/** Com produtos achados (ou no modo da despensa), a tela está só nos produtos: a nota fica para depois. */
const onlyProducts = ({ mode, found }: ScanState) => mode === 'despensa' || found > 0;

/**
 * O que fazer com o código lido. A nota só abre com a tela vazia: com produtos achados e não guardados, abrir a
 * nota os perderia, e no modo da despensa ninguém pediu nota.
 */
export function scanCodeStep(code: ScanCode | null, state: ScanState): 'nota' | 'produto' | 'ignorar' {
  if (!code) return 'ignorar';
  if (code.kind === 'produto') return 'produto';
  return onlyProducts(state) ? 'ignorar' : 'nota';
}

/**
 * Depois de uma foto. `partes`: pode ser uma nota comprida, e a pessoa diz se lê ou se fotografa a próxima parte.
 * `ler`: vai direto para a leitura (a tela só nos produtos, ou a nota já no máximo de fotos).
 */
export function photoStep(state: ScanState, parts: number): 'partes' | 'ler' {
  if (onlyProducts(state)) return 'ler';
  return parts >= MAX_RECEIPT_PHOTOS ? 'ler' : 'partes';
}

/** Como pedir a leitura à função: `any` aceita nota ou produtos; `products`, só produtos (a nota não é lida). */
export type ScanClassify = 'any' | 'products';

export const classifyFor = (state: ScanState): ScanClassify => (onlyProducts(state) ? 'products' : 'any');

// ---------------------------------------------------------------------------
// O que a função respondeu

/** Um produto que a IA achou na foto. */
export interface FoundProduct {
  name: string;
  category: string;
  quantity: number;
}

export type ScanReply =
  | { kind: 'nota'; receiptId: string; duplicate: boolean }
  /** É uma nota, mas a tela pediu só produtos: nada foi lido. */
  | { kind: 'nota-nao-lida' }
  | { kind: 'produtos'; products: FoundProduct[] }
  | { kind: 'nada' };

export const MAX_SCAN_QUANTITY = 99;
const MAX_SCAN_NAME = 120;

const CATEGORY_KEYS = new Set<string>(CATEGORIES.map((category) => category.key));

function foundProduct(raw: unknown): FoundProduct | null {
  if (!raw || typeof raw !== 'object') return null;
  const { name, category, quantity } = raw as { name?: unknown; category?: unknown; quantity?: unknown };
  const clean = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, MAX_SCAN_NAME).trim() : '';
  if (!clean) return null;
  const count = typeof quantity === 'number' && Number.isFinite(quantity) && quantity >= 1 ? Math.floor(quantity) : 1;
  return {
    name: clean,
    category: typeof category === 'string' && CATEGORY_KEYS.has(category) ? category : 'outros',
    quantity: Math.min(count, MAX_SCAN_QUANTITY),
  };
}

/**
 * A resposta da função, conferida. A função de antes do "Escanear" lê tudo como nota e responde só o id: é uma
 * nota. null quando a resposta não é nada que o app entenda.
 */
export function parseScanReply(data: unknown): ScanReply | null {
  if (!data || typeof data !== 'object') return null;
  const reply = data as { kind?: unknown; receipt_id?: unknown; duplicate?: unknown; products?: unknown };
  if (typeof reply.receipt_id === 'string' && reply.receipt_id) {
    return { kind: 'nota', receiptId: reply.receipt_id, duplicate: reply.duplicate === true };
  }
  if (reply.kind === 'nota') return { kind: 'nota-nao-lida' };
  if (reply.kind === 'nada') return { kind: 'nada' };
  if (reply.kind !== 'produtos') return null;
  const products = (Array.isArray(reply.products) ? reply.products : []).flatMap((raw) => foundProduct(raw) ?? []);
  return products.length ? { kind: 'produtos', products } : { kind: 'nada' };
}

/** O código do erro quando as fotos de produto do mês acabaram. */
export const PRODUCT_QUOTA = 'product_quota';

// ---------------------------------------------------------------------------
// Os produtos achados, até a pessoa dizer para onde vão

export interface ScanItem {
  /** O produto da casa (`p:id`) ou o nome lido (`n:nome`): o mesmo achado duas vezes soma na mesma linha. */
  key: string;
  name: string;
  category: string;
  quantity: number;
  /** O produto da casa, quando veio do código de barras. */
  productId: string | null;
  /** A validade que o produto já ensinou à casa, em dias. */
  shelfLifeDays?: number | null;
}

const nameKey = (name: string) => `n:${name.trim().toLocaleLowerCase('pt-BR')}`;

/** O produto da casa que o código de barras achou. */
export function scanItemFromProduct(product: { id: string; name: string; category: string; shelf_life_days?: number | null }): ScanItem {
  return {
    key: `p:${product.id}`,
    name: product.name,
    category: product.category,
    quantity: 1,
    productId: product.id,
    shelfLifeDays: product.shelf_life_days ?? null,
  };
}

/** Os produtos que a IA achou na foto. */
export function scanItemsFromRead(products: readonly FoundProduct[]): ScanItem[] {
  return products.map((p) => ({ key: nameKey(p.name), name: p.name, category: p.category, quantity: p.quantity, productId: null }));
}

/** Junta os achados novos aos de antes, na ordem em que chegaram; o mesmo produto (ou o mesmo nome) soma a quantidade. */
export function addScanItems(tray: readonly ScanItem[], more: readonly ScanItem[]): ScanItem[] {
  const next = tray.map((item) => ({ ...item }));
  for (const item of more) {
    const seen = next.find((other) => other.key === item.key);
    if (seen) seen.quantity = Math.min(seen.quantity + item.quantity, MAX_SCAN_QUANTITY);
    else next.push({ ...item, quantity: Math.min(Math.max(1, item.quantity), MAX_SCAN_QUANTITY) });
  }
  return next;
}

/** Mais um ou menos um de um achado, entre 1 e 99 (para tirar da lista, removeScanItem). */
export function changeScanQuantity(tray: readonly ScanItem[], key: string, delta: number): ScanItem[] {
  return tray.map((item) =>
    item.key === key ? { ...item, quantity: Math.min(Math.max(1, item.quantity + delta), MAX_SCAN_QUANTITY) } : item,
  );
}

export const removeScanItem = (tray: readonly ScanItem[], key: string): ScanItem[] => tray.filter((item) => item.key !== key);

// ---------------------------------------------------------------------------
// Para onde os achados vão

/** Uma linha da despensa, como o banco recebe. */
export interface ScanPantryRow {
  name: string;
  category: string;
  quantity: number;
  unit: 'un';
  purchased_on: string;
  expires_on: string | null;
  expiry_source: 'categoria' | 'produto' | null;
  product_id: string | null;
}

/**
 * Os achados como linhas da despensa: em unidades, com a data de hoje e a validade estimada como a do formulário
 * da despensa (a que o produto já ensinou, senão a da categoria). O que a pessoa já tinha em casa foi comprado
 * antes de hoje, e o app não sabe quando: a estimativa parte de hoje, e a pessoa corrige o item se quiser.
 */
export function pantryRowsFromScan(items: readonly ScanItem[], today: string): ScanPantryRow[] {
  return items.map((item) => {
    const estimate = estimateExpiry({ purchasedOn: today, category: item.category, productShelfLifeDays: item.shelfLifeDays });
    return {
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      unit: 'un',
      purchased_on: today,
      expires_on: estimate.expiresOn,
      expiry_source: estimate.expiresOn ? estimate.source : null,
      product_id: item.productId,
    };
  });
}

/** Um item da lista de compras, como useAddToMarketList recebe. */
export interface ScanListItem {
  name: string;
  category: string;
  productId: string | null;
  quantity: number;
  unit: 'un';
}

/** Os achados como itens da lista: sem a marca, como tudo que entra na lista (domain/genericItem), em unidades. */
export function listItemsFromScan(items: readonly ScanItem[]): ScanListItem[] {
  return items.map((item) => ({
    name: genericItem(item.name, item.category).name,
    category: item.category,
    productId: item.productId,
    quantity: item.quantity,
    unit: 'un',
  }));
}

// ---------------------------------------------------------------------------
// Textos

export const SCAN_TITLE = 'Escanear';
export const SCAN_PANTRY_TITLE = 'O que já tem em casa';

/** A frase em cima da câmera: o que ela lê agora. */
export function scanHint(state: ScanState): string {
  if (state.mode === 'despensa') {
    return 'Aponte para o código de barras de cada produto, ou tire uma foto do produto ou da prateleira inteira. O que for achado fica aqui embaixo até você guardar.';
  }
  return state.found > 0
    ? 'Siga com os produtos: o código de barras, ou uma foto do produto ou da prateleira. A nota fica para depois de guardar estes.'
    : 'Aponte para o QR code da nota ou para o código de barras de um produto. Ou tire uma foto: da nota, de um produto ou da prateleira.';
}

export const SCAN_SHUTTER = 'Tirar foto';
export const SCAN_MORE = 'Mais opções';
export const SCAN_ALLOW_CAMERA = 'Permitir a câmera';
export const SCAN_NEEDS_CAMERA = 'Para ler códigos e tirar fotos, o Kotii precisa usar a câmera. Sem ela, dá para usar as opções abaixo.';

export type ScanOption = 'galeria' | 'link' | 'codigo' | 'manual';

export const SCAN_OPTION_LABELS: Record<ScanOption, string> = {
  galeria: 'Escolher da galeria',
  link: 'Colar o link do QR code',
  codigo: 'Digitar o código de barras',
  manual: 'Digitar a nota manualmente',
};

/** As opções além da câmera. No modo da despensa (e com produtos achados), as da nota ficam de fora. */
export function scanOptions(state: ScanState): ScanOption[] {
  return onlyProducts(state) ? ['galeria', 'codigo'] : ['galeria', 'link', 'codigo', 'manual'];
}

/** Quantas imagens a galeria deixa escolher: as partes de uma nota, ou uma foto só quando são produtos. */
export const galleryLimit = (state: ScanState) => (onlyProducts(state) ? 1 : MAX_RECEIPT_PHOTOS);

/** Mais imagens escolhidas do que a leitura aceita (no navegador a galeria não segura o limite): nada é lido. */
export function tooManyImagesMessage(limit: number): string {
  return limit === 1
    ? 'Escolha uma imagem só: a foto do produto ou da prateleira.'
    : `Escolha até ${limit} imagens da mesma nota, sem deixar de fora o topo (com o mercado) e o rodapé (com a data).`;
}

export const partsTitle = (parts: number) => (parts === 1 ? 'Foto tirada' : `${parts} fotos tiradas`);
export const PARTS_MESSAGE =
  'Se for uma nota comprida, fotografe o resto de cima para baixo, deixando um pedaço repetido entre as fotos. Produto ou prateleira é uma foto só.';
export const partsRead = (parts: number) => (parts === 1 ? 'Ler' : `Ler (${parts} fotos)`);
export const PARTS_MORE = 'Mais uma foto';

export const SCAN_READING_TITLE = 'Lendo a foto…';
export const SCAN_READING_MESSAGE = 'Vendo se é uma nota ou produtos. Nota comprida pode levar até um minuto.';

export const foundTitle = (count: number) => (count === 1 ? '1 produto achado' : `${count} produtos achados`);
export const SCAN_TO_PANTRY = 'Pôr na despensa';
export const SCAN_TO_LIST = 'Pôr na lista';

export const SCAN_NOTHING_TITLE = 'Não reconheci a foto';
/** A foto que não é nota nem produto, pela tela em que foi tirada. */
export function scanNothingMessage(state: ScanState): string {
  return onlyProducts(state)
    ? 'Não achei nenhum produto nesta foto. Tente de novo mais de perto, com o rótulo de frente e bem iluminado.'
    : 'Não achei uma nota nem um produto nesta foto. Tente de novo mais de perto: a nota inteira, ou o rótulo do produto de frente.';
}

export const SCAN_RECEIPT_LATER_TITLE = 'Isto parece uma nota';
/** A nota fotografada com a tela só nos produtos: não foi lida. */
export function scanReceiptLaterMessage(state: ScanState): string {
  return state.mode === 'despensa'
    ? 'Aqui entram só os produtos. Para ler a nota, use o Escanear da tela Hoje.'
    : 'Guarde antes os produtos achados. Depois, escaneie a nota de novo.';
}

export const SCAN_QR_NOT_RECEIPT_TITLE = 'QR code não reconhecido';
export const SCAN_QR_NOT_RECEIPT = 'Esse link não é de uma nota fiscal de consumidor (NFC-e).';

/** "3 itens foram para a despensa." */
export function savedToPantryMessage(count: number): string {
  return count === 1 ? '1 item foi para a despensa.' : `${count} itens foram para a despensa.`;
}

/** O que foi para a lista; o que já estava lá não entra de novo, e a frase diz. */
export function savedToListMessage(added: number, skipped: number, listName: string): string {
  if (!added) return skipped === 1 ? `Já estava na lista "${listName}".` : `Já estava tudo na lista "${listName}".`;
  const went = added === 1 ? `1 item foi para a lista "${listName}".` : `${added} itens foram para a lista "${listName}".`;
  if (!skipped) return went;
  return `${went} ${skipped === 1 ? '1 já estava lá.' : `${skipped} já estavam lá.`}`;
}

export const SCAN_LEAVE_TITLE = 'Sair sem guardar?';
export const scanLeaveQuestion = (count: number) =>
  count === 1 ? 'O produto achado ainda não foi guardado.' : `Os ${count} produtos achados ainda não foram guardados.`;
