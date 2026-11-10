import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import ReceiptScreen from '@/app/nota/[id]';
import type { ConfirmedReceipt } from '@/domain/finishPurchase';
import { useFinishPurchase } from '@/features/FinishPurchase';
import { handConfirmedReceipt } from '@/lib/finishPurchase';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';
import { Button } from '@/ui/primitives';

// "Finalizar compra" num roteador de verdade (o Expo Router, com as rotas montadas na memória): a lista abre o leitor,
// o QR code troca de tela até a revisão (direto, ou pela pendente da Sefaz), e a revisão de verdade, com as gravações
// de src/data/receipts.ts e um "banco" em memória, confirma e volta. O que se confere: a volta cai na lista (o QR
// code e a pendente saíram do caminho), a lista recebe uma vez o que a nota fez quando ganha o foco de novo, e a
// revisão não avisa ela mesma. A lista daqui é só o fluxo de verdade (useFinishPurchase); a tela inteira tem os
// testes dela (shoppingListScreen.test). O QR code e a pendente fazem só o que as de verdade fazem com a nota lida
// (router.replace), que tem os testes dela (pendingReceiptFlow.test, duplicateReceipt.test).

/* eslint-disable @typescript-eslint/no-require-imports */
const { ExpoRoot } = require('expo-router/build/ExpoRoot');
const { inMemoryContext } = require('expo-router/build/testing-library/context-stubs');
const { store } = require('expo-router/build/global-state/router-store');
/* eslint-enable @typescript-eslint/no-require-imports */

type Row = Record<string, unknown>;

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = { receipts: [] as Row[], receipt_items: [] as Row[], stores: [] as Row[], rpcs: [] as { fn: string; args: Row }[] };
/** O que a lista recebeu ao voltar ao foco. */
const mockList: { confirmed: ConfirmedReceipt[]; cleared: (string | undefined)[] } = { confirmed: [], cleared: [] };
/** Os itens das listas abertas que a revisão vê: o detergente está no carrinho. */
const mockOpenList: Row[] = [];

jest.mock('expo-linking', () => ({
  ...jest.requireActual<object>('expo-linking'),
  createURL: (path: string) => `kotii://${path}`,
  resolveScheme: () => 'kotii',
  addEventListener: () => ({ remove() {} }),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }), useHouseholdId: () => 'h1' }));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/ui/dialogs', () => ({ askYesNo: jest.fn(async () => false), confirmAction: jest.fn(), notify: jest.fn() }));
jest.mock('@/ui/NukeLive', () => ({ NukeLive: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/PickerModal', () => ({ PickerModal: () => null }));
jest.mock('@/features/finance/PayerChips', () => ({ PayerChips: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/data/home', () => ({ fetchPantryNear: async () => [] }));
jest.mock('@/data/market', () => {
  const { LinkIndex: Links } = jest.requireActual<typeof import('@/domain/listLinks')>('@/domain/listLinks');
  const loaded = (data: unknown) => ({ data, isPending: false, isError: false, isFetching: false, error: null, refetch: async () => undefined });
  const links = loaded(new Links([]));
  return {
    useListLinks: () => links,
    useOpenListItems: () => loaded(mockOpenList),
    usePriceObservations: () => loaded([]),
    useProducts: () => loaded([]),
    usePurchaseRecords: () => loaded([]),
    useStores: () => loaded(mockDb.stores.map((entry) => ({ address: null, cnpj: null, ...entry }))),
  };
});
jest.mock('@/data/learnedAbbreviations', () => {
  const { NO_LEARNED } = jest.requireActual<typeof import('@/domain/learnedAbbreviations')>('@/domain/learnedAbbreviations');
  return { useLearnedAbbreviations: () => NO_LEARNED, loadLearnedAbbreviations: async () => NO_LEARNED };
});
jest.mock('@/lib/supabase', () => {
  const tables = () => mockDb as unknown as Record<string, Row[]>;
  const table = (name: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let write: { verb: 'insert' | 'update' | 'delete'; values?: Row } | null = null;
    let single = false;
    // A nota sai com o mercado dela, pelo store_id, como o "store:stores(...)" do pedido.
    const out = (row: Row): Row => {
      if (name !== 'receipts') return { ...row };
      const found = mockDb.stores.find((entry) => entry.id === row.store_id);
      return { receipt_items: [{ count: mockDb.receipt_items.filter((entry) => entry.receipt_id === row.id).length }], ...row, store: found ? { ...found } : null };
    };
    const run = () => {
      const rows = tables()[name] ?? [];
      const found = rows.filter((row) => filters.every((keep) => keep(row)));
      if (write?.verb === 'update') found.forEach((row) => Object.assign(row, write!.values));
      const data = found.map(out);
      return { data: single ? (data[0] ?? null) : data, error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      range: () => builder,
      is: (column: string, value: unknown) => (filters.push((row) => (row[column] ?? null) === value), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
      gte: (column: string, value: string) => (filters.push((row) => String(row[column]) >= value), builder),
      lte: (column: string, value: string) => (filters.push((row) => String(row[column]) <= value), builder),
      update: (values: Row) => ((write = { verb: 'update', values }), builder),
      single: () => ((single = true), builder),
      maybeSingle: () => ((single = true), builder),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  };
  return {
    supabase: {
      from: table,
      rpc: async (fn: string, args: Row) => {
        mockDb.rpcs.push({ fn, args });
        if (fn === 'confirm_receipt') {
          const note = mockDb.receipts.find((row) => row.id === args.p_receipt_id);
          if (note) note.status = 'confirmed';
        }
        return { data: [], error: null };
      },
      storage: { from: () => ({ remove: async () => ({ data: null, error: null }) }) },
    },
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
  };
});

/** A lista: só o "Finalizar compra" de verdade, com o que ela recebe ao voltar ao foco. */
function ListStub() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const finish = useFinishPurchase(id, {
    withoutReceipt: (notice) => mockList.cleared.push(notice),
    receiptConfirmed: (receipt) => mockList.confirmed.push(receipt),
  });
  return (
    <>
      <Pressable accessibilityLabel="Finalizar compra" onPress={finish.start}>
        <Text>lista {id}</Text>
      </Pressable>
      {finish.element}
    </>
  );
}

/** O QR code lido: a Sefaz mostrou a nota (a revisão toma o lugar desta tela) ou pediu o "não sou robô" (a pendente). */
function QrStub() {
  return (
    <>
      <Pressable accessibilityLabel="nota lida" onPress={() => router.replace({ pathname: '/nota/[id]', params: { id: 'r1' } })} />
      <Pressable accessibilityLabel="não sou robô" onPress={() => router.replace({ pathname: '/nota/pendente', params: { chave: '123' } })} />
    </>
  );
}

/** A pendente: os prints lidos, com o leitor que troca de tela (`replace`), viram a revisão. */
function PendingStub() {
  return <Pressable accessibilityLabel="prints lidos" onPress={() => router.replace({ pathname: '/nota/[id]', params: { id: 'r1' } })} />;
}

const ROUTES = {
  _layout: () => (
    <Stack>
      <Stack.Screen name="lista/[id]" />
      <Stack.Screen name="nota/[id]" />
      <Stack.Screen name="nota/qrcode" options={{ presentation: 'modal' }} />
      <Stack.Screen name="nota/pendente" options={{ presentation: 'modal' }} />
    </Stack>
  ),
  'lista/[id]': ListStub,
  'nota/qrcode': QrStub,
  'nota/pendente': PendingStub,
  'nota/[id]': ReceiptScreen,
};

let renderer: ReactTestRenderer | undefined;
let queryClient: QueryClient | undefined;

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
};

async function open(location: string) {
  process.env.EXPO_ROUTER_IMPORT_MODE = 'sync';
  // Sem o relógio da limpeza (gcTime): ele seguraria o Jest depois do fim.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  queryClient = client;
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  await act(async () => {
    renderer = create(<ExpoRoot context={inMemoryContext(ROUTES)} location={location} wrapper={wrapper} />);
  });
  await settle();
}

const where = () => store.getRouteInfo().pathname as string;
const tap = async (label: string) => {
  const target = renderer!.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
  expect(target).toBeDefined();
  await act(async () => target.props.onPress());
  await settle();
};
const press = async (title: string) => {
  const target = renderer!.root.findAllByType(Button).find((entry) => String(entry.props.title).startsWith(title));
  expect(target).toBeDefined();
  await act(async () => target!.props.onPress());
  await settle();
};
/** Escolhe no menu do "Finalizar compra", como ele faz: fecha e depois roda a ação. */
async function pick(label: string) {
  const sheet = renderer!.root.findAllByType(ActionSheet).find((entry) => entry.props.title === 'Finalizar compra')!;
  const action = (sheet.props.actions as SheetAction[]).find((entry) => entry.label === label)!;
  await act(async () => {
    sheet.props.onClose();
    action.onPress();
  });
  await settle();
}

beforeEach(() => {
  mockDb.stores = [{ id: 's1', name: 'Assaí' }];
  mockDb.receipts = [
    {
      id: 'r1',
      store_id: 's1',
      purchased_at: '2026-11-10T15:00:00.000Z',
      total: 12.9,
      access_key: null,
      image_path: null,
      extra_image_paths: [],
      source: 'qrcode',
      status: 'draft',
      created_at: '2026-11-10T15:05:00.000Z',
      paid_by: null,
    },
  ];
  mockDb.receipt_items = [
    {
      id: 'i1',
      receipt_id: 'r1',
      position: 0,
      raw_description: 'DETERGENTE YPE 500ML',
      suggested_name: 'Detergente',
      suggested_category: 'limpeza',
      product_id: null,
      quantity: 1,
      unit: 'un',
      unit_price: 12.9,
      total_price: 12.9,
    },
  ];
  mockDb.rpcs = [];
  mockOpenList.length = 0;
  mockOpenList.push({ id: 'li1', list_id: 'l1', list_name: 'Mercado', name: 'Detergente', category: 'limpeza', product_id: null, checked_at: '2026-11-10T14:50:00.000Z', brand: false });
  mockList.confirmed = [];
  mockList.cleared = [];
  jest.mocked(notify).mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  queryClient?.clear();
  queryClient = undefined;
});

describe('"Finalizar compra" com a nota, de ponta a ponta', () => {
  it('pelo QR code: a revisão toma o lugar do leitor, confirma e volta para a lista, que recebe o que a nota fez', async () => {
    await open('/lista/l1');
    await tap('Finalizar compra');
    await pick('Ler o QR code da nota');
    expect(where()).toBe('/nota/qrcode');
    await tap('nota lida');
    expect(where()).toBe('/nota/r1');
    // A revisão marcou sozinha o detergente do carrinho: confirmar o tira da lista.
    await press('Confirmar nota');
    expect(mockDb.rpcs.map(({ fn }) => fn)).toEqual(['confirm_receipt']);
    expect(where()).toBe('/lista/l1');
    expect(mockList.confirmed).toHaveLength(1);
    expect(mockList.confirmed[0]).toMatchObject({ onlineAtTap: true, removedListItems: ['li1'] });
    // Quem diz o que a nota fez é a lista: a revisão não avisou.
    expect(jest.mocked(notify).mock.calls.map(([title]) => title)).not.toContain('Nota salva');
  });

  it('pela pendente da Sefaz (o "não sou robô"): os prints viram a revisão, e a volta também cai na lista', async () => {
    await open('/lista/l1');
    await tap('Finalizar compra');
    await pick('Ler o QR code da nota');
    await tap('não sou robô');
    expect(where()).toBe('/nota/pendente');
    await tap('prints lidos');
    expect(where()).toBe('/nota/r1');
    await press('Confirmar nota');
    expect(where()).toBe('/lista/l1');
    expect(mockList.confirmed).toHaveLength(1);
  });

  it('voltar da revisão sem confirmar: a lista não recebe nada, e a nota confirmada depois avisa sozinha', async () => {
    await open('/lista/l1');
    await tap('Finalizar compra');
    await pick('Ler o QR code da nota');
    await tap('nota lida');
    await act(async () => router.back());
    await settle();
    expect(where()).toBe('/lista/l1');
    expect(mockList.confirmed).toHaveLength(0);
    expect(handConfirmedReceipt({ tappedAt: Date.now(), onlineAtTap: true, pantryCount: 0, removedListItems: [] })).toBe(false);
  });

  it('sem a nota: o "Limpar" da lista, sem abrir o leitor', async () => {
    await open('/lista/l1');
    await tap('Finalizar compra');
    await pick('Sem a nota: só limpar o carrinho');
    expect(where()).toBe('/lista/l1');
    expect(mockList.cleared).toEqual([undefined]);
  });
});
