// A base aberta de preços ("uma grande lista aberta", decisão do dono de
// 21/11/2026): o item da lista que a casa nunca comprou acha preço nas notas
// de outras casas dos estados onde ela compra. Aqui ficam as regras e os
// textos dessa leitura; o banco faz a busca em dois passos
// (supabase/migrations/20261122150000_shared_prices_open.sql):
//
// 1. shared_item_keys: para cada item, as descrições de nota (item_key, a
//    descrição padronizada: sem acento, em maiúsculas) que começam pelas
//    palavras dele (sameItem: itemSearchWords) ou as têm em segundo lugar,
//    com a semana mais nova e em quantos (mercado, semana) foram vistas;
// 2. shared_item_prices: para os grupos de descrições que o app decidiu
//    serem o mesmo item (openGroups), o preço da semana mais recente de cada
//    mercado.
//
// O app decide o que é o mesmo item com o vocabulário da revisão da nota:
// só o `mesmo` de sameItemFit, sem marca de outro produto (quebrado, tipo 2,
// cabra…) nem forma que a lista não diz (o café solúvel para "Café"). Na
// dúvida, fica de fora. O tamanho vem da leitura estrita da descrição
// (keyPackageSize, a mesma de quando o tamanho vai para a base) e do que o
// servidor leu na nota (pack_*). A conta da lista e do "Onde comprar" está em
// domain/listEstimate (o preço da casa sempre vence, depois o de outras casas
// pelo produto, e só no fim este).

import { genericItem } from './genericItem';
import { singular } from './nameWords';
import { packagesFor, plainSize } from './packagePrice';
import { packageLabel, packageSize, samePackageSize, sharedPackageSize, type PackageSize } from './packageSize';
import { addsForm, itemExtraWords, itemIdentity, sameItemFit, searchWords, spelledOut } from './sameItem';
import { guessCategory } from './search';
import {
  newerSharedRow,
  SHARED_CATEGORIES,
  sharedPack,
  sharedRowOf,
  sharedWeekStart,
  withinBand,
  type OpenPrice,
  type SharedPrice,
  type SharedPriceRow,
  type SharedQuote,
  type StoreCnpj,
} from './sharedPrices';
import { convertQuantity } from './units';

/** Buscas por chamada do passo 1 e grupos por chamada do passo 2 (o banco recusa mais: SQL). */
export const OPEN_MAX_ENTRIES = 40;
/** Chamadas de cada passo por lista: 160 buscas; o resto fica sem preço aberto. */
export const OPEN_MAX_CALLS = 4;
/** Descrições que o banco devolve por busca, e que um grupo leva (SQL). */
export const OPEN_KEYS_PER_ENTRY = 60;
/** Primeiras e segundas palavras por busca, cada uma (SQL). */
export const OPEN_MAX_WORDS = 24;
/** Palavras que só ordenam, por busca (SQL). */
export const OPEN_MAX_EXTRA = 12;

/** Logo depois do preço de outras casas nos detalhes do item: o que é esse preço. */
export const OPEN_PRICE_FACT =
  'É o menor preço do mesmo item nas notas de outras casas daquele mercado, naquela semana: a marca ou a variedade pode ser outra.';

/** O item da lista como a busca o lê. */
export interface OpenSearchItem {
  id: string;
  name: string;
  category: string | null;
  quantity: number;
  unit: string;
  brandPreferred?: boolean;
}

/** Uma busca: as palavras do item, em MAIÚSCULAS, sem repetir, em ordem; itens com as mesmas palavras dividem a busca. */
export interface OpenSearchEntry {
  signature: string;
  first: string[];
  second: string[];
  extra: string[];
}

export interface OpenSearchPlan {
  calls: OpenSearchEntry[][];
  /** De cada item (pelo id), a assinatura da sua busca. */
  entryOf: ReadonlyMap<string, string>;
}

/** Uma descrição da base: a chave, a unidade, a segunda-feira da semana mais nova e em quantos (mercado, semana) foi vista. */
export interface SharedItemKey {
  key: string;
  unit: 'un' | 'kg' | 'g' | 'l' | 'ml';
  week: string;
  seen: number;
}

/** A resposta de uma chamada do passo 1, alinhada com as buscas da chamada. */
export interface OpenKeysAnswer {
  entries: string[];
  keys: SharedItemKey[][];
  more: boolean[];
}

/** Um item num grupo: o tamanho escolhido para ele e, pedido em peso ou volume, o pacote cujo preço vira por kg ou litro. */
export interface OpenGroupItem {
  id: string;
  size: string | null;
  sizeBy: OpenPrice['sizeBy'];
  /** O tamanho do pacote das linhas por unidade, quando se sabe (o da lista ou o escolhido). */
  pack: PackageSize | null;
  perBase: { unit: 'kg' | 'l'; amount: number; label: string; packages: number | null } | null;
}

/**
 * Um grupo de descrições que são o mesmo item (para um ou mais itens da lista). `keys`: as descrições cujas linhas
 * valem em toda unidade (as por unidade que o app escolheu, com as vendidas a peso delas); `weightOnly`: as que só
 * valem vendidas a peso (kg, g, l, ml): "ALHO" entra pelo alho a granel, e a cabeça solta, "ALHO" por unidade, não é o
 * tamanho escolhido. `expected`: o tamanho das linhas por unidade que o grupo quer (o banco deixa de fora a linha
 * cujo tamanho lido é outro), na forma que a base guarda (basePackSize). A assinatura é as chaves, em ordem, uma por
 * linha, as só a peso depois de "~", e o tamanho esperado.
 */
export interface OpenGroup {
  signature: string;
  keys: string[];
  weightOnly: string[];
  expected: PackageSize | null;
  items: OpenGroupItem[];
}

/** Uma linha do passo 2: a de shared_latest_prices, com o número do grupo no lugar do produto. */
export interface SharedItemPrice extends Omit<SharedPrice, 'product_id'> {
  group: number;
}

/** A resposta de uma chamada do passo 2: groups[i] é a assinatura do grupo de número i. */
export interface OpenPricesAnswer {
  groups: string[];
  rows: SharedItemPrice[];
}

// ---------------------------------------------------------------------------
// Que itens procuram

/**
 * A chave do item sem marca (genericItem: "i:leite|2=integral"), quando o item é de qualquer marca: sem "Marca
 * preferida", um item que o app conhece, sem marca no nome. null para o resto, e também para ração e fralda, cujo
 * nome é o item (genericItem os deixa com o nome, "n:…"). A base aberta e a troca de marca partem dela.
 */
export function brandFreeItemKey(item: { name: string; category?: string | null; brandPreferred?: boolean }): string | null {
  if (item.brandPreferred === true) return null;
  const generic = genericItem(item.name, item.category);
  return generic.key.startsWith('i:') && !generic.branded ? generic.key : null;
}

/**
 * Os produtos da casa por chave de item sem marca (genericItem), só os que `keep` aceita (os que têm preço).
 * Serve para não buscar fora o item que a casa já compra com outro nome.
 */
export function productsByGenericKey(
  products: readonly { id: string; name: string; category?: string | null }[],
  keep: (productId: string) => boolean,
): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const product of products) {
    if (!keep(product.id)) continue;
    const { key } = genericItem(product.name, product.category);
    if (!key.startsWith('i:')) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), product.id]);
  }
  return byKey;
}

/**
 * As chaves de item sem marca dos produtos da casa que têm preço (acima de zero). O item digitado "Arroz" numa casa
 * que comprou "Arroz Camil 5kg" fica fora da base aberta: o dado da casa vence, e dar preço a ele pelos produtos
 * da casa é outra mudança.
 */
export function ownSameItemKeys(
  products: readonly { id: string; name: string; category?: string | null }[],
  prices: readonly { productId: string; unitPrice: number }[],
): Set<string> {
  const priced = new Set(prices.filter((price) => price.unitPrice > 0).map((price) => price.productId));
  return new Set(productsByGenericKey(products, (id) => priced.has(id)).keys());
}

/**
 * O item pode buscar preço na base aberta (quem chama já sabe que ele não tem preço nenhum: itemsWithoutPrice): de
 * qualquer marca (brandFreeItemKey), de uma categoria que se compartilha, "outros" ou sem categoria, com palavras
 * para buscar, e não é o item de um produto da casa com preço (`ownKeys`).
 */
export function openPriceItem(item: Pick<OpenSearchItem, 'name' | 'category' | 'brandPreferred'>, ownKeys: ReadonlySet<string>): boolean {
  const key = brandFreeItemKey(item);
  if (!key || ownKeys.has(key)) return false;
  if (item.category != null && item.category !== 'outros' && !SHARED_CATEGORIES.includes(item.category)) return false;
  return searchWords(item.name, item.category) != null;
}

// ---------------------------------------------------------------------------
// O passo 1: a busca das descrições

const upper = (words: readonly string[]) => words.map((word) => word.toUpperCase()).filter((word) => /^[A-Z0-9]{1,40}$/.test(word));
const capped = (forms: readonly string[], rest: readonly string[], cap: number) =>
  [...new Set([...forms, ...rest])].slice(0, cap).sort();

/** A busca de um item: as palavras dele em MAIÚSCULAS, cortadas no teto, as formas do item primeiro. null sem palavras. */
function searchEntry(item: OpenSearchItem): OpenSearchEntry | null {
  const words = searchWords(item.name, item.category);
  if (!words) return null;
  const forms = upper(words.forms);
  const first = capped(forms, upper(words.abbreviations), OPEN_MAX_WORDS);
  const second = capped(
    forms.filter((word) => word.length >= 3),
    upper(words.secondAbbreviations),
    OPEN_MAX_WORDS,
  );
  const extra = upper(itemExtraWords(item.name, OPEN_MAX_EXTRA));
  if (!first.length) return null;
  return { signature: JSON.stringify([first, second, extra]), first, second, extra };
}

/**
 * As buscas da lista: uma por conjunto de palavras (itens com as mesmas palavras dividem), em ordem de assinatura,
 * em chamadas de OPEN_MAX_ENTRIES, no máximo OPEN_MAX_CALLS. A ordem pela assinatura deixa os pedaços iguais quando a
 * ordem da lista muda (e a resposta guardada serve).
 */
export function openSearchPlan(items: readonly OpenSearchItem[]): OpenSearchPlan {
  const bySignature = new Map<string, OpenSearchEntry>();
  const entryOf = new Map<string, string>();
  for (const item of items) {
    const entry = searchEntry(item);
    if (!entry) continue;
    bySignature.set(entry.signature, entry);
    entryOf.set(item.id, entry.signature);
  }
  const entries = [...bySignature.values()].sort((a, b) => (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0));
  const calls: OpenSearchEntry[][] = [];
  for (let at = 0; at < entries.length && calls.length < OPEN_MAX_CALLS; at += OPEN_MAX_ENTRIES) calls.push(entries.slice(at, at + OPEN_MAX_ENTRIES));
  const planned = new Set(calls.flat().map((entry) => entry.signature));
  for (const [id, signature] of [...entryOf]) if (!planned.has(signature)) entryOf.delete(id);
  return { calls, entryOf };
}

/** O que identifica a lista para a busca (o gancho guarda o plano e os grupos por isto): marcar no carrinho não muda nada. */
export function openItemsSignature(items: readonly OpenSearchItem[]): string {
  return JSON.stringify(items.map((item) => [item.id, item.name, item.category, item.quantity, item.unit, item.brandPreferred === true]));
}

const UNITS = new Set(['un', 'kg', 'g', 'l', 'ml']);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A resposta do passo 1, conferida: uma lista com um {k, more} por busca, na ordem delas. Forma errada é erro (a
 * busca tenta de novo), nunca meia resposta. Cada chave vale quando é [texto, unidade, AAAA-MM-DD, inteiro ≥ 1].
 */
export function parseSharedItemKeys(raw: unknown, entries: readonly OpenSearchEntry[]): OpenKeysAnswer {
  if (!Array.isArray(raw) || raw.length !== entries.length) throw new Error('shared_item_keys: resposta inesperada');
  const keys: SharedItemKey[][] = [];
  const more: boolean[] = [];
  for (const element of raw) {
    if (!element || typeof element !== 'object' || !Array.isArray((element as { k?: unknown }).k)) {
      throw new Error('shared_item_keys: resposta inesperada');
    }
    const { k, more: cut } = element as { k: unknown[]; more?: unknown };
    keys.push(
      k.flatMap((row) => {
        if (!Array.isArray(row)) return [];
        const [key, unit, week, seen] = row as unknown[];
        if (typeof key !== 'string' || !key || typeof unit !== 'string' || !UNITS.has(unit)) return [];
        if (typeof week !== 'string' || !ISO_DAY.test(week) || typeof seen !== 'number' || !Number.isInteger(seen) || seen < 1) return [];
        return [{ key, unit: unit as SharedItemKey['unit'], week: sharedWeekStart(week), seen }];
      }),
    );
    more.push(cut === true);
  }
  return { entries: entries.map((entry) => entry.signature), keys, more };
}

// ---------------------------------------------------------------------------
// O mesmo item: as descrições que ficam

/**
 * "C/12" vira "C 12" na chave (normalize_alias), e a leitura do tamanho só entende a caixa com a barra: ela volta onde
 * um "C" vem antes de uma contagem que não é tamanho. "CERV SKOL LT 350ML C 12" volta a ser "… C/12" (12 x 350 ml);
 * "OVOS BRANCOS C 30", "… C/30" (30 un). "OLEO SOJA C 900 ML" e "VIT C 1000MG" ficam como estão.
 */
export function restorePackMark(key: string): string {
  return key.replace(/(^| )C (\d{1,3})(?=$| (?!(?:G|GR|GRS|KG|MG|ML|L|LT|UN|UND|UNID)\b))/g, '$1C/$2');
}

// normalize_alias corta o decimal ("10,1KG" vira "10 1KG"): o número solto antes do tamanho deixa o tamanho em dúvida.
const SPLIT_DECIMAL = /(?:^| )\d{1,3} \d{1,3} ?(?:KG|G|GR|GRS|L|LT|ML)(?= |$)/;

/** Os limites do check de shared_prices.pack_* (20261122140000_package_sizes.sql), os mesmos de readPack no servidor. */
export const MAX_PACK_AMOUNT = 100000;
export const MAX_PACK_OF = 1000;

/**
 * O tamanho como a base o guarda: o que readPack (supabase/functions/_shared/receiptRead.ts) grava em pack_* e o que
 * shared_item_prices aceita no tamanho esperado de um grupo. A quantidade com seis casas, acima de 0 e até 100 000; em
 * "un", inteira e de 2 ou mais; o "N x" só de 2 a 1000, e fora disso o tamanho fica sem ele ("1 x 2 L" é 2 L; "2000 x
 * 350 ml", 700 L, como o servidor guarda). null quando a base não guardaria tamanho nenhum.
 */
export function basePackSize(size: PackageSize | null): PackageSize | null {
  if (!size) return null;
  const amount = Math.round(size.amount * 1e6) / 1e6;
  if (!(amount > 0 && amount <= MAX_PACK_AMOUNT)) return null;
  if (size.unit === 'un') return Number.isInteger(amount) && amount >= 2 ? { unit: 'un', amount, label: packageLabel({ unit: 'un', amount }) } : null;
  const of = size.of != null && Number.isInteger(size.of) && size.of >= 2 && size.of <= MAX_PACK_OF ? size.of : undefined;
  const kept: Omit<PackageSize, 'label'> = { unit: size.unit, amount, ...(of !== undefined ? { of } : {}) };
  return { ...kept, label: of === size.of ? size.label : packageLabel(kept) };
}

/**
 * O tamanho do pacote que uma chave da base diz, pela leitura estrita (sharedPackageSize, a de quando o tamanho vai
 * para a base: "C12", "FD", "SIXPACK" e um número que a leitura não explicou deixam sem tamanho), com a caixa de
 * volta (restorePackMark) e na forma que a base guarda (basePackSize: "REFRI COCA COLA 1X2L" é 2 L, como "… 2L").
 * null também quando o decimal foi cortado ("ARROZ 10 1KG": 10,1 kg ou 1 kg?).
 */
export function keyPackageSize(key: string): PackageSize | null {
  if (SPLIT_DECIMAL.test(key)) return null;
  return basePackSize(sharedPackageSize(restorePackMark(key)));
}

/**
 * Palavras que dizem outro produto do mesmo item e que o leitor ainda lê como o item puro ("ARROZ QUEBRADO", "LEITE
 * CABRA", "OLEO COMPOSTO", "FEIJAO EM LATA"), no singular. Só a base aberta (e a troca de marca) as usa: não mudam o
 * "mesmo item" da revisão da nota.
 */
export const OTHER_PRODUCT_WORDS: ReadonlySet<string> = new Set([
  'quebrado', 'quebrada', 'quirera', 'pronto', 'pronta', 'gelado', 'gelada', 'piso', 'maquina', 'automotivo', 'automotiva',
  'motor', 'peroba', 'movel', 'cabra', 'ovelha', 'bufala', 'amendoa', 'castanha', 'aveia', 'seco', 'seca', 'desidratado',
  'desidratada', 'industrial', 'roupa', 'mineral', 'composto', 'lata', 'cozido', 'cozida', 'granulado', 'granulada',
  'cobertura', 'ralado', 'ralada', 'vermelho', 'negro', 'selvagem', 'cateto', 'arborio', 'arboreo', 'basmati', 'jasmim',
  'grao',
]);

// Depois destas, o "MIN" da nota é o mineral ("OLEO MIN", "SAL MIN"); em outro lugar ele pode ser outra coisa
// ("QUEIJO MIN FRESCAL" é o minas).
const MINERAL_BEFORE = new Set(['oleo', 'sal']);

/**
 * As marcas de "outro produto do mesmo item" num nome (lido por extenso, spelledOut, e no singular): cada palavra de
 * OTHER_PRODUCT_WORDS; "grau" para a classificação de segunda (T2 a T9, 2A a 9A, "segunda", "tipo 2", "tipo II"); e
 * "tipo" para "tipo" antes de uma palavra ("QUEIJO TIPO MUSSARELA", "LEITE TIPO A"). "ARROZ TIPO 1" e "T1" não marcam.
 * O mineral como a nota abrevia: "OLEO MIN" e "SAL MIN" marcam como "OLEO MINERAL"; e a água mineral é a água de
 * sempre, não outro produto: "AGUA MINERAL" não marca, como "AGUA MIN" e "AGUA CRYSTAL".
 */
export function otherProductMarks(name: string): ReadonlySet<string> {
  const words = spelledOut(name).split(' ').filter(Boolean);
  const marks = new Set<string>();
  words.forEach((word, at) => {
    const one = singular(word);
    const prev = at > 0 ? singular(words[at - 1]) : null;
    if (one === 'mineral' && prev === 'agua') return;
    if (word === 'min' && prev && MINERAL_BEFORE.has(prev)) marks.add('mineral');
    if (OTHER_PRODUCT_WORDS.has(word) || OTHER_PRODUCT_WORDS.has(one)) marks.add(OTHER_PRODUCT_WORDS.has(word) ? word : one);
    if (/^t[2-9]$/.test(word) || /^[2-9]a$/.test(word) || word === 'segunda') marks.add('grau');
    if (word === 'tipo' || word === 'tp') {
      const next = words[at + 1];
      if (next && /^(?:[2-9]|ii|iii)$/.test(next)) marks.add('grau');
      else if (next && !/^\d/.test(next) && next !== 'i') marks.add('tipo');
    }
  });
  return marks;
}

const VERDICTS = new Map<string, boolean>();
const VERDICTS_LIMIT = 20000;

/**
 * Os itens cuja forma de sempre é seca ou fresca, e a lata é outro produto: "FEIJAO EM LATA" é o feijão cozido,
 * "MILHO VERDE LATA" o milho em conserva, "TOMATE PELADO LATA", "ABACAXI CALDA LATA". Para eles o "LT" da nota
 * também é a lata ("MILHO VERDE LT QUERO 170G"; depois de um número é o litro). Para os outros itens a lata é só a
 * embalagem (a cerveja, o refrigerante, o atum, a sardinha, o leite condensado, o creme de leite, o óleo) e não marca
 * nada, com "LATA" ou "LT": o "LT" da nota não se lê como lata fora daqui, porque ele também é o litro, o leite e o
 * light.
 */
export const CAN_IS_ANOTHER_PRODUCT: ReadonlySet<string> = new Set(['feijao', 'milho', 'tomate', 'abacaxi']);

/** As marcas de um nome para o item da lista: as de otherProductMarks, com a lata só para CAN_IS_ANOTHER_PRODUCT. */
function itemMarks(name: string, canned: boolean): ReadonlySet<string> {
  const marks = new Set(otherProductMarks(name));
  if (!canned) marks.delete('lata');
  else {
    const words = spelledOut(name).split(' ').filter(Boolean);
    if (words.some((word, at) => word === 'lt' && at > 0 && !/\d$/.test(words[at - 1]))) marks.add('lata');
  }
  return marks;
}

/**
 * A descrição da base é o mesmo item da lista: `mesmo` de sameItemFit (talvez, outro e "não sei" ficam de fora), sem
 * marca de outro produto que o nome da lista não tenha (otherProductMarks, com a lata só onde ela é outro produto:
 * CAN_IS_ANOTHER_PRODUCT) e sem forma que a lista não diz (addsForm: o café solúvel para "Café"). A descrição é lida
 * com a caixa de volta (restorePackMark) e a categoria que o app adivinha dela. O resultado fica guardado (até
 * 20 000), fora do guardado de readItem: refazer a conta quando alguém marca um item no carrinho não chama
 * sameItemFit de novo.
 */
export function keyFit(item: { name: string; category?: string | null }, key: string): boolean {
  const restored = restorePackMark(key);
  const cacheKey = `${item.category ?? ''}\u0000${item.name}\u0001${restored}`;
  const known = VERDICTS.get(cacheKey);
  if (known !== undefined) return known;
  const category = guessCategory(restored, { abbreviated: true });
  let fit = sameItemFit({ name: item.name, category: item.category }, { names: [restored], category }) === 'mesmo';
  const want = fit ? itemIdentity(item.name, item.category) : null;
  if (fit) {
    const canned = want != null && CAN_IS_ANOTHER_PRODUCT.has(want.key);
    const mine = itemMarks(item.name, canned);
    fit = [...itemMarks(restored, canned)].every((mark) => mine.has(mark));
  }
  if (fit) {
    const have = itemIdentity(restored, category);
    fit = !(want && have && addsForm(want, have));
  }
  if (VERDICTS.size >= VERDICTS_LIMIT) VERDICTS.clear();
  VERDICTS.set(cacheKey, fit);
  return fit;
}

// ---------------------------------------------------------------------------
// Os grupos: que descrições e que tamanho para cada item

const WEIGHT_UNITS = new Set(['kg', 'g', 'l', 'ml']);
const SIZE_UNIT_ORDER = ['kg', 'l', 'un'];

interface SizeGroup {
  size: PackageSize;
  keys: SharedItemKey[];
  weight: number;
}

/** As chaves por unidade com tamanho, juntas pelo tamanho (o rótulo), com o peso de cada tamanho (Σ seen). */
function sizeGroups(keys: readonly SharedItemKey[]): SizeGroup[] {
  const groups = new Map<string, SizeGroup>();
  for (const key of keys) {
    const size = keyPackageSize(key.key);
    if (!size) continue;
    const group = groups.get(size.label) ?? { size, keys: [], weight: 0 };
    group.keys.push(key);
    group.weight += key.seen;
    groups.set(size.label, group);
  }
  return [...groups.values()];
}

/** O mais pesado; no empate, o menor, depois kg, l, un, depois o rótulo. */
const heaviest = (a: SizeGroup, b: SizeGroup) =>
  b.weight - a.weight ||
  a.size.amount - b.size.amount ||
  SIZE_UNIT_ORDER.indexOf(a.size.unit) - SIZE_UNIT_ORDER.indexOf(b.size.unit) ||
  (a.size.label < b.size.label ? -1 : a.size.label > b.size.label ? 1 : 0);

/**
 * As chaves do grupo, no máximo OPEN_KEYS_PER_ENTRY (as da semana mais nova, as mais vistas), em ordem: as que entram
 * por unidade (as escolhidas, que levam também as linhas a peso delas) e as que só entram a peso. Uma descrição vista
 * a peso e por unidade cuja linha por unidade não foi escolhida vai só a peso: o banco não devolve a linha por unidade
 * dela (a cabeça de alho solta no grupo da bandeja de 200 g, que levaria o tamanho da bandeja).
 */
function groupKeys(keys: readonly SharedItemKey[]): { keys: string[]; weightOnly: string[] } {
  const best = [...keys]
    .sort((a, b) => (a.week !== b.week ? (a.week < b.week ? 1 : -1) : b.seen - a.seen || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)))
    .slice(0, OPEN_KEYS_PER_ENTRY);
  const byUnit = new Set(best.filter((key) => key.unit === 'un').map((key) => key.key));
  const weightOnly = new Set(best.filter((key) => key.unit !== 'un' && !byUnit.has(key.key)).map((key) => key.key));
  return { keys: [...byUnit].sort(), weightOnly: [...weightOnly].sort() };
}

const expectedText = (size: PackageSize | null) => (size ? `\n#${size.unit}|${size.amount}|${size.of ?? ''}` : '');

/**
 * Os grupos de descrições da lista. Para cada item, na ordem da lista: as descrições da busca dele (em todas as
 * respostas), só as que são o mesmo item (keyFit). As vendidas a peso (kg, g, l, ml) sempre entram. As vendidas por
 * unidade, pelo que a lista pede:
 * - em peso ou volume ("Arroz", 2 kg): a lista já diz a quantidade. Os pacotes do mesmo tipo de medida entram pelo
 *   preço por kg ou litro (`perBase`): o pacote do mesmo tamanho; senão, o mais visto entre os que cumprem a
 *   quantidade em pacotes inteiros (packagesFor); senão, o mais visto (a conta usa uma fração do pacote);
 * - em "un", com o tamanho no nome ("Arroz 5kg", "Ovos (dúzia)"): só as do mesmo tamanho;
 * - em "un", sem o tamanho: o tamanho mais visto (Σ seen), dito nos detalhes (`sizeBy`); sem nenhum tamanho, as sem
 *   tamanho.
 * As outras por unidade ficam de fora, também quando a mesma descrição é vendida a peso em outro mercado: ela vai ao
 * banco só a peso (`weightOnly`). Os tamanhos estão na forma que a base guarda (basePackSize), e é nela que o tamanho
 * esperado vai ao banco. Grupos com as mesmas descrições e o mesmo tamanho esperado viram um, com vários itens.
 */
export function openGroups(items: readonly OpenSearchItem[], answers: readonly OpenKeysAnswer[], plan: OpenSearchPlan): OpenGroup[] {
  // As descrições de cada busca, em todas as respostas (a mesma busca pode estar em mais de uma, de outra lista).
  const keysOf = new Map<string, Map<string, SharedItemKey>>();
  for (const answer of answers) {
    answer.entries.forEach((signature, at) => {
      const known = keysOf.get(signature) ?? new Map<string, SharedItemKey>();
      for (const key of answer.keys[at] ?? []) known.set(`${key.key}\u0000${key.unit}`, key);
      keysOf.set(signature, known);
    });
  }
  const groups = new Map<string, OpenGroup>();
  for (const item of items) {
    const signature = plan.entryOf.get(item.id);
    if (!signature) continue;
    const kept = [...(keysOf.get(signature)?.values() ?? [])].filter((key) => keyFit(item, key.key));
    if (!kept.length) continue;
    const weightKeys = kept.filter((key) => WEIGHT_UNITS.has(key.unit));
    const unitKeys = kept.filter((key) => key.unit === 'un');
    let chosen: SharedItemKey[] = [];
    let entry: Omit<OpenGroupItem, 'id'> = { size: null, sizeBy: null, pack: null, perBase: null };
    if (WEIGHT_UNITS.has(item.unit)) {
      const dimension: 'kg' | 'l' = item.unit === 'kg' || item.unit === 'g' ? 'kg' : 'l';
      const asked = convertQuantity(item.quantity, item.unit, dimension);
      const packs = sizeGroups(unitKeys).filter((group) => plainSize(group.size)?.unit === dimension);
      const whole = (group: SizeGroup) => (asked != null && asked > 0 ? packagesFor(asked, 1, group.size) : null);
      const same = packs.filter((group) => asked != null && samePackageSize(group.size, { unit: dimension, amount: asked, label: '' }));
      const fitting = packs.filter((group) => whole(group) != null);
      const pick = (same.length ? same : fitting.length ? fitting : packs).sort(heaviest)[0];
      if (pick) {
        chosen = pick.keys;
        entry = { ...entry, pack: pick.size, perBase: { unit: dimension, amount: pick.size.amount, label: pick.size.label, packages: whole(pick) } };
      }
    } else {
      // O tamanho da lista na forma da base ("Refrigerante 1x2L" é 2 L); um que a base não guardaria fica como foi
      // lido, e nenhuma descrição tem esse tamanho.
      const said = item.unit === 'un' ? packageSize(item.name) : null;
      const stated = said && (basePackSize(said) ?? said);
      if (stated) {
        chosen = unitKeys.filter((key) => {
          const size = keyPackageSize(key.key);
          return size != null && samePackageSize(size, stated);
        });
        entry = { ...entry, pack: stated };
      } else {
        const sized = sizeGroups(unitKeys).sort(heaviest);
        const [pick, next] = sized;
        if (pick) {
          chosen = pick.keys;
          const sizeBy = sized.length === 1 ? 'only' : next && next.weight === pick.weight ? 'tie' : 'most';
          entry = { ...entry, size: pick.size.label, sizeBy, pack: pick.size };
        } else chosen = unitKeys;
      }
    }
    const { keys, weightOnly } = groupKeys([...chosen, ...weightKeys]);
    if (!keys.length && !weightOnly.length) continue;
    // O tamanho que o banco confere nas linhas por unidade (o pacote do preço por kg, o da lista, o escolhido).
    const expected = keys.length ? basePackSize(entry.pack) : null;
    const groupSignature = [...keys, ...weightOnly.map((key) => `~${key}`)].join('\n') + expectedText(expected);
    const group = groups.get(groupSignature) ?? { signature: groupSignature, keys, weightOnly, expected, items: [] };
    group.items.push({ id: item.id, ...entry });
    groups.set(groupSignature, group);
  }
  return [...groups.values()];
}

/** Os grupos em chamadas de no máximo OPEN_MAX_ENTRIES, na ordem das assinaturas; o número do grupo é a posição dele na chamada. */
export function openGroupCalls(groups: readonly OpenGroup[]): OpenGroup[][] {
  const sorted = [...groups].sort((a, b) => (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0));
  const calls: OpenGroup[][] = [];
  for (let at = 0; at < sorted.length && calls.length < OPEN_MAX_CALLS; at += OPEN_MAX_ENTRIES) calls.push(sorted.slice(at, at + OPEN_MAX_ENTRIES));
  return calls;
}

/**
 * O que vai ao banco por grupo: as chaves (`k`, toda unidade), as só a peso (`w`, quando há) e, quando há, o tamanho
 * esperado das linhas por unidade (`p`), sempre dentro do que o banco aceita (basePackSize: um "1 x" ou um tamanho
 * fora dos limites faria o banco recusar a chamada inteira, de até 40 grupos).
 */
export function openGroupArgument(group: OpenGroup): { k: string[]; w?: string[]; p?: { u: string; a: number; o?: number } } {
  const size = group.keys.length ? basePackSize(group.expected) : null;
  return {
    k: group.keys,
    ...(group.weightOnly.length ? { w: group.weightOnly } : {}),
    ...(size ? { p: { u: size.unit, a: size.amount, ...(size.of != null ? { o: size.of } : {}) } } : {}),
  };
}

// ---------------------------------------------------------------------------
// O passo 2: os preços

const CNPJ = /^\d{14}$/;
const UF = /^\d{2}$/;

/**
 * A resposta do passo 2, conferida: uma lista de [grupo, cnpj, nome, estado, unidade, preço, segunda-feira, é da
 * casa] e, no banco com o tamanho, [..., pack_unit, pack_amount, pack_of]. A linha que não tem essa forma fica de
 * fora; uma resposta que não é lista é erro (a busca tenta de novo).
 */
export function parseSharedItemPrices(raw: unknown, groups: readonly OpenGroup[]): OpenPricesAnswer {
  if (!Array.isArray(raw)) throw new Error('shared_item_prices: resposta inesperada');
  const rows: SharedItemPrice[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || (row.length !== 8 && row.length !== 11)) continue;
    const [group, cnpj, name, uf, unit, price, week, mine, packUnit, packAmount, packOf] = row as unknown[];
    if (typeof group !== 'number' || !Number.isInteger(group) || group < 0 || group >= groups.length) continue;
    if (typeof cnpj !== 'string' || !CNPJ.test(cnpj) || typeof name !== 'string' || typeof uf !== 'string' || !UF.test(uf)) continue;
    if (typeof unit !== 'string' || !UNITS.has(unit) || typeof price !== 'number' || !(price > 0)) continue;
    if (typeof week !== 'string' || !ISO_DAY.test(week) || typeof mine !== 'boolean') continue;
    rows.push({
      group,
      store_cnpj: cnpj,
      store_name: name,
      store_uf: uf,
      unit,
      unit_price: price,
      seen_on: sharedWeekStart(week),
      mine,
      ...(row.length === 11
        ? {
            pack_unit: typeof packUnit === 'string' ? packUnit : null,
            pack_amount: typeof packAmount === 'number' ? packAmount : null,
            pack_of: typeof packOf === 'number' ? packOf : null,
          }
        : {}),
    });
  }
  return { groups: groups.map((group) => group.signature), rows };
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * As linhas de um item que ficam, uma por mercado e unidade: a linha por unidade sem o tamanho lido pelo servidor
 * (`unsized`: pack_* vazio, porque veio da foto, é de antes do tamanho ou é o fardo vendido com a descrição da lata,
 * que a leitura do QR code nunca mede) leva o tamanho do grupo, e só fica quando mais da metade das linhas do item na
 * mesma unidade, ela incluída, está a no máximo 2,5 vezes dela (withinBand, a faixa do caminho do produto): o fardo a
 * R$ 39,90 ao lado de latas a R$ 3,49 sai, e duas sem acordo saem as duas. A linha com o tamanho lido, e a vendida a
 * peso, sempre ficam (e contam). Sozinha, a linha sem tamanho fica: não há com que comparar.
 */
function agreeingRows<T extends { row: SharedPriceRow; unsized: boolean }>(entries: readonly T[]): T[] {
  return entries.filter((entry) => {
    if (!entry.unsized) return true;
    const same = entries.filter((other) => other.row.unit === entry.row.unit);
    const near = same.filter((other) => withinBand(other.row.unitPrice, entry.row.unitPrice)).length;
    return near * 2 > same.length;
  });
}

/**
 * Os preços da base aberta de cada item, prontos para a conta da lista (SharedQuote com `productId` null e `open`).
 * Uma linha chega a um grupo de agora só pela assinatura dele (`groups[row.group]` da resposta igual à do grupo): a
 * resposta de outra lista, ou de antes, nunca põe preço em outros itens, e duas listas com os mesmos itens dividem a
 * resposta. Por item: a linha por unidade do item pedido em peso ou volume vira preço por kg ou litro, pelo pacote;
 * a outra linha por unidade leva o tamanho escolhido. Uma por mercado e unidade (a semana mais nova, a mais barata), a
 * sem tamanho lido só quando combina com as outras (agreeingRows), e
 * os mercados da casa pelo CNPJ, como em sharedQuotes: a linha "da casa" cujo CNPJ não está nos mercados carregados
 * fica de fora; a de fora fica com `storeId` null. Não há segunda camada da compra própria aqui (não há produto): a
 * regra do banco é a garantia.
 */
export function openQuotes(
  answers: readonly OpenPricesAnswer[],
  groups: readonly OpenGroup[],
  stores: readonly StoreCnpj[],
): Map<string, SharedQuote[]> {
  const bySignature = new Map<string, SharedItemPrice[]>();
  for (const answer of answers) {
    for (const row of answer.rows) {
      const signature = answer.groups[row.group];
      if (signature === undefined) continue;
      bySignature.set(signature, [...(bySignature.get(signature) ?? []), row]);
    }
  }
  const idsByCnpj = new Map<string, string[]>();
  const nameByCnpj = new Map<string, string>();
  for (const store of stores) {
    if (!store.cnpj) continue;
    idsByCnpj.set(store.cnpj, [...(idsByCnpj.get(store.cnpj) ?? []), store.id]);
    if (!nameByCnpj.has(store.cnpj)) nameByCnpj.set(store.cnpj, store.name);
  }
  const quotes = new Map<string, SharedQuote[]>();
  for (const group of groups) {
    const rows = bySignature.get(group.signature) ?? [];
    if (!rows.length) continue;
    for (const item of group.items) {
      const latest = new Map<string, { row: SharedPriceRow; open: OpenPrice; unsized: boolean }>();
      for (const row of rows) {
        let price: Omit<SharedPrice, 'product_id'> = row;
        let open: OpenPrice = { size: null, sizeBy: null, fromPackage: null, packages: null };
        let pack: PackageSize | null = null;
        if (row.unit === 'un' && item.perBase) {
          price = { ...row, unit: item.perBase.unit, unit_price: round4(row.unit_price / item.perBase.amount) };
          open = { ...open, fromPackage: item.perBase.label, packages: item.perBase.packages };
          pack = item.pack;
        } else if (row.unit === 'un') {
          open = { ...open, size: item.size, sizeBy: item.sizeBy };
          pack = sharedPack(row) ?? item.pack;
        }
        if (!(price.unit_price > 0)) continue;
        const shown = { ...sharedRowOf(price, nameByCnpj.get(row.store_cnpj)), pack };
        const key = `${shown.storeCnpj}\u0000${shown.unit}`;
        const seen = latest.get(key);
        if (!seen || newerSharedRow(shown, seen.row)) latest.set(key, { row: shown, open, unsized: row.unit === 'un' && sharedPack(row) == null });
      }
      const list: SharedQuote[] = [];
      for (const { row, open } of agreeingRows([...latest.values()])) {
        const ids = idsByCnpj.get(row.storeCnpj) ?? [];
        if (ids.length) list.push(...ids.map((storeId) => ({ ...row, productId: null, storeId, open })));
        else if (!row.mine) list.push({ ...row, productId: null, storeId: null, open });
      }
      if (list.length) quotes.set(item.id, [...(quotes.get(item.id) ?? []), ...list]);
    }
  }
  return quotes;
}

// ---------------------------------------------------------------------------
// Os textos

const baseWord = (unit: 'kg' | 'l' | string) => (unit === 'l' ? 'litro' : 'kg');

/**
 * O que os detalhes do item dizem do tamanho que a conta usou, quando o app escolheu: o pacote do item pedido em
 * peso ou volume ("A conta usa 2 embalagens de 1 kg.", "A conta usa a embalagem de 5 kg.", ou, quando nenhum pacote
 * cumpre a quantidade inteira, "A conta usa o preço por kg da embalagem de 5 kg."), ou o tamanho que a lista não
 * disse ("A lista não diz o tamanho: a conta usa o de 5 kg, o mais visto nas notas."). null quando a lista disse.
 */
export function openSizeFact(open: OpenPrice, unit?: string): string | null {
  if (open.fromPackage) {
    if (open.packages === 1) return `A conta usa a embalagem de ${open.fromPackage}.`;
    if (open.packages != null) return `A conta usa ${open.packages} embalagens de ${open.fromPackage}.`;
    return `A conta usa o preço por ${baseWord(unit ?? 'kg')} da embalagem de ${open.fromPackage}.`;
  }
  if (!open.size) return null;
  if (open.sizeBy === 'most') return `A lista não diz o tamanho: a conta usa o de ${open.size}, o mais visto nas notas.`;
  if (open.sizeBy === 'tie') return `A lista não diz o tamanho: a conta usa o de ${open.size}, um dos mais vistos nas notas.`;
  return `A lista não diz o tamanho: a conta usa o de ${open.size}.`;
}

/** O mesmo, curto, depois de "Preço de outras casas" no "Onde comprar": " (5 kg)", " (da embalagem de 5 kg)", " (2 embalagens de 1 kg)"; vazio quando a lista disse. */
export function openSizeNote(open?: OpenPrice): string {
  if (!open) return '';
  if (open.fromPackage) {
    if (open.packages === 1) return ` (embalagem de ${open.fromPackage})`;
    if (open.packages != null) return ` (${open.packages} embalagens de ${open.fromPackage})`;
    return ` (da embalagem de ${open.fromPackage})`;
  }
  return open.size ? ` (${open.size})` : '';
}
