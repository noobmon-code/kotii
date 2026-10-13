import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { SESSION_ENDED } from '@/lib/accessErrors';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchPersonExams, readHealthDocument } from '../health';

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

describe('todos os exames de uma pessoa', () => {
  /** Um banco de mentira com `total` exames da pessoa, que responde por faixa como o PostgREST. */
  function examsDb(total: number) {
    const calls: string[] = [];
    const rows = Array.from({ length: total }, (_, i) => ({ id: `e${i}` }));
    const query = {
      select: () => query,
      eq: (column: string, value: string) => {
        calls.push(`${column}=${value}`);
        return query;
      },
      order: () => query,
      range: async (from: number, to: number) => {
        calls.push(`${from}-${to}`);
        return { data: rows.slice(from, to + 1), error: null };
      },
    };
    return { db: { from: () => query } as unknown as SupabaseClient, calls };
  }

  it('busca em páginas até acabar, só os da pessoa', async () => {
    const few = examsDb(3);
    expect(await fetchPersonExams('ana', few.db)).toHaveLength(3);
    expect(few.calls).toEqual(['person_id=ana', '0-499']);

    // Mais do que a lista da casa traz (300) e do que cabe numa busca.
    const many = examsDb(1203);
    const exams = await fetchPersonExams('ana', many.db);
    expect(exams).toHaveLength(1203);
    expect(new Set(exams.map((e) => e.id)).size).toBe(1203);
    expect(many.calls.filter((c) => c.includes('-'))).toEqual(['0-499', '500-999', '1000-1499']);

    // Página cheia exata: mais uma busca, vazia, e acabou.
    const exact = examsDb(500);
    expect(await fetchPersonExams('ana', exact.db)).toHaveLength(500);
    expect(exact.calls.filter((c) => c.includes('-'))).toEqual(['0-499', '500-999']);

    expect(await fetchPersonExams('ana', examsDb(0).db)).toEqual([]);
  });
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
