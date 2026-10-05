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
  const product: ProductChoice =
    override?.product ??
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
