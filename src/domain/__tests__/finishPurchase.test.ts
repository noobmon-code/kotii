import { describe, expect, it } from '@jest/globals';

import {
  afterReceipt,
  asksEndTrip,
  END_TRIP_ASK_MS,
  endTripTitle,
  finishStart,
  listFooter,
  receiptSavedText,
  type ConfirmedReceipt,
} from '../finishPurchase';

describe('listFooter: o rodapé da lista pelo contexto', () => {
  const footer = (pending: number, inCart: number, kind: 'mercado' | 'farmacia' | 'outros' = 'mercado', archived = false) =>
    listFooter({ pending, inCart, kind, archived });

  it('com o carrinho vazio e algo para comprar, "Onde comprar mais barato?", como antes', () => {
    expect(footer(3, 0)).toBe('whereToBuy');
    expect(footer(3, 0, 'farmacia')).toBe('whereToBuy');
  });

  it('com item no carrinho, "Finalizar compra" (também com tudo no carrinho)', () => {
    expect(footer(3, 1)).toBe('finish');
    expect(footer(0, 2)).toBe('finish');
  });

  it('a lista "outros" não compara mercados, mas finaliza a compra', () => {
    expect(footer(3, 0, 'outros')).toBeNull();
    expect(footer(3, 1, 'outros')).toBe('finish');
  });

  it('a lista arquivada é só para ver: nunca "Finalizar compra"; o "Onde comprar" fica como antes', () => {
    expect(footer(0, 2, 'mercado', true)).toBeNull();
    expect(footer(3, 2, 'mercado', true)).toBe('whereToBuy');
  });

  it('lista vazia: nada no rodapé', () => {
    expect(footer(0, 0)).toBeNull();
  });
});

describe('finishStart: o toque em "Finalizar compra"', () => {
  it('com internet pergunta da nota; sem, segue para o "Limpar" (a nota fica para depois)', () => {
    expect(finishStart(true)).toBe('askReceipt');
    expect(finishStart(false)).toBe('clearOffline');
  });
});

describe('asksEndTrip: as regras de quando perguntar de encerrar a ida', () => {
  it('o toque com internet e a resposta em até 30 s', () => {
    expect(asksEndTrip({ onlineAtTap: true, tappedAt: 1000, answeredAt: 1000 + END_TRIP_ASK_MS - 1 })).toBe(true);
    expect(asksEndTrip({ onlineAtTap: true, tappedAt: 1000, answeredAt: 1000 + END_TRIP_ASK_MS })).toBe(false);
    expect(asksEndTrip({ onlineAtTap: false, tappedAt: 1000, answeredAt: 1500 })).toBe(false);
  });
});

describe('textos', () => {
  it('endTripTitle: "ao mercado" na lista de mercado, "às compras" nas outras', () => {
    expect(endTripTitle('mercado')).toBe('Encerrar a ida ao mercado?');
    expect(endTripTitle('farmacia')).toBe('Encerrar a ida às compras?');
    expect(endTripTitle('outros')).toBe('Encerrar a ida às compras?');
  });

  it('receiptSavedText: o que a nota fez, no singular e no plural; nada, undefined', () => {
    expect(receiptSavedText(1, 1)).toBe('1 item foi para a despensa. 1 item saiu da lista.');
    expect(receiptSavedText(3, 0)).toBe('3 itens foram para a despensa.');
    expect(receiptSavedText(0, 2)).toBe('2 itens saíram da lista.');
    expect(receiptSavedText(0, 0)).toBeUndefined();
  });
});

describe('afterReceipt: a lista de volta, com a nota confirmada no fluxo', () => {
  const NOW = 1_800_000_000_000;
  const receipt = (patch: Partial<ConfirmedReceipt> = {}): ConfirmedReceipt => ({
    tappedAt: NOW - 3000,
    confirmedAt: NOW - 1000,
    onlineAtTap: true,
    pantryCount: 2,
    removedListItems: ['leite', 'cafe'],
    ...patch,
  });
  const ctx = (patch: Partial<Parameters<typeof afterReceipt>[1]> = {}) => ({
    cart: ['leite', 'cafe'],
    trip: null,
    online: true,
    now: NOW,
    ...patch,
  });
  const TAIL = 'Ao encerrar, a casa deixa de ver o aviso de que você está nas compras.';

  it('sem ida: o "Nota salva" com o que a nota fez', () => {
    expect(afterReceipt(receipt(), ctx())).toEqual({
      kind: 'saved',
      title: 'Nota salva',
      message: '2 itens foram para a despensa. 2 itens saíram da lista.',
    });
  });

  it('nada a dizer: o "Nota salva" sem texto, como na revisão', () => {
    expect(afterReceipt(receipt({ pantryCount: 0, removedListItems: [] }), ctx({ cart: [] }))).toEqual({
      kind: 'saved',
      title: 'Nota salva',
      message: undefined,
    });
  });

  it('o que ficou no carrinho é o carrinho de agora menos o que a nota tirou (a busca nova pode não ter chegado)', () => {
    const one = afterReceipt(receipt({ removedListItems: ['leite'] }), ctx({ cart: ['leite', 'cafe'] }));
    expect(one.message).toBe(
      '2 itens foram para a despensa. 1 item saiu da lista. Ficou 1 item no carrinho que a nota não tirou da lista. Se não comprou, toque nele para devolver à lista; se comprou, use "Limpar".',
    );
    // A busca nova já chegou: o leite saiu do carrinho; o café e o arroz (posto agora por outra pessoa) ficaram.
    const two = afterReceipt(receipt({ removedListItems: ['leite'] }), ctx({ cart: ['cafe', 'arroz'] }));
    expect(two.message).toContain('Ficaram 2 itens no carrinho que a nota não tirou da lista. Se não comprou, toque neles');
    // A nota tirou itens de outra lista também: contam no "saíram da lista", e não no carrinho desta.
    const other = afterReceipt(receipt({ removedListItems: ['leite', 'cafe', 'de-outra-lista'] }), ctx());
    expect(other.message).toBe('2 itens foram para a despensa. 3 itens saíram da lista.');
  });

  it('com a ida da pessoa nesta lista: a pergunta de encerrar, com o que a nota fez e o que ficou', () => {
    expect(afterReceipt(receipt({ removedListItems: ['leite'] }), ctx({ trip: { kind: 'mercado' } }))).toEqual({
      kind: 'endTrip',
      title: 'Encerrar a ida ao mercado?',
      message: `A nota foi salva. 2 itens foram para a despensa. 1 item saiu da lista. Ficou 1 item no carrinho que a nota não tirou da lista. Se não comprou, toque nele para devolver à lista; se comprou, use "Limpar". ${TAIL}`,
    });
    expect(afterReceipt(receipt({ pantryCount: 0, removedListItems: [] }), ctx({ cart: [], trip: { kind: 'farmacia' } }))).toEqual({
      kind: 'endTrip',
      title: 'Encerrar a ida às compras?',
      message: `A nota foi salva. ${TAIL}`,
    });
  });

  it('as mesmas regras do "Limpar": sem internet no toque, ou com a resposta depois de 30 s, não pergunta', () => {
    const trip = { kind: 'mercado' as const };
    expect(afterReceipt(receipt({ onlineAtTap: false }), ctx({ trip })).kind).toBe('saved');
    expect(afterReceipt(receipt({ tappedAt: NOW - END_TRIP_ASK_MS - 5000, confirmedAt: NOW - 4000 }), ctx({ trip })).kind).toBe('saved');
  });

  it('sem internet agora (encerrar é um pedido ao servidor), ou voltando muito depois da confirmação, não pergunta', () => {
    const trip = { kind: 'mercado' as const };
    expect(afterReceipt(receipt(), ctx({ trip, online: false })).kind).toBe('saved');
    expect(afterReceipt(receipt({ tappedAt: NOW - END_TRIP_ASK_MS - 2000, confirmedAt: NOW - END_TRIP_ASK_MS }), ctx({ trip })).kind).toBe('saved');
  });
});
