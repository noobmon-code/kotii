import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'fs';
import { join } from 'path';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { LONG_CYCLE_ITEMS, LONG_CYCLE_NOT_READY, longCycleFirstWords, type LongCycleSetting } from '@/domain/longCycle';

import {
  fetchLongCycleHistory,
  fetchLongCycleSettings,
  LONG_CYCLE_HISTORY_KEY,
  LONG_CYCLE_SETTINGS_KEY,
  useSetLongCycleSetting,
} from '../longCycle';
import { useAddItemsToList } from '../market';

interface Call {
  /** A tabela, ou "rpc nome". */
  target: string;
  steps: [string, unknown[]][];
}
type Reply = { data: unknown; error: object | null };

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = {
  calls: [] as Call[],
  reply: (_call: Call): Reply => ({ data: null, error: null }),
};

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
jest.mock('@/lib/supabase', () => {
  // Um pedido como o do Supabase: cada método devolve o próprio pedido, e esperar por ele traz a resposta.
  const request = (target: string, first?: unknown[]) => {
    const call: Call = { target, steps: first ? [['rpc', first]] : [] };
    const builder: object = new Proxy(
      {},
      {
        get: (_target, step) => {
          if (typeof step !== 'string') return undefined;
          if (step !== 'then') {
            return (...args: unknown[]) => {
              call.steps.push([step, args]);
              return builder;
            };
          }
          return (resolve: (reply: Reply) => unknown, reject: (error: unknown) => unknown) => {
            mockDb.calls.push(call);
            return Promise.resolve(mockDb.reply(call)).then(resolve, reject);
          };
        },
      },
    );
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => request(table),
      rpc: (name: string, ...args: unknown[]) => request(`rpc ${name}`, args),
    },
    unwrap: (result: Reply) => {
      if (result.error) throw result.error;
      return result.data;
    },
    errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
  };
});

const step = (call: Call, name: string) => call.steps.find(([s]) => s === name)?.[1];

let renderer: ReactTestRenderer | undefined;

// Sem temporizador de limpeza do cache: o Jest não fica esperando por ele no fim.
const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } } });

async function withHook<T>(useIt: () => T, client = newClient()) {
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
  return { client, value: () => seen.current as T };
}

beforeEach(() => {
  mockDb.calls = [];
  mockDb.reply = () => ({ data: null, error: null });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('a leitura longa', () => {
  it('pede as primeiras palavras e o começo do dia de 48 meses atrás, e lê as linhas', async () => {
    mockDb.reply = () => ({
      data: [
        {
          name: 'Escova Dental Colgate',
          category: 'higiene',
          product_id: 'p1',
          quantity: '2.000',
          unit: 'un',
          bought_at: '2026-06-01T15:00:00+00:00',
          source: 'receipt',
        },
      ],
      error: null,
    });
    const rows = await fetchLongCycleHistory(new Date(2026, 10, 22, 15, 30));
    expect(mockDb.calls[0].target).toBe('rpc long_cycle_purchases');
    expect(step(mockDb.calls[0], 'rpc')).toEqual([
      { p_words: longCycleFirstWords(), p_since: new Date(2022, 10, 22, 0, 0, 0).toISOString() },
    ]);
    expect(rows).toEqual([
      {
        name: 'Escova Dental Colgate',
        category: 'higiene',
        productId: 'p1',
        quantity: 2,
        unit: 'un',
        at: '2026-06-01T15:00:00+00:00',
        source: 'receipt',
      },
    ]);
  });

  it('sem a função no banco, null; outro erro sobe', async () => {
    mockDb.reply = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.long_cycle_purchases' } });
    expect(await fetchLongCycleHistory()).toBeNull();
    const broken = { code: '57014', message: 'canceling statement due to statement timeout' };
    mockDb.reply = () => ({ data: null, error: broken });
    await expect(fetchLongCycleHistory()).rejects.toBe(broken);
  });
});

describe('o que a casa mudou', () => {
  it('lê só as chaves da tabela do app', async () => {
    const rows: LongCycleSetting[] = [{ item_key: 'escova_dente', every_months: 2, off: false, replaced_on: null }];
    mockDb.reply = () => ({ data: rows, error: null });
    expect(await fetchLongCycleSettings()).toEqual(rows);
    const call = mockDb.calls[0];
    expect(call.target).toBe('long_cycle_settings');
    expect(step(call, 'select')).toEqual(['item_key, every_months, off, replaced_on']);
    expect(step(call, 'in')).toEqual(['item_key', LONG_CYCLE_ITEMS.map((i) => i.key)]);
  });

  it('sem a tabela no banco, null', async () => {
    mockDb.reply = () => ({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.long_cycle_settings'" } });
    expect(await fetchLongCycleSettings()).toBeNull();
  });

  it('grava só o que mudou (null também), pede a linha de volta e põe no cache', async () => {
    const before: LongCycleSetting[] = [
      { item_key: 'escova_dente', every_months: 2, off: false, replaced_on: '2026-10-01' },
      { item_key: 'vassoura', every_months: null, off: true, replaced_on: null },
    ];
    const saved: LongCycleSetting = { item_key: 'escova_dente', every_months: 2, off: false, replaced_on: null };
    mockDb.reply = (call) => ({ data: call.target === 'long_cycle_settings' && step(call, 'upsert') ? saved : before, error: null });
    const client = newClient();
    client.setQueryData(LONG_CYCLE_SETTINGS_KEY, before);
    const hook = await withHook(() => useSetLongCycleSetting(), client);
    await act(async () => {
      await hook.value().mutateAsync({ itemKey: 'escova_dente', change: { replaced_on: null } });
    });
    const write = mockDb.calls.find((c) => step(c, 'upsert'))!;
    expect(step(write, 'upsert')).toEqual([{ item_key: 'escova_dente', replaced_on: null }, { onConflict: 'household_id,item_key' }]);
    expect(write.steps.map(([s]) => s)).toEqual(['upsert', 'select', 'single']);
    expect(client.getQueryData<LongCycleSetting[]>(LONG_CYCLE_SETTINGS_KEY)).toEqual(expect.arrayContaining([before[1], saved]));
    expect(client.getQueryState(LONG_CYCLE_SETTINGS_KEY)?.isInvalidated).toBe(true);
  });

  it('sem a tabela, gravar diz que ainda não está disponível', async () => {
    mockDb.reply = () => ({ data: null, error: { code: '42P01', message: 'relation "public.long_cycle_settings" does not exist' } });
    const hook = await withHook(() => useSetLongCycleSetting());
    let caught: unknown;
    await act(async () => {
      await hook
        .value()
        .mutateAsync({ itemKey: 'vassoura', change: { off: true } })
        .catch((error: unknown) => {
          caught = error;
        });
    });
    expect((caught as Error).message).toBe(LONG_CYCLE_NOT_READY);
  });
});

describe('as chaves do cache', () => {
  it('invalidar o histórico de compras marca a leitura longa como velha', () => {
    const client = newClient();
    client.setQueryData(LONG_CYCLE_HISTORY_KEY, []);
    client.setQueryData(['purchaseRecords'], []);
    void client.invalidateQueries({ queryKey: ['purchaseRecords'], refetchType: 'none' });
    expect(client.getQueryState(LONG_CYCLE_HISTORY_KEY)?.isInvalidated).toBe(true);
    client.clear();
  });

  it('os ajustes e o histórico (com a leitura longa) ficam guardados no aparelho', () => {
    const source = readFileSync(join(__dirname, '../../lib/queryClient.ts'), 'utf8');
    const persisted = source.slice(source.indexOf('const PERSISTED'), source.indexOf(']);', source.indexOf('const PERSISTED')));
    expect(persisted).toContain("'longCycleSettings'");
    expect(persisted).toContain("'purchaseRecords'");
    expect(LONG_CYCLE_HISTORY_KEY[0]).toBe('purchaseRecords');
  });
});

describe('pôr na lista de mercado com o item dos prazos (useAddItemsToList)', () => {
  const PILLOW = { name: 'Travesseiro', category: 'outros', productId: null, quantity: 1, unit: 'un' as const };

  function reply(pending: { name: string; category: string }[]) {
    return (call: Call): Reply => {
      if (call.target === 'rpc open_market_list') return { data: { id: 'l1', name: 'Mercado' }, error: null };
      if (call.target === 'shopping_list_items' && step(call, 'select')) return { data: pending, error: null };
      return { data: null, error: null };
    };
  }
  const inserted = () => mockDb.calls.find((c) => c.target === 'shopping_list_items' && step(c, 'insert'));

  it('o pendente que é o mesmo item com outro nome não entra de novo', async () => {
    mockDb.reply = reply([{ name: 'Travesseiro Nasa', category: 'outros' }]);
    const hook = await withHook(() => useAddItemsToList());
    await act(async () => {
      await hook.value().mutateAsync({ newListName: 'Mercado', reuseMarketList: true, items: [{ ...PILLOW, cycleKey: 'travesseiro' }] });
    });
    expect(inserted()).toBeUndefined();
  });

  it('sem nada pendente que seja ele, entra, e o cycleKey não vai para o banco', async () => {
    mockDb.reply = reply([{ name: 'Capa de travesseiro', category: 'outros' }]);
    const hook = await withHook(() => useAddItemsToList());
    await act(async () => {
      await hook.value().mutateAsync({ newListName: 'Mercado', reuseMarketList: true, items: [{ ...PILLOW, cycleKey: 'travesseiro' }] });
    });
    const rows = step(inserted()!, 'insert')![0] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ list_id: 'l1', name: 'Travesseiro', category: 'outros', product_id: null, quantity: 1, unit: 'un' });
    expect(Object.keys(rows[0]).sort()).toEqual(['category', 'id', 'list_id', 'name', 'product_id', 'quantity', 'unit']);
  });

  it('sem o cycleKey (o "Acho que acabou"), só o mesmo item pelo nome conta, como antes', async () => {
    mockDb.reply = reply([{ name: 'Travesseiro Nasa', category: 'outros' }]);
    const hook = await withHook(() => useAddItemsToList());
    await act(async () => {
      await hook.value().mutateAsync({ newListName: 'Mercado', reuseMarketList: true, items: [PILLOW] });
    });
    expect(step(inserted()!, 'insert')![0]).toHaveLength(1);
  });
});
