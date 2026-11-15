import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { scanItemFromProduct, scanItemsFromRead } from '@/domain/scan';

import { FunctionError } from '../images';
import { saveScanToPantry, scanPhotos } from '../scan';

// A leitura da foto do "Escanear" e os achados indo para a despensa, com o Supabase de mentira: o que é enviado, o
// que acontece com as fotos em cada resposta (só a nota lida as guarda) e a despensa que não para por causa de um
// produto que sumiu.

type Reply = { data: unknown; error: unknown };
const mockInvoke = jest.fn(async (_name: string, _options: { body: unknown }): Promise<Reply> => ({ data: null, error: null }));
const mockInsert = jest.fn(async (_table: string, _rows: unknown): Promise<Reply> => ({ data: null, error: null }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (name: string, options: { body: unknown }) => mockInvoke(name, options) },
    from: (table: string) => ({ insert: (rows: unknown) => mockInsert(table, rows) }),
  },
  unwrap: (result: Reply) => {
    if (result.error) throw result.error;
    return result.data;
  },
}));

const mockUpload = jest.fn(async (_bucket: string, householdId: string, uris: string[]) => uris.map((_, i) => `${householdId}/foto-${i}.jpg`));
const mockRemove = jest.fn(async (_bucket: string, _paths: string[]) => undefined);
jest.mock('../images', () => {
  class MockFunctionError extends Error {
    readonly code: string | null;
    constructor(message: string, code: string | null) {
      super(message);
      this.code = code;
    }
  }
  return {
    FunctionError: MockFunctionError,
    uploadImages: (bucket: string, householdId: string, uris: string[]) => mockUpload(bucket, householdId, uris),
    removeImages: (bucket: string, paths: string[]) => mockRemove(bucket, paths),
    // O corpo do erro da função, como o app o lê.
    functionErrorDetails: async (error: { context?: { body?: { error?: string; code?: string } } } | null, fallback: string) => ({
      message: error?.context?.body?.error ?? fallback,
      code: error?.context?.body?.code ?? null,
    }),
  };
});

const PATHS = ['casa-1/foto-0.jpg'];

beforeEach(() => {
  mockInvoke.mockReset();
  mockInsert.mockReset();
  mockInsert.mockResolvedValue({ data: null, error: null });
  mockUpload.mockClear();
  mockRemove.mockClear();
});

describe('a foto do "Escanear"', () => {
  it('vai para a função da nota dizendo o que a tela aceita; a nota lida guarda as fotos', async () => {
    mockInvoke.mockResolvedValue({ data: { receipt_id: 'r1', duplicate: false }, error: null });
    const reply = await scanPhotos('casa-1', { uris: ['file://a.jpg'], classify: 'any' });
    expect(mockUpload).toHaveBeenCalledWith('receipts', 'casa-1', ['file://a.jpg']);
    expect(mockInvoke).toHaveBeenCalledWith('parse-receipt', { body: { image_paths: PATHS, classify: 'any' } });
    expect(reply).toEqual({ kind: 'nota', receiptId: 'r1', duplicate: false });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('produto, prateleira, nada ou a nota que não foi lida: as fotos saem do armazenamento', async () => {
    const replies: [unknown, string][] = [
      [{ kind: 'produtos', products: [{ name: 'Arroz 5kg', category: 'graos', quantity: 1 }] }, 'produtos'],
      [{ kind: 'nada', products: [] }, 'nada'],
      [{ kind: 'nota', products: [] }, 'nota-nao-lida'],
    ];
    for (const [data, kind] of replies) {
      mockRemove.mockClear();
      mockInvoke.mockResolvedValue({ data, error: null });
      const reply = await scanPhotos('casa-1', { uris: ['file://a.jpg'], classify: 'products' });
      expect(reply.kind).toBe(kind);
      expect(mockRemove).toHaveBeenCalledWith('receipts', PATHS);
    }
    expect(mockInvoke).toHaveBeenLastCalledWith('parse-receipt', { body: { image_paths: PATHS, classify: 'products' } });
  });

  it('a função que recusa (as fotos de produto do mês acabaram): as fotos saem, e o erro leva o aviso e o código', async () => {
    const context = { body: { error: 'A casa já usou as 50 fotos de produto deste mês.', code: 'product_quota' } };
    mockInvoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });
    const failure = scanPhotos('casa-1', { uris: ['file://a.jpg'], classify: 'products' });
    await expect(failure).rejects.toBeInstanceOf(FunctionError);
    await expect(failure).rejects.toMatchObject({ message: 'A casa já usou as 50 fotos de produto deste mês.', code: 'product_quota' });
    expect(mockRemove).toHaveBeenCalledWith('receipts', PATHS);
  });

  it('a falha de rede deixa as fotos: a nota pode ter sido salva', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
    await expect(scanPhotos('casa-1', { uris: ['file://a.jpg'], classify: 'any' })).rejects.toThrow('Não foi possível ler a foto');
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('a resposta que o app não entende vira erro, e as fotos saem', async () => {
    mockInvoke.mockResolvedValue({ data: { kind: 'outra-coisa' }, error: null });
    await expect(scanPhotos('casa-1', { uris: ['file://a.jpg'], classify: 'any' })).rejects.toThrow('Não foi possível ler a foto');
    expect(mockRemove).toHaveBeenCalledWith('receipts', PATHS);
  });

  it('manda no máximo as fotos de uma nota, e nada sem a casa', async () => {
    mockInvoke.mockResolvedValue({ data: { kind: 'nada' }, error: null });
    await scanPhotos('casa-1', { uris: ['1', '2', '3', '4', '5', '6', '7', '8'], classify: 'any' });
    expect(mockUpload.mock.calls[0][2]).toHaveLength(6);
    await expect(scanPhotos(undefined, { uris: ['1'], classify: 'any' })).rejects.toThrow('Família não carregada');
  });
});

describe('os achados na despensa', () => {
  const items = [
    scanItemFromProduct({ id: 'p1', name: 'Arroz Tio João 5kg', category: 'graos', shelf_life_days: null }),
    ...scanItemsFromRead([{ name: 'Leite Italac 1L', category: 'laticinios', quantity: 2 }]),
  ];

  it('entram todos de uma vez, com o produto da casa quando veio do código de barras', async () => {
    expect(await saveScanToPantry(items, '2026-11-14')).toBe(2);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [table, rows] = mockInsert.mock.calls[0];
    expect(table).toBe('pantry_items');
    expect((rows as { name: string; product_id: string | null; quantity: number; unit: string; purchased_on: string }[]).map((r) => [r.name, r.product_id, r.quantity, r.unit, r.purchased_on])).toEqual([
      ['Arroz Tio João 5kg', 'p1', 1, 'un', '2026-11-14'],
      ['Leite Italac 1L', null, 2, 'un', '2026-11-14'],
    ]);
  });

  it('o produto que sumiu (juntado com outro em outro aparelho) não segura os outros: entram só com o nome', async () => {
    mockInsert.mockResolvedValueOnce({
      data: null,
      error: { code: '23503', message: 'insert or update on table "pantry_items" violates foreign key constraint "pantry_items_product_id_household_id_fkey"' },
    });
    expect(await saveScanToPantry(items, '2026-11-14')).toBe(2);
    expect(mockInsert).toHaveBeenCalledTimes(2);
    const retried = mockInsert.mock.calls[1][1] as { name: string; product_id: string | null }[];
    expect(retried.map((r) => [r.name, r.product_id])).toEqual([
      ['Arroz Tio João 5kg', null],
      ['Leite Italac 1L', null],
    ]);
  });

  it('outro erro do banco sobe como veio, sem tentar de novo; sem achados, nada é pedido', async () => {
    mockInsert.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'sem acesso' } });
    await expect(saveScanToPantry(items, '2026-11-14')).rejects.toMatchObject({ code: '42501' });
    expect(mockInsert).toHaveBeenCalledTimes(1);
    mockInsert.mockClear();
    expect(await saveScanToPantry([], '2026-11-14')).toBe(0);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
