import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { SESSION_ENDED } from '@/lib/accessErrors';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchExamResultOwners, fetchPersonExams, readHealthDocument, TOO_MANY_ROWS } from '../health';

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

  it('histórico que não acaba nunca é entregue cortado: a busca falha', async () => {
    // Bem além de qualquer casa de verdade: mais páginas cheias do que a leitura aceita.
    const endless = examsDb(500 * 200 + 1);
    await expect(fetchPersonExams('ana', endless.db)).rejects.toThrow(TOO_MANY_ROWS);
    // Logo abaixo do teto vem tudo: a última página é a que vem incompleta.
    const edge = examsDb(500 * 200 - 1);
    expect(await fetchPersonExams('ana', edge.db)).toHaveLength(500 * 200 - 1);
    // E exatamente no teto também: todas as páginas cheias, e a linha a mais que a leitura pede não existe.
    const exact = examsDb(500 * 200);
    expect(await fetchPersonExams('ana', exact.db)).toHaveLength(500 * 200);
    expect(exact.calls.at(-1)).toBe('100000-100000');
  });
});

describe('quem tem resultados de exame, na casa toda', () => {
  /**
   * Um banco de mentira com os exames realizados e com resultados de cada pessoa (`results` de cada um). Guarda
   * cada pedido como "colunas | filtros | página".
   */
  function ownersDb(exams: { person_id: string; results: { value: string | null }[] }[]) {
    const calls: string[] = [];
    const db = {
      from: () => {
        let columns = '';
        const filters: string[] = [];
        let person: string | null = null;
        const query = {
          select: (asked: string) => {
            columns = asked;
            return query;
          },
          eq: (column: string, value: string) => {
            filters.push(`${column}=${value}`);
            if (column === 'person_id') person = value;
            return query;
          },
          neq: (column: string, value: string) => {
            filters.push(`${column}<>${value}`);
            return query;
          },
          order: () => query,
          range: async (from: number, to: number) => {
            calls.push(`${columns} | ${filters.join(' ')} | ${from}-${to}`);
            const rows = exams.filter((exam) => person === null || exam.person_id === person);
            return { data: rows.slice(from, to + 1), error: null };
          },
        };
        return query;
      },
    };
    return { db: db as unknown as SupabaseClient, calls };
  }
  const filled = [{ value: '92' }];
  const blank = [{ value: '' }, { value: '   ' }, { value: null }];

  it('lê só a coluna da pessoa, dos realizados com resultados, em páginas, e devolve cada pessoa uma vez', async () => {
    // 2.300 exames com resultados, de três pessoas.
    const { db, calls } = ownersDb(Array.from({ length: 2300 }, (_, i) => ({ person_id: ['ana', 'beto', 'rex'][i % 3], results: filled })));
    expect((await fetchExamResultOwners(db)).sort()).toEqual(['ana', 'beto', 'rex']);
    const people = calls.filter((call) => call.startsWith('person_id |'));
    expect(people).toEqual([
      'person_id | status=realizado results<>[] | 0-999',
      'person_id | status=realizado results<>[] | 1000-1999',
      'person_id | status=realizado results<>[] | 2000-2999',
    ]);
    // A conferência de cada pessoa para no primeiro laudo com um resultado preenchido: uma página pequena por pessoa.
    expect(calls.filter((call) => call.startsWith('results |')).sort()).toEqual([
      'results | person_id=ana status=realizado results<>[] | 0-19',
      'results | person_id=beto status=realizado results<>[] | 0-19',
      'results | person_id=rex status=realizado results<>[] | 0-19',
    ]);
  });

  it('quem só tem laudo com os valores em branco não é "quem tem resultados"', async () => {
    const { db, calls } = ownersDb([
      // Ana: o primeiro laudo veio em branco, o segundo tem um valor.
      { person_id: 'ana', results: blank },
      { person_id: 'ana', results: [...blank, ...filled] },
      // Beto: 25 laudos, todos em branco (a conferência lê as duas páginas e desiste).
      ...Array.from({ length: 25 }, () => ({ person_id: 'beto', results: blank })),
      // Rex: exatamente uma página cheia de laudos em branco e, depois dela, um com valor.
      ...Array.from({ length: 20 }, () => ({ person_id: 'rex', results: blank })),
      { person_id: 'rex', results: filled },
    ]);
    expect((await fetchExamResultOwners(db)).sort()).toEqual(['ana', 'rex']);
    expect(calls.filter((call) => call.includes('person_id=beto')).map((call) => call.split(' | ')[2])).toEqual(['0-19', '20-39']);
    expect(calls.filter((call) => call.includes('person_id=rex')).map((call) => call.split(' | ')[2])).toEqual(['0-19', '20-39']);
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
