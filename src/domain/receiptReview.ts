// Revisão de nota: o que cada item vira ao confirmar (produto, despensa,
// validade). Os padrões vêm da IA e do histórico; o usuário só corrige.

import { getCategory } from './categories';
import {
  asksFrozenOnReceipt,
  boughtFrozen,
  freezeKindOf,
  frozenExpiryFor,
  frozenReceiptHint,
  type FreezeDays,
  type FreezeKind,
  type Fresh,
} from './freezer';
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
  /** "Congelei" (só nesta revisão); sem resposta vale o nome ("CONG": já começa marcado). */
  frozen?: boolean;
  /** A validade digitada antes de marcar "Congelei": é a de antes do congelador, de onde o descongelar conta. */
  freshExpiresOn?: string | null;
  freshManual?: boolean;
}

export interface ReviewItem {
  id: string;
  raw_description: string;
  suggested_name: string | null;
  suggested_category: string | null;
  product_id: string | null;
  /** A unidade da linha: o atum e a sardinha por kg são frescos (domain/freezer). */
  unit?: string;
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
  /** O tipo do congelador quando a linha pergunta "Congelou?" (domain/freezer); null quando não pergunta. */
  freezeKind: FreezeKind | null;
  /** Vai para o congelador. */
  frozen: boolean;
  /** A validade de antes do congelador, só com `frozen`. */
  freshExpiresOn: string | null;
  freshExpirySource: ExpirySource | null;
}

/** "Congelei" ligado ou desligado numa linha, com a validade digitada antes ou durante (ver PantryEntryInput). */
export function toggleFrozen(override: ItemOverride | undefined, on: boolean): ItemOverride {
  const o = override ?? {};
  if (on) {
    return o.expiryManual
      ? { ...o, frozen: true, freshExpiresOn: o.expiresOn ?? null, freshManual: true, expiryManual: false, expiresOn: undefined }
      : { ...o, frozen: true };
  }
  return o.freshManual
    ? { ...o, frozen: false, expiresOn: o.freshExpiresOn ?? null, expiryManual: true, freshExpiresOn: undefined, freshManual: undefined }
    : { ...o, frozen: false, expiryManual: false, expiresOn: undefined };
}

/**
 * A linha da nota pergunta "Congelou?": o tipo dela no congelador, só com o congelador no banco (`freezer`), indo
 * para a despensa e quando é carne ou peixe (asksFrozenOnReceipt). É o que a linha incluída depois numa nota
 * confirmada também pergunta.
 */
export function receiptFreezeKind(
  names: readonly (string | null | undefined)[],
  category: string,
  unit: string | null | undefined,
  freezer: FreezeDays | null,
): FreezeKind | null {
  if (!freezer) return null;
  const kind = freezeKindOf(names, category, unit);
  return asksFrozenOnReceipt(kind, category) ? kind : null;
}

/** O que decide a validade da linha que vai para a despensa (a da revisão e a incluída depois numa nota confirmada). */
export interface PantryEntryInput {
  category: string;
  purchasedOn: string;
  /** A validade aprendida do produto escolhido, se ele tem. */
  productShelfLifeDays?: number | null;
  /** De receiptFreezeKind: null quando a linha não pergunta "Congelou?". */
  freezeKind: FreezeKind | null;
  /** Os nomes da linha, para o "CONG" que já começa marcado (boughtFrozen). */
  names: readonly (string | null | undefined)[];
  override?: Pick<ItemOverride, 'frozen' | 'expiresOn' | 'expiryManual' | 'freshExpiresOn' | 'freshManual'>;
  freezer: FreezeDays | null;
}

export interface PantryEntryExpiry {
  frozen: boolean;
  expiresOn: string | null;
  expirySource: ExpirySource | null;
  freshExpiresOn: string | null;
  freshExpirySource: ExpirySource | null;
}

/**
 * A validade da linha na despensa. Sem congelador: a digitada, senão a estimada (aprendida do produto ou da
 * categoria). Congelada: a de antes é a digitada antes de marcar "Congelei" (`manual`), senão a estimada; a da linha
 * é a digitada com "Congelei" marcado (`manual`), senão a do congelador, contada do dia da compra.
 */
export function pantryEntry(input: PantryEntryInput): PantryEntryExpiry {
  const { override, freezeKind, freezer } = input;
  const estimate = estimateExpiry({
    purchasedOn: input.purchasedOn,
    category: input.category,
    productShelfLifeDays: input.productShelfLifeDays,
  });
  const fresh: Fresh = override?.freshManual
    ? { expiresOn: override.freshExpiresOn ?? null, source: 'manual' }
    : { expiresOn: estimate.expiresOn, source: estimate.source };
  const typed: Fresh | null = override?.expiryManual ? { expiresOn: override.expiresOn ?? null, source: 'manual' } : null;
  const frozen = Boolean(freezeKind && freezer && (override?.frozen ?? boughtFrozen(input.names)));
  if (frozen && freezeKind && freezer) {
    const expiry = typed ?? frozenExpiryFor({ frozenOn: input.purchasedOn, fresh, kind: freezeKind, days: freezer });
    return {
      frozen: true,
      expiresOn: expiry.expiresOn,
      expirySource: expiry.expiresOn ? expiry.source : null,
      freshExpiresOn: fresh.expiresOn,
      freshExpirySource: fresh.expiresOn ? fresh.source : null,
    };
  }
  const expiry = typed ?? fresh;
  return { frozen: false, expiresOn: expiry.expiresOn, expirySource: expiry.source, freshExpiresOn: null, freshExpirySource: null };
}

/** O que vai em `pantry` de confirm_receipt (e da linha incluída depois): o congelador só na linha congelada. */
export function pantryPayload(
  entry: PantryEntryExpiry & { freezeKind: FreezeKind | null },
  { name, category, purchasedOn }: { name: string; category: string; purchasedOn: string },
): NonNullable<ConfirmItem['pantry']> {
  const pantry: NonNullable<ConfirmItem['pantry']> = {
    name,
    category,
    purchased_on: purchasedOn,
    expires_on: entry.expiresOn,
    expiry_source: entry.expiresOn ? entry.expirySource : null,
  };
  if (entry.frozen && entry.freezeKind) {
    pantry.frozen_on = purchasedOn;
    pantry.freeze_kind = entry.freezeKind;
    pantry.fresh_expires_on = entry.freshExpiresOn;
    pantry.fresh_expiry_source = entry.freshExpiresOn ? entry.freshExpirySource : null;
  }
  return pantry;
}

/** O chip da despensa da linha da nota. */
export const pantryChoiceLabel = (on: boolean) => (on ? 'Vai para a despensa' : 'Não vai para a despensa');

/** O texto embaixo da validade da linha: de onde ela veio (nada para a digitada). */
export function receiptExpiryHint(
  resolved: Pick<ResolvedItem, 'pantry' | 'expiresOn' | 'expirySource' | 'frozen' | 'freezeKind'>,
  freezer: FreezeDays | null,
): string | null {
  if (!resolved.pantry || !resolved.expiresOn) return null;
  if (resolved.frozen && resolved.freezeKind && freezer && resolved.expirySource === 'congelado') {
    return frozenReceiptHint(resolved.freezeKind, freezer);
  }
  if (resolved.expirySource === 'produto') return 'Validade que o produto aprendeu — ajuste se quiser.';
  if (resolved.expirySource === 'categoria') return 'Validade estimada pela categoria — ajuste se quiser.';
  return null;
}

export function resolveItem(
  item: ReviewItem,
  override: ItemOverride | undefined,
  catalog: Map<string, CatalogProduct>,
  purchasedOn: string,
  freezer: FreezeDays | null = null,
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
  const names = [productName, item.suggested_name, item.raw_description];
  const freezeKind = pantry && product.kind !== 'none' ? receiptFreezeKind(names, category, item.unit, freezer) : null;
  const entry = pantryEntry({
    category,
    purchasedOn,
    productShelfLifeDays: existing?.shelf_life_days,
    freezeKind,
    names: [item.raw_description, item.suggested_name, productName],
    override,
    freezer,
  });
  return { product, productName, category, pantry, freezeKind, ...entry };
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
    /** Só na linha "Congelei": o dia da compra, o tipo e a validade de antes do congelador. */
    frozen_on?: string;
    freeze_kind?: FreezeKind;
    fresh_expires_on?: string | null;
    fresh_expiry_source?: ExpirySource | null;
  };
}

export interface GoneProducts {
  /** Ids dos itens cuja escolha desta revisão sumiu. */
  chosen: string[];
  /** "item:produto" (`goneKey`) dos itens cujo próprio produto não está no catálogo. */
  own: string[];
}

/** O item e o produto que sumiu dele: é para este par que a busca nova vale. */
export const goneKey = (itemId: string, productId: string) => `${itemId}:${productId}`;

/**
 * Os itens em que um produto sumiu do catálogo (outra pessoa da casa o juntou com outro, ou o excluiu, com esta
 * revisão aberta). O `resolveItem` já não manda o id que sumiu, mas o que ele põe no lugar é "produto novo", e
 * confirmar assim criaria de novo, pelo nome da nota, o produto que acabou de ser juntado:
 * - `chosen`: a pessoa escolheu nesta revisão um produto que não existe mais. A escolha tem de ser refeita.
 * - `own`: o produto do próprio item (sem escolha por cima) não está no catálogo. Ou a nota é de antes da
 *   junção (o banco já passou o item para o produto que ficou), ou os produtos são de antes de um produto
 *   novo: buscar os dois de novo resolve. Vem como "item:produto" (`goneKey`): o mesmo item pode sumir de
 *   novo, com OUTRO produto (o que ficou foi juntado com um terceiro), e aí é outra busca a fazer.
 */
export function goneProducts(
  items: ReviewItem[],
  overrides: Record<string, ItemOverride>,
  catalog: Map<string, CatalogProduct>,
): GoneProducts {
  const chosen: string[] = [];
  const own: string[] = [];
  for (const item of items) {
    const choice = overrides[item.id]?.product;
    if (choice) {
      if (choice.kind === 'existing' && !catalog.has(choice.productId)) chosen.push(item.id);
    } else if (item.product_id && !catalog.has(item.product_id)) own.push(goneKey(item.id, item.product_id));
  }
  return { chosen, own };
}

/** No item, no lugar do aviso de preço: a escolha que sumiu. */
export const GONE_CHOICE_HINT = 'O produto escolhido foi juntado com outro ou excluído. Escolha de novo.';

export interface ConfirmBlock {
  /** `choose`: a pessoa refaz a escolha. `refresh`: a tela busca os produtos e a nota de novo, e a pessoa confere. */
  kind: 'choose' | 'refresh';
  title: string;
  message: string;
}

/**
 * O que impede a confirmação de seguir (null: nada). A escolha que sumiu impede sempre, até ser refeita. O
 * produto do próprio item fora do catálogo pede uma busca nova dos produtos e da nota, e impede até ela dar
 * certo: `refreshed` são os pares "item:produto" para os quais as DUAS buscas já chegaram (a tela só os
 * guarda aí; com uma das buscas falhando o catálogo pode continuar sem o produto, e confirmar o criaria de
 * novo). O par que continua fora depois de as duas chegarem segue como produto novo, como sempre foi. Outro
 * item que sumir depois, ou o mesmo item com outro produto (o produto que ficou foi juntado com um
 * terceiro), pede a busca de novo.
 */
export function confirmBlock(gone: GoneProducts, refreshed: readonly string[]): ConfirmBlock | null {
  if (gone.chosen.length) {
    return {
      kind: 'choose',
      title: 'Escolha o produto de novo',
      message:
        gone.chosen.length === 1
          ? 'O produto escolhido para um item desta nota foi juntado com outro ou excluído em outro aparelho. Escolha de novo o produto desse item.'
          : `Os produtos escolhidos para ${gone.chosen.length} itens desta nota foram juntados com outros ou excluídos em outro aparelho. Escolha de novo o produto desses itens.`,
    };
  }
  if (gone.own.some((key) => !refreshed.includes(key))) {
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

/**
 * Payload de confirm_receipt (ver migration). Sem o congelador no banco (`freezer` null) nada da linha é congelado, e
 * o payload é o de antes dele: a linha "CONG" não leva 'congelado' a um banco que não o aceita.
 */
export function buildConfirmPayload(
  items: ReviewItem[],
  overrides: Record<string, ItemOverride>,
  catalog: Map<string, CatalogProduct>,
  purchasedOn: string,
  freezer: FreezeDays | null = null,
): ConfirmItem[] {
  return items.map((item) => {
    const r = resolveItem(item, overrides[item.id], catalog, purchasedOn, freezer);
    const entry: ConfirmItem = { id: item.id };
    if (r.product.kind === 'existing') entry.product_id = r.product.productId;
    if (r.product.kind === 'new') {
      entry.new_product = { name: r.product.name.trim() || item.raw_description, category: r.product.category };
    }
    if (r.pantry) {
      entry.pantry = pantryPayload(r, {
        name: r.productName ?? item.suggested_name ?? item.raw_description,
        category: r.category,
        purchasedOn,
      });
    }
    return entry;
  });
}
