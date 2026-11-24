// Excluir um produto: só o que não está em nenhuma nota (nem confirmada, nem em revisão), e só pela pessoa, depois
// de uma pergunta que lê o produto de novo no banco. O produto que tem compra guarda o histórico de preços e os
// gastos dos meses: para ele o caminho é juntar (domain/productMerge). Quem exclui é o banco (delete_product, em
// supabase/migrations/20261123130646_delete_product.sql); aqui ficam as regras do que perguntar e todas as frases.

import { gtinLabel } from './barcode';
import { formatShortDate } from './dates';
import { MERGE_IRREVERSIBLE } from './productMerge';

/** Um rascunho de nota com uma linha deste produto: o que a recusa cita, e para onde "Abrir a nota" vai. */
export interface DraftRef {
  receiptId: string;
  store: string | null;
  /** AAAA-MM-DD, o dia do aparelho de purchased_at. */
  day: string;
}

/** O que a pergunta lê do banco sobre um produto (fetchDeleteFacts, em data/productDelete). */
export interface DeleteFacts {
  /** O produto como está agora; null: não está mais nesta casa (excluído, juntado, ou de outra casa). */
  product: { id: string; name: string } | null;
  /** Uma linha de nota confirmada aponta para ele. */
  purchased: boolean;
  /** Um rascunho de nota com uma linha dele (qualquer um), ou null. */
  review: DraftRef | null;
  /** Um item aberto da despensa (consumed_at null) aponta para ele. */
  inPantry: boolean;
  /** Um item de uma lista que não foi arquivada aponta para ele. */
  onList: boolean;
  /** Os códigos de barras dele: quantos, e o primeiro (para a frase de um código só). */
  barcodes: { count: number; first: string | null };
}

export type DeleteStep =
  | { kind: 'gone'; title: string; message: string }
  | { kind: 'refuse'; reason: 'purchased'; title: string; message: string }
  | { kind: 'refuse'; reason: 'inReview'; title: string; message: string; receiptId: string | null }
  | { kind: 'ask'; name: string; title: string; message: string; confirmLabel: string };

// ---------------------------------------------------------------------------
// As frases

export const DELETE_BUTTON = 'Excluir produto';
export const DELETE_TITLE = 'Excluir produto';
export const DELETE_CONFIRM = 'Excluir';
export const DELETE_PREFER_JOIN = 'Se ele é o mesmo que outro produto, junte os dois em vez de excluir.';
/** Um produto que já foi comprado nunca é excluído: o caminho é juntar. */
export const DELETE_PURCHASED_TITLE = 'Este produto tem compras';
export const DELETE_PURCHASED =
  'Um produto que já foi comprado guarda o histórico de preços e os gastos dos meses, e não pode ser excluído. Se ele é o mesmo que outro produto, junte os dois.';
/** Um item de nota em revisão está com este produto: confirmar a nota sem ele criaria outro igual, pelo texto da nota. */
export const DELETE_IN_REVIEW_TITLE = 'Está numa nota para revisar';
/** A recusa sem saber qual rascunho (a do banco, NK017). */
export const DELETE_IN_REVIEW =
  'Um item de uma nota para revisar, em Compras > Notas, está com este produto. Confirme a nota com outro produto nesse item, ou exclua a nota, e tente de novo.';
export const OPEN_REVIEW = 'Abrir a nota';
export const DELETE_GONE_TITLE = 'Produto não encontrado';
/**
 * O produto não está entre os da casa: pode ter sido excluído ou juntado (por outra pessoa da casa, ou por este
 * aparelho mesmo, cuja resposta se perdeu), ou o endereço é de outra casa. Neutra de propósito.
 */
export const PRODUCT_NOT_IN_HOUSE = 'Este produto não está entre os produtos desta casa: pode ter sido excluído ou juntado com outro.';
/** O catálogo guardado no aparelho não tem o produto, e não deu para conferir no banco (sem internet, ou a busca falhou). */
export const PRODUCT_NOT_CHECKED = 'Não deu para conferir este produto agora: ele não está entre os produtos guardados neste aparelho.';
export const DELETE_RENAMED_TITLE = 'Confira o nome';
export const DELETE_RENAMED = 'Este produto mudou de nome em outro aparelho, e nada foi excluído. Confira o nome antes de excluir.';
/** A resposta de excluir não chegou a tempo: não dá para saber se o banco excluiu. */
export const DELETE_NO_ANSWER_TITLE = 'Sem resposta';
export const DELETE_NO_ANSWER = 'A resposta não chegou, e pode ser que o produto já tenha sido excluído. Confira antes de tentar de novo.';
/** O banco ainda não tem a função de excluir (o app chegou antes da migração). */
export const DELETE_UNAVAILABLE_TITLE = 'Ainda não está disponível';
export const DELETE_UNAVAILABLE = 'Excluir produtos ainda está sendo ativado no Kotii. Tente de novo mais tarde.';
/** A leitura antes da pergunta falhou: nada foi tentado ainda. */
export const DELETE_CHECK_FAILED_TITLE = 'Não deu para conferir';
export const DELETE_CHECK_FAILED = 'Não deu para conferir este produto agora. Tente de novo.';
/** A trava de delete_product: o produto não saiu (55000), e nada mudou. */
export const DELETE_BLOCKED = 'Não deu para excluir: o banco não conseguiu tirar o produto. Nada foi mudado.';
export const DELETE_FAILED_TITLE = 'Não deu para excluir';

/** Com o rascunho: a frase que diz qual é; sem ele, DELETE_IN_REVIEW. */
export function deleteInReviewMessage(review: DraftRef | null, referenceYear?: number): string {
  if (!review) return DELETE_IN_REVIEW;
  const where = `${review.store ?? 'Mercado não informado'}, ${formatShortDate(review.day, referenceYear)}`;
  return `Um item de uma nota para revisar (${where}), em Compras > Notas, está com este produto. Confirme a nota com outro produto nesse item, ou exclua a nota, e tente de novo.`;
}

/**
 * A pergunta, com o nome lido do banco: o produto sai; o que está na despensa e na lista fica, sem ligação; os
 * códigos de barras, lidos de novo, perguntam qual produto é; para dois que são o mesmo, o caminho é juntar; e não
 * dá para desfazer. As frases vão nessa ordem, separadas por um espaço.
 */
export function deleteQuestion(name: string, facts: Pick<DeleteFacts, 'inPantry' | 'onList' | 'barcodes'>): string {
  const places = [facts.inPantry ? 'na despensa' : null, facts.onList ? 'na lista' : null].filter(Boolean).join(' e ');
  const { count, first } = facts.barcodes;
  const codes =
    count > 1
      ? `Lidos de novo, os ${count} códigos de barras ligados a ele perguntam qual produto é.`
      : count === 1 && first
        ? `Lido de novo, o código de barras ${gtinLabel(first)} pergunta qual produto é.`
        : null;
  return [
    `"${name}" sai dos produtos da casa.`,
    places ? `O que está ${places} continua lá, sem ligação com este produto.` : null,
    codes,
    DELETE_PREFER_JOIN,
    MERGE_IRREVERSIBLE,
  ]
    .filter(Boolean)
    .join(' ');
}

/** O que fazer com o toque, pelo que a leitura trouxe: sumiu; tem compra (vence o rascunho); está num rascunho; ou perguntar. */
export function deleteStep(facts: DeleteFacts, referenceYear?: number): DeleteStep {
  if (!facts.product) return { kind: 'gone', title: DELETE_GONE_TITLE, message: PRODUCT_NOT_IN_HOUSE };
  if (facts.purchased) return { kind: 'refuse', reason: 'purchased', title: DELETE_PURCHASED_TITLE, message: DELETE_PURCHASED };
  if (facts.review) {
    return {
      kind: 'refuse',
      reason: 'inReview',
      title: DELETE_IN_REVIEW_TITLE,
      message: deleteInReviewMessage(facts.review, referenceYear),
      receiptId: facts.review.receiptId,
    };
  }
  const { name } = facts.product;
  return { kind: 'ask', name, title: DELETE_TITLE, message: deleteQuestion(name, facts), confirmLabel: DELETE_CONFIRM };
}

/**
 * O produto que dá para excluir agora, pela leitura (fetchDeleteFacts): a leitura o achou, e nenhuma linha de nota
 * aponta para ele, nem confirmada, nem em revisão. É quando o toque de excluir perguntaria (deleteStep 'ask'); null em
 * todos os outros casos. Serve à oferta de "Trocar produto" na nota confirmada, que só aparece com isto.
 */
export function deletableProduct(facts: DeleteFacts): { id: string; name: string } | null {
  return deleteStep(facts).kind === 'ask' ? facts.product : null;
}

/**
 * A tela do produto quando o id não está no catálogo que ela tem: buscando, espera; com uma busca desta visita que
 * deu certo sem ele, o produto não está na casa; sem ela (sem internet, ou a busca falhou), não deu para conferir.
 */
export function missingProductView(state: { fetching: boolean; checked: boolean }): 'loading' | 'gone' | 'unchecked' {
  if (state.fetching) return 'loading';
  return state.checked ? 'gone' : 'unchecked';
}

const codeOf = (error: unknown) => (error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined);

/** delete_product, ou um delete direto, recusou porque uma linha de nota confirmada aponta para o produto: só pelo código (NK016). */
export function isProductPurchased(error: unknown): boolean {
  return codeOf(error) === 'NK016';
}

/** Recusou porque só uma linha de rascunho aponta para ele (NK017). */
export function isProductInReview(error: unknown): boolean {
  return codeOf(error) === 'NK017';
}
