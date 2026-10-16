import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { isRotationChangedElsewhere, isRotationUnavailable, ROTATION_NOT_READY } from '@/domain/choreRotation';
import { isChoreGoneOnSave } from '@/domain/chores';

import { fetchChoreRotations, saveChore } from '../home';

type Answer = { data: unknown; error: unknown } | Error;

// "mock" no nome: o jest.mock só enxerga variáveis assim.
// O banco de mentira: o que cada chamada responde e o que foi chamado.
const mockDb: {
  rotation: { data: unknown; error: unknown };
  /** O que save_chore responde: uma resposta para todas as chamadas, ou uma por chamada, na ordem (a última vale para as seguintes). */
  rpc: Answer | Answer[];
  /** O que a gravação direto na tabela responde (com `.select()`, as linhas que mudou). */
  update: Answer;
  /** O que a olhada na tabela do rodízio responde, antes de gravar direto na tabela das tarefas. */
  probe: Answer;
  /** Cada chamada a uma função do banco, com os argumentos como foram mandados. */
  rpcs: { name: string; args: Record<string, unknown> }[];
  /** Tudo o que foi ao banco, na ordem. */
  calls: string[];
} = {
  rotation: { data: [], error: null },
  rpc: { data: 'salva', error: null },
  update: { data: [{ id: 'louca' }], error: null },
  probe: { data: null, error: null },
  rpcs: [],
  calls: [],
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        order: async () => mockDb.rotation,
        limit: async () => {
          mockDb.calls.push(`olha ${table}`);
          if (mockDb.probe instanceof Error) throw mockDb.probe;
          return mockDb.probe;
        },
      }),
      insert: (values: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            mockDb.calls.push(`insert ${table}: ${Object.keys(values).join(',')}`);
            return { data: { id: 'nova' }, error: null };
          },
        }),
      }),
      update: (values: Record<string, unknown>) => {
        // Uma consulta do supabase-js: `.eq()`, talvez `.select()`, e ela responde quando alguém espera por ela.
        let id: unknown;
        // Só com `.select()` a gravação devolve as linhas que mudou.
        let returning = false;
        const query = {
          eq: (_column: string, value: unknown) => {
            id = value;
            return query;
          },
          select: () => {
            returning = true;
            return query;
          },
          then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
            mockDb.calls.push(`update ${table} ${id}: ${Object.keys(values).join(',')}${returning ? ' (devolve as linhas)' : ''}`);
            const answer = mockDb.update;
            if (answer instanceof Error) return Promise.reject(answer).then(resolve, reject);
            return Promise.resolve(returning ? answer : { ...answer, data: null }).then(resolve, reject);
          },
        };
        return query;
      },
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      mockDb.calls.push(`rpc ${name}`);
      mockDb.rpcs.push({ name, args });
      const answers = Array.isArray(mockDb.rpc) ? mockDb.rpc : [mockDb.rpc];
      const answer = answers[Math.min(mockDb.rpcs.length, answers.length) - 1];
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
const NO_FUNCTION = {
  code: 'PGRST202',
  message:
    'Could not find the function public.save_chore(p_assigned_to, p_chore_id, p_due_on, p_equipment_id, p_expect_none, p_interval_count, p_kid_id, p_notes, p_people, p_points, p_recurrence, p_set_turn, p_title) in the schema cache',
};
// A recusa de save_chore ao formulário que abriu sem rodízio: a tarefa tem um.
const HAS_ROTATION = { code: 'NK006', message: 'chore has a rotation', details: null, hint: null };
// A tarefa não está mais nesta casa (apagada em outro aparelho, ou a pessoa saiu da casa).
const NOT_FOUND = { code: 'P0002', message: 'chore not found', details: null, hint: null };
// Como o supabase-js devolve a falha de rede.
const OFFLINE = { code: '', message: 'TypeError: Network request failed' };

const values = { title: 'Lavar a louça', notes: null, recurrence: 'daily' as const, interval_count: 1, due_on: '2026-10-12' };
// O que save_chore recebe de `values`, seja qual for o formulário.
const FIELDS = { p_title: 'Lavar a louça', p_notes: null, p_recurrence: 'daily', p_interval_count: 1, p_due_on: '2026-10-12' };
// Sem responsável escolhido, sem ordem, sem aparelho, sem os pontos (ficam como estão) e sem o aviso.
const UNTOUCHED = { p_points: null, p_equipment_id: null, p_set_turn: false, p_assigned_to: null, p_kid_id: null, p_people: null, p_expect_none: false };
const ONE_CALL = ['rpc save_chore'];

/** Os argumentos da única chamada feita. */
function sent() {
  expect(mockDb.calls).toEqual(ONE_CALL);
  return mockDb.rpcs[0].args;
}

beforeEach(() => {
  mockDb.rotation = { data: [], error: null };
  mockDb.rpc = { data: 'salva', error: null };
  mockDb.update = { data: [{ id: 'louca' }], error: null };
  // O banco sem a função também não tem a tabela do rodízio (o app chegou antes da migração).
  mockDb.probe = { data: null, error: NO_TABLE };
  mockDb.rpcs = [];
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

describe('salvar a tarefa: uma chamada só ao banco, com a tarefa inteira', () => {
  it('tarefa nova sem rodízio: os campos, o aparelho e o responsável escolhido; o id vem na resposta', async () => {
    // O que o Nuke e as sugestões de manutenção mandam: de qualquer um, sem falar de pontos.
    expect(await saveChore({ values: { ...values, assigned_to: null, equipment_id: 'geladeira' } })).toEqual({ id: 'salva' });
    expect(sent()).toEqual({ ...UNTOUCHED, ...FIELDS, p_chore_id: null, p_equipment_id: 'geladeira', p_set_turn: true });
  });

  it('tarefa nova de uma criança, com os pontos', async () => {
    await saveChore({ values: { ...values, assigned_to: null, kid_id: 'p-lia', points: 10 }, rotation: null });
    expect(sent()).toEqual({ ...UNTOUCHED, ...FIELDS, p_chore_id: null, p_points: 10, p_set_turn: true, p_kid_id: 'p-lia' });
  });

  it('tarefa nova já com rodízio: a ordem vai junto, e o responsável não (a vez do rodízio novo quem põe é o banco)', async () => {
    // O editor manda o primeiro da ordem como responsável, para o banco que ainda não tem o rodízio: aqui ele não vai.
    const ofBeto = { ...values, assigned_to: 'u-beto', kid_id: null, points: 10 };
    expect(await saveChore({ values: ofBeto, rotation: ['p-beto', 'p-lia'] })).toEqual({ id: 'salva' });
    expect(sent()).toEqual({ ...UNTOUCHED, ...FIELDS, p_chore_id: null, p_points: 10, p_people: ['p-beto', 'p-lia'] });
  });

  it('tarefa nova não tem o que conferir: o aviso de "abriu sem rodízio" nem vai', async () => {
    await saveChore({ values, rotation: ['p-beto', 'p-lia'], expectNone: true });
    expect(sent()).toMatchObject({ p_chore_id: null, p_expect_none: false });
  });

  it('tarefa que já existe, formulário que abriu sem rodízio: o responsável escolhido e os pontos, com o aviso para o banco conferir', async () => {
    expect(await saveChore({ id: 'louca', values: { ...values, assigned_to: 'u-beto', kid_id: null, points: 0 }, expectNone: true })).toEqual({
      id: 'salva',
    });
    expect(sent()).toEqual({ ...UNTOUCHED, ...FIELDS, p_chore_id: 'louca', p_points: 0, p_set_turn: true, p_assigned_to: 'u-beto', p_expect_none: true });
    mockDb.calls = [];
    mockDb.rpcs = [];
    // De uma criança, e a ordem dita como "nenhuma".
    await saveChore({ id: 'louca', values: { ...values, assigned_to: null, kid_id: 'p-lia', points: 10 }, rotation: null, expectNone: true });
    expect(sent()).toEqual({ ...UNTOUCHED, ...FIELDS, p_chore_id: 'louca', p_points: 10, p_set_turn: true, p_kid_id: 'p-lia', p_expect_none: true });
  });

  it('formulário que abriu sem rodízio e cria um: a ordem, os pontos e o aviso, sem o responsável', async () => {
    const ofBeto = { ...values, assigned_to: 'u-beto', kid_id: null, points: 10 };
    await saveChore({ id: 'louca', values: ofBeto, rotation: ['p-beto', 'p-lia'], expectNone: true });
    expect(sent()).toEqual({ ...UNTOUCHED, ...FIELDS, p_chore_id: 'louca', p_points: 10, p_people: ['p-beto', 'p-lia'], p_expect_none: true });
  });

  it('formulário que mostrou o rodízio: a ordem e os pontos, sem o responsável e sem o aviso', async () => {
    await saveChore({ id: 'louca', values: { ...values, points: 10 }, rotation: ['p-lia', 'p-beto', 'p-carla'] });
    expect(sent()).toEqual({ ...UNTOUCHED, ...FIELDS, p_chore_id: 'louca', p_points: 10, p_people: ['p-lia', 'p-beto', 'p-carla'] });
  });

  it('encerrar o rodízio com uma pessoa escolhida: a ordem vazia e o responsável', async () => {
    await saveChore({ id: 'louca', values: { ...values, assigned_to: null, kid_id: 'p-lia', points: 5 }, rotation: [] });
    expect(sent()).toEqual({ ...UNTOUCHED, ...FIELDS, p_chore_id: 'louca', p_points: 5, p_set_turn: true, p_kid_id: 'p-lia', p_people: [] });
  });

  it('tarefa em rodízio que vira "Uma vez": a ordem vazia, e nem o responsável nem os pontos (ficam com o banco)', async () => {
    await saveChore({ id: 'louca', values: { ...values, recurrence: 'none' }, rotation: [] });
    expect(sent()).toEqual({ ...UNTOUCHED, ...FIELDS, p_chore_id: 'louca', p_recurrence: 'none', p_people: [] });
  });

  it('sem responsável nos valores e sem ordem: só os campos', async () => {
    await saveChore({ id: 'louca', values });
    expect(sent()).toEqual({ ...UNTOUCHED, ...FIELDS, p_chore_id: 'louca' });
  });
});

describe('o banco recusa, ou a chamada falha: o erro sobe, e nada mais vai ao banco', () => {
  const ofBeto = { ...values, assigned_to: 'u-beto', kid_id: null, points: 0 };
  const plain = { id: 'louca', values: ofBeto, expectNone: true };
  const created = { id: 'louca', values: ofBeto, rotation: ['p-beto', 'p-lia'], expectNone: true };

  it('a tarefa ganhou um rodízio em outro celular', async () => {
    mockDb.rpc = { data: null, error: HAS_ROTATION };
    const refused = await saveChore(plain).catch((err: unknown) => err);
    expect(refused).toBe(HAS_ROTATION);
    expect(isRotationChangedElsewhere(refused)).toBe(true);
    await expect(saveChore(created)).rejects.toBe(HAS_ROTATION);
    expect(mockDb.calls).toEqual([...ONE_CALL, ...ONE_CALL]);
  });

  it('tarefa apagada em outro aparelho', async () => {
    mockDb.rpc = { data: null, error: NOT_FOUND };
    const gone = await saveChore(plain).catch((err: unknown) => err);
    expect(gone).toBe(NOT_FOUND);
    expect(isChoreGoneOnSave(gone)).toBe(true);
    await expect(saveChore(created)).rejects.toBe(NOT_FOUND);
    await expect(saveChore({ id: 'louca', values, rotation: ['p-beto', 'p-lia'] })).rejects.toBe(NOT_FOUND);
    expect(mockDb.calls).toEqual([...ONE_CALL, ...ONE_CALL, ...ONE_CALL]);
  });

  it('as outras recusas: alguém da ordem saiu da casa, tarefa que não se repete, responsável que saiu da casa', async () => {
    const left = { code: 'P0002', message: 'Alguém do rodízio não está mais na casa. Confira a ordem e salve de novo.' };
    mockDb.rpc = { data: null, error: left };
    const refused = await saveChore(created).catch((err: unknown) => err);
    expect(refused).toBe(left);
    // A tarefa existe: não é o aviso da tarefa apagada.
    expect(isChoreGoneOnSave(refused)).toBe(false);
    mockDb.rpc = { data: null, error: { code: '22023', message: 'Só tarefa que se repete pode ter rodízio.' } };
    await expect(saveChore(created)).rejects.toMatchObject({ code: '22023' });
    mockDb.rpc = { data: null, error: { code: '23503', message: 'insert or update on table "chores" violates foreign key constraint' } };
    await expect(saveChore(plain)).rejects.toMatchObject({ code: '23503' });
    expect(mockDb.calls).toEqual([...ONE_CALL, ...ONE_CALL, ...ONE_CALL]);
  });

  it('sem internet: também sobe, sem tentar gravar a tarefa de outro jeito', async () => {
    mockDb.rpc = { data: null, error: OFFLINE };
    const failed = await saveChore(created).catch((err: unknown) => err);
    expect(failed).toBe(OFFLINE);
    // Não é o banco sem a função: a tarefa não vai direto na tabela.
    expect(isRotationUnavailable(failed)).toBe(false);
    mockDb.rpc = new TypeError('Network request failed');
    await expect(saveChore(created)).rejects.toBe(mockDb.rpc);
    await expect(saveChore({ values })).rejects.toBe(mockDb.rpc);
    expect(mockDb.calls).toEqual([...ONE_CALL, ...ONE_CALL, ...ONE_CALL]);
  });

  it('salvar de novo depois da falha de rede repete a mesma chamada, com a mesma ordem e o mesmo aviso', async () => {
    // A primeira chamada pode ter chegado ao banco: ele aceita a segunda porque a ordem gravada é a que ela traz.
    mockDb.rpc = [{ data: null, error: OFFLINE }, { data: 'louca', error: null }];
    await expect(saveChore(created)).rejects.toBe(OFFLINE);
    expect(await saveChore(created)).toEqual({ id: 'louca' });
    expect(mockDb.calls).toEqual([...ONE_CALL, ...ONE_CALL]);
    expect(mockDb.rpcs[1].args).toEqual(mockDb.rpcs[0].args);
    expect(mockDb.rpcs[1].args).toMatchObject({ p_people: ['p-beto', 'p-lia'], p_expect_none: true });
  });
});

describe('banco que ainda não tem a função (o app chegou antes da migração): a tarefa vai direto na tabela, como antes de o rodízio existir', () => {
  const ofBeto = { ...values, assigned_to: 'u-beto', kid_id: null, points: 10 };
  const EVERYTHING = 'title,notes,recurrence,interval_count,due_on,assigned_to,kid_id,points';
  // A chamada que falhou e a olhada que confere que o banco também não tem a tabela do rodízio.
  const FALLBACK = [...ONE_CALL, 'olha chore_rotation'];

  beforeEach(() => {
    mockDb.rpc = { data: null, error: NO_FUNCTION };
  });

  it('tarefa nova, sem rodízio pedido: grava e pronto', async () => {
    expect(await saveChore({ values: { ...values, assigned_to: null, equipment_id: 'geladeira' } })).toEqual({ id: 'nova' });
    expect(mockDb.calls).toEqual([...FALLBACK, 'insert chores: title,notes,recurrence,interval_count,due_on,assigned_to,equipment_id']);
  });

  it('tarefa nova, com rodízio pedido: fica salva, com o primeiro da ordem como responsável, e o resultado diz que o rodízio ficou de fora', async () => {
    expect(await saveChore({ values: ofBeto, rotation: ['p-beto', 'p-lia'] })).toEqual({ id: 'nova', rotationUnavailable: true });
    expect(mockDb.calls).toEqual([...FALLBACK, `insert chores: ${EVERYTHING}`]);
  });

  it('tarefa que já existe, sem rodízio pedido: a gravação leva o responsável e pede a linha de volta', async () => {
    expect(await saveChore({ id: 'louca', values: ofBeto, expectNone: true })).toEqual({ id: 'louca' });
    expect(mockDb.calls).toEqual([...FALLBACK, `update chores louca: ${EVERYTHING} (devolve as linhas)`]);
  });

  it('tarefa que já existe, com rodízio pedido: fica salva, e o resultado diz que o rodízio ficou de fora', async () => {
    expect(await saveChore({ id: 'louca', values: ofBeto, rotation: ['p-beto', 'p-lia'], expectNone: true })).toEqual({
      id: 'louca',
      rotationUnavailable: true,
    });
    expect(mockDb.calls).toEqual([...FALLBACK, `update chores louca: ${EVERYTHING} (devolve as linhas)`]);
  });

  it('banco que já tem a tabela do rodízio, mas a API ainda não enxerga a função: nada é gravado, e o aviso pede para tentar de novo', async () => {
    // Gravando direto na tabela, a tarefa que deixou o rodízio continuaria nele (a ordem não mudaria).
    mockDb.probe = { data: [{ chore_id: 'louca' }], error: null };
    await expect(saveChore({ id: 'louca', values: { ...values, assigned_to: 'u-beto', kid_id: null }, rotation: [] })).rejects.toThrow(
      ROTATION_NOT_READY,
    );
    // Também a tarefa nova e a tabela vazia: o banco tem o rodízio, e quem salva é a função.
    mockDb.probe = { data: [], error: null };
    await expect(saveChore({ values: ofBeto, rotation: ['p-beto', 'p-lia'] })).rejects.toThrow(ROTATION_NOT_READY);
    expect(mockDb.calls).toEqual([...FALLBACK, ...FALLBACK]);
  });

  it('a API não enxerga nem a função nem a tabela, mas o banco já tem o rodízio: ele recusa a troca da vez, e o aviso pede para tentar de novo', async () => {
    // O cache do esquema ficou para trás (a olhada diz "sem a tabela"), e a tarefa está em rodízio no banco: gravada
    // direto, a troca do responsável deixaria a ordem lá. O banco recusa (NK009) e nada muda. O texto da recusa é o
    // que o app já instalado mostra; este reconhece a recusa pelo código e mostra o aviso dele.
    const refused = { code: 'NK009', message: 'Esta tarefa está em rodízio. Atualize o app para trocar o responsável.', details: null, hint: null };
    mockDb.update = { data: null, error: refused };
    const err = await saveChore({ id: 'louca', values: { ...values, assigned_to: 'u-beto', kid_id: null }, rotation: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(ROTATION_NOT_READY);
    expect(mockDb.calls).toEqual([...FALLBACK, 'update chores louca: title,notes,recurrence,interval_count,due_on,assigned_to,kid_id (devolve as linhas)']);
    // Os outros erros da gravação direta seguem como estão.
    mockDb.update = { data: null, error: HAS_ROTATION };
    await expect(saveChore({ id: 'louca', values: ofBeto })).rejects.toBe(HAS_ROTATION);
  });

  it('formulário que mostrou um rodízio: o banco tem o rodízio, então a função faltar é o cache do esquema; nada é gravado, nem pela tabela', async () => {
    // A olhada diria "sem a tabela" (o cache ficou para trás) e a gravação direta passaria: encerrar o rodízio com a
    // mesma pessoa na vez não troca a vez, o banco não recusa, e a ordem ficaria lá. Seja o que for que o formulário
    // muda (encerrar o rodízio, uma ordem nova, só o título), nem a olhada vai: o aviso é o de tentar de novo.
    for (const rotation of [[], ['p-lia', 'p-beto'], null]) {
      const err = await saveChore({ id: 'louca', values: { ...values, assigned_to: 'u-beto', kid_id: null, points: 0 }, rotation, shownRotation: true }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe(ROTATION_NOT_READY);
    }
    expect(mockDb.calls).toEqual([...ONE_CALL, ...ONE_CALL, ...ONE_CALL]);
    // A mesma chamada, sem o rodízio mostrado (o Nuke, o aparelho, o formulário que abriu sem rodízio): grava direto.
    mockDb.calls = [];
    expect(await saveChore({ id: 'louca', values: ofBeto })).toEqual({ id: 'louca' });
    expect(mockDb.calls).toEqual([...FALLBACK, `update chores louca: ${EVERYTHING} (devolve as linhas)`]);
  });

  it('a olhada na tabela do rodízio falha (sem internet, outra recusa): o erro sobe, e nada é gravado', async () => {
    mockDb.probe = { data: null, error: OFFLINE };
    await expect(saveChore({ id: 'louca', values: ofBeto })).rejects.toBe(OFFLINE);
    mockDb.probe = new TypeError('Network request failed');
    await expect(saveChore({ id: 'louca', values: ofBeto })).rejects.toBe(mockDb.probe);
    expect(mockDb.calls).toEqual([...FALLBACK, ...FALLBACK]);
  });

  it('o Postgres dizendo o mesmo (42883) também cai aí', async () => {
    mockDb.rpc = { data: null, error: { code: '42883', message: 'function public.save_chore(uuid, text) does not exist' } };
    expect(await saveChore({ id: 'louca', values: ofBeto })).toEqual({ id: 'louca' });
    expect(mockDb.calls).toEqual([...FALLBACK, `update chores louca: ${EVERYTHING} (devolve as linhas)`]);
  });

  it('tarefa apagada em outro aparelho: a gravação não acha a linha, e isso sobe como a tarefa que não existe', async () => {
    // Para a API não é erro: ela responde que gravou em nenhuma linha.
    mockDb.update = { data: [], error: null };
    const gone = await saveChore({ id: 'louca', values: ofBeto, rotation: ['p-beto', 'p-lia'], expectNone: true }).catch((err: unknown) => err);
    expect(isChoreGoneOnSave(gone)).toBe(true);
    expect(mockDb.calls).toEqual([...FALLBACK, `update chores louca: ${EVERYTHING} (devolve as linhas)`]);
  });

  it('a gravação direto na tabela falha: o erro sobe', async () => {
    mockDb.update = { data: null, error: OFFLINE };
    await expect(saveChore({ id: 'louca', values: ofBeto })).rejects.toBe(OFFLINE);
    mockDb.update = new TypeError('Network request failed');
    await expect(saveChore({ id: 'louca', values: ofBeto })).rejects.toBe(mockDb.update);
  });
});
