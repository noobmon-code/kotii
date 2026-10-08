import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { SESSION_ENDED } from '@/lib/accessErrors';

import { readHealthDocument } from '../health';

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockLog: string[] = [];
const mockSession = { ended: true };

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    // A função não reconhece a sessão: 401.
    functions: {
      invoke: async () => {
        const { FunctionsHttpError: HttpError } = jest.requireActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
        return { data: null, error: new HttpError(new Response(JSON.stringify({ error: 'Não autenticado.' }), { status: 401 })) };
      },
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          mockLog.push(`apaga ${bucket}: ${paths.join(',')}`);
          return { data: [], error: null };
        },
      }),
    },
  },
  unwrap: (result: { data: unknown }) => result.data,
}));

// Como o guarda da sessão (lib/accessErrors): a limpeza roda antes de sair, só se a sessão acabou.
jest.mock('@/lib/session', () => ({
  endSessionIfGone: async (beforeEnd?: () => Promise<unknown>) => {
    if (!mockSession.ended) return false;
    await beforeEnd?.();
    mockLog.push('sai da conta');
    return true;
  },
}));

beforeEach(() => {
  mockLog.length = 0;
  mockSession.ended = true;
});

describe('leitura de documento de saúde com a sessão encerrada', () => {
  it('fotos recém-enviadas (plano novo): saem do storage antes de o app sair da conta', async () => {
    await expect(readHealthDocument('diet', ['h1/a.jpg', 'h1/b.jpg'], { unclaimed: true })).rejects.toThrow(SESSION_ENDED);
    expect(mockLog).toEqual(['apaga health: h1/a.jpg,h1/b.jpg', 'sai da conta']);
  });

  it('fotos de um exame já guardado: ficam (o registro aponta para elas)', async () => {
    await expect(readHealthDocument('exam', ['h1/exame.jpg'])).rejects.toThrow(SESSION_ENDED);
    expect(mockLog).toEqual(['sai da conta']);
  });

  it('sessão renovada: as fotos ficam para o rascunho', async () => {
    mockSession.ended = false;
    await expect(readHealthDocument('workout', ['h1/a.jpg'], { unclaimed: true })).rejects.toThrow(
      'Não foi possível ler o documento. Tente novamente.',
    );
    expect(mockLog).toEqual([]);
  });
});
