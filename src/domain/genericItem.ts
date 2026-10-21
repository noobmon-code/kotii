// A lista sem marca: a família escolhe a marca na hora, pelo preço e pela
// qualidade. "Comprados recentemente", "Acho que acabou", a busca de produtos
// e o "Pôr na lista" do produto põem o item ("Leite desnatado"), e não o
// produto da última compra ("Leite IL Desnatado"); o produto vai junto só
// como dica de preço (product_id). O tipo que muda o item fica (desnatado,
// zero, sem lactose, em pó, caipira); a marca, a embalagem e o tamanho saem.
//
// "Marca preferida" (nos detalhes do item) é uma escolha guardada no item
// (shopping_list_items.brand_preferred), e não deduzida do nome: os itens que
// já estavam nas listas com o nome de um produto ("Leite IL Desnatado", de
// antes da lista sem marca) não foram escolha de marca e continuam casando
// com qualquer marca do mesmo item. Ligada, o nome vira o do produto e a nota
// só cumpre o item por esse produto, a ligação ou o mesmo nome
// (domain/listLinks); desligada, o nome volta sem a marca.

import { COMMON_ITEMS } from './commonItems';
import { listNameKey } from './listLinks';
import { LOOSE_UNITS, OTHER_THING, PACKAGING, singular } from './nameWords';
import { samePackageSize } from './packageSize';
import { isItemKindWord, readItem, type ItemIdentity } from './sameItem';
import { normalizeSearch } from './search';

// Onde a marca é o item: a ração que o bicho come, a fralda do tamanho do bebê, o remédio. O nome fica.
const KEEP_BRAND = new Set(['pet', 'bebe', 'medicamentos', 'suplementos', 'primeiros_socorros']);
// Entre duas palavras que ficam, estas ficam junto ("Café em pó", "Óleo de soja").
const GAP_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'em', 'com', 'e']);
// Logo depois do item, "de" e mais uma palavra dizem qual é ("Bolo de cenoura", "Coxa de frango").
const OF_WORDS = new Set(['de', 'da', 'do']);
// Tipos que são nome próprio: o sabor do refrigerante e a máquina da cápsula ficam com maiúscula.
const PROPER_WORDS = new Set(['coca', 'cola', 'pepsi', 'fanta', 'schweppes', 'kuat', 'sukita', 'sprite', 'dolce', 'gusto', 'nespresso']);

/** O item da lista sem a marca. */
export interface GenericItem {
  /** O nome para a lista: "Leite desnatado". Sem saber que item é, o próprio nome. */
  name: string;
  /**
   * O mesmo para todas as marcas e embalagens do mesmo item e tipo ("Leite IL Desnatado" e "Leite desnatado"):
   * junta as compras nas faixas e diz que o item já está na lista. Sem saber que item é, a chave do nome.
   */
  key: string;
}

const byName = (name: string): GenericItem => ({ name, key: `n:${listNameKey(name)}` });

/** A chave do item e dos tipos que ele diz, na ordem dos tipos. */
function identityKey(identity: ItemIdentity, extra: string | null): string {
  const kinds = [...identity.kinds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([at, values]) => `|${at}=${[...values].sort().join(',')}`)
    .join('');
  return `i:${identity.key}${kinds}${extra ? `|de=${extra}` : ''}`;
}

/** As palavras do nome como o texto do item as lê (sem acento, só letras e números), com onde cada uma está no nome. */
function nameTokens(name: string): { word: string; start: number; end: number }[] {
  const tokens: { word: string; start: number; end: number }[] = [];
  let at = 0;
  for (const char of name) {
    const plain = normalizeSearch(char);
    if (/^[a-z0-9]+$/.test(plain)) {
      const last = tokens[tokens.length - 1];
      if (last && last.end === at) {
        last.word += plain;
        last.end = at + char.length;
      } else tokens.push({ word: plain, start: at, end: at + char.length });
    }
    at += char.length;
  }
  return tokens;
}

let CATALOG_WORDS: Map<string, string[][]> | null = null;

/**
 * As palavras que cada item comum do catálogo diz além do termo e dos tipos ("mineral" da "Água mineral"), pela
 * chave do item. Só os nomes que começam pelo item; os com quantidade ("Ovos (dúzia)") ficam de fora.
 */
function catalogWords(): Map<string, string[][]> {
  if (CATALOG_WORDS) return CATALOG_WORDS;
  CATALOG_WORDS = new Map();
  for (const item of COMMON_ITEMS) {
    if (/[()\d]/.test(item.name)) continue;
    const reading = readItem(item.name, item.category);
    if (!reading || reading.term[0] !== 0) continue;
    const extra = reading.words.filter((word, at) => !reading.kept.has(at) && !GAP_WORDS.has(word));
    if (!extra.length) continue;
    const key = identityKey(reading.identity, null);
    CATALOG_WORDS.set(key, [...(CATALOG_WORDS.get(key) ?? []), extra]);
  }
  return CATALOG_WORDS;
}

const capitalized = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

const GENERIC = new Map<string, GenericItem>();
const GENERIC_LIMIT = 4000;

/**
 * O item do nome sem a marca, a embalagem nem o tamanho: "Ovo Doninho
 * Caipira" é "Ovo caipira", "Leite IL Desnatado" é "Leite desnatado",
 * "Refrigerante sem Açúcar Coca-Cola Garrafa 1,5l" é "Refrigerante sem
 * açúcar Coca-Cola" (para o refrigerante, Coca é o sabor, não a marca). Nunca
 * inventa: o nome fica como está quando o app não sabe que item é, quando o
 * nome não começa por ele ("Danone Morango" não é morango), quando sobraria
 * uma palavra que faz outra coisa ("Leite Ninho em pó") ou que é outro item
 * ("Chocolate ao leite"), e onde a marca é o item (ração, fralda, remédio).
 */
export function genericItem(name: string, category?: string | null): GenericItem {
  // As faixas leem o histórico inteiro a cada mudança na lista: o resultado fica guardado.
  const cacheKey = `${category ?? ''}\u0000${name}`;
  const known = GENERIC.get(cacheKey);
  if (known) return known;
  const result = readGeneric(name.normalize('NFC').trim(), category);
  if (GENERIC.size >= GENERIC_LIMIT) GENERIC.clear();
  GENERIC.set(cacheKey, result);
  return result;
}

function readGeneric(name: string, category: string | null | undefined): GenericItem {
  if (!name || (category && KEEP_BRAND.has(category))) return byName(name);
  const reading = readItem(name, category);
  if (!reading || reading.term[0] !== 0) return byName(name);
  const { identity, words } = reading;
  const keep = new Set(reading.kept);
  // "de" e uma palavra logo depois do item: diz qual é ("Bolo de cenoura"). Entra na chave: não é o bolo de fubá.
  let extra: string | null = null;
  const [, termEnd] = reading.term;
  const [of, what] = [words[termEnd + 1], words[termEnd + 2]];
  if (of && what && OF_WORDS.has(of) && !keep.has(termEnd + 2) && /^[a-z]+$/.test(what) && !GAP_WORDS.has(what) && !PACKAGING.has(what) && !LOOSE_UNITS.has(what)) {
    keep.add(termEnd + 1).add(termEnd + 2);
    extra = singular(what);
  }
  // O que o catálogo de itens comuns diz do mesmo item não é marca ("Água Mineral Crystal" é "Água mineral",
  // "Frango Inteiro Sadia" é "Frango inteiro"): fica, quando todas as palavras do catálogo estão no nome.
  for (const catalog of catalogWords().get(identityKey(identity, null)) ?? []) {
    const found = catalog.map((word) => words.findIndex((other, at) => !keep.has(at) && singular(other) === singular(word)));
    if (found.every((at) => at >= 0)) found.forEach((at) => keep.add(at));
  }
  // Entre duas palavras que ficam, as de ligação ficam também ("Óleo de soja"); logo antes de um tipo, a ligação
  // vai com ele ("Café Pilão em Pó" é "Café em pó").
  const kept = [...keep].sort((a, b) => a - b);
  kept.slice(1).forEach((at, i) => {
    const gap = words.slice(kept[i] + 1, at);
    if (gap.length && gap.every((word) => GAP_WORDS.has(word))) gap.forEach((_, j) => keep.add(kept[i] + 1 + j));
    else if (OF_WORDS.has(words[at - 1]) || words[at - 1] === 'em' || words[at - 1] === 'com') keep.add(at - 1);
  });
  // O que sai não pode mudar o item: uma palavra que faz outra coisa ("Leite Ninho em pó") ou que é outro item
  // ("Chocolate ao leite", "Sardinha com óleo"). Na dúvida, o nome fica.
  for (const [at, word] of words.entries()) {
    if (keep.has(at) || /\d/.test(word) || GAP_WORDS.has(word)) continue;
    const otherThing = (OTHER_THING.has(word) || OTHER_THING.has(singular(word))) && !isItemKindWord(word, identity);
    if (otherThing || readItem(word, category)) return byName(name);
  }
  const key = identityKey(identity, extra);
  // O nome escrito do jeito do produto (acento, hífen), palavra por palavra. Uma abreviação por extenso
  // ("REFRIG" é refrigerante) não está escrita no nome: aí o nome fica, mas a chave já diz o item.
  const tokens = nameTokens(name);
  if (tokens.length !== words.length || tokens.some((token, at) => token.word !== words[at])) return { name, key };
  const runs: string[] = [];
  let run = '';
  for (const [at, token] of tokens.entries()) {
    if (!keep.has(at)) {
      if (run) runs.push(run);
      run = '';
      continue;
    }
    const written = name.slice(token.start, token.end);
    const shown = PROPER_WORDS.has(token.word) ? capitalized(written) : written.toLowerCase();
    // Dentro do trecho, o que separa as palavras no nome ("Coca-Cola"); entre trechos, um espaço.
    run += run ? name.slice(tokens[at - 1].end, token.start) + shown : shown;
  }
  if (run) runs.push(run);
  const generic = runs.join(' ');
  const shown = generic.charAt(0).toUpperCase() + generic.slice(1);
  // Sem marca para tirar, o nome fica como a pessoa escreveu.
  return { name: listNameKey(shown) === listNameKey(name) ? name : shown, key };
}

/** O mesmo item na lista: o mesmo nome, ou o mesmo item e tipo, de qualquer marca, sem tamanhos diferentes. */
export function sameListItem(a: { name: string; category?: string | null }, b: { name: string; category?: string | null }): boolean {
  const [keyA, keyB] = [listNameKey(a.name), listNameKey(b.name)];
  if (keyA && keyA === keyB) return true;
  const [itemA, itemB] = [genericItem(a.name, a.category), genericItem(b.name, b.category)];
  if (!itemA.key.startsWith('i:') || itemA.key !== itemB.key) return false;
  // "Arroz 5kg" e "Arroz 1kg" não são o mesmo pedido.
  const [sizeA, sizeB] = [readItem(a.name, a.category)?.identity.size, readItem(b.name, b.category)?.identity.size];
  return !(sizeA && sizeB && !samePackageSize(sizeA, sizeB));
}

/**
 * O item ainda para comprar que já é este ("Leite IL Desnatado" para "Leite
 * desnatado", e o contrário): o app não põe de novo e diz "Já estava na lista".
 */
export function pendingSameItem<T extends { name: string; category?: string | null; checked_at?: string | null }>(
  item: { name: string; category?: string | null },
  items: readonly T[],
): T | undefined {
  return items.find((other) => !other.checked_at && sameListItem(item, other));
}

/** "Marca preferida" nos detalhes do item: o nome com a marca e sem ela. */
export interface BrandChoice {
  /** O nome do produto, com a marca: ligado. */
  brandName: string;
  /** O nome sem a marca: desligado. */
  genericName: string;
}

/**
 * O item tem um produto cujo nome tem marca para tirar: dá para escolher
 * entre a marca dele e qualquer marca. null quando não há o que escolher (sem
 * produto, ou o nome do produto já é o do item).
 */
export function brandChoice(product: { name: string; category?: string | null } | null | undefined): BrandChoice | null {
  if (!product) return null;
  const generic = genericItem(product.name, product.category).name;
  return listNameKey(generic) === listNameKey(product.name) ? null : { brandName: product.name.trim(), genericName: generic };
}

/** A "Marca preferida" nos detalhes do item, ainda sem salvar: ligada ou não, e o nome no campo. */
export interface BrandSwitch {
  on: boolean;
  name: string;
}

/**
 * Liga ou desliga a "Marca preferida". Ligar põe o nome do produto (com a
 * marca). Desligar com esse nome no campo volta o nome que o item tinha, ou o
 * nome sem a marca quando o item já tinha o do produto; com outro nome no
 * campo (a pessoa o escreveu), ele fica. Sem produto com marca (a escolha
 * ficou de antes, e o produto mudou), só a escolha muda.
 */
export function switchBrand(state: BrandSwitch, itemName: string, choice: BrandChoice | null): BrandSwitch {
  if (!state.on) return { on: true, name: choice ? choice.brandName : state.name };
  if (!choice || listNameKey(state.name) !== listNameKey(choice.brandName)) return { on: false, name: state.name };
  return { on: false, name: listNameKey(itemName) === listNameKey(choice.brandName) ? choice.genericName : itemName };
}
