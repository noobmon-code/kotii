// Nota confirmada: trocar o produto de uma linha ("Trocar produto") e incluir o item que a leitura perdeu ("Item").
// Decisões do dono de 2026-11-21: (a) a troca leva para o produto novo a entrada da despensa e o histórico de preço,
// e o apelido e o código que a casa aprendeu daquela linha vão junto; (b) o item que faltou entra nas linhas da nota
// (os gastos, o Mercado do mês e o histórico de preço contam com ele) e, como na confirmação, na despensa. As regras e
// todas as frases ficam aqui; os dados, em data/receipts.ts; o banco, em 20261124180430_confirmed_receipt_items.sql.
// Nenhuma das duas correções chega aos preços compartilhados entre casas.

import type { Unit } from '@/lib/types';
import { CATEGORIES, getCategory } from './categories';
import { freezeKind, type FreezeDays, type FreezeKind } from './freezer';
import { formatBRL, formatQuantity } from './money';
import { PRODUCT_MERGED_AWAY } from './productMerge';
import { RECEIPT_GONE } from './receiptEdit';
import { houseNameOverride, typedNameActions } from './receiptNames';
import {
  pantryEntry,
  pantryPayload,
  receiptFreezeKind,
  type CatalogProduct,
  type ConfirmItem,
  type PantryEntryExpiry,
  type ProductChoice,
} from './receiptReview';
import { guessCategory } from './search';
import { existingNameLabel, indexNames, type NameCandidate, type NameIndex } from './similarNames';

export type CorrectionAction = 'change' | 'add';

/** O produto que a linha passa a ter: um da casa, ou um novo (o banco usa o da casa com o mesmo nome, se houver). */
export type CorrectionTarget = { productId: string } | { newProduct: { name: string; category: string } };

/** As validades padrão de CATEGORIES, chave → dias (null: sem padrão). O banco refaz com elas a validade estimada da despensa. */
export const CATEGORY_SHELF_LIFE_DAYS: Readonly<Record<string, number | null>> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c.shelfLifeDays]),
);

/** O que da linha da nota decide a categoria de um produto novo, quando o nome não diz. */
export type CorrectionLine = { suggested_category: string | null; raw_description: string };

/**
 * Categoria do produto novo criado na nota confirmada: a do nome (guessCategory(name) ≠ 'outros'); senão a sugerida
 * da linha; senão guessCategory(raw_description, { abbreviated: true }); senão 'outros'. Nunca a do produto de antes:
 * a troca é justamente a pessoa dizendo que a linha é outra coisa.
 */
export function newProductCategory(name: string, line?: CorrectionLine | null): string {
  const fromName = guessCategory(name);
  if (fromName !== 'outros') return fromName;
  if (line?.suggested_category) return line.suggested_category;
  const fromLine = line ? guessCategory(line.raw_description, { abbreviated: true }) : 'outros';
  return fromLine;
}

/** O "item atual" que typedNameActions / houseNameOverride recebem nos modos da nota confirmada. */
export function correctionCurrent(name: string, line?: CorrectionLine | null): { category: string } {
  return { category: newProductCategory(name, line) };
}

/** O botão de criar diz a categoria que vai junto: `Novo produto "Leite" (Laticínios)`. */
export const newProductActionTitle = (title: string, category: string) => `${title} (${getCategory(category).label})`;

/** O subtítulo de um nome parecido sem produto: de onde ele vem e a categoria que o produto novo teria. */
export const suggestionSubtitle = (sourceLabel: string, category: string) => `${sourceLabel} · ${getCategory(category).label}`;

/**
 * Nos modos da nota confirmada não há nomes dados a outros itens desta nota (eles só existem numa revisão): o índice
 * vazio vai no lugar do da nota, nos nomes parecidos e nos botões do seletor.
 */
export const NO_NOTE_NAMES: NameIndex = indexNames([]);

/**
 * O nome da casa escolhido no seletor (um nome parecido, ou "Usar" o que já existe), como escolha de produto: o
 * produto da casa, ou um produto novo com a categoria que o botão e o subtítulo mostram (correctionCurrent, nunca a
 * do produto de antes).
 */
export function correctionNameChoice(
  chosen: Pick<NameCandidate, 'name' | 'category' | 'productId'>,
  line: CorrectionLine | null,
  catalog: ReadonlyMap<string, CatalogProduct>,
): ProductChoice {
  return houseNameOverride(chosen, correctionCurrent(chosen.name, line), catalog).product ?? { kind: 'none' };
}

/** Os botões do seletor nos modos da nota confirmada, para o texto digitado: usar o nome que já existe, e criar. */
export interface CorrectionActions {
  existing: { label: string; choice: ProductChoice } | null;
  create: { title: string; choice: ProductChoice } | null;
}

/**
 * O que o seletor oferece para o texto digitado na nota confirmada: os botões da revisão (typedNameActions), com a
 * categoria do produto novo pelo nome digitado (newProductCategory) e dita no botão de criar, lida da mesma escolha
 * que vai para o banco. Sem "Não acompanhar preço": a linha confirmada continua com um produto.
 */
export function correctionActions(
  typed: string,
  house: NameIndex,
  line: CorrectionLine | null,
  catalog: ReadonlyMap<string, CatalogProduct>,
): CorrectionActions {
  const { existing, create } = typedNameActions(typed, house, NO_NOTE_NAMES, correctionCurrent(typed, line), catalog);
  const created = create?.override.product;
  return {
    existing: existing ? { label: existingNameLabel(existing), choice: correctionNameChoice(existing, line, catalog) } : null,
    create:
      create && created?.kind === 'new'
        ? { title: newProductActionTitle(create.title, created.category), choice: created }
        : null,
  };
}

export type CorrectionPick =
  | { kind: 'nothing' }
  | { kind: 'gone' }
  | {
      kind: 'write';
      target: CorrectionTarget;
      /**
       * O tipo do congelador do produto escolhido (changedFreezeKind), para a compra da linha que está no congelador:
       * null deixa o tipo de antes.
       */
      freezeKind: FreezeKind | null;
    };

/**
 * O tipo do congelador do produto novo, para a compra da linha que já está no congelador (o banco troca o tipo e
 * refaz a validade 'congelado'); null deixa o tipo de antes. A regra do formulário da despensa quando o nome muda.
 */
export const changedFreezeKind = (product: { name: string; category: string }, unit: string | null | undefined) =>
  freezeKind(product.name, product.category, unit);

/**
 * O que a escolha no seletor faz na linha da nota confirmada. `none`, nome em branco e o mesmo produto não gravam
 * nada; o produto que saiu do catálogo entre o desenho e o toque (juntado ou excluído em outro aparelho) é `gone`.
 */
export function productCorrection(
  line: { product_id: string | null; unit?: string | null },
  choice: ProductChoice,
  catalog: ReadonlyMap<string, CatalogProduct>,
): CorrectionPick {
  if (choice.kind === 'none') return { kind: 'nothing' };
  if (choice.kind === 'existing') {
    const product = catalog.get(choice.productId);
    if (!product) return { kind: 'gone' };
    if (choice.productId === line.product_id) return { kind: 'nothing' };
    return { kind: 'write', target: { productId: choice.productId }, freezeKind: changedFreezeKind(product, line.unit) };
  }
  const name = choice.name.trim();
  if (!name) return { kind: 'nothing' };
  const newProduct = { name, category: choice.category };
  return { kind: 'write', target: { newProduct }, freezeKind: changedFreezeKind(newProduct, line.unit) };
}

/** O produto do item que faltou, escolhido antes do formulário. */
export type AddedProduct =
  | { kind: 'existing'; productId: string; name: string; category: string; shelfLifeDays: number | null }
  | { kind: 'new'; name: string; category: string };

export type AddedPick = { kind: 'nothing' } | { kind: 'gone' } | { kind: 'ok'; product: AddedProduct };

/** O produto escolhido para o item que faltou: o mesmo `nothing` / `gone` da troca. */
export function addedProduct(choice: ProductChoice, catalog: ReadonlyMap<string, CatalogProduct>): AddedPick {
  if (choice.kind === 'none') return { kind: 'nothing' };
  if (choice.kind === 'existing') {
    const product = catalog.get(choice.productId);
    if (!product) return { kind: 'gone' };
    return {
      kind: 'ok',
      product: {
        kind: 'existing',
        productId: product.id,
        name: product.name,
        category: product.category,
        shelfLifeDays: product.shelf_life_days,
      },
    };
  }
  const name = choice.name.trim();
  if (!name) return { kind: 'nothing' };
  return { kind: 'ok', product: { kind: 'new', name, category: choice.category } };
}

/** A despensa começa como na revisão: pelo padrão da categoria. */
export const addedItemPantryDefault = (product: AddedProduct) => getCategory(product.category).pantry;

/** A linha pequena do formulário: `Produto: Feijão carioca (Grãos, massas e cereais)`. */
export function addItemProductLine(product: AddedProduct): string {
  const label = getCategory(product.category).label;
  return product.kind === 'existing' ? `Produto: ${product.name} (${label})` : `Produto novo: ${product.name} (${label})`;
}

/** O que o formulário do item que faltou tem nos campos. */
export interface AddedItemValues {
  raw_description: string;
  quantity: number;
  unit: Unit;
  unit_price: number;
  total_price: number;
}

/** O que o formulário escolheu da despensa: o chip e o "Congelei" (undefined: o que o nome diz, como na revisão). */
export interface AddedItemPantryChoice {
  pantry: boolean;
  frozen?: boolean;
}

/** A despensa do item que faltou, como o cartão da linha mostra (ReceiptPantryChoice) e o pedido manda. */
export interface AddedItemPantry extends PantryEntryExpiry {
  pantry: boolean;
  /** O tipo do congelador quando a linha pergunta "Congelou?"; null quando não pergunta. */
  freezeKind: FreezeKind | null;
}

/**
 * A despensa do item que faltou, pelas regras da revisão (pantryEntry, receiptFreezeKind): a validade estimada pelo
 * produto ou pela categoria e, em carnes e peixes com o congelador no banco (`freezer`), o "Congelei". Sem campo de
 * validade: a data digitada fica para o formulário da despensa.
 */
export function addedItemPantry(input: {
  product: AddedProduct;
  description: string;
  unit: Unit;
  choice: AddedItemPantryChoice;
  purchasedOn: string;
  freezer: FreezeDays | null;
}): AddedItemPantry {
  const { product, description, unit, choice, purchasedOn, freezer } = input;
  const names = [product.name, description];
  const freezeKindOfLine = choice.pantry ? receiptFreezeKind(names, product.category, unit, freezer) : null;
  const entry = pantryEntry({
    category: product.category,
    purchasedOn,
    productShelfLifeDays: product.kind === 'existing' ? product.shelfLifeDays : null,
    freezeKind: freezeKindOfLine,
    names: [description, product.name],
    override: choice.frozen === undefined ? undefined : { frozen: choice.frozen },
    freezer,
  });
  return { pantry: choice.pantry, freezeKind: freezeKindOfLine, ...entry };
}

/** O p_item de add_confirmed_receipt_item. */
export type AddedItemRequest = Omit<ConfirmItem, 'list_items' | 'forget_links'> & AddedItemValues;

/**
 * O p_item de add_confirmed_receipt_item: product_id OU new_product, e, com a despensa, o que confirm_receipt
 * receberia para a mesma linha (pantryPayload: o nome e a categoria do produto, o dia da compra, a validade estimada e,
 * na linha "Congelei", o congelador). Sem a despensa, a chave não vai.
 */
export function addedItemRequest(input: {
  id: string;
  values: AddedItemValues;
  product: AddedProduct;
  choice: AddedItemPantryChoice;
  purchasedOn: string;
  freezer: FreezeDays | null;
}): AddedItemRequest {
  const { id, values, product, choice, purchasedOn, freezer } = input;
  const request: AddedItemRequest = {
    id,
    raw_description: values.raw_description.trim(),
    quantity: values.quantity,
    unit: values.unit,
    unit_price: values.unit_price,
    total_price: values.total_price,
  };
  if (product.kind === 'existing') request.product_id = product.productId;
  else request.new_product = { name: product.name, category: product.category };
  if (choice.pantry) {
    const entry = addedItemPantry({ product, description: values.raw_description, unit: values.unit, choice, purchasedOn, freezer });
    request.pantry = pantryPayload(entry, { name: product.name, category: product.category, purchasedOn });
  }
  return request;
}

/** A pergunta antes de incluir: depois, a linha não muda nem sai (só excluindo a nota). */
export function addItemSummary(
  request: AddedItemRequest,
  productName: string,
): { title: string; message: string; confirmLabel: string; cancelLabel: string } {
  const where = request.pantry ? (request.pantry.frozen_on ? ', e vai para o congelador' : ', e vai para a despensa') : '';
  return {
    title: 'Incluir este item?',
    message: `${productName}: ${formatQuantity(request.quantity, request.unit)}, ${formatBRL(request.total_price)}${where}. Depois de incluído, a quantidade e o valor não mudam mais, e o item só sai da nota excluindo a nota inteira.`,
    confirmLabel: 'Incluir',
    cancelLabel: 'Voltar',
  };
}

export const CHANGE_PRODUCT_LABEL = 'Trocar produto';
export const CHOOSE_PRODUCT_LABEL = 'Escolher produto';

/** O chip de cada item da nota confirmada: com produto troca, sem produto escolhe. */
export function changeProductButton(lineTitle: string, hasProduct: boolean): { title: string; accessibilityLabel: string } {
  return hasProduct
    ? { title: CHANGE_PRODUCT_LABEL, accessibilityLabel: `Trocar o produto de ${lineTitle}` }
    : { title: CHOOSE_PRODUCT_LABEL, accessibilityLabel: `Escolher o produto de ${lineTitle}` };
}

export const CHANGE_PRODUCT_TITLE = 'Qual produto é este?';
/** O que a troca muda em qualquer linha. */
export const CHANGE_ADDED_PRODUCT_MESSAGE =
  'A compra passa para o produto escolhido no histórico de preço e nos gastos, e na despensa, se foi para lá.';
/** A linha que veio na nota: o apelido da descrição dela vai junto (change_receipt_item_product, passo 7). */
export const CHANGE_PRODUCT_MESSAGE = `${CHANGE_ADDED_PRODUCT_MESSAGE} A casa aprende junto: as próximas notas com esta descrição costumam vir com ele.`;

/**
 * A frase do seletor da troca para esta linha. A incluída depois de a nota ser confirmada ("Item") não ensina apelido,
 * nem quando o produto dela é trocado (o texto dela é da pessoa): para ela, a frase não promete que a casa aprende.
 */
export function changeProductMessage(line: { added_after_confirmation?: boolean } | undefined): string {
  return line?.added_after_confirmation ? CHANGE_ADDED_PRODUCT_MESSAGE : CHANGE_PRODUCT_MESSAGE;
}

/** O botão "Item" da nota confirmada, para o leitor de tela. */
export const ADD_ITEM_ACCESSIBILITY = 'Incluir um item que faltou na nota';
export const ADD_ITEM_PICKER_TITLE = 'Qual produto faltou?';

/** A frase do seletor do item que faltou: a nota lida perdeu o item; a digitada à mão, deixou de fora. */
export function addItemPickerMessage(source: 'ai' | 'manual' | 'qrcode'): string {
  return source === 'manual'
    ? 'Escolha o produto do item que ficou fora da nota. Depois vêm a quantidade e o valor.'
    : 'Escolha o produto do item que a leitura não pegou. Depois vêm a quantidade e o valor.';
}

export const ADD_ITEM_TITLE = 'Item que faltou';
export const ADD_ITEM_INTRO =
  'O item entra nesta nota, e com ela nos gastos e no histórico de preço do produto. Ele não vai para os preços compartilhados entre casas.';
export const ADD_ITEM_SAVE = 'Incluir item';
export const ADD_ITEM_NEEDS_VALUE = {
  title: 'Informe o valor',
  message:
    'O item que faltou entra com o que foi pago por ele. Para guardar na despensa algo que veio de graça, use "Adicionar à despensa", em Compras > Despensa.',
};
export const ADDED_BEFORE = {
  title: 'Item já incluído',
  message: 'O item já tinha entrado na nota com o que foi salvo da primeira vez, e esta mudança não foi gravada. Confira o item na nota.',
};
export const PRODUCT_SAVED_NOT_SHOWN = {
  title: 'Produto trocado',
  message: 'Não deu para atualizar a nota na tela: o item pode aparecer com o produto de antes até ela ser buscada de novo.',
};
/** A busca de fundo falhou: as correções da nota confirmada esperam a nota voltar. */
export const CORRECTION_STALE = {
  title: 'Não deu para buscar a nota',
  message: 'Os itens na tela podem estar diferentes do que está salvo. Toque em "Tentar de novo" e corrija o item depois.',
};

/** Sem internet, nada abre: as correções gravam na hora. */
export function correctionOffline(action: CorrectionAction): { title: string; message: string } {
  return {
    title: 'Sem internet agora',
    message: action === 'change' ? 'Troque o produto quando a conexão voltar.' : 'Inclua o item quando a conexão voltar.',
  };
}

type Notice = { title: string; message: string };

/**
 * O toque numa correção com a tela atrás do que ela gravou (ou com a busca de fundo que falhou): a nota é buscada de
 * novo, e o toque fica para depois, já com os itens de agora. Não fala em confirmar: a nota já está confirmada.
 */
export function correctionCatchUp(action: CorrectionAction): { caughtUp: Notice; behind: Notice; failed: Notice } {
  return {
    caughtUp: {
      title: 'Nota atualizada',
      message:
        action === 'change'
          ? 'Confira o item e toque de novo, se ainda precisar trocar o produto.'
          : 'Confira os itens e toque em "Item" de novo, se ainda faltar um.',
    },
    behind: {
      title: 'A nota ainda não atualizou',
      message: 'Os itens na tela podem estar diferentes do que está salvo. Confira a internet e tente de novo.',
    },
    failed: CORRECTION_STALE,
  };
}

/** Por que o banco recusou a correção (data/receipts correctionRefusal). */
export type CorrectionRefusal = 'notReady' | 'receiptGone' | 'notConfirmed' | 'itemGone' | 'itemChanged' | 'productGone';

/** Os códigos das recusas da migração (os usados são NK001–NK006 e NK008–NK019). */
export const CORRECTION_CODES = { itemChanged: 'NK018', notConfirmed: 'NK019' } as const;
/** As mensagens do P0002 das duas funções. */
export const CORRECTION_NOT_FOUND = {
  receiptGone: 'receipt not found',
  itemGone: 'item not found',
  productGone: 'product not found',
} as const;

const REFUSAL_MESSAGES: Record<CorrectionRefusal, string> = {
  notReady: 'Ainda não dá para corrigir os itens de uma nota confirmada: falta atualizar o banco do app.',
  receiptGone: RECEIPT_GONE,
  notConfirmed: 'Esta nota ainda está em revisão. Confira os itens e confirme a nota.',
  itemGone: 'Este item não está mais na nota.',
  // Não diz de onde veio a mudança: pode ter sido um toque anterior deste aparelho cuja resposta se perdeu.
  itemChanged: 'O produto deste item já tinha mudado, e nada foi trocado. Confira o produto na nota e troque de novo, se precisar.',
  productGone: PRODUCT_MERGED_AWAY,
};

/** O aviso de uma recusa: "Produto não trocado" ou "Item não incluído", com o porquê. */
export function correctionNotice(kind: CorrectionRefusal, action: CorrectionAction): Notice {
  return { title: action === 'change' ? 'Produto não trocado' : 'Item não incluído', message: REFUSAL_MESSAGES[kind] };
}
