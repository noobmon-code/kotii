// Revisão de nota: o que cada item vira ao confirmar (produto, despensa,
// validade). Os padrões vêm da IA e do histórico; o usuário só corrige.

import { getCategory } from './categories';
import type { ListRemoval } from './listLinks';
import { estimateExpiry, type ExpirySource } from './pantry';
import { guessCategory } from './search';

export type ProductChoice =
  | { kind: 'existing'; productId: string }
  | { kind: 'new'; name: string; category: string }
  | { kind: 'none' };

/** O que o usuário mudou num item; o resto segue o padrão. */
export interface ItemOverride {
  product?: ProductChoice;
  pantry?: boolean;
  /** Validade digitada; só vale com expiryManual. */
  expiresOn?: string | null;
  expiryManual?: boolean;
}

export interface ReviewItem {
  id: string;
  raw_description: string;
  suggested_name: string | null;
  suggested_category: string | null;
  product_id: string | null;
}

export interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  shelf_life_days: number | null;
}

export interface ResolvedItem {
  product: ProductChoice;
  productName: string | null;
  category: string;
  pantry: boolean;
  expiresOn: string | null;
  expirySource: ExpirySource | null;
}

export function resolveItem(
  item: ReviewItem,
  override: ItemOverride | undefined,
  catalog: Map<string, CatalogProduct>,
  purchasedOn: string,
): ResolvedItem {
  // Produto que não está mais no catálogo (outra pessoa da casa o juntou com outro) não é escolha: nem o que a
  // pessoa escolheu nesta revisão, nem o do próprio item. Senão o id que sumiu iria para o banco a cada toque.
  const chosen = override?.product;
  const product: ProductChoice =
    (chosen?.kind === 'existing' && !catalog.has(chosen.productId) ? undefined : chosen) ??
    (item.product_id && catalog.has(item.product_id)
      ? { kind: 'existing', productId: item.product_id }
      : {
          kind: 'new',
          name: item.suggested_name?.trim() || item.raw_description,
          category: item.suggested_category ?? guessCategory(item.raw_description),
        });

  const existing = product.kind === 'existing' ? catalog.get(product.productId) : undefined;
  const category =
    product.kind === 'existing'
      ? (existing?.category ?? 'outros')
      : product.kind === 'new'
        ? product.category
        : (item.suggested_category ?? guessCategory(item.raw_description));
  const productName = product.kind === 'existing' ? (existing?.name ?? null) : product.kind === 'new' ? product.name : null;

  const pantry = override?.pantry ?? getCategory(category).pantry;
  if (override?.expiryManual) {
    return { product, productName, category, pantry, expiresOn: override.expiresOn ?? null, expirySource: 'manual' };
  }
  const estimate = estimateExpiry({ purchasedOn, category, productShelfLifeDays: existing?.shelf_life_days });
  return { product, productName, category, pantry, expiresOn: estimate.expiresOn, expirySource: estimate.source };
}

export interface ConfirmItem {
  id: string;
  product_id?: string;
  new_product?: { name: string; category: string };
  /** Itens de lista que esta compra cumpre: saem da lista e o nome vira vínculo com o produto. */
  list_items?: ListRemoval[];
  /** Ligações nome da lista -> este produto que a pessoa desfez nesta nota. */
  forget_links?: string[];
  pantry?: {
    name: string;
    category: string;
    purchased_on: string;
    expires_on: string | null;
    expiry_source: ExpirySource | null;
  };
}

/**
 * Os itens em que um produto sumiu do catálogo (outra pessoa da casa o juntou com outro, com esta revisão
 * aberta). O `resolveItem` já não manda o id que sumiu, mas o que ele põe no lugar é "produto novo", e
 * confirmar assim criaria de novo, pelo nome da nota, o produto que acabou de ser juntado:
 * - `chosen`: a pessoa escolheu nesta revisão um produto que não existe mais. A escolha tem de ser refeita.
 * - `own`: o produto do próprio item (sem escolha por cima) não está no catálogo. Ou a nota é de antes da
 *   junção (o banco já passou o item para o produto que ficou), ou os produtos são de antes de um produto
 *   novo: buscar os dois de novo resolve.
 */
export function goneProducts(
  items: ReviewItem[],
  overrides: Record<string, ItemOverride>,
  catalog: Map<string, CatalogProduct>,
): { chosen: string[]; own: string[] } {
  const chosen: string[] = [];
  const own: string[] = [];
  for (const item of items) {
    const choice = overrides[item.id]?.product;
    if (choice) {
      if (choice.kind === 'existing' && !catalog.has(choice.productId)) chosen.push(item.id);
    } else if (item.product_id && !catalog.has(item.product_id)) own.push(item.id);
  }
  return { chosen, own };
}

/** No item, no lugar do aviso de preço: a escolha que sumiu. */
export const GONE_CHOICE_HINT = 'O produto escolhido foi juntado com outro. Escolha de novo.';

export interface ConfirmBlock {
  /** `choose`: a pessoa refaz a escolha. `refresh`: a tela busca os produtos e a nota de novo, e a pessoa confere. */
  kind: 'choose' | 'refresh';
  title: string;
  message: string;
}

/**
 * O que impede a confirmação de seguir (null: nada). A escolha que sumiu impede sempre, até ser refeita. O
 * produto do próprio item fora do catálogo pede uma busca nova dos produtos e da nota, e impede até ela dar
 * certo: `refreshed` são os itens para os quais as DUAS buscas já chegaram (a tela só os guarda aí; com uma
 * das buscas falhando o catálogo pode continuar sem o produto, e confirmar o criaria de novo). O item que
 * continua fora depois de as duas chegarem segue como produto novo, como sempre foi; um item que sumir depois
 * pede a busca de novo.
 */
export function confirmBlock(gone: { chosen: string[]; own: string[] }, refreshed: readonly string[]): ConfirmBlock | null {
  if (gone.chosen.length) {
    return {
      kind: 'choose',
      title: 'Escolha o produto de novo',
      message:
        gone.chosen.length === 1
          ? 'O produto escolhido para um item desta nota foi juntado com outro em outro aparelho. Escolha de novo o produto desse item.'
          : `Os produtos escolhidos para ${gone.chosen.length} itens desta nota foram juntados com outros em outro aparelho. Escolha de novo o produto desses itens.`,
    };
  }
  if (gone.own.some((id) => !refreshed.includes(id))) {
    return {
      kind: 'refresh',
      title: 'Produtos atualizados',
      message: 'Um produto desta nota mudou em outro aparelho. Confira os itens e confirme de novo.',
    };
  }
  return null;
}

/**
 * As buscas pedidas chegaram, todas? Uma que falha (com o dado de antes ainda guardado, ela responde sem dar
 * erro) ou que estoura conta como não chegou.
 */
export async function allArrived(fetches: (() => Promise<{ isSuccess: boolean }>)[]): Promise<boolean> {
  try {
    const results = await Promise.all(fetches.map((fetch) => fetch()));
    return results.every((result) => result.isSuccess);
  } catch {
    return false;
  }
}

/** A busca nova dos produtos ou da nota não chegou: a confirmação continua parada. */
export const REFRESH_FAILED_NOTICE = {
  title: 'Não deu para atualizar',
  message: 'Um produto desta nota mudou em outro aparelho, e não deu para buscar os produtos e a nota de novo. Confira a internet e confirme outra vez.',
};

/** Payload de confirm_receipt (ver migration). */
export function buildConfirmPayload(
  items: ReviewItem[],
  overrides: Record<string, ItemOverride>,
  catalog: Map<string, CatalogProduct>,
  purchasedOn: string,
): ConfirmItem[] {
  return items.map((item) => {
    const r = resolveItem(item, overrides[item.id], catalog, purchasedOn);
    const entry: ConfirmItem = { id: item.id };
    if (r.product.kind === 'existing') entry.product_id = r.product.productId;
    if (r.product.kind === 'new') {
      entry.new_product = { name: r.product.name.trim() || item.raw_description, category: r.product.category };
    }
    if (r.pantry) {
      entry.pantry = {
        name: r.productName ?? item.suggested_name ?? item.raw_description,
        category: r.category,
        purchased_on: purchasedOn,
        expires_on: r.expiresOn,
        expiry_source: r.expiresOn ? r.expirySource : null,
      };
    }
    return entry;
  });
}
