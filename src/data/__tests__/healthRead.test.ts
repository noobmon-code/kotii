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
  const idOf = (index: number) => `e${String(index).padStart(6, '0')}`;

  /**
   * Um banco de mentira com `total` exames da pessoa, que responde como o PostgREST a uma busca em ordem de id:
   * as linhas depois do id pedido (`gt`), até o limite. Cada exame foi criado ANTES do de id menor, para a ordem
   * entregue (a de criação) não ser a da leitura. `afterPage` roda depois de cada página servida.
   */
  function examsDb(total: number, afterPage?: (rows: { id: string; created_at: string }[], page: number) => void) {
    const calls: string[] = [];
    const rows = Array.from({ length: total }, (_, i) => ({ id: idOf(i), created_at: new Date(Date.UTC(2026, 0, 1) + (total - i) * 60_000).toISOString() }));
    let pages = 0;
    const from = () => {
      let after: string | null = null;
      const query = {
        select: () => query,
        eq: (column: string, value: string) => {
          calls.push(`${column}=${value}`);
          return query;
        },
        order: (column: string) => {
          calls.push(`ordem ${column}`);
          return query;
        },
        gt: (column: string, value: string) => {
          if (column === 'id') after = value;
          return query;
        },
        limit: async (count: number) => {
          calls.push(`${after ?? 'início'}+${count}`);
          // As linhas estão em ordem de id: a primeira depois do cursor.
          let start = 0;
          if (after !== null) {
            start = rows.findIndex((row) => row.id > after!);
            if (start < 0) start = rows.length;
          }
          const data = rows.slice(start, start + count);
          afterPage?.(rows, ++pages);
          return { data, error: null };
        },
      };
      return query;
    };
    return { db: { from } as unknown as SupabaseClient, calls };
  }
  const pagesOf = (calls: string[]) => calls.filter((call) => call.includes('+'));

  it('busca em páginas até acabar, só os da pessoa, e entrega na ordem de criação', async () => {
    const few = examsDb(3);
    const exams = await fetchPersonExams('ana', few.db);
    // A leitura andou por id (e0, e1, e2); o mais antigo é o de id maior.
    expect(exams.map((e) => e.id)).toEqual([idOf(2), idOf(1), idOf(0)]);
    expect(few.calls).toEqual(['person_id=ana', 'ordem id', 'início+500']);

    // Mais do que a lista da casa traz (300) e do que cabe numa busca.
    const many = examsDb(1203);
    const all = await fetchPersonExams('ana', many.db);
    expect(all).toHaveLength(1203);
    expect(new Set(all.map((e) => e.id)).size).toBe(1203);
    // Cada página começa depois do último id lido, e não numa posição.
    expect(pagesOf(many.calls)).toEqual(['início+500', `${idOf(499)}+500`, `${idOf(999)}+500`]);

    // Página cheia exata: mais uma busca, vazia, e acabou.
    const exact = examsDb(500);
    expect(await fetchPersonExams('ana', exact.db)).toHaveLength(500);
    expect(pagesOf(exact.calls)).toEqual(['início+500', `${idOf(499)}+500`]);

    expect(await fetchPersonExams('ana', examsDb(0).db)).toEqual([]);
  });

  it('um exame apagado em outro aparelho no meio da leitura não faz nenhum outro ser pulado', async () => {
    // Depois da primeira página, some um exame que ela já tinha entregue: por posição, a segunda página começaria
    // uma linha adiante e o exame 500 nunca viria.
    const db = examsDb(1203, (rows, page) => {
      if (page === 1) rows.splice(10, 1);
    });
    const ids = (await fetchPersonExams('ana', db.db)).map((e) => e.id);
    expect(ids).toHaveLength(1203);
    expect(ids).toContain(idOf(500));
    expect(new Set(ids).size).toBe(1203);
  });

  it('um exame criado em outro aparelho no meio da leitura não faz nenhum vir duas vezes', async () => {
    // Depois da primeira página entra um exame com id antes do cursor: por posição, a última linha da primeira
    // página viria de novo na segunda (e viraria um ponto repetido na evolução).
    const db = examsDb(1203, (rows, page) => {
      if (page === 1) rows.splice(5, 0, { id: 'e000004x', created_at: '2026-06-01T00:00:00.000Z' });
    });
    const ids = (await fetchPersonExams('ana', db.db)).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(1203);
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
    expect(exact.calls.at(-1)).toBe(`${idOf(500 * 200 - 1)}+1`);
  });
});

describe('quem tem resultados de exame, na casa toda', () => {
  const idOf = (index: number) => `x${String(index).padStart(6, '0')}`;

  /**
   * Um banco de mentira com os exames realizados e com resultados de cada pessoa (`results` de cada um), em ordem
   * de id. Guarda cada pedido como "colunas | filtros | depois de qual id + quantas linhas".
   */
  function ownersDb(exams: { person_id: string; results: { value: string | null }[] }[]) {
    const calls: string[] = [];
    const stored = exams.map((exam, index) => ({ id: idOf(index), ...exam }));
    const db = {
      from: () => {
        let columns = '';
        const filters: string[] = [];
        let person: string | null = null;
        let after: string | null = null;
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
          gt: (column: string, value: string) => {
            if (column === 'id') after = value;
            return query;
          },
          limit: async (count: number) => {
            calls.push(`${columns} | ${filters.join(' ')} | ${after ?? 'início'}+${count}`);
            const rows = stored.filter((exam) => (person === null || exam.person_id === person) && (after === null || exam.id > after));
            return { data: rows.slice(0, count), error: null };
          },
        };
        return query;
      },
    };
    return { db: db as unknown as SupabaseClient, calls };
  }
  const filled = [{ value: '92' }];
  const blank = [{ value: '' }, { value: '   ' }, { value: null }];
  const pageOf = (call: string) => call.split(' | ')[2];

  it('lê só o id e a pessoa, dos realizados com resultados, em páginas por id, e devolve cada pessoa uma vez', async () => {
    // 2.300 exames com resultados, de três pessoas.
    const { db, calls } = ownersDb(Array.from({ length: 2300 }, (_, i) => ({ person_id: ['ana', 'beto', 'rex'][i % 3], results: filled })));
    expect((await fetchExamResultOwners(db)).sort()).toEqual(['ana', 'beto', 'rex']);
    const people = calls.filter((call) => call.startsWith('id, person_id |'));
    expect(people).toEqual([
      'id, person_id | status=realizado results<>[] | início+1000',
      `id, person_id | status=realizado results<>[] | ${idOf(999)}+1000`,
      `id, person_id | status=realizado results<>[] | ${idOf(1999)}+1000`,
    ]);
    // A conferência de cada pessoa para no primeiro laudo com um resultado preenchido: uma página pequena por pessoa.
    expect(calls.filter((call) => call.startsWith('id, results |')).sort()).toEqual([
      'id, results | person_id=ana status=realizado results<>[] | início+20',
      'id, results | person_id=beto status=realizado results<>[] | início+20',
      'id, results | person_id=rex status=realizado results<>[] | início+20',
    ]);
  });

  it('quem só tem laudo com os valores em branco não é "quem tem resultados"', async () => {
    const { db, calls } = ownersDb([
      // Ana: o primeiro laudo veio em branco, o segundo tem um valor.
      { person_id: 'ana', results: blank },
      { person_id: 'ana', results: [...blank, ...filled] },
      // Beto (do 2 ao 26): 25 laudos, todos em branco (a conferência lê as duas páginas e desiste).
      ...Array.from({ length: 25 }, () => ({ person_id: 'beto', results: blank })),
      // Rex (do 27 ao 47): exatamente uma página cheia de laudos em branco e, depois dela, um com valor.
      ...Array.from({ length: 20 }, () => ({ person_id: 'rex', results: blank })),
      { person_id: 'rex', results: filled },
    ]);
    expect((await fetchExamResultOwners(db)).sort()).toEqual(['ana', 'rex']);
    // A segunda página de cada um começa depois do vigésimo laudo dele.
    expect(calls.filter((call) => call.includes('person_id=beto')).map(pageOf)).toEqual(['início+20', `${idOf(21)}+20`]);
    expect(calls.filter((call) => call.includes('person_id=rex')).map(pageOf)).toEqual(['início+20', `${idOf(46)}+20`]);
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
