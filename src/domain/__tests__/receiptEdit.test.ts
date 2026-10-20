import { describe, expect, it } from '@jest/globals';

import { confirmedEditNote, purchaseDateChange, receiptEditing, receiptTotalChange } from '../receiptEdit';

describe('o que a nota deixa corrigir', () => {
  it('na revisão, tudo', () => {
    expect(receiptEditing('draft')).toEqual({ store: true, date: true, total: true, payer: true, items: 'all', addItem: true });
  });

  it('confirmada: mercado, data, total e quem pagou; dos itens, só o valor do que ficou sem, e nada de item novo', () => {
    expect(receiptEditing('confirmed')).toEqual({ store: true, date: true, total: true, payer: true, items: 'missingValue', addItem: false });
  });
});

describe('a frase da nota confirmada', () => {
  it('nota lida pelo app (QR code ou foto): vale para a casa, e os preços já dados a outras casas não mudam', () => {
    const read = 'O que você corrigir aqui vale para a casa: gastos, Mercado do mês e histórico de preço. Os preços que esta nota já deu para outras casas não mudam.';
    expect(confirmedEditNote('qrcode')).toBe(read);
    expect(confirmedEditNote('ai')).toBe(read);
  });

  it('nota digitada à mão nunca deu preço para fora: a frase não fala disso', () => {
    expect(confirmedEditNote('manual')).toBe('O que você corrigir aqui vale para a casa: gastos, Mercado do mês e histórico de preço.');
  });
});

describe('a data digitada', () => {
  it('outro dia: vai como meio-dia local, para não virar o dia ao passar para UTC', () => {
    expect(purchaseDateChange('11/06/2026', '2026-06-10')).toEqual({ kind: 'changed', purchasedAt: new Date('2026-06-11T12:00:00').toISOString() });
    expect(purchaseDateChange('1/7/26', '2026-06-10')).toEqual({ kind: 'changed', purchasedAt: new Date('2026-07-01T12:00:00').toISOString() });
  });

  it('o mesmo dia não grava nada', () => {
    expect(purchaseDateChange('10/06/2026', '2026-06-10')).toEqual({ kind: 'same' });
  });

  it('o que não é data avisa', () => {
    expect(purchaseDateChange('31/02/2026', '2026-06-10')).toEqual({ kind: 'invalid' });
    expect(purchaseDateChange('10/06', '2026-06-10')).toEqual({ kind: 'invalid' });
    expect(purchaseDateChange('', '2026-06-10')).toEqual({ kind: 'invalid' });
  });
});

describe('o total digitado na nota confirmada', () => {
  it('outro valor grava', () => {
    expect(receiptTotalChange('50', 62.9)).toEqual({ kind: 'changed', total: 50 });
    expect(receiptTotalChange('46,38', null)).toEqual({ kind: 'changed', total: 46.38 });
  });

  it('em branco ou zero é "sem total", como na revisão', () => {
    expect(receiptTotalChange('', 62.9)).toEqual({ kind: 'changed', total: null });
    expect(receiptTotalChange('0', 62.9)).toEqual({ kind: 'changed', total: null });
  });

  it('o mesmo valor, ao centavo, não grava nada', () => {
    expect(receiptTotalChange('62,90', 62.9)).toEqual({ kind: 'same' });
    expect(receiptTotalChange('', null)).toEqual({ kind: 'same' });
    expect(receiptTotalChange('', 0)).toEqual({ kind: 'same' });
    expect(receiptTotalChange('0', null)).toEqual({ kind: 'same' });
  });

  it('o que não dá para ler avisa, com a frase da revisão', () => {
    expect(receiptTotalChange('62,9,0', 62.9)).toEqual({ kind: 'invalid', title: 'Confira o total', message: 'Confira o total da nota, ou deixe em branco.' });
  });
});
