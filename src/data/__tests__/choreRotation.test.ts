import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { isRotationUnavailable } from '@/domain/choreRotation';

import { fetchChoreRotations, saveChore } from '../home';

// "mock" no nome: o jest.mock só enxerga variáveis assim.
// O banco de mentira: o que cada chamada responde e o que foi chamado.
const mockDb: {
  rotation: { data: unknown; error: unknown };
  rpc: { data: unknown; error: unknown } | Error;
  calls: string[];
} = { rotation: { data: [], error: null }, rpc: { data: null, error: null }, calls: [] };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({ order: async () => mockDb.rotation }),
      insert: (values: { title: string }) => ({
        select: () => ({
          single: async () => {
            mockDb.calls.push(`insert ${table}: ${values.title}`);
            return { data: { id: 'nova' }, error: null };
          },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async (_column: string, id: string) => {
          mockDb.calls.push(`update ${table} ${id}: ${Object.keys(values).join(',')}`);
          return { data: null, error: null };
        },
      }),
    }),
    rpc: async (name: string, args: { p_people: string[] }) => {
      mockDb.calls.push(`rpc ${name}: ${args.p_people.join(',')}`);
      if (mockDb.rpc instanceof Error) throw mockDb.rpc;
      return mockDb.rpc;
    },
  },
  unwrap: (r: { data: unknown; error: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  },
}));

// O que a API responde quando o banco ainda não tem a tabela ou a função.
const NO_TABLE = { code: 'PGRST205', message: "Could not find the table 'public.chore_rotation' in the schema cache" };
const NO_FUNCTION = { code: 'PGRST202', message: 'Could not find the function public.save_chore_rotation(p_chore_id, p_people) in the schema cache' };

const values = { title: 'Lavar a louça', notes: null, recurrence: 'daily' as const, interval_count: 1, due_on: '2026-10-12' };

beforeEach(() => {
  mockDb.rotation = { data: [], error: null };
  mockDb.rpc = { data: null, error: null };
  mockDb.calls = [];
});

describe('ordens do rodízio', () => {
  it('vêm por tarefa, na ordem', async () => {
    mockDb.rotation = {
      data: [
        { chore_id: 'louca', person_id: 'p-carla', position: 2 },
        { chore_id: 'louca', person_id: 'p-beto', position: 1 },
      ],
      error: null,
    };
    expect(await fetchChoreRotations()).toEqual({ louca: ['p-beto', 'p-carla'] });
  });

  it('banco ainda sem o rodízio: nenhuma ordem, sem erro', async () => {
    mockDb.rotation = { data: null, error: NO_TABLE };
    expect(await fetchChoreRotations()).toEqual({});
    mockDb.rotation = { data: null, error: { code: '42P01', message: 'relation "public.chore_rotation" does not exist' } };
    expect(await fetchChoreRotations()).toEqual({});
  });

  it('os outros erros continuam sendo erros', async () => {
    mockDb.rotation = { data: null, error: { code: '42501', message: 'permission denied for table chore_rotation' } };
    await expect(fetchChoreRotations()).rejects.toMatchObject({ code: '42501' });
  });
});

describe('salvar a tarefa com o rodízio', () => {
  it('tarefa nova: grava a tarefa e, com o id dela, a ordem', async () => {
    expect(await saveChore({ values, rotation: ['p-beto', 'p-carla'] })).toEqual({ id: 'nova' });
    expect(mockDb.calls).toEqual(['insert chores: Lavar a louça', 'rpc save_chore_rotation: p-beto,p-carla']);
  });

  it('sem rodízio, nada do rodízio é chamado', async () => {
    expect(await saveChore({ id: 'louca', values: { ...values, assigned_to: null, kid_id: null } })).toEqual({ id: 'louca' });
    expect(await saveChore({ values, rotation: null })).toEqual({ id: 'nova' });
    expect(mockDb.calls).toEqual([
      'update chores louca: title,notes,recurrence,interval_count,due_on,assigned_to,kid_id',
      'insert chores: Lavar a louça',
    ]);
  });

  it('ordem vazia encerra o rodízio que havia', async () => {
    await saveChore({ id: 'louca', values, rotation: [] });
    expect(mockDb.calls).toEqual(['update chores louca: title,notes,recurrence,interval_count,due_on', 'rpc save_chore_rotation: ']);
  });

  it('banco ainda sem o rodízio: a tarefa fica salva e a falha volta no resultado, não como erro', async () => {
    mockDb.rpc = { data: null, error: NO_FUNCTION };
    const saved = await saveChore({ values, rotation: ['p-beto', 'p-carla'] });
    expect(saved.id).toBe('nova');
    expect(isRotationUnavailable(saved.rotationError)).toBe(true);
    expect(mockDb.calls).toEqual(['insert chores: Lavar a louça', 'rpc save_chore_rotation: p-beto,p-carla']);
  });

  it('sem internet na hora da ordem: também volta no resultado, com o id para tentar de novo', async () => {
    mockDb.rpc = new TypeError('Network request failed');
    const saved = await saveChore({ values, rotation: ['p-beto', 'p-carla'] });
    expect(saved).toMatchObject({ id: 'nova', rotationError: mockDb.rpc });
    expect(isRotationUnavailable(saved.rotationError)).toBe(false);
  });
});
