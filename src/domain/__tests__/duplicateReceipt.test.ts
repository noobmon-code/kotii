import { describe, expect, it } from '@jest/globals';

import { duplicateReceiptNotice, findDuplicateReceipt, type ReceiptFingerprint } from '../duplicateReceipt';

const draft: ReceiptFingerprint = {
  id: 'draft',
  storeId: 's1',
  storeCnpj: '12345678000199',
  storeName: 'Assaí',
  // 10/06 às 21h em São Paulo.
  purchasedAt: '2026-06-11T00:00:00.000Z',
  total: 62.9,
};
const confirmed = (patch: Partial<ReceiptFingerprint>): ReceiptFingerprint => ({ ...draft, id: 'c1', purchasedAt: '2026-06-10T15:00:00.000Z', ...patch });

describe('nota repetida', () => {
  it('mesmo mercado, mesmo dia de São Paulo e mesmo total: é ela', () => {
    expect(findDuplicateReceipt(draft, [confirmed({})])?.id).toBe('c1');
  });

  it('o dia é o de São Paulo, perto da meia-noite', () => {
    // 23h50 de 10/06 em São Paulo (já 11/06 no UTC): mesmo dia do rascunho.
    expect(findDuplicateReceipt(draft, [confirmed({ purchasedAt: '2026-06-11T02:50:00.000Z' })])?.id).toBe('c1');
    // 00h10 de 11/06 em São Paulo: outro dia.
    expect(findDuplicateReceipt(draft, [confirmed({ purchasedAt: '2026-06-11T03:10:00.000Z' })])).toBeNull();
    // 23h de 09/06 em São Paulo (10/06 no UTC): outro dia.
    expect(findDuplicateReceipt(draft, [confirmed({ purchasedAt: '2026-06-10T02:00:00.000Z' })])).toBeNull();
  });

  it('o total pode diferir até 5 centavos', () => {
    expect(findDuplicateReceipt(draft, [confirmed({ total: 62.95 })])?.id).toBe('c1');
    expect(findDuplicateReceipt(draft, [confirmed({ total: 62.85 })])?.id).toBe('c1');
    expect(findDuplicateReceipt(draft, [confirmed({ total: 62.96 })])).toBeNull();
  });

  it('sem total de um dos lados, não há como dizer', () => {
    expect(findDuplicateReceipt({ ...draft, total: null }, [confirmed({})])).toBeNull();
    expect(findDuplicateReceipt(draft, [confirmed({ total: null })])).toBeNull();
  });

  it('o mesmo CNPJ em outra loja da casa conta; sem CNPJ, só o mesmo mercado', () => {
    expect(findDuplicateReceipt(draft, [confirmed({ storeId: 's2' })])?.id).toBe('c1');
    const noCnpj = { ...draft, storeCnpj: null };
    expect(findDuplicateReceipt(noCnpj, [confirmed({ storeId: 's2', storeCnpj: null })])).toBeNull();
    expect(findDuplicateReceipt(noCnpj, [confirmed({ storeCnpj: null })])?.id).toBe('c1');
    expect(findDuplicateReceipt(draft, [confirmed({ storeId: 's2', storeCnpj: '99999999000199' })])).toBeNull();
  });

  it('sem mercado no rascunho, nenhuma', () => {
    expect(findDuplicateReceipt({ ...draft, storeId: null, storeCnpj: null }, [confirmed({ storeId: null, storeCnpj: null })])).toBeNull();
  });

  it('a própria nota não conta; de várias, a de horário mais perto', () => {
    expect(findDuplicateReceipt(draft, [{ ...draft }])).toBeNull();
    const far = confirmed({ id: 'longe', purchasedAt: '2026-06-10T12:00:00.000Z' });
    const near = confirmed({ id: 'perto', purchasedAt: '2026-06-10T23:00:00.000Z' });
    expect(findDuplicateReceipt(draft, [far, near])?.id).toBe('perto');
  });

  it('o aviso diz o mercado, o dia de São Paulo e o total', () => {
    expect(duplicateReceiptNotice(confirmed({ purchasedAt: '2026-06-11T02:50:00.000Z' }))).toBe(
      `Parece que esta compra já foi registrada: Assaí, 10/06/2026, R$${String.fromCodePoint(32)}62,90.`,
    );
  });
});
