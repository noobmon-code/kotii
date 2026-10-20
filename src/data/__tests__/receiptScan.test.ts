import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { FunctionError } from '../images';
import { fetchNfcePage, scanReceiptPhotos } from '../receipts';

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockCalls: { name: string; body: unknown }[] = [];
const mockRemoved: string[][] = [];
const mockReply: { data: unknown; status?: number; body?: unknown } = { data: null };

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: async (name: string, { body }: { body: unknown }) => {
        mockCalls.push({ name, body });
        if (mockReply.status) {
          const { FunctionsHttpError: HttpError } = jest.requireActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
          return { data: null, error: new HttpError(new Response(JSON.stringify(mockReply.body), { status: mockReply.status })) };
        }
        return { data: mockReply.data, error: null };
      },
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          mockRemoved.push(paths);
          return { data: [], error: null };
        },
      }),
    },
  },
  unwrap: (result: { data: unknown }) => result.data,
}));

// O envio de verdade reduz a foto (expo-image-manipulator): aqui só devolve os caminhos.
jest.mock('../images', () => ({
  ...jest.requireActual<typeof import('../images')>('../images'),
  uploadImages: async (_bucket: string, householdId: string, uris: string[]) => uris.map((_, i) => `${householdId}/${i}.jpg`),
}));

const KEY = '25261012345678000199650010000012341000123456';

beforeEach(() => {
  mockCalls.length = 0;
  mockRemoved.length = 0;
  mockReply.data = null;
  mockReply.status = undefined;
  mockReply.body = undefined;
});

describe('nota pela foto com a chave do QR code', () => {
  it('a chave vai junto com as fotos para a leitura guardar na nota', async () => {
    mockReply.data = { receipt_id: 'r1', duplicate: false };
    await expect(scanReceiptPhotos('h1', { uris: ['a', 'b'], accessKey: KEY })).resolves.toEqual({ receipt_id: 'r1', duplicate: false });
    expect(mockCalls).toEqual([{ name: 'parse-receipt', body: { image_paths: ['h1/0.jpg', 'h1/1.jpg'], access_key: KEY } }]);
    expect(mockRemoved).toEqual([]);
  });

  it('sem chave, o pedido é o de sempre', async () => {
    mockReply.data = { receipt_id: 'r1', duplicate: false };
    await scanReceiptPhotos('h1', { uris: ['a'] });
    expect(mockCalls).toEqual([{ name: 'parse-receipt', body: { image_paths: ['h1/0.jpg'] } }]);
  });

  it('nota com essa chave já na casa: abre a existente e as fotos novas saem', async () => {
    mockReply.data = { receipt_id: 'r0', duplicate: true };
    await expect(scanReceiptPhotos('h1', { uris: ['a'], accessKey: KEY })).resolves.toEqual({ receipt_id: 'r0', duplicate: true });
    expect(mockRemoved).toEqual([['h1/0.jpg']]);
  });
});

describe('quantas fotos vão numa leitura', () => {
  const uris = (n: number) => Array.from({ length: n }, (_, i) => `foto${i}`);

  it('vão até 8 fotos (os prints da Sefaz), na ordem; passando disso, as 8 primeiras', async () => {
    mockReply.data = { receipt_id: 'r1', duplicate: false };
    await scanReceiptPhotos('h1', { uris: uris(8), accessKey: KEY });
    expect((mockCalls[0].body as { image_paths: string[] }).image_paths).toEqual(uris(8).map((_, i) => `h1/${i}.jpg`));
    mockCalls.length = 0;
    await scanReceiptPhotos('h1', { uris: uris(10) });
    expect((mockCalls[0].body as { image_paths: string[] }).image_paths).toHaveLength(8);
  });

  it('a função de antes (até 4 fotos) recusa sem dizer por quê: a pessoa sabe quantas mandar, e as fotos saem', async () => {
    mockReply.status = 400;
    mockReply.body = { error: 'Imagem inválida.' };
    await expect(scanReceiptPhotos('h1', { uris: uris(6), accessKey: KEY })).rejects.toThrow(
      'Por enquanto, a leitura aceita até 4 fotos por nota.',
    );
    expect(mockRemoved).toEqual([uris(6).map((_, i) => `h1/${i}.jpg`)]);
  });

  it('a função de agora diz o limite: vale a mensagem dela; e até 4 fotos o "Imagem inválida." fica como veio', async () => {
    mockReply.status = 400;
    mockReply.body = { error: 'Mande até 8 fotos ou prints por nota.', code: 'too_many_photos' };
    await expect(scanReceiptPhotos('h1', { uris: uris(6) })).rejects.toThrow('Mande até 8 fotos ou prints por nota.');
    mockReply.body = { error: 'Imagem inválida.' };
    await expect(scanReceiptPhotos('h1', { uris: uris(3) })).rejects.toThrow('Imagem inválida.');
  });
});

describe('busca da nota na Sefaz', () => {
  it('"não sou robô": o erro traz o código e a mensagem da função', async () => {
    mockReply.status = 422;
    mockReply.body = { error: 'A Sefaz da Paraíba pede uma verificação. Leia a nota pela foto.', code: 'captcha', uf: '25' };
    const error = await fetchNfcePage('https://www.sefaz.pb.gov.br/nfce?p=1').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(FunctionError);
    expect(error).toMatchObject({ code: 'captcha', message: 'A Sefaz da Paraíba pede uma verificação. Leia a nota pela foto.' });
  });

  it('erro sem código: mensagem da função e código nulo', async () => {
    mockReply.status = 502;
    mockReply.body = { error: 'A Sefaz não respondeu agora.' };
    await expect(fetchNfcePage('https://x.gov.br')).rejects.toMatchObject({ code: null, message: 'A Sefaz não respondeu agora.' });
  });
});
