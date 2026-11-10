// "Finalizar compra", na lista: o botão do rodapé, o caminho do toque e o que a lista diz quando volta da nota.
// Puro: quem abre o leitor e guarda a espera da nota é features/FinishPurchase (com lib/finishPurchase).
//
// A nota vem antes de limpar, porque a revisão usa o carrinho: um item da lista só sai marcado sozinho na nota
// quando está no carrinho (`checked_at`, domain/listLinks), e limpar antes apagaria os itens com que ela casa.
// Confirmar a nota já põe as compras na despensa (guardar pelo carrinho antes faria a revisão perguntar o que é
// repetido) e liga o nome da lista ao produto (`list_item_links`). Sem a nota, o caminho é o "Limpar" de sempre.

import type { ListKind } from '@/lib/types';

/** Até quanto tempo depois do toque a resposta ainda traz a pergunta de encerrar a ida (no limpar e na nota). */
export const END_TRIP_ASK_MS = 30_000;

export const FINISH_LABEL = 'Finalizar compra';

/** A pergunta do toque em "Finalizar compra": as opções do leitor de nota e o caminho sem ela. */
export const FINISH_SHEET = {
  title: FINISH_LABEL,
  message:
    'Com a nota fiscal, a revisão tira da lista o que você comprou e guarda as compras na despensa. Sem ela, o carrinho é limpo como no "Limpar".',
  withoutReceipt: 'Sem a nota: só limpar o carrinho',
};

/** Sem internet, a nota fica para depois: o aviso vai no "Limpar o carrinho", que segue no lugar dela. */
export const FINISH_OFFLINE_NOTICE =
  'Sem internet agora, a nota fica para depois: dá para lê-la em Compras → Notas quando a conexão voltar. Se for ler a nota, limpe sem guardar na despensa, porque ela guarda.';

/** "Tudo no carrinho!": o que fazer agora (o botão vem logo abaixo, e também no rodapé). */
export const ALL_IN_CART_MESSAGE = 'Toque em "Finalizar compra" para ler a nota: ela tira da lista o que você comprou e guarda na despensa.';

/** A pergunta de encerrar a ida depois de limpar pelo "Finalizar compra" sem a nota. */
export const END_TRIP_AFTER_CLEAR = 'O carrinho foi limpo. Ao encerrar, a casa deixa de ver o aviso de que você está nas compras.';
const END_TRIP_TAIL = 'Ao encerrar, a casa deixa de ver o aviso de que você está nas compras.';

/** "Encerrar a ida ao mercado?" na lista de mercado; nas outras, "às compras". */
export function endTripTitle(kind: ListKind): string {
  return `Encerrar a ida ${kind === 'mercado' ? 'ao mercado' : 'às compras'}?`;
}

/** O que a lista mostra o que fazer, no rodapé. */
export type ListFooter = 'finish' | 'whereToBuy' | null;

/**
 * O rodapé da lista, pelo contexto: com item no carrinho, "Finalizar compra" (também no "Tudo no carrinho!"); com o
 * carrinho vazio e algo para comprar, "Onde comprar mais barato?", como antes (não nas listas "outros", que não
 * comparam mercados). A lista arquivada é só para ver: nela não se finaliza a compra.
 */
export function listFooter({
  pending,
  inCart,
  kind,
  archived,
}: {
  pending: number;
  inCart: number;
  kind: ListKind;
  archived: boolean;
}): ListFooter {
  if (inCart > 0 && !archived) return 'finish';
  if (pending > 0 && kind !== 'outros') return 'whereToBuy';
  return null;
}

/**
 * O toque em "Finalizar compra": com internet, a pergunta da nota (o leitor ou o "Limpar"); sem, a nota fica para
 * depois e o fluxo segue como o "Limpar", com o aviso. Ler a nota (a Sefaz, a IA, o rascunho no banco) precisa
 * de internet; limpar, não (vai pela fila da lista).
 */
export function finishStart(online: boolean): 'askReceipt' | 'clearOffline' {
  return online ? 'askReceipt' : 'clearOffline';
}

/**
 * A pergunta de encerrar a ida vem só se o toque (o limpar do fluxo, ou o "Confirmar nota") foi com internet e a
 * resposta chegou em até 30 s. Sem internet o pedido espera, e a resposta que chegasse com a conexão de volta, ou
 * muito depois, faria a pergunta aparecer do nada.
 */
export function asksEndTrip({ onlineAtTap, tappedAt, answeredAt }: { onlineAtTap: boolean; tappedAt: number; answeredAt: number }): boolean {
  return onlineAtTap && answeredAt - tappedAt < END_TRIP_ASK_MS;
}

/**
 * Depois de limpar o carrinho, a pergunta de encerrar a ida só vem no fim do "Finalizar compra" (o caminho sem a
 * nota, escolhido ou sem internet): ela passou do "Limpar" para o fim desse fluxo. O "Limpar" da seção "No carrinho"
 * é para quem só quer esvaziar, e guardar um item pela geladeira não encerra nada. Com as regras do toque de sempre
 * (`asksEndTrip`).
 */
export function asksEndTripAfterClear({
  finishing,
  ...tap
}: {
  /** O limpar veio do "Finalizar compra". */
  finishing: boolean;
  onlineAtTap: boolean;
  tappedAt: number;
  answeredAt: number;
}): boolean {
  return finishing && asksEndTrip(tap);
}

/** "Nota salva": quantos itens foram para a despensa e quantos saíram da lista (nada a dizer: undefined). */
export function receiptSavedText(pantryCount: number, listCount: number): string | undefined {
  const done = [
    pantryCount ? `${pantryCount} ${pantryCount === 1 ? 'item foi' : 'itens foram'} para a despensa.` : null,
    listCount ? `${listCount} ${listCount === 1 ? 'item saiu' : 'itens saíram'} da lista.` : null,
  ].filter(Boolean);
  return done.length ? done.join(' ') : undefined;
}

/** A nota que a revisão confirmou no meio do fluxo, entregue à lista (lib/finishPurchase). */
export interface ConfirmedReceipt {
  /** O toque em "Confirmar nota" e a resposta do servidor (relógio do aparelho, ms). */
  tappedAt: number;
  confirmedAt: number;
  /** Com internet no toque. */
  onlineAtTap: boolean;
  /** Quantos itens a nota pôs na despensa. */
  pantryCount: number;
  /** Os itens de lista que a confirmação tirou (de qualquer lista aberta da casa). */
  removedListItems: readonly string[];
}

/**
 * De volta à lista: a pergunta de encerrar a ida (com o que a nota fez) ou só o "Nota salva". `cartEmpty`: a nota
 * tirou tudo do carrinho, e as compras acabaram como no "Limpar" do carrinho todo (o mercado de "Onde estou" não
 * vale para a próxima).
 */
export type AfterReceipt = ({ kind: 'endTrip'; title: string; message: string } | { kind: 'saved'; title: string; message: string | undefined }) & {
  cartEmpty: boolean;
};

/** O que ficou no carrinho que a nota não tirou da lista: comprado e não casado, ou não comprado. */
function leftInCartText(count: number): string | null {
  if (!count) return null;
  return count === 1
    ? 'Ficou 1 item no carrinho que a nota não tirou da lista. Se não comprou, toque nele para devolver à lista; se comprou, use "Limpar".'
    : `Ficaram ${count} itens no carrinho que a nota não tirou da lista. Se não comprou, toque neles para devolver à lista; se comprou, use "Limpar".`;
}

/**
 * A lista de volta ao foco, com a nota confirmada no fluxo. O que ficou no carrinho é o carrinho de agora menos o
 * que a nota tirou (a busca nova da lista pode ainda não ter chegado), e continua lá para a pessoa limpar ou
 * devolver. A pergunta de encerrar a ida vem uma vez, aqui, no fim do fluxo, e só com a ida da própria pessoa
 * nesta lista (`trip`), com internet agora e com as mesmas regras do limpar para o toque de confirmar
 * (`asksEndTrip`); a volta à lista também tem de vir logo, senão a pergunta apareceria do nada. Sem ela, o
 * "Nota salva" de sempre, que a revisão deixou para a lista dizer. A nota que deixa o carrinho vazio encerra as
 * compras (`cartEmpty`); com algo ainda no carrinho, a pessoa pode estar no mercado.
 */
export function afterReceipt(
  receipt: ConfirmedReceipt,
  { cart, trip, online, now }: { cart: readonly string[]; trip: { kind: ListKind } | null; online: boolean; now: number },
): AfterReceipt {
  const removed = new Set(receipt.removedListItems);
  const leftCount = cart.filter((id) => !removed.has(id)).length;
  const left = leftInCartText(leftCount);
  const cartEmpty = leftCount === 0;
  const saved = receiptSavedText(receipt.pantryCount, receipt.removedListItems.length);
  const ask =
    trip !== null &&
    online &&
    asksEndTrip({ onlineAtTap: receipt.onlineAtTap, tappedAt: receipt.tappedAt, answeredAt: receipt.confirmedAt }) &&
    now - receipt.confirmedAt < END_TRIP_ASK_MS;
  if (ask) {
    return {
      kind: 'endTrip',
      title: endTripTitle(trip.kind),
      message: ['A nota foi salva.', saved, left, END_TRIP_TAIL].filter(Boolean).join(' '),
      cartEmpty,
    };
  }
  const message = [saved, left].filter(Boolean).join(' ');
  return { kind: 'saved', title: 'Nota salva', message: message || undefined, cartEmpty };
}
