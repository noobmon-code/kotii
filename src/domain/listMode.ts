// A tela da lista mistura dois momentos: montar a lista (em casa, pondo o que falta) e fazer a compra (no mercado,
// marcando o que vai para o carrinho). Puro: o que a tela mostra em cada um, e os textos disso.
//
// "Modo compra": com item no carrinho ou com a ida ao mercado da própria pessoa nesta lista, o que é para montar a
// lista sai da frente, e a lista sobe. O cartão de pôr item recolhe ao campo de texto (ainda dá para pôr o que
// faltou), e "Acho que acabou" e "Comprados recentemente" somem. Os itens comuns, colar a lista e o código de barras
// continuam a um toque, em "Mais opções" (o botão ao lado do campo): no mercado também se lê o código de um produto
// da gôndola, e quem está em casa enquanto outra pessoa compra (o carrinho é da lista, em tempo real) ainda monta a
// lista. Tocar no campo não abre o cartão inteiro: com o teclado aberto, ele empurraria a lista para baixo
// justamente na hora de digitar um item rápido.
//
// A quantidade não tem campo: ela vem do que a pessoa digita ("2 kg arroz", "leite x2"), lida pela mesma leitura do
// "Colar lista" (domain/listPaste, readListLine). Sem quantidade na linha, 1 un, como sempre; depois de posto, a
// quantidade muda nos detalhes do item.

import type { Unit } from '@/lib/types';

import { formatQuantity } from './money';

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

/**
 * O cartão de pôr item: nenhum (arquivada), só o campo (modo compra) ou inteiro (o campo e, com ele vazio, os itens
 * comuns, colar a lista e o código de barras). O que vai junto do item (a quantidade) está no próprio texto do
 * campo, que fica nos dois jeitos: recolher ou abrir o cartão não muda o que entra.
 */
export type AddCardShape = 'nenhum' | 'campo' | 'inteiro';

/** `expanded`: a pessoa tocou em "Mais opções" no modo compra (ao entrar e ao sair do modo compra, recolhe). */
export function addCardShape(mode: ListMode, expanded: boolean): AddCardShape {
  if (mode === 'ver') return 'nenhum';
  return mode === 'compra' && !expanded ? 'campo' : 'inteiro';
}

/**
 * O campo de pôr item, sem o campo da quantidade ao lado: o exemplo diz que ela vai no próprio texto. Cabe inteiro
 * num celular de 360 também no modo compra, com o botão "Mais opções" ao lado. Sem rótulo à parte: é ele que o
 * leitor de tela lê.
 */
export const ADD_FIELD_PLACEHOLDER = 'Adicionar (ex.: 2 kg arroz)';

/** A quantidade de sempre, quando a linha não diz outra: 1 un. */
export function isUsualAmount(quantity: number, unit: Unit): boolean {
  return quantity === 1 && unit === 'un';
}

/**
 * O botão de pôr o que foi digitado: diz o que vai entrar, o nome lido e, quando não é a de sempre, a quantidade
 * ('Adicionar "Arroz" · 2 kg'). `label` é o que o leitor de tela diz, sem as aspas e o ponto do meio.
 */
export function addLineButton(line: { name: string; quantity: number; unit: Unit }): { title: string; label: string } {
  const amount = isUsualAmount(line.quantity, line.unit) ? null : formatQuantity(line.quantity, line.unit);
  return {
    title: `Adicionar "${line.name}"${amount ? ` · ${amount}` : ''}`,
    label: `Adicionar ${line.name}${amount ? `, ${amount}` : ''}`,
  };
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

/**
 * O texto da lista vazia em cada momento. `desktop`: no computador (ui/desktop) a lista vazia fica na coluna dos
 * itens, e o campo de pôr item, na coluna ao lado, e não acima dela.
 */
export function emptyListMessage(mode: ListMode, desktop = false): string {
  if (mode === 'ver') return 'Esta lista ficou sem itens.';
  if (mode === 'compra') return desktop ? 'Digite no campo ao lado o que faltou.' : 'Digite no campo acima o que faltou.';
  return 'Digite um item ou escolha do catálogo de itens comuns da casa.';
}

/**
 * "Mais opções", o botão ao lado do campo: só no modo compra e com o campo vazio. O que ele abre (os itens comuns,
 * colar a lista e o código de barras) fica embaixo do campo vazio; com o texto, o botão de pôr toma esse lugar, e o
 * botão aberto não mostraria nada (o leitor de tela diria "expandido" sem nada novo na tela). Ele sai sem mexer no
 * campo, o primeiro filho da linha, então o teclado e o texto ficam.
 */
export function showsAddOptionsButton(mode: ListMode, typing: boolean): boolean {
  return mode === 'compra' && !typing;
}

/**
 * O botão ao lado do campo, no modo compra: o leitor de tela diz o que ele abre e se está aberto. O código de barras
 * só quando a casa tem como lê-lo.
 */
export function addOptionsLabel(barcode: boolean): string {
  return barcode ? 'Mais opções: itens comuns, colar lista e código de barras' : 'Mais opções: itens comuns e colar lista';
}

/**
 * O botão do código de barras, na linha do "Colar lista": o título curto cabe ao lado dele num celular de 360; o
 * leitor de tela diz a ação inteira.
 */
export const BARCODE_BUTTON = { title: 'Código de barras', label: 'Ler código de barras' } as const;

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
