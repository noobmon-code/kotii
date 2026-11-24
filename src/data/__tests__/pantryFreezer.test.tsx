import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { DEFAULT_FREEZE_DAYS, FREEZER_NOT_READY } from '@/domain/freezer';
import { EXPECTS_ROWS_META } from '@/lib/accessErrors';

import { fetchFreezerAvailable, useFreezePantryItems, useFreezer, useThawPantryItems } from '../freezer';
import { fetchPantryNear, usePantry, usePantryItem, useSavePantryItem, type PantryValues } from '../home';

// O congelador nos dados: a pergunta se o banco o tem, congelar e descongelar, as leituras da despensa que repetem
// sem as colunas novas e o salvar do formulário (as condições, a linha que volta e o que ensina o produto).

type Reply = { data: unknown; error: object | null };

/** Um pedido como chegou ao servidor. */
interface Asked {
  table: string;
  verb: 'select' | 'update' | 'insert';
  columns?: string;
  values?: Record<string, unknown>;
  /** "eq frozen_on", "is thawed_on"… com o valor. */
  filters: Record<string, unknown>;
  returning: boolean;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = {
  asked: [] as Asked[],
  rpcs: [] as { name: string; args: unknown }[],
  /** As respostas, na ordem: a primeira de cada lista sai no primeiro pedido daquela tabela (ou função). */
  replies: {} as Record<string, Reply[]>,
  /** Segura as respostas das funções até o teste soltar. */
  rpcGate: null as Promise<void> | null,
};
const reply = (key: string): Reply => mockDb.replies[key]?.shift() ?? { data: [], error: null };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const asked: Asked = { table, verb: 'select', filters: {}, returning: false };
      const query = {
        select: (columns?: string) => {
          if (asked.verb === 'select') asked.columns = columns;
          else asked.returning = true;
          return query;
        },
        update: (values: Record<string, unknown>) => {
          Object.assign(asked, { verb: 'update', values });
          return query;
        },
        insert: (values: Record<string, unknown>) => {
          Object.assign(asked, { verb: 'insert', values });
          return query;
        },
        eq: (column: string, value: unknown) => {
          asked.filters[`eq ${column}`] = value;
          return query;
        },
        is: (column: string, value: unknown) => {
          asked.filters[`is ${column}`] = value;
          return query;
        },
        in: (column: string, value: unknown) => {
          asked.filters[`in ${column}`] = value;
          return query;
        },
        gte: (column: string, value: unknown) => {
          asked.filters[`gte ${column}`] = value;
          return query;
        },
        lte: (column: string, value: unknown) => {
          asked.filters[`lte ${column}`] = value;
          return query;
        },
        order: () => query,
        maybeSingle: () => query,
        single: () => query,
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
          mockDb.asked.push(asked);
          return Promise.resolve(reply(`${table} ${asked.verb}`)).then(resolve, reject);
        },
      };
      return query;
    },
    rpc: (name: string, args: unknown) => {
      mockDb.rpcs.push({ name, args });
      return (mockDb.rpcGate ?? Promise.resolve()).then(() => reply(name));
    },
  },
  unwrap: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
}));

let renderer: ReactTestRenderer | undefined;

/** Roda um hook de verdade dentro de um QueryClient; devolve o que ele deu por último e as chaves invalidadas. */
async function withHook<T>(useIt: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  const invalidated: unknown[] = [];
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((filters?: { queryKey?: readonly unknown[] }) => {
    invalidated.push(filters?.queryKey?.[0]);
    return invalidate(filters);
  }) as typeof client.invalidateQueries;
  const seen: { current: T | undefined } = { current: undefined };
  function Probe() {
    seen.current = useIt();
    return null;
  }
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return { client, invalidated, value: () => seen.current as T };
}

const flush = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const MISSING_COLUMN = { code: '42703', message: 'column pantry_items.frozen_on does not exist' };
const MISSING_WRITE_COLUMN = { code: 'PGRST204', message: "Could not find the 'frozen_on' column of 'pantry_items' in the schema cache" };

beforeEach(() => {
  mockDb.asked = [];
  mockDb.rpcs = [];
  mockDb.replies = {};
  mockDb.rpcGate = null;
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('a pergunta: o banco já tem o congelador?', () => {
  it('true, false sem a função, e outro erro sobe', async () => {
    mockDb.replies.pantry_freezer_available = [
      { data: true, error: null },
      { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.pantry_freezer_available' } },
      { data: null, error: { code: '500', message: 'caiu' } },
    ];
    await expect(fetchFreezerAvailable()).resolves.toBe(true);
    await expect(fetchFreezerAvailable()).resolves.toBe(false);
    await expect(fetchFreezerAvailable()).rejects.toEqual({ code: '500', message: 'caiu' });
  });

  it('useFreezer: os dias só com true (pendente, false e a falha sem resposta guardada dão null)', async () => {
    let release!: () => void;
    mockDb.rpcGate = new Promise<void>((resolve) => (release = resolve));
    mockDb.replies.pantry_freezer_available = [{ data: true, error: null }];
    const { value } = await withHook(() => useFreezer());
    expect(value()).toEqual({ available: undefined, days: null });
    mockDb.rpcGate = null;
    release();
    await flush();
    await flush();
    expect(value()).toEqual({ available: true, days: DEFAULT_FREEZE_DAYS });
    await act(async () => renderer?.unmount());
    mockDb.replies.pantry_freezer_available = [{ data: null, error: { code: 'PGRST202', message: 'pantry_freezer_available' } }];
    const without = await withHook(() => useFreezer());
    await flush();
    expect(without.value()).toEqual({ available: false, days: null });
    await act(async () => renderer?.unmount());
    mockDb.replies.pantry_freezer_available = [{ data: null, error: { code: '500', message: 'caiu' } }];
    const failed = await withHook(() => useFreezer());
    await flush();
    expect(failed.value()).toEqual({ available: undefined, days: null });
  });
});

describe('congelar e descongelar', () => {
  it('congelar manda as compras, o tipo e o dia (sem dias: o banco tem os dele), e devolve as que mudaram', async () => {
    mockDb.replies.freeze_pantry_items = [
      { data: [{ item_id: 'a', item_expires_on: '2027-02-18', item_expiry_source: 'congelado', item_frozen_on: '2026-11-20' }], error: null },
    ];
    const { client, invalidated, value } = await withHook(() => useFreezePantryItems());
    let rows: unknown;
    await act(async () => {
      rows = await value().mutateAsync({ ids: ['a', 'b'], kind: 'frango', frozenOn: '2026-11-20' });
    });
    expect(mockDb.rpcs).toEqual([{ name: 'freeze_pantry_items', args: { p_ids: ['a', 'b'], p_kind: 'frango', p_frozen_on: '2026-11-20' } }]);
    expect(rows).toEqual([{ id: 'a', expiresOn: '2027-02-18', expirySource: 'congelado', frozenOn: '2026-11-20' }]);
    expect(client.getMutationCache().getAll()[0].options.meta).toEqual(EXPECTS_ROWS_META);
    expect(invalidated).toEqual(['pantry']);
  });

  it('descongelar manda as compras e o dia, e devolve qual foi desfeita', async () => {
    mockDb.replies.thaw_pantry_items = [
      {
        data: [
          { item_id: 'a', item_expires_on: '2026-11-23', item_expiry_source: 'descongelado', item_frozen_on: '2026-11-01', item_undone: false },
          // A descongelada que tinha voltado ao congelador, desfeita: volta com frozen_on, e só item_undone diz que desfez.
          { item_id: 'b', item_expires_on: '2026-11-23', item_expiry_source: 'descongelado', item_frozen_on: '2026-11-01', item_undone: true },
        ],
        error: null,
      },
    ];
    const { client, invalidated, value } = await withHook(() => useThawPantryItems());
    let rows: unknown;
    await act(async () => {
      rows = await value().mutateAsync({ ids: ['a', 'b'], thawedOn: '2026-11-20' });
    });
    expect(mockDb.rpcs).toEqual([{ name: 'thaw_pantry_items', args: { p_ids: ['a', 'b'], p_thawed_on: '2026-11-20' } }]);
    expect(rows).toEqual([
      { id: 'a', expiresOn: '2026-11-23', expirySource: 'descongelado', frozenOn: '2026-11-01', undone: false },
      { id: 'b', expiresOn: '2026-11-23', expirySource: 'descongelado', frozenOn: '2026-11-01', undone: true },
    ]);
    expect(client.getMutationCache().getAll()[0].options.meta).toEqual(EXPECTS_ROWS_META);
    expect(invalidated).toEqual(['pantry']);
  });

  it('a função que o banco não tem diz que está sendo ativado; o dia fora do que o banco aceita, que a data do aparelho está errada', async () => {
    mockDb.replies.freeze_pantry_items = [
      { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.freeze_pantry_items' } },
      { data: null, error: { code: '22023', message: 'freeze day out of range' } },
    ];
    mockDb.replies.thaw_pantry_items = [{ data: null, error: { code: '42883', message: 'function public.thaw_pantry_items(uuid[], date) does not exist' } }];
    const freeze = await withHook(() => useFreezePantryItems());
    await act(async () => {
      await expect(freeze.value().mutateAsync({ ids: ['a'], kind: 'carne', frozenOn: '2026-11-20' })).rejects.toThrow(FREEZER_NOT_READY);
      await expect(freeze.value().mutateAsync({ ids: ['a'], kind: 'carne', frozenOn: '1999-11-20' })).rejects.toThrow(
        'A data deste aparelho parece errada. Acerte o dia e a hora dele para o Kotii guardar o dia do congelador.',
      );
    });
    await act(async () => renderer?.unmount());
    const thaw = await withHook(() => useThawPantryItems());
    await act(async () => {
      await expect(thaw.value().mutateAsync({ ids: ['a'], thawedOn: '2026-11-20' })).rejects.toThrow(FREEZER_NOT_READY);
    });
  });
});

describe('as leituras da despensa', () => {
  it('pedem as colunas do congelador e repetem sem elas quando o banco não as tem', async () => {
    mockDb.replies['pantry_items select'] = [
      { data: null, error: MISSING_COLUMN },
      { data: [{ id: 'a', name: 'Frango' }], error: null },
    ];
    const { value } = await withHook(() => usePantry());
    await flush();
    expect(value().data).toEqual([{ id: 'a', name: 'Frango' }]);
    expect(mockDb.asked.map((asked) => asked.columns)).toEqual([
      'id, product_id, name, category, quantity, unit, purchased_on, expires_on, expiry_source, consumed_at, frozen_on, thawed_on, freeze_kind, fresh_expires_on, fresh_expiry_source',
      'id, product_id, name, category, quantity, unit, purchased_on, expires_on, expiry_source, consumed_at',
    ]);
  });

  it('a compra sozinha também', async () => {
    mockDb.replies['pantry_items select'] = [
      { data: null, error: { code: '42703', message: 'column pantry_items.fresh_expiry_source does not exist' } },
      { data: { id: 'a', name: 'Frango' }, error: null },
    ];
    const { value } = await withHook(() => usePantryItem('a'));
    await flush();
    expect(value().data).toEqual({ id: 'a', name: 'Frango' });
    expect(mockDb.asked).toHaveLength(2);
  });

  it('as compras do carrinho perto da nota trazem o id: é ele que o "Não colocar" congela (repeatFreezes, entryId)', async () => {
    mockDb.replies['pantry_items select'] = [{ data: [{ id: 'cart-1', product_id: 'p1', name: 'Picanha', purchased_on: '2026-11-10' }], error: null }];
    await expect(fetchPantryNear('2026-11-10')).resolves.toEqual([
      { id: 'cart-1', product_id: 'p1', name: 'Picanha', purchased_on: '2026-11-10' },
    ]);
    expect(mockDb.asked).toEqual([
      {
        table: 'pantry_items',
        verb: 'select',
        columns: 'id, product_id, name, purchased_on',
        filters: { 'is receipt_item_id': null, 'gte purchased_on': '2026-11-07', 'lte purchased_on': '2026-11-13' },
        returning: false,
      },
    ]);
  });

  it('outro erro não repete', async () => {
    mockDb.replies['pantry_items select'] = [{ data: null, error: { code: '42703', message: 'column pantry_items.outra does not exist' } }];
    const { value } = await withHook(() => usePantry());
    await flush();
    expect(value().isError).toBe(true);
    expect(mockDb.asked).toHaveLength(1);
  });
});

describe('salvar a compra (o formulário)', () => {
  const values = (patch: Partial<PantryValues> = {}): PantryValues => ({
    name: 'Picanha',
    category: 'carnes',
    quantity: 1,
    unit: 'kg',
    purchased_on: '2026-11-01',
    expires_on: '2026-11-04',
    expiry_source: 'categoria',
    ...patch,
  });
  const saved = { id: 'a', name: 'Picanha', frozen_on: null };
  const updates = () => mockDb.asked.filter((asked) => asked.table === 'pantry_items' && asked.verb === 'update');
  const learned = () => mockDb.asked.filter((asked) => asked.table === 'products');

  it('com a cópia que traz o congelador: só grava se ele ainda é o mesmo, e pede a linha de volta', async () => {
    mockDb.replies['pantry_items update'] = [{ data: [saved], error: null }];
    const { client, value } = await withHook(() => useSavePantryItem());
    let rows: unknown;
    await act(async () => {
      rows = await value().mutateAsync({ id: 'a', values: values(), copy: { frozen_on: '2026-11-01', thawed_on: null } });
    });
    expect(rows).toEqual([saved]);
    expect(updates()[0]).toEqual(
      expect.objectContaining({ filters: { 'eq id': 'a', 'eq frozen_on': '2026-11-01', 'is thawed_on': null }, returning: true }),
    );
    expect(client.getMutationCache().getAll()[0].options.meta).toEqual(EXPECTS_ROWS_META);
  });

  it('a cópia de antes desta versão, com o congelador no banco: só fora dele; sem a coluna na API, repete sem a condição', async () => {
    mockDb.replies['pantry_items update'] = [
      { data: null, error: MISSING_COLUMN },
      { data: [saved], error: null },
    ];
    const { value } = await withHook(() => useSavePantryItem());
    await act(async () => {
      await value().mutateAsync({ id: 'a', values: values(), copy: {}, freezerAvailable: true });
    });
    expect(updates().map((asked) => asked.filters)).toEqual([{ 'eq id': 'a', 'is frozen_on': null }, { 'eq id': 'a' }]);
  });

  it('sem o congelador no banco e sem as colunas na cópia: a gravação de sempre (com a linha de volta)', async () => {
    mockDb.replies['pantry_items update'] = [{ data: [saved], error: null }];
    const { value } = await withHook(() => useSavePantryItem());
    await act(async () => {
      await value().mutateAsync({ id: 'a', values: values(), copy: {} });
    });
    expect(updates()[0]).toEqual(expect.objectContaining({ filters: { 'eq id': 'a' }, returning: true }));
  });

  it('nenhuma linha de volta: [] (a tela diz que mudou), e nada é ensinado', async () => {
    mockDb.replies['pantry_items update'] = [{ data: [], error: null }];
    const { value } = await withHook(() => useSavePantryItem());
    let rows: unknown;
    await act(async () => {
      rows = await value().mutateAsync({
        id: 'a',
        productId: 'p1',
        values: values({ expires_on: '2026-11-30', expiry_source: 'manual' }),
        copy: { frozen_on: null, thawed_on: null },
      });
    });
    expect(rows).toEqual([]);
    expect(learned()).toEqual([]);
  });

  it('a validade digitada ensina o produto, menos a de uma compra que esteve no congelador', async () => {
    const typed = values({ expires_on: '2026-11-30', expiry_source: 'manual' });
    const run = async (input: Parameters<ReturnType<typeof useSavePantryItem>['mutateAsync']>[0], back: object) => {
      mockDb.asked = [];
      mockDb.replies['pantry_items update'] = [{ data: [back], error: null }];
      mockDb.replies['products update'] = [{ data: [{ id: 'p1' }], error: null }];
      const { value } = await withHook(() => useSavePantryItem());
      await act(async () => {
        await value().mutateAsync(input);
      });
      await act(async () => renderer?.unmount());
      return learned().length;
    };
    // A compra fresca ensina.
    expect(await run({ id: 'a', productId: 'p1', values: typed, copy: { frozen_on: null, thawed_on: null } }, saved)).toBe(1);
    // A que está ou esteve no congelador, não: pela cópia, pelo que vai, ou pela linha que volta.
    expect(await run({ id: 'a', productId: 'p1', values: typed, copy: { frozen_on: '2026-11-01', thawed_on: null } }, saved)).toBe(0);
    expect(await run({ id: 'a', productId: 'p1', values: typed, copy: { frozen_on: '2026-11-01', thawed_on: '2026-11-05' } }, saved)).toBe(0);
    expect(
      await run(
        { id: 'a', productId: 'p1', values: { ...typed, frozen_on: '2026-11-01', freeze_kind: 'carne' }, copy: { frozen_on: null, thawed_on: null } },
        saved,
      ),
    ).toBe(0);
    expect(await run({ id: 'a', productId: 'p1', values: typed, copy: {} }, { ...saved, frozen_on: '2026-11-01' })).toBe(0);
  });

  it('a gravação com as colunas do congelador que o banco não tem diz que o congelador está sendo ativado', async () => {
    mockDb.replies['pantry_items update'] = [{ data: null, error: MISSING_WRITE_COLUMN }];
    const { value } = await withHook(() => useSavePantryItem());
    await act(async () => {
      await expect(
        value().mutateAsync({
          id: 'a',
          values: values({ frozen_on: '2026-11-01', freeze_kind: 'carne', expiry_source: 'congelado' }),
          copy: { frozen_on: null, thawed_on: null },
        }),
      ).rejects.toThrow(FREEZER_NOT_READY);
    });
  });

  it('o item novo vai com insert e a linha de volta', async () => {
    mockDb.replies['pantry_items insert'] = [{ data: [saved], error: null }];
    const { invalidated, value } = await withHook(() => useSavePantryItem());
    let rows: unknown;
    await act(async () => {
      rows = await value().mutateAsync({ values: values() });
    });
    expect(rows).toEqual([saved]);
    expect(mockDb.asked[0]).toEqual(expect.objectContaining({ verb: 'insert', returning: true }));
    expect(invalidated).toEqual(['pantry', 'products']);
  });
});
