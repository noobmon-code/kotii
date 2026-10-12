// Revisão da nota: o que cada toque faz com o nome do produto de um item
// (usar um nome que a casa já tem, digitar um nome) e os nomes que a pessoa
// já deu a outros itens desta mesma nota. A tela só aplica o que sai daqui.

import type { ItemOverride, ProductChoice } from './receiptReview';
import { knownName, similarNames, type NameCandidate, type NameIndex, type SimilarName } from './similarNames';

/** Os produtos que existem (o catálogo da tela): só dá para ligar o item a um deles. */
interface Products {
  has(id: string): boolean;
}

/** O item como está na revisão: a categoria dele vale quando o nome escolhido não traz uma. */
interface CurrentItem {
  category: string;
}

/**
 * O item passa a usar um nome que a casa já tem: o que muda nele. Com
 * produto, liga o item a ele. Sem produto, é um produto novo com o nome
 * escrito como a casa escreve e a categoria desse nome; se é o nome de um item
 * de lista aberta, esse item passa a vir marcado em "Lista de compras"
 * enquanto o nome for esse (matchListItems).
 */
export function houseNameOverride(
  chosen: Pick<NameCandidate, 'name' | 'category' | 'productId'>,
  current: CurrentItem,
  products: Products,
): ItemOverride {
  if (chosen.productId && products.has(chosen.productId)) return { product: { kind: 'existing', productId: chosen.productId } };
  // Item de lista digitado solto fica em "Outros": vale mais a categoria que a nota já tinha.
  const category = chosen.category === 'outros' ? current.category : chosen.category;
  // A despensa segue a categoria: só volta ao padrão dela se a categoria mudou.
  return { product: { kind: 'new', name: chosen.name, category }, ...(category !== current.category ? { pantry: undefined } : {}) };
}

/** Tudo minúsculo ou tudo maiúsculo: digitado sem cuidar da grafia. */
const plainCase = (text: string) => text === text.toLowerCase() || text === text.toUpperCase();

/**
 * A pessoa digitou o nome do produto: o que muda no item. Com as mesmas
 * letras de um produto da casa, é ele (dois produtos não têm o mesmo nome).
 * Com as mesmas letras de um nome sem produto (da lista, de uma compra, do
 * catálogo ou de outro item desta nota), fica o que a pessoa digitou e a
 * categoria do item; a grafia da casa só entra no lugar de um texto todo
 * minúsculo ou todo maiúsculo, quando ela mesma não é assim. `indexes`: onde
 * procurar, na ordem.
 */
export function typedNameOverride(typed: string, indexes: readonly NameIndex[], current: CurrentItem, products: Products): ItemOverride {
  const name = typed.trim();
  for (const index of indexes) {
    const known = knownName(name, index);
    if (!known || known.name.toLowerCase() !== name.toLowerCase()) continue;
    if (known.productId && products.has(known.productId)) return { product: { kind: 'existing', productId: known.productId } };
    const spelled = plainCase(name) && !plainCase(known.name) ? known.name : name;
    return { product: { kind: 'new', name: spelled, category: current.category } };
  }
  return { product: { kind: 'new', name, category: current.category } };
}

/** A escolha de produto é a mesma: "Usar" o que o item já tem não muda nada, e não há o que desfazer. */
export function sameProduct(a: ProductChoice | undefined, b: ProductChoice | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'existing') return b.kind === 'existing' && a.productId === b.productId;
  if (a.kind === 'new') return b.kind === 'new' && a.name === b.name && a.category === b.category;
  return true;
}

/** O nome de produto novo que a mudança deixa no item: a pessoa decidiu, o item não sugere outro de novo. */
export function keptName(change: ItemOverride): string | null {
  return change.product?.kind === 'new' ? change.product.name : null;
}

/** Os botões do seletor de produto para o texto digitado. */
export interface TypedNameActions {
  /** O mesmo nome com outra grafia que já existe (na casa, nesta nota ou no catálogo): usar vem antes de criar. */
  existing: SimilarName | null;
  /** Criar o produto com o texto digitado; null quando o texto já é um produto da casa. */
  create: { title: string; override: ItemOverride } | null;
}

/**
 * O que o seletor oferece para o texto digitado: usar o nome que já existe
 * ("Bananas", com "Banana" na casa) e criar o produto. O botão de criar diz
 * o nome que vai ficar, e só é "mesmo assim" quando a casa já usa o nome.
 */
export function typedNameActions(typed: string, house: NameIndex, note: NameIndex, current: CurrentItem, products: Products): TypedNameActions {
  const name = typed.trim();
  if (!name) return { existing: null, create: null };
  const [existing = null] = similarNames(name, house, { onlySame: true, limit: 1, also: note });
  const override = typedNameOverride(name, [house, note], current, products);
  const created = keptName(override);
  if (created == null) return { existing, create: null };
  const title = existing && existing.source !== 'comum' ? `Criar "${created}" mesmo assim` : `Novo produto "${created}"`;
  return { existing, create: { title, override } };
}

/**
 * Os nomes que a pessoa deu a produtos novos em outros itens desta nota
 * (digitados, escolhidos ou mantidos: `keptNames`), para o seletor oferecer o
 * mesmo nome em vez de criar outro ("Pitaya" e "Pitayas" na mesma nota). A
 * leitura que ninguém tocou não entra.
 */
export function noteNames(
  items: readonly { id: string; product: ProductChoice }[],
  keptNames: Readonly<Record<string, string>>,
  exceptItemId: string,
): NameCandidate[] {
  return items.flatMap(({ id, product }): NameCandidate[] =>
    id !== exceptItemId && product.kind === 'new' && keptNames[id] === product.name
      ? [{ name: product.name, category: product.category, productId: null, source: 'nota', listItemIds: [] }]
      : [],
  );
}

/** O registro com `key` valendo `value`; sem valor, sem a chave (para desfazer: o item volta a não ter nada guardado). */
export function withEntry<T>(record: Readonly<Record<string, T>>, key: string, value: NoInfer<T> | undefined): Record<string, T> {
  const next = { ...record };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}
