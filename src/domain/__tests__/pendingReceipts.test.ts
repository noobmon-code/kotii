import { describe, expect, it } from '@jest/globals';

import { accessKeyCheckDigit } from '../nfce';
import {
  MAX_PENDING_RECEIPTS,
  parsePendingReceipts,
  pendingOfHousehold,
  pendingReceiptCnpj,
  pendingReceiptSubtitle,
  type PendingReceipt,
  sefazLink,
  withoutPendingReceipt,
  withPendingReceipt,
} from '../pendingReceipts';

// PB (25), out/2026, CNPJ 12.345.678/0001-99, modelo 65; `n` muda o número da nota.
const key = (n: number) => {
  const body = '25' + '2610' + '12345678000199' + '65' + '001' + String(n).padStart(9, '0') + '1' + '12345678';
  return body + accessKeyCheckDigit(body);
};
const URL_PB = (k: string) => `http://www.sefaz.pb.gov.br/nfce?p=${k}|2|1|1|ABCDEF`;
const pending = (n: number, over: Partial<PendingReceipt> = {}): PendingReceipt => ({
  accessKey: key(n),
  url: URL_PB(key(n)),
  householdId: 'h1',
  savedAt: `2026-10-${String(10 + (n % 10)).padStart(2, '0')}T12:00:00.000Z`,
  ...over,
});

describe('notas pendentes guardadas no aparelho', () => {
  it('lê o que foi gravado e deixa de fora o que não é uma pendente válida', () => {
    const good = pending(1);
    const raw = JSON.stringify([good, { ...good, accessKey: '123' }, { ...good, householdId: '' }, { ...good, savedAt: 'ontem' }, null, 'x']);
    expect(parsePendingReceipts(raw)).toEqual([good]);
    expect(parsePendingReceipts('{corrompido')).toEqual([]);
    expect(parsePendingReceipts('{"a":1}')).toEqual([]);
    expect(parsePendingReceipts(null)).toEqual([]);
  });

  it('a mesma chave na mesma casa não vira outra pendente: fica a de antes, e a mais nova vem primeiro', () => {
    const first = pending(1);
    const list = withPendingReceipt([], first);
    const again = withPendingReceipt(list, { ...first, savedAt: '2026-10-19T12:00:00.000Z' });
    expect(again).toEqual([first]);
    // Lida pela chave digitada (sem link) depois: o link que ela tinha fica.
    expect(withPendingReceipt(list, { ...first, url: null })).toEqual([first]);
    // Sem link antes, o de agora entra.
    expect(withPendingReceipt([{ ...first, url: null }], first)).toEqual([first]);
    // Outra nota, ou a mesma em outra casa, é outra pendente.
    const two = withPendingReceipt(again, pending(2));
    expect(two.map((p) => p.accessKey)).toEqual([key(2), key(1)]);
    expect(withPendingReceipt(two, pending(1, { householdId: 'h2' }))).toHaveLength(3);
  });

  it('guarda até MAX_PENDING_RECEIPTS: a mais antiga sai', () => {
    let list: PendingReceipt[] = [];
    for (let n = 1; n <= MAX_PENDING_RECEIPTS + 2; n++) list = withPendingReceipt(list, pending(n));
    expect(list).toHaveLength(MAX_PENDING_RECEIPTS);
    expect(list.some((p) => p.accessKey === key(1) || p.accessKey === key(2))).toBe(false);
  });

  it('descartar tira só a daquela chave e daquela casa', () => {
    const list = [pending(1), pending(2), pending(1, { householdId: 'h2' })];
    expect(withoutPendingReceipt(list, 'h1', key(1))).toEqual([pending(2), pending(1, { householdId: 'h2' })]);
  });

  it('a casa aberta vê só as dela, da mais nova para a mais antiga, menos as que já viraram nota', () => {
    const list = [pending(1), pending(3), pending(2, { householdId: 'h2' })];
    expect(pendingOfHousehold(list, 'h1').map((p) => p.accessKey)).toEqual([key(3), key(1)]);
    expect(pendingOfHousehold(list, 'h1', new Set([key(3)])).map((p) => p.accessKey)).toEqual([key(1)]);
    expect(pendingOfHousehold(list, undefined)).toEqual([]);
  });
});

describe('o que a pendente mostra', () => {
  it('abre a Sefaz só pelo link do QR num endereço do governo', () => {
    expect(sefazLink(URL_PB(key(1)))).toContain('www.sefaz.pb.gov.br/nfce');
    expect(sefazLink('https://www4.sefaz.pb.gov.br/atf/seg/SEGf_AcessarFuncao.jsp?cdFuncao=FIS_1410')).not.toBeNull();
    expect(sefazLink('https://sefaz.pb.gov.br.golpe.com/nfce')).toBeNull();
    expect(sefazLink('https://gov.br.example.com/?p=1')).toBeNull();
    expect(sefazLink('javascript:alert(1)//.gov.br')).toBeNull();
    expect(sefazLink('não é link')).toBeNull();
    expect(sefazLink(null)).toBeNull();
  });

  it('o mês da compra e o CNPJ vêm da chave', () => {
    expect(pendingReceiptSubtitle(key(1))).toBe('Compra de outubro de 2026');
    expect(pendingReceiptCnpj(key(1))).toBe('12345678000199');
  });
});
