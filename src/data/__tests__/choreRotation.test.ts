import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { isRotationChangedElsewhere, isRotationUnavailable } from '@/domain/choreRotation';
import { isChoreGoneOnSave } from '@/domain/chores';

import { fetchChoreRotations, saveChore } from '../home';

// "mock" no nome: o jest.mock só enxerga variáveis assim.
// O banco de mentira: o que cada chamada responde e o que foi chamado.
const mockDb: {
  rotation: { data: unknown; error: unknown };
  rpc: { data: unknown; error: unknown } | Error;
  /** O que save_chore_single responde (as outras funções: `rpc`). */
  single: { data: unknown; error: unknown } | Error;
  /** O que save_chore_rotation responde quando vem com p_expect_none (sem ele: `rpc`). */
  flagged: { data: unknown; error: unknown } | Error;
  /** O que a gravação direto na tabela responde. */
  update: { data: unknown; error: unknown } | Error;
  /** O que responde a gravação só da repetição, a que exige `recurrence=none`: a linha, se a tarefa era "Uma vez" no banco, ou nenhuma. */
  repeats: { data: unknown; error: unknown } | Error;
  calls: string[];
} = {
  rotation: { data: [], error: null },
  rpc: { data: null, error: null },
  single: { data: null, error: null },
  flagged: { data: null, error: null },
  update: { data: null, error: null },
  repeats: { data: [], error: null },
  calls: [],
};

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
      update: (values: Record<string, unknown>) => {
        // Uma consulta do supabase-js: `.eq()` uma ou mais vezes, e ela responde quando alguém espera por ela.
        const filters: [string, unknown][] = [];
        // Só com `.select()` a gravação devolve as linhas que mudou.
        let returning = false;
        const query = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return query;
          },
          select: () => {
            returning = true;
            return query;
          },
          then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
            // Além do id, o que mais a gravação exige da linha ("se recurrence=none").
            const [[, id], ...more] = filters;
            const only = more.map(([column, value]) => ` se ${column}=${value}`).join('');
            mockDb.calls.push(`update ${table} ${id}: ${Object.keys(values).join(',')}${only}`);
            // A gravação com condição é a da repetição, e responde à parte: o teste diz se ela achou a linha.
            const answer = more.length ? mockDb.repeats : mockDb.update;
            if (answer instanceof Error) return Promise.reject(answer).then(resolve, reject);
            return Promise.resolve(returning ? answer : { ...answer, data: null }).then(resolve, reject);
          },
        };
        return query;
      },
    }),
    rpc: async (
      name: string,
      args: { p_chore_id: string; p_people?: string[]; p_expect_none?: boolean; p_assigned_to?: unknown; p_kid_id?: unknown; p_points?: unknown },
    ) => {
      if (name === 'save_chore_single') {
        mockDb.calls.push(`rpc ${name} ${args.p_chore_id}: ${JSON.stringify([args.p_assigned_to, args.p_kid_id, args.p_points])}`);
        if (mockDb.single instanceof Error) throw mockDb.single;
        return mockDb.single;
      }
      // O terceiro argumento só aparece quando foi mandado: o banco com a função de dois argumentos não acha a de três.
      const flagged = 'p_expect_none' in args;
      mockDb.calls.push(`rpc ${name}: ${args.p_people?.join(',')}${flagged ? ` (p_expect_none: ${args.p_expect_none})` : ''}`);
      const answer = flagged ? mockDb.flagged : mockDb.rpc;
      if (answer instanceof Error) throw answer;
      return answer;
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
// A recusa de save_chore_single, e de save_chore_rotation com p_expect_none: a tarefa tem rodízio.
const HAS_ROTATION = { code: 'NK006', message: 'chore has a rotation', details: null, hint: null };
// Banco com a save_chore_rotation de dois argumentos (uma cópia de antes): a de três a API não acha.
const NO_FLAG = {
  code: 'PGRST202',
  message: 'Could not find the function public.save_chore_rotation(p_chore_id, p_expect_none, p_people) in the schema cache',
};
// A tarefa não está mais nesta casa (apagada em outro aparelho, ou a pessoa saiu da casa).
const NOT_FOUND = { code: 'P0002', message: 'chore not found', details: null, hint: null };
// Como o supabase-js devolve a falha de rede.
const OFFLINE = { code: '', message: 'TypeError: Network request failed' };

const values = { title: 'Lavar a louça', notes: null, recurrence: 'daily' as const, interval_count: 1, due_on: '2026-10-12' };

beforeEach(() => {
  mockDb.rotation = { data: [], error: null };
  mockDb.rpc = { data: null, error: null };
  mockDb.single = { data: null, error: null };
  mockDb.flagged = { data: null, error: null };
  mockDb.update = { data: null, error: null };
  mockDb.repeats = { data: [], error: null };
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

  it('tarefa apagada em outro aparelho: a função responde que ela não existe, o erro sobe e nada mais é gravado', async () => {
    mockDb.single = { data: null, error: NOT_FOUND };
    const gone = await saveChore({ id: 'louca', values: ofBeto }).catch((err: unknown) => err);
    expect(gone).toBe(NOT_FOUND);
    expect(isChoreGoneOnSave(gone)).toBe(true);
    expect(mockDb.calls).toEqual([SINGLE]);
  });
});

describe('salvar um rodízio novo na tarefa que já existe e não mostrou rodízio', () => {
  // O que o editor manda: a vez do primeiro da ordem (para o banco de antes) e os pontos.
  const ofBeto = { ...values, assigned_to: 'u-beto', kid_id: null, points: 10 };
  const created = { id: 'louca', values: ofBeto, rotation: ['p-beto', 'p-lia'], expectNone: true };
  const FLAGGED = 'rpc save_chore_rotation: p-beto,p-lia (p_expect_none: true)';
  const UNFLAGGED = 'rpc save_chore_rotation: p-beto,p-lia';
  const REST = 'update chores louca: title,notes,recurrence,interval_count,due_on,points';
  const EVERYTHING = 'update chores louca: title,notes,recurrence,interval_count,due_on,assigned_to,kid_id,points';
  // A repetição, e só ela, vai antes de tudo, com a condição à vista: só grava na tarefa que segue "Uma vez" no banco.
  const REPEATS = 'update chores louca: recurrence,interval_count se recurrence=none';
  // A tarefa era "Uma vez" no banco: a gravação da repetição achou a linha.
  const ONE_OFF = { data: [{ id: 'louca' }], error: null };

  it('a ordem vai antes do resto, pela função que confere que a tarefa segue sem rodízio; o resto depois, sem o responsável e com os pontos', async () => {
    expect(await saveChore(created)).toEqual({ id: 'louca' });
    // A vez quem põe é a função (o primeiro da ordem); os pontos, em que ela não mexe, vão com o resto.
    expect(mockDb.calls).toEqual([REPEATS, FLAGGED, REST]);
  });

  it('a repetição vai sempre antes da ordem, e só grava se a tarefa segue "Uma vez" no banco (a função recusa rodízio em tarefa que não se repete)', async () => {
    // Tarefa que se repete: a gravação não acha linha nenhuma, e nada muda.
    expect(await saveChore(created)).toEqual({ id: 'louca' });
    // "Uma vez" no banco, tenha o formulário aberto assim ou virado isso em outro celular depois: a repetição que
    // ele mostra é gravada, e a função aceita a ordem. A sequência é a mesma, sem perguntar como o formulário abriu.
    mockDb.repeats = ONE_OFF;
    expect(await saveChore(created)).toEqual({ id: 'louca' });
    expect(mockDb.calls).toEqual([REPEATS, FLAGGED, REST, REPEATS, FLAGGED, REST]);
  });

  it('nem a repetição pôde ser gravada: nada foi salvo, o erro sobe e nada mais é tentado', async () => {
    mockDb.repeats = { data: null, error: OFFLINE };
    await expect(saveChore(created)).rejects.toBe(OFFLINE);
    mockDb.repeats = new TypeError('Network request failed');
    await expect(saveChore(created)).rejects.toBe(mockDb.repeats);
    expect(mockDb.calls).toEqual([REPEATS, REPEATS]);
  });

  it('a tarefa ganhou um rodízio em outro celular: a recusa do banco sobe como erro e nada mais é gravado', async () => {
    mockDb.flagged = { data: null, error: HAS_ROTATION };
    const refused = await saveChore(created).catch((err: unknown) => err);
    expect(refused).toBe(HAS_ROTATION);
    expect(isRotationChangedElsewhere(refused)).toBe(true);
    expect(mockDb.calls).toEqual([REPEATS, FLAGGED]);
  });

  it('tarefa apagada em outro aparelho: o erro sobe e nada mais é gravado', async () => {
    mockDb.flagged = { data: null, error: NOT_FOUND };
    const gone = await saveChore(created).catch((err: unknown) => err);
    expect(gone).toBe(NOT_FOUND);
    expect(isChoreGoneOnSave(gone)).toBe(true);
    expect(mockDb.calls).toEqual([REPEATS, FLAGGED]);
  });

  it('as outras falhas da função (sem internet, alguém da ordem que saiu da casa) também sobem, sem gravar o resto: a tarefa já se repetia, e nada foi salvo', async () => {
    mockDb.flagged = new TypeError('Network request failed');
    await expect(saveChore(created)).rejects.toBe(mockDb.flagged);
    mockDb.flagged = { data: null, error: OFFLINE };
    await expect(saveChore(created)).rejects.toBe(OFFLINE);
    mockDb.flagged = { data: null, error: { code: 'P0002', message: 'Alguém do rodízio não está mais na casa. Confira a ordem e salve de novo.' } };
    await expect(saveChore(created)).rejects.toMatchObject({ code: 'P0002' });
    expect(mockDb.calls).toEqual([REPEATS, FLAGGED, REPEATS, FLAGGED, REPEATS, FLAGGED]);
  });

  it('a tarefa era "Uma vez", a repetição foi gravada e a ordem falha: volta no resultado, não como erro, para a tela dizer o que foi salvo', async () => {
    mockDb.repeats = ONE_OFF;
    mockDb.flagged = { data: null, error: OFFLINE };
    expect(await saveChore(created)).toEqual({ id: 'louca', repeatOnlyError: OFFLINE });
    mockDb.flagged = new TypeError('Network request failed');
    expect(await saveChore(created)).toEqual({ id: 'louca', repeatOnlyError: mockDb.flagged });
    const left = { code: 'P0002', message: 'Alguém do rodízio não está mais na casa. Confira a ordem e salve de novo.' };
    mockDb.flagged = { data: null, error: left };
    expect(await saveChore(created)).toEqual({ id: 'louca', repeatOnlyError: left });
    // O resto da tarefa nem é tentado: sem a ordem aceita, nada mais daquele formulário é gravado.
    expect(mockDb.calls).toEqual([REPEATS, FLAGGED, REPEATS, FLAGGED, REPEATS, FLAGGED]);
  });

  it('com a repetição gravada, o rodízio criado em outro celular e a tarefa apagada seguem subindo como erro: a tela já tem o aviso de cada um', async () => {
    mockDb.repeats = ONE_OFF;
    mockDb.flagged = { data: null, error: HAS_ROTATION };
    await expect(saveChore(created)).rejects.toBe(HAS_ROTATION);
    mockDb.flagged = { data: null, error: NOT_FOUND };
    await expect(saveChore(created)).rejects.toBe(NOT_FOUND);
    expect(mockDb.calls).toEqual([REPEATS, FLAGGED, REPEATS, FLAGGED]);
  });

  it('o resto falha depois de a ordem ser gravada: volta no resultado, não como erro, para a tela dizer o que foi salvo', async () => {
    mockDb.update = { data: null, error: OFFLINE };
    expect(await saveChore(created)).toEqual({ id: 'louca', restError: OFFLINE });
    mockDb.update = new TypeError('Network request failed');
    expect(await saveChore(created)).toEqual({ id: 'louca', restError: mockDb.update });
    expect(mockDb.calls).toEqual([REPEATS, FLAGGED, REST, REPEATS, FLAGGED, REST]);
  });

  it('banco ainda sem o rodízio (o app chegou antes da migração): o caminho de antes, e a falha da ordem volta no resultado', async () => {
    mockDb.flagged = { data: null, error: NO_FUNCTION };
    mockDb.rpc = { data: null, error: NO_FUNCTION };
    const saved = await saveChore(created);
    expect(saved.id).toBe('louca');
    expect(isRotationUnavailable(saved.rotationError)).toBe(true);
    expect(saved.restError).toBeUndefined();
    // A tarefa inteira direto na tabela, com o responsável, e a ordem tentada como sempre foi.
    expect(mockDb.calls).toEqual([REPEATS, FLAGGED, EVERYTHING, UNFLAGGED]);
  });

  it('banco com a função de dois argumentos (uma cópia de antes da migração): o caminho de antes grava a tarefa e a ordem', async () => {
    mockDb.flagged = { data: null, error: NO_FLAG };
    expect(await saveChore(created)).toEqual({ id: 'louca' });
    // Também com a repetição já gravada (a tarefa era "Uma vez"): não é uma falha, a tarefa inteira vem logo depois.
    mockDb.repeats = ONE_OFF;
    expect(await saveChore(created)).toEqual({ id: 'louca' });
    expect(mockDb.calls).toEqual([REPEATS, FLAGGED, EVERYTHING, UNFLAGGED, REPEATS, FLAGGED, EVERYTHING, UNFLAGGED]);
  });

  it('só o rodízio novo de uma tarefa que já existe passa por aí: a tarefa nova e o formulário que mostrou o rodízio nem mandam a repetição antes', async () => {
    // Tarefa nova: ninguém mais pode ter criado um rodízio para ela.
    await saveChore({ values: ofBeto, rotation: ['p-beto', 'p-lia'], expectNone: true });
    // Sem ordem a gravar, o responsável vai pela função da tarefa sem rodízio.
    await saveChore({ id: 'louca', values: ofBeto, rotation: null, expectNone: true });
    // O formulário mostrou o rodízio: a tarefa primeiro e a ordem depois, sem o terceiro argumento.
    await saveChore({ id: 'louca', values, rotation: ['p-beto', 'p-lia'] });
    await saveChore({ id: 'louca', values, rotation: ['p-beto', 'p-lia'], expectNone: false });
    expect(mockDb.calls).toEqual([
      'insert chores: Lavar a louça',
      UNFLAGGED,
      'rpc save_chore_single louca: ["u-beto",null,10]',
      'update chores louca: title,notes,recurrence,interval_count,due_on',
      'update chores louca: title,notes,recurrence,interval_count,due_on',
      UNFLAGGED,
      'update chores louca: title,notes,recurrence,interval_count,due_on',
      UNFLAGGED,
    ]);
    expect(mockDb.calls).not.toContain(REPEATS);
  });
});
