import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CameraView } from 'expo-camera';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import ScanScreen from '@/app/escanear';
import ReceiptScreen from '@/app/nota/[id]';
import type { ConfirmedReceipt } from '@/domain/finishPurchase';
import { accessKeyCheckDigit } from '@/domain/nfce';
import { SCAN_MORE, SCAN_PANTRY_TITLE, SCAN_RECEIPT_TITLE, SCAN_TITLE } from '@/domain/scan';
import { useFinishPurchase } from '@/features/FinishPurchase';
import { handConfirmedReceipt } from '@/lib/finishPurchase';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';
import { Button } from '@/ui/primitives';

// "Finalizar compra" num roteador de verdade (o Expo Router, com as rotas montadas na memória): a lista abre a câmera
// só da nota (a do "Escanear", de verdade, com a câmera de mentira), que dá lugar à tela do QR code (e esta à revisão,
// direto ou pela pendente da Sefaz) ou, pela foto e pela nota à mão, direto à revisão; e a revisão de verdade, com as
// gravações de src/data/receipts.ts e um "banco" em memória, confirma e volta. O que se confere: a volta cai na lista
// (a câmera, o QR code e a pendente saíram do caminho), a lista recebe uma vez o que a nota fez quando ganha o foco
// de novo, e a revisão não avisa ela mesma. A lista daqui é só o fluxo de verdade (useFinishPurchase); a tela inteira
// tem os testes dela (shoppingListScreen.test), e a câmera também (scanner.test). O QR code e a pendente fazem só o
// que as de verdade fazem com a nota lida (router.replace), que tem os testes dela (pendingReceiptFlow.test,
// duplicateReceipt.test).

/* eslint-disable @typescript-eslint/no-require-imports */
const { ExpoRoot } = require('expo-router/build/ExpoRoot');
const { inMemoryContext } = require('expo-router/build/testing-library/context-stubs');
const { store } = require('expo-router/build/global-state/router-store');
/* eslint-enable @typescript-eslint/no-require-imports */

type Row = Record<string, unknown>;

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = {
  receipts: [] as Row[],
  receipt_items: [] as Row[],
  stores: [] as Row[],
  rpcs: [] as { fn: string; args: Row }[],
  /** As chamadas às funções do servidor (a leitura da foto). */
  invoked: [] as { fn: string; body: unknown }[],
};
/** O que a lista recebeu ao voltar ao foco. */
const mockList: { confirmed: ConfirmedReceipt[]; cleared: (string | undefined)[] } = { confirmed: [], cleared: [] };
/** Os itens das listas abertas que a revisão vê: o detergente está no carrinho. */
const mockOpenList: Row[] = [];
/** O que a leitura local acharia na foto tirada (o QR do rodapé da nota, quando ela pega). */
const mockPhotoCodes: { data: string }[] = [];

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
// O congelador (data/freezer): sem ele no banco, como antes da migração.
jest.mock('@/data/freezer', () => ({
  useFreezer: () => ({ available: false, days: null }),
  useFreezePantryItems: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useThawPantryItems: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('@/data/home', () => ({ fetchPantryNear: async () => [] }));
// A câmera do "Escanear": a permissão já dada, a foto tirada e o que a leitura local acharia nela.
jest.mock('expo-camera', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  class MockCameraView extends React.Component {
    takePictureAsync = async () => ({ uri: 'file://nota.jpg' });
    render() {
      return null;
    }
  }
  // A permissão, o pedido e a leitura dela (a câmera da nota a lê ela mesma, para pegar a falha): os mesmos a cada desenho.
  const permission = { granted: true };
  const request = jest.fn(async () => permission);
  const read = async () => permission;
  return { CameraView: MockCameraView, useCameraPermissions: () => [permission, request, read], scanFromURLAsync: async () => mockPhotoCodes };
});
jest.mock('@/lib/barcodeReader', () => ({ prepareBarcodeReader: async () => undefined }));
// O código de barras de produto, que o modo da nota nem procura: tem os testes dele (productBarcodeFlow.test).
jest.mock('@/features/ProductBarcode', () => ({
  useProductBarcode: () => ({ available: true, busy: false, start: jest.fn(), read: jest.fn(), element: null }),
}));
// As fotos sobem para o armazenamento sem sair daqui.
jest.mock('@/data/images', () => ({
  ...jest.requireActual<object>('@/data/images'),
  uploadImages: async (_bucket: string, householdId: string, uris: string[]) => uris.map((_, i) => `${householdId}/foto-${i}.jpg`),
  removeImages: async () => undefined,
}));
jest.mock('@/data/market', () => {
  const { LinkIndex: Links } = jest.requireActual<typeof import('@/domain/listLinks')>('@/domain/listLinks');
  const loaded = (data: unknown) => ({ data, isPending: false, isError: false, isFetching: false, error: null, refetch: async () => undefined });
  const links = loaded(new Links([]));
  return {
    useAddToMarketList: () => ({ mutateAsync: jest.fn() }),
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
      // A nota à mão: uma nota nova, vazia, que a revisão abre.
      insert: (values: Row) => {
        const row: Row = {
          id: `r${tables()[name].length + 1}`,
          store_id: null,
          purchased_at: '2026-11-10T15:00:00.000Z',
          total: null,
          access_key: null,
          image_path: null,
          extra_image_paths: [],
          status: 'draft',
          created_at: '2026-11-10T15:05:00.000Z',
          paid_by: null,
          ...values,
        };
        tables()[name].push(row);
        filters.push((entry) => entry === row);
        return builder;
      },
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
      // A leitura da foto: a função lê a nota r1.
      functions: {
        invoke: async (fn: string, options: { body: unknown }) => {
          mockDb.invoked.push({ fn, body: options.body });
          return { data: { receipt_id: 'r1', duplicate: false }, error: null };
        },
      },
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
  const { qr } = useLocalSearchParams<{ qr?: string }>();
  return (
    <>
      {/* O QR que a câmera leu, que a tela de verdade segue sozinha. */}
      <Text testID="qr dado">{qr ?? ''}</Text>
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
      <Stack.Screen name="escanear" />
      <Stack.Screen name="nota/[id]" />
      <Stack.Screen name="nota/qrcode" options={{ presentation: 'modal' }} />
      <Stack.Screen name="nota/pendente" options={{ presentation: 'modal' }} />
    </Stack>
  ),
  'lista/[id]': ListStub,
  escanear: ScanScreen,
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
/** O título da tela aberta, como a rota o pôs no cabeçalho. */
const title = () => (store.navigationRef.getCurrentOptions() as { title?: string } | undefined)?.title;
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
/** Escolhe num menu (o do "Finalizar compra", o "Mais opções" da câmera), como ele faz: fecha e depois roda a ação. */
async function pick(label: string, title = 'Finalizar compra') {
  const sheet = renderer!.root.findAllByType(ActionSheet).find((entry) => entry.props.title === title)!;
  const action = (sheet.props.actions as SheetAction[]).find((entry) => entry.label === label)!;
  expect(action).toBeDefined();
  await act(async () => {
    sheet.props.onClose();
    action.onPress();
  });
  await settle();
}

// Uma chave de NFC-e com o dígito certo, e o link do QR dela.
const FIRST43 = '3526111234567800019565001000012345100001234';
const QR = `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=${FIRST43}${accessKeyCheckDigit(FIRST43)}|2|1|1|A1B2C3`;

/** "Finalizar compra" → "Ler a nota": a câmera só da nota, por cima da lista. */
async function toCamera() {
  await open('/lista/l1');
  await tap('Finalizar compra');
  await pick('Ler a nota');
  expect(where()).toBe('/escanear');
  expect(store.getRouteInfo().params).toMatchObject({ para: 'nota' });
  // O título que a rota dá à câmera: o da nota, nunca o "Escanear" de nota ou produto.
  expect(title()).toBe('Ler a nota');
}

/** A câmera vê o QR code da nota (sozinha, sem toque). */
async function cameraSees(data: string) {
  await act(async () => renderer!.root.findByType(CameraView).props.onBarcodeScanned({ data }));
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
  mockDb.invoked = [];
  mockOpenList.length = 0;
  mockPhotoCodes.length = 0;
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
  it('o menu tem duas opções: ler a nota (a câmera só da nota) e o caminho sem ela', async () => {
    await open('/lista/l1');
    await tap('Finalizar compra');
    const sheet = renderer!.root.findAllByType(ActionSheet).find((entry) => entry.props.title === 'Finalizar compra')!;
    expect((sheet.props.actions as SheetAction[]).map((action) => action.label)).toEqual(['Ler a nota', 'Sem a nota: só limpar o carrinho']);
  });

  it('pelo QR code: a câmera dá lugar à tela do QR, e esta à revisão, que confirma e volta para a lista, que recebe o que a nota fez', async () => {
    await toCamera();
    await cameraSees(QR);
    expect(where()).toBe('/nota/qrcode');
    expect(renderer!.root.findByProps({ testID: 'qr dado' }).props.children).toBe(QR);
    await tap('nota lida');
    expect(where()).toBe('/nota/r1');
    // A revisão marcou sozinha o detergente do carrinho: confirmar o tira da lista.
    await press('Confirmar nota');
    // A nota já confirmada pergunta se o banco tem as correções dela (só uma leitura, receipt_corrections_available).
    expect(mockDb.rpcs.map(({ fn }) => fn).filter((fn) => fn !== 'receipt_corrections_available')).toEqual(['confirm_receipt']);
    expect(where()).toBe('/lista/l1');
    expect(mockList.confirmed).toHaveLength(1);
    expect(mockList.confirmed[0]).toMatchObject({ onlineAtTap: true, removedListItems: ['li1'] });
    // Quem diz o que a nota fez é a lista: a revisão não avisou.
    expect(jest.mocked(notify).mock.calls.map(([title]) => title)).not.toContain('Nota salva');
  });

  it('pela foto: a leitura de sempre da nota (sem perguntar se é produto), e a revisão toma o lugar da câmera', async () => {
    // A foto pegou o QR do rodapé: mesmo assim é lida pela foto (é a saída de quando a Sefaz não trouxe a nota).
    mockPhotoCodes.push({ data: QR });
    await toCamera();
    await press('Tirar foto');
    expect(where()).toBe('/escanear');
    // Uma foto só: a nota pode continuar, e a pessoa diz que é para ler.
    expect(mockDb.invoked).toEqual([]);
    await press('Ler');
    expect(mockDb.invoked).toEqual([{ fn: 'parse-receipt', body: { image_paths: ['h1/foto-0.jpg'] } }]);
    expect(where()).toBe('/nota/r1');
    await press('Confirmar nota');
    expect(where()).toBe('/lista/l1');
    expect(mockList.confirmed).toHaveLength(1);
    expect(mockList.confirmed[0]).toMatchObject({ removedListItems: ['li1'] });
    expect(jest.mocked(notify).mock.calls.map(([title]) => title)).not.toContain('Nota salva');
  });

  it('pela nota à mão ("Mais opções" da câmera): a revisão também toma o lugar da câmera', async () => {
    await toCamera();
    await pick('Digitar a nota manualmente', SCAN_MORE);
    expect(where()).toBe('/nota/r2');
    expect(mockDb.receipts.find((row) => row.id === 'r2')).toMatchObject({ source: 'manual', status: 'draft' });
    // Voltar da revisão cai na lista: a câmera não ficou no caminho.
    await act(async () => router.back());
    await settle();
    expect(where()).toBe('/lista/l1');
    expect(mockList.confirmed).toHaveLength(0);
  });

  it('pela pendente da Sefaz (o "não sou robô"): os prints viram a revisão, e a volta também cai na lista', async () => {
    await toCamera();
    await cameraSees(QR);
    await tap('não sou robô');
    expect(where()).toBe('/nota/pendente');
    await tap('prints lidos');
    expect(where()).toBe('/nota/r1');
    await press('Confirmar nota');
    expect(where()).toBe('/lista/l1');
    expect(mockList.confirmed).toHaveLength(1);
  });

  it('voltar da câmera sem nota: a lista não recebe nada, e a espera acaba sem aviso', async () => {
    await toCamera();
    await act(async () => router.back());
    await settle();
    expect(where()).toBe('/lista/l1');
    expect(mockList.confirmed).toHaveLength(0);
    expect(jest.mocked(notify)).not.toHaveBeenCalled();
    expect(handConfirmedReceipt({ tappedAt: Date.now(), onlineAtTap: true, pantryCount: 0, removedListItems: [] })).toBe(false);
  });

  it('voltar da revisão sem confirmar: a lista não recebe nada, e a nota confirmada depois avisa sozinha', async () => {
    await toCamera();
    await cameraSees(QR);
    await tap('nota lida');
    await act(async () => router.back());
    await settle();
    expect(where()).toBe('/lista/l1');
    expect(mockList.confirmed).toHaveLength(0);
    expect(handConfirmedReceipt({ tappedAt: Date.now(), onlineAtTap: true, pantryCount: 0, removedListItems: [] })).toBe(false);
  });

  it('a câmera tem o título do modo pedido na URL: só a nota, o que já tem em casa, ou o "Escanear" de sempre', async () => {
    await open('/escanear?para=nota');
    expect(title()).toBe(SCAN_RECEIPT_TITLE);
    await act(async () => renderer?.unmount());
    await open('/escanear?para=despensa');
    expect(title()).toBe(SCAN_PANTRY_TITLE);
    await act(async () => renderer?.unmount());
    await open('/escanear');
    expect(title()).toBe(SCAN_TITLE);
  });

  it('sem a nota: o "Limpar" da lista, sem abrir a câmera', async () => {
    await open('/lista/l1');
    await tap('Finalizar compra');
    await pick('Sem a nota: só limpar o carrinho');
    expect(where()).toBe('/lista/l1');
    expect(mockList.cleared).toEqual([undefined]);
  });
});
