import { describe, expect, it } from '@jest/globals';

import { nfceReadLines } from '../../../supabase/functions/nfce/readLines';
import { nfceItemsToDraft, nfceReceiptRow, type NfceItem } from '../nfce';

// A função nfce grava no servidor as linhas da nota como o app as põe no rascunho, e o banco só compartilha a linha
// confirmada que bate com uma delas. Se o espelho divergir do app, nenhuma nota do QR code compartilha mais.
const UNITS = ['UN', 'un', 'PCT', 'KG', 'kg ', 'KGS', 'G', 'GR', 'GRS', 'L', 'LT', 'LTS', 'ML', 'CX', ''];

function items(): NfceItem[] {
  const list: NfceItem[] = [];
  UNITS.forEach((unit, i) => {
    list.push({ description: `  ITEM  ${i} 500G `, code: null, quantity: 1 + i / 7, unit, unitPrice: 3.3333 + i, totalPrice: 7.77 + i });
    list.push({ description: `SEM UNITARIO ${i}`, code: null, quantity: 0.333 * (i + 1), unit, unitPrice: 0, totalPrice: 10 / 3 + i });
    list.push({ description: `SEM QUANTIDADE ${i}`, code: null, quantity: 0, unit, unitPrice: 0, totalPrice: 2.5 + i });
  });
  list.push({ description: '   ', code: null, quantity: 1, unit: 'UN', unitPrice: 1, totalPrice: 1 });
  list.push({ description: 'NEGATIVO', code: null, quantity: 1, unit: 'UN', unitPrice: 1, totalPrice: -1 });
  list.push({ description: 'BRINDE', code: null, quantity: 1, unit: 'UN', unitPrice: 0, totalPrice: 0 });
  return list;
}

describe('leitura do QR code gravada no servidor', () => {
  it('tem as mesmas linhas (descrição, unidade e preço unitário) que o rascunho do app', () => {
    const draft = nfceItemsToDraft(items(), new Map()).map((line) => ({
      description: line.raw_description,
      unit: line.unit,
      unit_price: line.unit_price,
    }));
    expect(nfceReadLines(items())).toEqual(draft);
  });
});

describe('nfceReceiptRow', () => {
  const qr = { accessKey: '35261012345678000199650010000123451000012347' };
  const now = new Date('2026-10-18T12:00:00Z');

  it('leva o id da leitura do servidor quando a função devolveu um', () => {
    expect(nfceReceiptRow({ issuedAtLocal: null, total: 9.5, readId: 'read-1' }, qr, 's1', now)).toEqual({
      store_id: 's1',
      purchased_at: now.toISOString(),
      total: 9.5,
      access_key: qr.accessKey,
      source: 'qrcode',
      status: 'draft',
      read_id: 'read-1',
    });
  });

  it('sem leitura (função de antes, ou a gravação falhou), a nota vai sem a coluna', () => {
    expect(nfceReceiptRow({ issuedAtLocal: null, total: null }, qr, null, now)).not.toHaveProperty('read_id');
    expect(nfceReceiptRow({ issuedAtLocal: null, total: null, readId: null }, qr, null, now)).not.toHaveProperty('read_id');
  });

  it('a data é a da nota, lida no fuso do celular', () => {
    const row = nfceReceiptRow({ issuedAtLocal: '2026-10-09T18:30:00', total: null }, qr, null, now);
    expect(row.purchased_at).toBe(new Date(2026, 9, 9, 18, 30, 0).toISOString());
  });
});
