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
import { addsForm, itemExtraWords, itemGroup, itemIdentity, sameItemFit, searchWords, spelledOut } from './sameItem';
import { guessCategory } from './search';
import {
  newerSharedRow,
  SHARED_CATEGORIES,
  SHARED_PRICE_BAND,
  sharedPack,
  sharedRowOf,
  sharedWeekStart,
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

/** Os produtos da casa com preço, por chave de item sem marca (ownSameItemKeys). */
export type OwnSameItems = ReadonlyMap<string, readonly { name: string; category: string | null }[]>;

/**
 * Os produtos da casa que têm preço (acima de zero), por chave de item sem marca. O item digitado "Arroz" numa casa
 * que comprou "Arroz Camil 5kg" fica fora da base aberta: o dado da casa vence, e ele sai por esse produto (`sameItem`,
 * em domain/listEstimate). Numa casa que só comprou "Arroz Quebrado Kicaldo 5kg", não: o quebrado tem a chave do
 * arroz, mas não é o "Arroz" da lista (openPriceItem confere o mesmo item, como a conta).
 */
export function ownSameItemKeys(
  products: readonly { id: string; name: string; category?: string | null }[],
  prices: readonly { productId: string; unitPrice: number }[],
): OwnSameItems {
  const priced = new Set(prices.filter((price) => price.unitPrice > 0).map((price) => price.productId));
  const byId = new Map(products.map((product) => [product.id, product]));
  return new Map(
    [...productsByGenericKey(products, (id) => priced.has(id))].map(([key, ids]) => [
      key,
      ids.map((id) => ({ name: byId.get(id)!.name, category: byId.get(id)!.category ?? null })),
    ]),
  );
}

/**
 * O item pode buscar preço na base aberta (quem chama já sabe que ele não tem preço nenhum: itemsWithoutPrice): de
 * qualquer marca (brandFreeItemKey), de uma categoria que se compartilha, "outros" ou sem categoria, com palavras
 * para buscar, e não é o item de um produto da casa com preço (`own`: a mesma chave e o mesmo item, itemFits, sem
 * marca de outro produto que a lista não diga; a mesma regra que dá a ele o preço desse produto).
 */
export function openPriceItem(item: Pick<OpenSearchItem, 'name' | 'category' | 'brandPreferred'>, own: OwnSameItems): boolean {
  const key = brandFreeItemKey(item);
  if (!key || (own.get(key) ?? []).some((product) => itemFits(item, product))) return false;
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

/** Chamadas a mais, de cada passo, para as buscas de fora da base aberta (a troca de marca, domain/cheaperBrand). */
export const EXTRA_SEARCH_CALLS = 2;

const bySignatureOrder = (a: { signature: string }, b: { signature: string }) =>
  a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0;

/** As buscas em chamadas de OPEN_MAX_ENTRIES, na ordem da assinatura, no máximo `cap` chamadas. */
function inCalls(entries: readonly OpenSearchEntry[], cap: number): OpenSearchEntry[][] {
  const sorted = [...entries].sort(bySignatureOrder);
  const calls: OpenSearchEntry[][] = [];
  for (let at = 0; at < sorted.length && calls.length < cap; at += OPEN_MAX_ENTRIES) calls.push(sorted.slice(at, at + OPEN_MAX_ENTRIES));
  return calls;
}

/**
 * As buscas da lista: uma por conjunto de palavras (itens com as mesmas palavras dividem), em ordem de assinatura,
 * em chamadas de OPEN_MAX_ENTRIES, no máximo OPEN_MAX_CALLS. A ordem pela assinatura deixa os pedaços iguais quando a
 * ordem da lista muda (e a resposta guardada serve).
 *
 * `extra`: os itens que a troca de marca procura (domain/cheaperBrand, os que já têm preço da casa). Os itens da base
 * aberta são planejados exatamente como sem eles (as mesmas buscas, as mesmas chamadas); a busca de um item de
 * `extra` igual a uma já planejada é a mesma, e as outras vão depois, em chamadas só delas, no máximo
 * EXTRA_SEARCH_CALLS. Além disso, o item fica sem busca (sem outra marca da base aberta), sem erro.
 */
export function openSearchPlan(items: readonly OpenSearchItem[], extra: readonly OpenSearchItem[] = []): OpenSearchPlan {
  const bySignature = new Map<string, OpenSearchEntry>();
  const entryOf = new Map<string, string>();
  for (const item of items) {
    const entry = searchEntry(item);
    if (!entry) continue;
    bySignature.set(entry.signature, entry);
    entryOf.set(item.id, entry.signature);
  }
  const calls = inCalls([...bySignature.values()], OPEN_MAX_CALLS);
  const planned = new Set(calls.flat().map((entry) => entry.signature));
  for (const [id, signature] of [...entryOf]) if (!planned.has(signature)) entryOf.delete(id);
  // As buscas de fora: a mesma que já vai é dividida; as outras, em chamadas depois.
  const extraBySignature = new Map<string, OpenSearchEntry>();
  const extraOf = new Map<string, string>();
  for (const item of extra) {
    if (entryOf.has(item.id)) continue;
    const entry = searchEntry(item);
    if (!entry) continue;
    if (!planned.has(entry.signature)) extraBySignature.set(entry.signature, entry);
    extraOf.set(item.id, entry.signature);
  }
  const extraCalls = inCalls([...extraBySignature.values()], EXTRA_SEARCH_CALLS);
  for (const entry of extraCalls.flat()) planned.add(entry.signature);
  for (const [id, signature] of extraOf) if (planned.has(signature)) entryOf.set(id, signature);
  return { calls: [...calls, ...extraCalls], entryOf };
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
 * CABRA", "OLEO COMPOSTO", "FEIJAO EM LATA", "GOIABA EM CALDA"), no singular. Só a base aberta (e a troca de marca)
 * as usa: não mudam o "mesmo item" da revisão da nota.
 */
export const OTHER_PRODUCT_WORDS: ReadonlySet<string> = new Set([
  'quebrado', 'quebrada', 'quirera', 'pronto', 'pronta', 'gelado', 'gelada', 'piso', 'maquina', 'automotivo', 'automotiva',
  'motor', 'peroba', 'movel', 'cabra', 'ovelha', 'bufala', 'amendoa', 'castanha', 'aveia', 'seco', 'seca', 'desidratado',
  'desidratada', 'industrial', 'roupa', 'mineral', 'composto', 'lata', 'conserva', 'calda', 'cozido', 'cozida', 'granulado',
  'granulada', 'cobertura', 'ralado', 'ralada', 'desfiado', 'desfiada', 'vermelho', 'negro', 'selvagem', 'cateto', 'arborio',
  'arboreo', 'basmati', 'jasmim', 'grao',
]);

/**
 * A marca de cada palavra é a forma de base: o feminino é o masculino ("QUEBRADA" e "QUEBRADO" são uma marca, e a
 * "Carne seca" da lista leva o "CARNE SEC" da nota), e a conserva e a calda são a lata (a forma em conserva do item:
 * "Milho em conserva" na lista leva "MILHO VERDE LATA").
 */
const MARK_OF: ReadonlyMap<string, string> = new Map([
  ['quebrada', 'quebrado'],
  ['pronta', 'pronto'],
  ['gelada', 'gelado'],
  ['automotiva', 'automotivo'],
  ['seca', 'seco'],
  ['desidratada', 'desidratado'],
  ['cozida', 'cozido'],
  ['granulada', 'granulado'],
  ['ralada', 'ralado'],
  ['desfiada', 'desfiado'],
  ['arboreo', 'arborio'],
  ['conserva', 'lata'],
  ['calda', 'lata'],
]);

/**
 * As abreviações de nota das palavras de OTHER_PRODUCT_WORDS (a chave guarda a descrição como a nota imprime, e o
 * SPELLED_OUT da revisão da nota não as expande): cada uma é a marca da palavra inteira, em qualquer lugar do nome.
 * Só as que não têm outra leitura comum numa descrição de mercado; as que têm valem só depois de certas palavras
 * (ABBREVIATED_AFTER), ou o item decide (itemMarks: o "COZ" também é a cozinha, mas só em item de casa, "PAPEL TOALHA
 * COZ", onde o cozido não marca nada). Uma abreviação lida a mais não só deixa a descrição de fora: as outras
 * descrições do grupo continuam dando o preço, e se a que saiu era o produto de sempre, o preço passa a ser de outro
 * produto (o "PRES COZ" é o presunto de sempre: COOKED_IS_THE_USUAL). Por isso cada marca vale só onde a palavra é
 * mesmo outro produto do item.
 */
export const ABBREVIATED_MARKS: ReadonlyMap<string, string> = new Map([
  ['qbr', 'quebrado'],
  ['queb', 'quebrado'],
  ['quebr', 'quebrado'],
  ['quebrad', 'quebrado'],
  ['comp', 'composto'],
  ['compo', 'composto'],
  ['compos', 'composto'],
  ['compost', 'composto'],
  ['ral', 'ralado'],
  ['rald', 'ralado'],
  ['ralad', 'ralado'],
  ['cob', 'cobertura'],
  ['cobert', 'cobertura'],
  ['cobertur', 'cobertura'],
  ['granul', 'granulado'],
  ['granulad', 'granulado'],
  ['coz', 'cozido'],
  ['cozid', 'cozido'],
  ['desf', 'desfiado'],
  ['desfiad', 'desfiado'],
  ['verm', 'vermelho'],
  ['vermel', 'vermelho'],
  ['vermelh', 'vermelho'],
  ['cabr', 'cabra'],
  ['ovel', 'ovelha'],
  ['buf', 'bufala'],
  ['bufal', 'bufala'],
  ['desid', 'desidratado'],
  ['desidr', 'desidratado'],
  ['desidrat', 'desidratado'],
  ['sec', 'seco'],
  ['miner', 'mineral'],
  ['maq', 'maquina'],
  ['autom', 'automotivo'],
  ['automot', 'automotivo'],
  ['indust', 'industrial'],
  ['industr', 'industrial'],
  ['selv', 'selvagem'],
  ['arb', 'arborio'],
  ['arbor', 'arborio'],
  ['basm', 'basmati'],
  ['jasm', 'jasmim'],
  ['conserv', 'lata'],
]);

/**
 * As abreviações que só são a palavra depois de certas palavras: "OLEO MIN" e "SAL MIN" são o mineral ("QUEIJO MIN
 * FRESCAL" é o minas); "LEITE CAB" e "QUEIJO CAB" são a cabra ("ALHO CAB" é a cabeça); "CHOC GRAN" é o granulado
 * ("OVOS GRAN" são os grandes, e o "GRAN" de outro lugar pode ser o granel ou a marca); "LEITE AMEND" é a amêndoa
 * ("PASTA AMEND" é o amendoim).
 */
const ABBREVIATED_AFTER: ReadonlyMap<string, { mark: string; after: ReadonlySet<string> }> = new Map([
  ['min', { mark: 'mineral', after: new Set(['oleo', 'sal']) }],
  ['cab', { mark: 'cabra', after: new Set(['leite', 'lt', 'queijo']) }],
  ['gran', { mark: 'granulado', after: new Set(['chocolate']) }],
  ['amend', { mark: 'amendoa', after: new Set(['leite', 'lt']) }],
]);

/** A marca de uma palavra do nome (lida por extenso, com a do singular e a palavra de antes, no singular), ou null. */
function wordMark(word: string, one: string, prev: string | null): string | null {
  const whole = OTHER_PRODUCT_WORDS.has(word) ? word : OTHER_PRODUCT_WORDS.has(one) ? one : null;
  if (whole) return MARK_OF.get(whole) ?? whole;
  const short = ABBREVIATED_MARKS.get(word);
  if (short) return short;
  const after = ABBREVIATED_AFTER.get(word);
  return after && prev != null && after.after.has(prev) ? after.mark : null;
}

// A classificação de segunda: o número do tipo (2 a 9, II, III), sozinho depois de "TIPO", "TP" ou "T", ou colado neles.
const GRADE = /^(?:[2-9]|ii|iii)$/;
const GLUED_GRADE = /^(?:t|tp|tipo)(?:[2-9]|ii|iii)$/;

/**
 * As marcas de "outro produto do mesmo item" num nome (lido por extenso, spelledOut, e no singular): cada palavra de
 * OTHER_PRODUCT_WORDS, na forma de base (MARK_OF), também como a nota abrevia (ABBREVIATED_MARKS: "OLEO COMP",
 * "QUEIJO RAL", "ARROZ QUEBR", "ARROZ QBR", "FEIJAO VERM", "MILHO COZ"; e ABBREVIATED_AFTER: "OLEO MIN", "LEITE CAB",
 * "CHOC GRAN"); "grau" para a classificação de segunda (T2 a T9, 2A a 9A, "segunda", "tipo 2", "tipo II", e como a
 * nota escreve: "TIPO2", "TP2", "TP 2", "T 2"); e "tipo" para "tipo" antes de uma palavra ("QUEIJO TIPO MUSSARELA",
 * "LEITE TIPO A"). "ARROZ TIPO 1", "T1" e "TP1" não marcam. A água mineral é a água de sempre, não outro produto:
 * "AGUA MINERAL" não marca, como "AGUA MIN", "AGUA MINER" e "AGUA CRYSTAL".
 */
export function otherProductMarks(name: string): ReadonlySet<string> {
  const words = spelledOut(name).split(' ').filter(Boolean);
  const marks = new Set<string>();
  words.forEach((word, at) => {
    const one = singular(word);
    const prev = at > 0 ? singular(words[at - 1]) : null;
    const next = words[at + 1];
    const mark = wordMark(word, one, prev);
    if (mark && !(mark === 'mineral' && prev === 'agua')) marks.add(mark);
    if (GLUED_GRADE.test(word) || /^[2-9]a$/.test(word) || word === 'segunda') marks.add('grau');
    if ((word === 'tipo' || word === 'tp' || word === 't') && next && GRADE.test(next)) marks.add('grau');
    else if ((word === 'tipo' || word === 'tp') && next && !/^\d/.test(next) && next !== 'i') marks.add('tipo');
  });
  return marks;
}

const VERDICTS = new Map<string, boolean>();
const VERDICTS_LIMIT = 20000;

/**
 * Os itens que quase sempre vêm em lata ou em conserva, onde ela é só a embalagem: a cerveja, o refrigerante, o suco,
 * a água tônica, o atum, a sardinha, o leite condensado, o creme de leite, o doce de leite, o leite em pó, o
 * achocolatado, o fermento, o óleo, o azeite e o extrato, o molho e a polpa de tomate. Para eles a lata, a conserva e
 * a calda não marcam nada. Para todo outro item são outro produto ("FRANGO DESFIADO LATA", "SALSICHA VIENA LATA",
 * "CARNE BOVINA CONSERVA", "GOIABA EM CALDA", "CHA MATE LEAO LATA" para "Chá"), e a descrição só fica quando a lista
 * também diz a lata ou a conserva: na dúvida, fica de fora.
 */
export const CAN_IS_THE_PACKAGE: ReadonlySet<string> = new Set([
  'cerveja', 'refrigerante', 'suco', 'agua+tonica', 'atum', 'sardinha', 'leite_condensado', 'creme_leite', 'doce_leite',
  'leite+po', 'achocolatado', 'fermento', 'oleo', 'azeite', 'extrato_tomate', 'molho_tomate', 'polpa_tomate',
]);

/**
 * Os itens frescos ou secos onde o "LT" da nota que não vem depois de um número também é a lata ("MILHO VERDE LT
 * QUERO 170G", "FRANGO DESF LT 170G", "SALSICHA VIENA LT 180G"; depois de um número é o litro). Em outro item o "LT"
 * não se lê como lata, porque ele também é o leite ("CHOC AO LT", "PAO DE LT") e o light; a palavra "LATA" marca em
 * todo item fora de CAN_IS_THE_PACKAGE.
 */
export const LT_IS_THE_CAN: ReadonlySet<string> = new Set(['feijao', 'milho', 'tomate', 'abacaxi', 'frango', 'carne', 'salsicha', 'goiaba']);

/**
 * Os itens que vêm cozidos de sempre: o presunto, o peito de peru e a mortadela do frios. A nota escreve "PRES COZ
 * SADIA KG", "PRESUNTO COZIDO PERDIGAO", "PEITO PERU DEFUM COZ", e essa é a descrição do item de sempre: para eles o
 * cozido (por extenso ou abreviado) não marca outro produto. Tirá-la deixaria o grupo de "Presunto" só com o cru, bem
 * mais caro (CURED_HAM_WORDS). Em todo outro item de comida o cozido é outro produto ("MILHO COZ", "FEIJAO PRETO
 * COZ"); em item de casa ou de pet ele não marca nada, porque lá o "COZ" é a cozinha ("PAPEL TOALHA COZ").
 */
export const COOKED_IS_THE_USUAL: ReadonlySet<string> = new Set(['presunto', 'peito_peru', 'mortadela']);

/**
 * O presunto cru (o parma, o serrano, o jamón, o ibérico) é outro produto do presunto de sempre, o cozido, e custa
 * várias vezes mais: com qualquer destas palavras o nome tem a marca "cru" para o item presunto, e essa marca vale nos
 * dois sentidos (BOTH_WAYS): "Presunto" não leva o cru, e "Presunto parma" não leva o cozido.
 */
export const CURED_HAM_WORDS: ReadonlySet<string> = new Set(['cru', 'crua', 'parma', 'serrano', 'jamon', 'iberico']);

/** As marcas que a lista e a descrição precisam ter juntas: a que a lista diz e a descrição não diz também tira a descrição. */
const BOTH_WAYS: ReadonlySet<string> = new Set(['cru']);

/**
 * As marcas de um nome para o item da lista (pela chave dele): as de otherProductMarks, sem a lata onde ela é a
 * embalagem, sem o cozido onde ele é o de sempre ou fora da comida, e com o cru do presunto.
 */
function itemMarks(name: string, itemKey: string | null): ReadonlySet<string> {
  const marks = new Set(otherProductMarks(name));
  const words = spelledOut(name).split(' ').filter(Boolean);
  if (itemKey != null && CAN_IS_THE_PACKAGE.has(itemKey)) marks.delete('lata');
  else if (itemKey != null && LT_IS_THE_CAN.has(itemKey)) {
    if (words.some((word, at) => word === 'lt' && at > 0 && !/\d$/.test(words[at - 1]))) marks.add('lata');
  }
  if (itemKey != null && (COOKED_IS_THE_USUAL.has(itemKey) || itemGroup(itemKey) !== 'comida')) marks.delete('cozido');
  if (itemKey === 'presunto' && words.some((word) => CURED_HAM_WORDS.has(word) || CURED_HAM_WORDS.has(singular(word)))) marks.add('cru');
  return marks;
}

/**
 * O texto (uma descrição da base, ou o nome de um produto) é o mesmo item da lista: `mesmo` de sameItemFit (talvez,
 * outro e "não sei" ficam de fora), sem marca de outro produto que o nome da lista não tenha (otherProductMarks, sem a
 * lata onde ela é só a embalagem: CAN_IS_THE_PACKAGE, e sem o cozido onde ele é o de sempre: COOKED_IS_THE_USUAL), sem
 * faltar a marca que vale nos dois sentidos (o cru do presunto: "Presunto parma" não leva o cozido) e sem forma que a
 * lista não diz (addsForm: o café solúvel para "Café"). Com `reference` (o produto que a casa compra, na troca de
 * marca, domain/cheaperBrand), as marcas dele também são da lista, e o texto tem de tê-las todas: a casa que compra o
 * leite de cabra pedindo "Leite" leva só leite de cabra, e a que compra o arroz de sempre não leva o quebrado.
 */
function computeFit(
  item: { name: string; category?: string | null },
  text: string,
  category: string | null,
  reference: string | null,
): boolean {
  let fit = sameItemFit({ name: item.name, category: item.category }, { names: [text], category }) === 'mesmo';
  const want = fit ? itemIdentity(item.name, item.category) : null;
  if (fit) {
    const itemKey = want?.key ?? null;
    const mine = itemMarks(item.name, itemKey);
    const usual = reference != null ? itemMarks(reference, itemKey) : new Set<string>();
    const theirs = itemMarks(text, itemKey);
    fit =
      [...theirs].every((mark) => mine.has(mark) || usual.has(mark)) &&
      [...mine].every((mark) => !BOTH_WAYS.has(mark) || theirs.has(mark)) &&
      [...usual].every((mark) => theirs.has(mark));
  }
  if (fit) {
    const have = itemIdentity(text, category);
    fit = !(want && have && addsForm(want, have));
  }
  return fit;
}

function remembered(cacheKey: string, compute: () => boolean): boolean {
  const known = VERDICTS.get(cacheKey);
  if (known !== undefined) return known;
  const fit = compute();
  if (VERDICTS.size >= VERDICTS_LIMIT) VERDICTS.clear();
  VERDICTS.set(cacheKey, fit);
  return fit;
}

/**
 * A descrição da base é o mesmo item da lista (computeFit), lida com a caixa de volta (restorePackMark) e a categoria
 * que o app adivinha dela. O resultado fica guardado (até 20 000), fora do guardado de readItem: refazer a conta quando
 * alguém marca um item no carrinho não chama sameItemFit de novo.
 */
export function keyFit(item: { name: string; category?: string | null }, key: string): boolean {
  const restored = restorePackMark(key);
  return remembered(`k\u0000${item.category ?? ''}\u0000${item.name}\u0001${restored}`, () =>
    computeFit(item, restored, guessCategory(restored, { abbreviated: true }), null),
  );
}

/**
 * O nome de um produto (com a categoria dele), ou uma descrição já lida, é o mesmo item da lista (computeFit), com as
 * marcas do produto de sempre (`reference`) também valendo. Guardado como keyFit.
 */
export function itemFits(
  item: { name: string; category?: string | null },
  candidate: { name: string; category: string | null },
  reference: string | null = null,
): boolean {
  return remembered(
    `n\u0000${item.category ?? ''}\u0000${item.name}\u0001${candidate.name}\u0002${candidate.category ?? ''}\u0003${reference ?? ''}`,
    () => computeFit(item, candidate.name, candidate.category, reference),
  );
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

/** A assinatura de um grupo: as chaves, em ordem, uma por linha, as só a peso depois de "~", e o tamanho esperado. */
export function groupSignature(keys: readonly string[], weightOnly: readonly string[], expected: PackageSize | null): string {
  return [...keys, ...weightOnly.map((key) => `~${key}`)].join('\n') + expectedText(expected);
}

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
    const named = groupSignature(keys, weightOnly, expected);
    const group = groups.get(named) ?? { signature: named, keys, weightOnly, expected, items: [] };
    group.items.push({ id: item.id, ...entry });
    groups.set(named, group);
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
export function openGroupArgument<G extends Pick<OpenGroup, 'keys' | 'weightOnly' | 'expected'>>(
  group: G,
): { k: string[]; w?: string[]; p?: { u: string; a: number; o?: number } } {
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
export function parseSharedItemPrices(raw: unknown, groups: readonly Pick<OpenGroup, 'signature'>[]): OpenPricesAnswer {
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
 * As linhas de um item que ficam, uma por mercado e unidade. A linha por unidade sem o tamanho lido pelo servidor
 * (pack_* vazio, porque veio da foto, é de antes do tamanho ou é o fardo vendido com a descrição da lata, que a
 * leitura do QR code nunca mede) leva o tamanho do grupo (`takesGroupSize`, só quando o grupo tem um), e o único erro
 * que isso traz é para cima: as chaves do grupo dizem o tamanho dele, e o que vem com essa descrição sem ser desse
 * tamanho é o fardo ou a caixa, mais caros que a lata. Por isso ela só sai quando mais da metade das outras linhas do
 * item na mesma unidade custa menos de 1/2,5 dela (SHARED_PRICE_BAND, a faixa do caminho do produto): o fardo a
 * R$ 39,90 ao lado de latas a R$ 3,49 sai, e ao lado de uma lata só também. Nunca sai por ser mais barata: a marca ou a
 * variedade pode ser outra (o café de R$ 12,90 ao lado dos de R$ 34,90 fica), então a mais barata do item sempre fica
 * e o item nunca perde todos os preços. A linha com o tamanho lido, a vendida a peso e a do grupo sem tamanho (que não
 * leva tamanho nenhum) sempre ficam, e contam. Sozinha, a linha sem tamanho fica: não há com que comparar.
 */
function agreeingRows<T extends { row: SharedPriceRow; takesGroupSize: boolean }>(entries: readonly T[]): T[] {
  return entries.filter((entry) => {
    if (!entry.takesGroupSize) return true;
    const others = entries.filter((other) => other !== entry && other.row.unit === entry.row.unit);
    const far = others.filter((other) => entry.row.unitPrice > other.row.unitPrice * SHARED_PRICE_BAND).length;
    return far * 2 <= others.length;
  });
}

/**
 * Os preços da base aberta de cada item, prontos para a conta da lista (SharedQuote com `productId` null e `open`).
 * Uma linha chega a um grupo de agora só pela assinatura dele (`groups[row.group]` da resposta igual à do grupo): a
 * resposta de outra lista, ou de antes, nunca põe preço em outros itens, e duas listas com os mesmos itens dividem a
 * resposta. Por item: a linha por unidade do item pedido em peso ou volume vira preço por kg ou litro, pelo pacote;
 * a outra linha por unidade leva o tamanho escolhido. Uma por mercado e unidade (a semana mais nova, a mais barata), a
 * sem tamanho lido que leva o do grupo só quando não está muito acima das outras (agreeingRows), e os mercados da casa
 * pelo CNPJ, como em sharedQuotes: a linha "da casa" cujo CNPJ não está nos mercados carregados
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
      const latest = new Map<string, { row: SharedPriceRow; open: OpenPrice; takesGroupSize: boolean }>();
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
        const takesGroupSize = row.unit === 'un' && sharedPack(row) == null && item.pack != null;
        if (!seen || newerSharedRow(shown, seen.row)) latest.set(key, { row: shown, open, takesGroupSize });
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
