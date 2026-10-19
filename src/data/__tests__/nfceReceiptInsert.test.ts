import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { nfceReceiptRow } from '@/domain/nfce';

import { insertNfceReceipt } from '../receipts';

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockInserts: Record<string, unknown>[] = [];
const mockReplies: { data: unknown; error: unknown }[] = [];

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        mockInserts.push({ table, ...row });
        return { select: () => ({ single: async () => mockReplies.shift() ?? { data: null, error: { code: 'XX000' } } }) };
      },
    }),
  },
  unwrap: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
}));

const QR = { accessKey: '35261012345678000199650010000123451000012347' };
const NOW = new Date('2026-10-18T12:00:00Z');

beforeEach(() => {
  mockInserts.length = 0;
  mockReplies.length = 0;
});

describe('rascunho da nota do QR code', () => {
  it('grava com o id da leitura do servidor', async () => {
    mockReplies.push({ data: { id: 'n1' }, error: null });
    await expect(insertNfceReceipt(nfceReceiptRow({ issuedAtLocal: null, total: 9, readId: 'r1' }, QR, 's1', NOW))).resolves.toEqual({ id: 'n1' });
    expect(mockInserts).toHaveLength(1);
    expect(mockInserts[0]).toMatchObject({ table: 'receipts', read_id: 'r1', store_id: 's1' });
  });

  it('leitura recusada (23503: a pessoa trocou de casa entre a leitura e a gravação): grava de novo sem ela', async () => {
    mockReplies.push({ data: null, error: { code: '23503' } }, { data: { id: 'n2' }, error: null });
    await expect(insertNfceReceipt(nfceReceiptRow({ issuedAtLocal: null, total: 9, readId: 'r1' }, QR, 's1', NOW))).resolves.toEqual({ id: 'n2' });
    expect(mockInserts).toHaveLength(2);
    expect(mockInserts[1]).not.toHaveProperty('read_id');
    expect(mockInserts[1]).toMatchObject({ table: 'receipts', store_id: 's1', access_key: QR.accessKey, source: 'qrcode', status: 'draft' });
  });

  it('sem leitura, ou outro erro, não tenta de novo: o erro volta', async () => {
    mockReplies.push({ data: null, error: { code: '23503' } });
    await expect(insertNfceReceipt(nfceReceiptRow({ issuedAtLocal: null, total: 9 }, QR, 's1', NOW))).rejects.toEqual({ code: '23503' });
    mockReplies.push({ data: null, error: { code: '23505' } });
    await expect(insertNfceReceipt(nfceReceiptRow({ issuedAtLocal: null, total: 9, readId: 'r1' }, QR, 's1', NOW))).rejects.toEqual({ code: '23505' });
    expect(mockInserts).toHaveLength(2);
  });
});
