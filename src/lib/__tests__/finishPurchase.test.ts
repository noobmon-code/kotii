import { beforeEach, describe, expect, it } from '@jest/globals';

import { handConfirmedReceipt, stopWaitingForReceipt, takeConfirmedReceipt, waitForReceipt } from '../finishPurchase';

// A espera da nota do "Finalizar compra": a lista que abriu o leitor recebe a nota que a revisão confirmou nesse meio.

const done = (tappedAt: number) => ({ tappedAt, onlineAtTap: true, pantryCount: 1, removedListItems: ['leite'] });

beforeEach(() => {
  stopWaitingForReceipt('l1');
  stopWaitingForReceipt('l2');
});

describe('a espera da nota', () => {
  it('a nota confirmada com a lista esperando fica para ela, uma vez', () => {
    waitForReceipt('l1', 1000);
    expect(handConfirmedReceipt(done(2000), 3000)).toBe(true);
    expect(takeConfirmedReceipt('l1')).toEqual({ ...done(2000), confirmedAt: 3000 });
    // Acabou: voltar de novo à lista não traz a nota outra vez, e a próxima confirmação avisa sozinha.
    expect(takeConfirmedReceipt('l1')).toBeNull();
    expect(handConfirmedReceipt(done(4000), 5000)).toBe(false);
  });

  it('sem lista esperando, a revisão avisa sozinha', () => {
    expect(handConfirmedReceipt(done(2000), 3000)).toBe(false);
  });

  it('a lista voltou ao foco sem a nota (a pessoa desistiu): a espera acaba', () => {
    waitForReceipt('l1', 1000);
    expect(takeConfirmedReceipt('l1')).toBeNull();
    expect(handConfirmedReceipt(done(2000), 3000)).toBe(false);
  });

  it('o toque de confirmar de antes de a lista abrir o leitor não é desta compra', () => {
    waitForReceipt('l1', 5000);
    expect(handConfirmedReceipt(done(4000), 6000)).toBe(false);
    expect(takeConfirmedReceipt('l1')).toBeNull();
  });

  it('o foco de outra lista não acaba a espera desta; desistir ou sair da tela, sim', () => {
    waitForReceipt('l1', 1000);
    expect(takeConfirmedReceipt('l2')).toBeNull();
    stopWaitingForReceipt('l2');
    expect(handConfirmedReceipt(done(2000), 3000)).toBe(true);
    stopWaitingForReceipt('l1');
    expect(takeConfirmedReceipt('l1')).toBeNull();
  });

  it('ler de novo recomeça a espera', () => {
    waitForReceipt('l1', 1000);
    waitForReceipt('l1', 8000);
    expect(handConfirmedReceipt(done(2000), 3000)).toBe(false);
    expect(handConfirmedReceipt(done(9000), 9500)).toBe(true);
  });
});
