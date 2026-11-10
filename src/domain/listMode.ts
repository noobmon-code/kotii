// A tela da lista mistura dois momentos: montar a lista (em casa, pondo o que falta) e fazer a compra (no mercado,
// marcando o que vai para o carrinho). Puro: o que a tela mostra em cada um, e os textos disso.
//
// "Modo compra": com item no carrinho ou com a ida ao mercado da própria pessoa nesta lista, o que é para montar a
// lista sai da frente, e a lista sobe. O cartão de pôr item recolhe ao campo de texto (ainda dá para pôr o que
// faltou), e "Acho que acabou" e "Comprados recentemente" somem. A quantidade, a unidade, os itens comuns, colar a
// lista e o código de barras continuam a um toque, em "Mais opções" (o botão ao lado do campo): no mercado também se
// lê o código de um produto da gôndola, e quem está em casa enquanto outra pessoa compra (o carrinho é da lista,
// em tempo real) ainda monta a lista. Tocar no campo não abre o cartão inteiro: com o teclado aberto, ele empurraria
// a lista para baixo justamente na hora de digitar um item rápido.

import type { Unit } from '@/lib/types';

/** `ver`: a lista arquivada, só para ver; `montar`: pondo o que falta; `compra`: no meio das compras. */
export type ListMode = 'ver' | 'montar' | 'compra';

/**
 * O momento da lista. O carrinho é de quem estiver comprando (de qualquer pessoa da casa); a ida, só a da própria
 * pessoa (a de outra pessoa não muda a tela de quem ficou em casa, que segue montando).
 */
export function listMode({ archived, inCart, ownTrip }: { archived: boolean; inCart: number; ownTrip: boolean }): ListMode {
  if (archived) return 'ver';
  return inCart > 0 || ownTrip ? 'compra' : 'montar';
}

/** O cartão de pôr item: nenhum (arquivada), só o campo (modo compra) ou inteiro. */
export type AddCardShape = 'nenhum' | 'campo' | 'inteiro';

/** `expanded`: a pessoa tocou em "Mais opções" no modo compra. */
export function addCardShape(mode: ListMode, expanded: boolean): AddCardShape {
  if (mode === 'ver') return 'nenhum';
  return mode === 'compra' && !expanded ? 'campo' : 'inteiro';
}

/** A quantidade e a unidade com que o cartão começa (e para onde volta depois de pôr um item). */
export const DEFAULT_AMOUNT: { quantity: string; unit: Unit } = { quantity: '1', unit: 'un' };

/**
 * O modo compra começa com o cartão inteiro quando a pessoa já tinha mudado a quantidade ou a unidade (alguém pôs o
 * primeiro item no carrinho enquanto ela digitava): recolhido, o item sairia com uma quantidade que ela não vê. Com
 * as de sempre, recolhe. Recolher pelo botão volta as duas para as de sempre, pelo mesmo motivo: só o campo na tela
 * é sempre 1 un.
 */
export function startsExpanded(quantity: string, unit: Unit): boolean {
  return quantity.trim() !== DEFAULT_AMOUNT.quantity || unit !== DEFAULT_AMOUNT.unit;
}

/** "Acho que acabou" e "Comprados recentemente": para montar a lista, e não enquanto a pessoa digita um item. */
export function showsSuggestions(mode: ListMode, typing: boolean): boolean {
  return mode === 'montar' && !typing;
}

/**
 * "Lista vazia": sem item nenhum. Montando, só quando também não há o que sugerir (as faixas já mostram por onde
 * começar); arquivada ou no modo compra, as faixas não aparecem, e a lista vazia diz isso.
 */
export function showsEmptyList({ mode, items, suggestions }: { mode: ListMode; items: number; suggestions: number }): boolean {
  if (items > 0) return false;
  return mode !== 'montar' || suggestions === 0;
}

/** O texto da lista vazia em cada momento. */
export function emptyListMessage(mode: ListMode): string {
  if (mode === 'ver') return 'Esta lista ficou sem itens.';
  if (mode === 'compra') return 'Digite no campo acima o que faltou.';
  return 'Digite um item ou escolha do catálogo de itens comuns da casa.';
}

/**
 * O botão ao lado do campo, no modo compra: o leitor de tela diz o que ele abre e se está aberto. O código de barras
 * só quando a casa tem como lê-lo.
 */
export function addOptionsLabel(barcode: boolean): string {
  return `Mais opções: quantidade, unidade, itens comuns, colar lista${barcode ? ' e código de barras' : ''}`;
}

/** O menu do cabeçalho da lista, ao lado da calculadora. */
export const LIST_MENU_LABEL = 'Opções da lista';

export type ListMenuAction = 'rename' | 'archive' | 'reopen';

export const LIST_MENU_LABELS: Record<ListMenuAction, string> = {
  rename: 'Renomear lista',
  archive: 'Arquivar lista',
  reopen: 'Reabrir lista',
};

/**
 * O que o menu oferece: renomear (também a arquivada, como antes) e arquivar; na arquivada, reabrir no lugar de
 * arquivar.
 */
export function listMenuActions(archived: boolean): ListMenuAction[] {
  return ['rename', archived ? 'reopen' : 'archive'];
}
