import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import ReceiptScreen from '@/app/nota/[id]';
import NfceQrScreen from '@/app/nota/qrcode';
import { accessKeyCheckDigit } from '@/domain/nfce';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button } from '@/ui/primitives';

// Nota repetida, de ponta a ponta: a revisão de verdade e a tela do QR de verdade, com as consultas e gravações
// de src/data/receipts.ts e um "banco" em memória atrás do cliente do Supabase. A casa já tem a compra confirmada
// (Assaí, 10/06, R$ 62,90); a mesma compra chega de novo, lida pela foto ou pelo QR.

type Row = Record<string, unknown>;

// SP (35), jun/2026, CNPJ 12.345.678/0001-99, modelo 65.
const BODY = '35' + '2606' + '12345678000199' + '65' + '001' + '000012345' + '1' + '12345678';
const KEY = BODY + accessKeyCheckDigit(BODY);
const QR = `https://www.nfce.fazenda.sp.gov.br/qrcode?p=${KEY}|2|1|1|ABCDEF`;

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = {
  receipts: [] as Row[],
  receipt_items: [] as Row[],
  stores: [] as Row[],
  deletes: [] as { table: string; filters: Row }[],
  rpcs: [] as { fn: string; args: Row }[],
  nfce: 0,
};
const mockScreen: { id: string; onScan: ((event: { data: string }) => void) | null } = { id: 'r1', onScan: null };
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouter.push(...args),
    replace: (...args: unknown[]) => mockRouter.replace(...args),
    back: () => mockRouter.back(),
    canGoBack: () => true,
  },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: mockScreen.id }),
}));
jest.mock('expo-camera', () => ({
  CameraView: (props: { onBarcodeScanned: (event: { data: string }) => void }) => {
    mockScreen.onScan = props.onBarcodeScanned;
    return null;
  },
  useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })],
}));
jest.mock('@/lib/barcodeReader', () => ({ prepareBarcodeReader: async () => undefined }));
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
    useOpenListItems: () => loaded([]),
    usePriceObservations: () => loaded([]),
    useProducts: () => loaded([]),
    usePurchaseRecords: () => loaded([]),
    useStores: () => loaded(mockDb.stores.map((store) => ({ address: null, ...store }))),
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
    const named: Row = {};
    let write: { verb: 'insert' | 'update' | 'delete'; values?: Row } | null = null;
    let single = false;
    // A nota sai com o mercado dela, pelo store_id, como o "store:stores(...)" do pedido.
    const out = (row: Row): Row => {
      if (name !== 'receipts') return { ...row };
      const store = mockDb.stores.find((entry) => entry.id === row.store_id);
      return { receipt_items: [{ count: mockDb.receipt_items.filter((item) => item.receipt_id === row.id).length }], ...row, store: store ? { ...store } : null };
    };
    const run = () => {
      const rows = tables()[name];
      if (write?.verb === 'insert') {
        const added = ([] as Row[]).concat(write.values as Row).map((values) => ({ id: `${name === 'receipts' ? 'r' : name}${rows.length + 2}`, ...values }));
        rows.push(...added);
        return { data: single ? added[0] : added, error: null };
      }
      const found = rows.filter((row) => filters.every((keep) => keep(row)));
      if (write?.verb === 'delete') {
        mockDb.deletes.push({ table: name, filters: named });
        tables()[name] = rows.filter((row) => !found.includes(row));
        return { data: null, error: null };
      }
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
      eq: (column: string, value: unknown) => ((named[column] = value), filters.push((row) => row[column] === value), builder),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
      gte: (column: string, value: string) => (filters.push((row) => String(row[column]) >= value), builder),
      lte: (column: string, value: string) => (filters.push((row) => String(row[column]) <= value), builder),
      insert: (values: Row) => ((write = { verb: 'insert', values }), builder),
      update: (values: Row) => ((write = { verb: 'update', values }), builder),
      delete: () => ((write = { verb: 'delete' }), builder),
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
      functions: {
        // A Sefaz mostra a nota: a mesma compra que a casa já confirmou.
        invoke: async (fn: string) => {
          if (fn !== 'nfce') throw new Error(`função inesperada: ${fn}`);
          mockDb.nfce += 1;
          return {
            data: {
              store: { name: 'ASSAI ATACADISTA', cnpj: '12345678000199', address: null },
              issuedAtLocal: '2026-06-10T12:00:00',
              total: 62.9,
              items: [{ description: 'DETERGENTE YPE 500ML', code: '1', quantity: 1, unit: 'UN', unitPrice: 62.9, totalPrice: 62.9 }],
            },
            error: null,
          };
        },
      },
    },
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
  };
});

/** A compra que a casa já confirmou: Assaí, 10/06 ao meio-dia em São Paulo, R$ 62,90. */
const CONFIRMED: Row = {
  id: 'c1',
  store_id: 's1',
  purchased_at: '2026-06-10T15:00:00.000Z',
  total: 62.9,
  access_key: null,
  image_path: null,
  extra_image_paths: [],
  source: 'ai',
  status: 'confirmed',
  created_at: '2026-06-10T15:05:00.000Z',
  paid_by: null,
};
const draft = (patch: Row = {}): Row => ({ ...CONFIRMED, id: 'r1', status: 'draft', purchased_at: '2026-06-10T22:30:00.000Z', ...patch });
const item = (receiptId: string): Row => ({
  id: `i-${receiptId}`,
  receipt_id: receiptId,
  position: 0,
  raw_description: 'DETERGENTE YPE 500ML',
  suggested_name: 'Detergente',
  suggested_category: 'limpeza',
  product_id: null,
  quantity: 1,
  unit: 'un',
  unit_price: 62.9,
  total_price: 62.9,
});
const NOTICE = 'Parece que esta compra já foi registrada: Assaí, 10/06/2026, R$';

let renderer: ReactTestRenderer | undefined;
let client: QueryClient;

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
const texts = (node: ReturnType<ReactTestRenderer['toJSON']> | string): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);
const page = () => texts(renderer!.toJSON()).join('\n');
const button = (title: string) => renderer!.root.findAllByType(Button).find((entry) => String(entry.props.title).startsWith(title));

async function open(screen: ReactElement) {
  act(() => renderer?.unmount());
  act(() => {
    renderer = create(<QueryClientProvider client={client}>{screen}</QueryClientProvider>);
  });
  await settle();
  await settle();
}
async function press(title: string) {
  const target = button(title);
  expect(target).toBeDefined();
  await act(async () => target!.props.onPress());
  await settle();
  await settle();
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  mockDb.receipts = [{ ...CONFIRMED }];
  mockDb.receipt_items = [item('c1')];
  mockDb.stores = [{ id: 's1', name: 'Assaí', cnpj: '12345678000199' }];
  mockDb.deletes = [];
  mockDb.rpcs = [];
  mockDb.nfce = 0;
  mockScreen.id = 'r1';
  mockScreen.onScan = null;
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.back.mockClear();
  jest.mocked(notify).mockClear();
  // "Excluir esta" e "Descartar" pedem confirmação: a pessoa confirma.
  jest.mocked(confirmAction).mockReset();
  jest.mocked(confirmAction).mockImplementation((_title, _message, _label, yes) => yes());
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  client.clear();
});

describe('nota repetida na revisão', () => {
  it('o rascunho da mesma compra (às 19h30 do mesmo dia) avisa, com "Ver a outra nota"', async () => {
    mockDb.receipts.push(draft());
    mockDb.receipt_items.push(item('r1'));
    await open(<ReceiptScreen />);
    expect(page()).toContain(NOTICE);
    await press('Ver a outra nota');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/nota/[id]', params: { id: 'c1' } });
  });

  it('"Excluir esta" exclui só o rascunho e volta', async () => {
    mockDb.receipts.push(draft());
    mockDb.receipt_items.push(item('r1'));
    await open(<ReceiptScreen />);
    await press('Excluir esta');
    expect(mockDb.deletes).toEqual([{ table: 'receipts', filters: { id: 'r1' } }]);
    expect(mockDb.receipts.map((row) => row.id)).toEqual(['c1']);
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('confirmar mesmo assim funciona: o aviso não segura a nota', async () => {
    mockDb.receipts.push(draft());
    mockDb.receipt_items.push(item('r1'));
    await open(<ReceiptScreen />);
    expect(page()).toContain(NOTICE);
    await press('Confirmar nota');
    expect(mockDb.rpcs.map((call) => call.fn)).toEqual(['confirm_receipt']);
    expect(mockDb.rpcs[0].args.p_receipt_id).toBe('r1');
    expect(mockDb.deletes).toEqual([]);
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('outro dia em São Paulo (00h30 do dia seguinte), outro total ou outro mercado: sem aviso', async () => {
    for (const patch of [{ purchased_at: '2026-06-11T03:30:00.000Z' }, { total: 70 }, { store_id: 's2' }]) {
      mockDb.receipts = [{ ...CONFIRMED }, draft(patch)];
      mockDb.receipt_items = [item('c1'), item('r1')];
      mockDb.stores = [
        { id: 's1', name: 'Assaí', cnpj: '12345678000199' },
        { id: 's2', name: 'Carrefour', cnpj: '99999999000199' },
      ];
      client.clear();
      await open(<ReceiptScreen />);
      expect(button('Confirmar nota')).toBeDefined();
      expect(page()).not.toContain('Parece que esta compra já foi registrada');
    }
  });

  it('a nota já confirmada não avisa (nem dela mesma)', async () => {
    mockScreen.id = 'c1';
    await open(<ReceiptScreen />);
    expect(button('Excluir nota')).toBeDefined();
    expect(page()).not.toContain('Parece que esta compra já foi registrada');
  });
});

describe('nota repetida na importação pelo QR', () => {
  it('a nota nova do QR abre na revisão com o aviso, também com a outra nota em outra loja do mesmo CNPJ', async () => {
    // A casa tem duas lojas com o CNPJ da nota: o QR usa a primeira, e a compra confirmada é da outra.
    mockDb.stores = [
      { id: 's1', name: 'Assaí', cnpj: '12345678000199' },
      { id: 's0', name: 'Assaí Atacadista', cnpj: '12345678000199' },
    ];
    mockDb.receipts = [{ ...CONFIRMED, store_id: 's0' }];
    await open(<NfceQrScreen />);
    expect(mockScreen.onScan).not.toBeNull();
    await act(async () => mockScreen.onScan!({ data: QR }));
    await settle();
    await settle();
    expect(mockDb.nfce).toBe(1);
    const created = mockDb.receipts.find((row) => row.access_key === KEY);
    expect(created).toBeDefined();
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/nota/[id]', params: { id: created!.id } });

    mockScreen.id = String(created!.id);
    await open(<ReceiptScreen />);
    expect(created!.store_id).toBe('s1');
    expect(page()).toContain('Parece que esta compra já foi registrada: Assaí Atacadista, 10/06/2026, R$');
    await press('Ver a outra nota');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/nota/[id]', params: { id: 'c1' } });
  });
});
