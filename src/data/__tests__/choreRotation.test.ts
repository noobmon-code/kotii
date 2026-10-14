import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { isRotationChangedElsewhere, isRotationUnavailable } from '@/domain/choreRotation';

import { fetchChoreRotations, saveChore } from '../home';

// "mock" no nome: o jest.mock só enxerga variáveis assim.
// O banco de mentira: o que cada chamada responde e o que foi chamado.
const mockDb: {
  rotation: { data: unknown; error: unknown };
  rpc: { data: unknown; error: unknown } | Error;
  /** O que save_chore_single responde (as outras funções: `rpc`). */
  single: { data: unknown; error: unknown } | Error;
  calls: string[];
} = { rotation: { data: [], error: null }, rpc: { data: null, error: null }, single: { data: null, error: null }, calls: [] };

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
    rpc: async (name: string, args: { p_chore_id: string; p_people?: string[]; p_assigned_to?: unknown; p_kid_id?: unknown; p_points?: unknown }) => {
      if (name === 'save_chore_single') {
        mockDb.calls.push(`rpc ${name} ${args.p_chore_id}: ${JSON.stringify([args.p_assigned_to, args.p_kid_id, args.p_points])}`);
        if (mockDb.single instanceof Error) throw mockDb.single;
        return mockDb.single;
      }
      mockDb.calls.push(`rpc ${name}: ${args.p_people?.join(',')}`);
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
const NO_SINGLE_FUNCTION = {
  code: 'PGRST202',
  message: 'Could not find the function public.save_chore_single(p_assigned_to, p_chore_id, p_kid_id, p_points) in the schema cache',
};
// A recusa de save_chore_single: a tarefa tem rodízio.
const HAS_ROTATION = { code: 'NK006', message: 'chore has a rotation', details: null, hint: null };

const values = { title: 'Lavar a louça', notes: null, recurrence: 'daily' as const, interval_count: 1, due_on: '2026-10-12' };

beforeEach(() => {
  mockDb.rotation = { data: [], error: null };
  mockDb.rpc = { data: null, error: null };
  mockDb.single = { data: null, error: null };
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

  it('sem rodízio, a ordem não é gravada', async () => {
    expect(await saveChore({ id: 'louca', values: { ...values, assigned_to: null, kid_id: null } })).toEqual({ id: 'louca' });
    expect(await saveChore({ values, rotation: null })).toEqual({ id: 'nova' });
    // Na tarefa que já existe, o responsável vai pela função que confere se ela segue sem rodízio (mais abaixo).
    expect(mockDb.calls).toEqual([
      'rpc save_chore_single louca: [null,null,null]',
      'update chores louca: title,notes,recurrence,interval_count,due_on',
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

describe('salvar a tarefa que já existe e não mostrou rodízio', () => {
  const ofBeto = { ...values, assigned_to: 'u-beto', kid_id: null, points: 0 };
  const SINGLE = 'rpc save_chore_single louca: ["u-beto",null,0]';
  const REST = 'update chores louca: title,notes,recurrence,interval_count,due_on';
  const EVERYTHING = `${REST},assigned_to,kid_id,points`;

  it('o responsável e os pontos vão pela função que confere o rodízio; o resto, direto na tabela, depois', async () => {
    expect(await saveChore({ id: 'louca', values: ofBeto })).toEqual({ id: 'louca' });
    expect(mockDb.calls).toEqual([SINGLE, REST]);
    mockDb.calls = [];
    // Tarefa de criança, e a ordem dita como "nenhuma".
    await saveChore({ id: 'louca', values: { ...values, assigned_to: null, kid_id: 'p-lia', points: 10 }, rotation: null });
    expect(mockDb.calls).toEqual(['rpc save_chore_single louca: [null,"p-lia",10]', REST]);
  });

  it('a tarefa ganhou um rodízio em outro celular: a recusa do banco sobe como erro e nada mais é gravado', async () => {
    mockDb.single = { data: null, error: HAS_ROTATION };
    const refused = await saveChore({ id: 'louca', values: ofBeto }).catch((err: unknown) => err);
    expect(refused).toBe(HAS_ROTATION);
    expect(isRotationChangedElsewhere(refused)).toBe(true);
    expect(mockDb.calls).toEqual([SINGLE]);
  });

  it('banco ainda sem a função (o app chegou antes da migração): lá não há rodízio, e a tarefa é gravada direto, inteira', async () => {
    mockDb.single = { data: null, error: NO_SINGLE_FUNCTION };
    expect(await saveChore({ id: 'louca', values: ofBeto })).toEqual({ id: 'louca' });
    expect(mockDb.calls).toEqual([SINGLE, EVERYTHING]);
  });

  it('as outras falhas da função (sem internet, responsável que saiu da casa) também sobem, sem gravar o resto', async () => {
    mockDb.single = new TypeError('Network request failed');
    await expect(saveChore({ id: 'louca', values: ofBeto })).rejects.toBe(mockDb.single);
    // Como o supabase-js devolve a falha de rede.
    mockDb.single = { data: null, error: { code: '', message: 'TypeError: Network request failed' } };
    await expect(saveChore({ id: 'louca', values: ofBeto })).rejects.toMatchObject({ message: 'TypeError: Network request failed' });
    mockDb.single = { data: null, error: { code: '23503', message: 'insert or update on table "chores" violates foreign key constraint' } };
    await expect(saveChore({ id: 'louca', values: ofBeto })).rejects.toMatchObject({ code: '23503' });
    expect(mockDb.calls).toEqual([SINGLE, SINGLE, SINGLE]);
  });

  it('sem o responsável nos valores, nada passa pela função', async () => {
    await saveChore({ id: 'louca', values });
    expect(mockDb.calls).toEqual([REST]);
  });

  it('com a ordem (o formulário mostrou o rodízio, ou está criando um), a tarefa segue direto na tabela', async () => {
    // Encerrando o rodízio que mostrou: o responsável escolhido é gravado com ele ainda lá, e a ordem sai em seguida.
    await saveChore({ id: 'louca', values: ofBeto, rotation: [] });
    await saveChore({ id: 'louca', values: ofBeto, rotation: ['p-beto', 'p-carla'] });
    expect(mockDb.calls).toEqual([EVERYTHING, 'rpc save_chore_rotation: ', EVERYTHING, 'rpc save_chore_rotation: p-beto,p-carla']);
  });
});
