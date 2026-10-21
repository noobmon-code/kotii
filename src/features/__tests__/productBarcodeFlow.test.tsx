import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useUnlinkBarcode } from '@/data/barcodes';
import { useProductBarcode, type ProductBarcodeFlow } from '@/features/ProductBarcode';
import type { Product } from '@/lib/types';
import { askYesNo, notify } from '@/ui/dialogs';

// O caminho depois de ler o código, com os hooks de dados de verdade (src/data/barcodes.ts e market.ts) e um
// "banco" em memória atrás do cliente do Supabase. A câmera é de mentira; os seletores de produto e de categoria
// também: guarda-se o que a tela manda para eles, e o teste escolhe como a pessoa escolheria.

type Row = Record<string, unknown>;
// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb: { products: Row[]; product_barcodes: Row[]; missing: boolean; writes: { table: string; op: string; row?: Row }[] } = {
  products: [],
  product_barcodes: [],
  missing: false,
  writes: [],
};
const mockCamera: { onScan: ((event: { data: string }) => void) | null } = { onScan: null };
const mockPickers: Record<string, Record<string, unknown>> = {};

jest.mock('expo-camera', () => ({
  CameraView: (props: { onBarcodeScanned: (event: { data: string }) => void }) => {
    mockCamera.onScan = props.onBarcodeScanned;
    return null;
  },
  useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })],
}));
jest.mock('@/lib/barcodeReader', () => ({ prepareBarcodeReader: async () => undefined }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn(), askYesNo: jest.fn() }));
jest.mock('@/ui/PickerModal', () => ({
  PickerModal: (props: Record<string, unknown>) => {
    mockPickers[props.title as string] = props;
    return null;
  },
}));
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/supabase', () => {
  const MISSING = { code: 'PGRST205', message: "Could not find the table 'public.product_barcodes' in the schema cache" };
  const table = (name: 'products' | 'product_barcodes') => {
    const filters: [string, unknown][] = [];
    let write: (() => { data: unknown; error: unknown }) | null = null;
    const rows = () => mockDb[name].filter((row) => filters.every(([column, value]) => row[column] === value));
    const query: Record<string, unknown> = {
      select: () => query,
      order: () => query,
      limit: () => query,
      range: () => query,
      gt: () => query,
      eq: (column: string, value: unknown) => (filters.push([column, value]), query),
      upsert: (row: Row) => {
        write = () => {
          mockDb.writes.push({ table: name, op: 'upsert', row });
          mockDb[name] = [...mockDb[name].filter((r) => r.gtin !== row.gtin), { ...row }];
          return { data: null, error: null };
        };
        return query;
      },
      insert: (row: Row) => {
        write = () => {
          mockDb.writes.push({ table: name, op: 'insert', row });
          const created = { id: `novo-${mockDb[name].length}`, shelf_life_days: null, ...row };
          mockDb[name].push(created);
          return { data: [created], error: null };
        };
        return query;
      },
      delete: () => {
        write = () => {
          const gone = rows();
          mockDb.writes.push({ table: name, op: 'delete' });
          mockDb[name] = mockDb[name].filter((row) => !gone.includes(row));
          return { data: null, error: null };
        };
        return query;
      },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve()
          .then(() => {
            if (name === 'product_barcodes' && mockDb.missing) return { data: null, count: null, error: MISSING };
            if (write) return write();
            const found = rows();
            return { data: found.map((row) => ({ ...row })), count: found.length, error: null };
          })
          .then(resolve, reject),
    };
    return query;
  };
  return {
    errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado.',
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    supabase: { from: (name: 'products' | 'product_barcodes') => table(name) },
  };
});

const LEITE: Product = { id: 'leite', name: 'Leite IL Desnatado', category: 'laticinios', shelf_life_days: null };
const ARROZ: Product = { id: 'arroz', name: 'Arroz Tio João 5kg', category: 'graos', shelf_life_days: null };
const EAN = '7891000100103';
const GTIN = '07891000100103';

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;
/** O que o hook devolveu no último desenho, na tela aberta por open(). */
let hook: { flow: ProductBarcodeFlow };
const onProduct = jest.fn<(product: Product) => void>();

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
async function open(linkTo?: Product) {
  const result = { flow: undefined as unknown as ProductBarcodeFlow };
  function Harness() {
    result.flow = useProductBarcode({ onProduct, linkTo });
    return result.flow.element as ReactElement;
  }
  hook = result;
  act(() => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
  });
  await settle();
}
async function scan(code: string) {
  act(() => hook.flow.start());
  await act(async () => mockCamera.onScan!({ data: code }));
  await settle();
}
/** O que foi gravado (inserir, ligar, apagar), na ordem. */
const writes = () => mockDb.writes;
const barcodeRows = () => mockDb.product_barcodes.map(({ gtin, product_id }) => ({ gtin, product_id }));

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  mockDb.products = [{ ...LEITE }, { ...ARROZ }];
  mockDb.product_barcodes = [];
  mockDb.missing = false;
  mockDb.writes = [];
  mockCamera.onScan = null;
  for (const key of Object.keys(mockPickers)) delete mockPickers[key];
  onProduct.mockClear();
  jest.mocked(notify).mockClear();
  jest.mocked(askYesNo).mockReset();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
});

describe('depois de ler o código de barras', () => {
  it('código conhecido: segue com o produto da casa, sem gravar nada', async () => {
    mockDb.product_barcodes = [{ gtin: GTIN, product_id: 'arroz' }];
    await open();
    expect(hook.flow.available).toBe(true);
    await scan(EAN);
    expect(onProduct.mock.calls).toEqual([[ARROZ]]);
    expect(writes()).toEqual([]);
    expect(mockPickers['Qual produto é este?']).toBeUndefined();
  });

  it('código que outra pessoa ligou há pouco (fora do guardado): o banco diz de quem é', async () => {
    await open();
    mockDb.product_barcodes = [{ gtin: GTIN, product_id: 'leite' }];
    await scan(EAN);
    expect(onProduct.mock.calls).toEqual([[LEITE]]);
    expect(writes()).toEqual([]);
  });

  it('código novo com um produto da casa: pergunta qual é, aprende o código e segue com ele', async () => {
    await open();
    await scan(EAN);
    const picker = mockPickers['Qual produto é este?'];
    expect(picker).toMatchObject({ visible: true });
    expect(picker.message).toBe('Código novo: 7891000100103. Escolha o produto ou crie um, e da próxima vez o Kotii já reconhece.');
    expect((picker.options as { id: string }[]).map((o) => o.id)).toEqual(['arroz', 'leite']);
    await act(async () => (picker.onSelect as (id: string) => void)('leite'));
    await settle();
    expect(barcodeRows()).toEqual([{ gtin: GTIN, product_id: 'leite' }]);
    expect(onProduct.mock.calls).toEqual([[LEITE]]);
    // Lido de novo, já é conhecido: não pergunta.
    delete mockPickers['Qual produto é este?'];
    await scan(EAN);
    expect(onProduct).toHaveBeenCalledTimes(2);
    expect(mockPickers['Qual produto é este?']).toBeUndefined();
  });

  it('código novo com um produto criado: nome, categoria (a do nome primeiro), cria, aprende e segue', async () => {
    await open();
    await scan(EAN);
    const picker = mockPickers['Qual produto é este?'];
    const extra = (picker.extraActions as (query: string) => ReactElement<{ title: string; onPress: () => void }> | null);
    // O nome que já é de um produto da casa não oferece criar outro.
    expect(extra('arroz tio joão 5KG')).toBeNull();
    const button = extra('Café Pilão 500g')!;
    expect(button.props.title).toBe('Criar "Café Pilão 500g"');
    act(() => button.props.onPress());
    const categories = mockPickers.Categoria;
    expect(categories.message).toBe('Do produto novo, "Café Pilão 500g".');
    expect((categories.options as { id: string; subtitle?: string }[])[0]).toMatchObject({ id: 'cafe_cha', subtitle: 'Pelo nome' });
    // Até escolher a categoria, nada foi gravado.
    expect(writes()).toEqual([]);
    await act(async () => (categories.onSelect as (id: string) => void)('cafe_cha'));
    await settle();
    expect(mockDb.writes.map((w) => `${w.op} ${w.table}`)).toEqual(['insert products', 'upsert product_barcodes']);
    const created = mockDb.products.find((p) => p.name === 'Café Pilão 500g')!;
    expect(created).toMatchObject({ category: 'cafe_cha' });
    expect(barcodeRows()).toEqual([{ gtin: GTIN, product_id: created.id }]);
    expect(onProduct.mock.calls[0][0]).toMatchObject({ id: created.id, name: 'Café Pilão 500g', category: 'cafe_cha' });
  });

  it('cancelar não grava nada: fechar a câmera, a escolha do produto ou a da categoria', async () => {
    await open();
    act(() => hook.flow.start());
    expect(mockCamera.onScan).not.toBeNull();
    await scan(EAN);
    act(() => (mockPickers['Qual produto é este?'].onClose as () => void)());
    await scan(EAN);
    const extra = mockPickers['Qual produto é este?'].extraActions as (query: string) => ReactElement<{ onPress: () => void }>;
    act(() => extra('Café').props.onPress());
    act(() => (mockPickers.Categoria.onClose as () => void)());
    await settle();
    expect(writes()).toEqual([]);
    expect(barcodeRows()).toEqual([]);
    expect(onProduct).not.toHaveBeenCalled();
  });

  it('na tela do produto: liga o código novo a ele', async () => {
    await open(LEITE);
    await scan(EAN);
    expect(barcodeRows()).toEqual([{ gtin: GTIN, product_id: 'leite' }]);
    expect(askYesNo).not.toHaveBeenCalled();
  });

  it('código de outro produto: pergunta antes de trocar; "Cancelar" não grava, "Passar para este" grava', async () => {
    mockDb.product_barcodes = [{ gtin: GTIN, product_id: 'arroz' }];
    await open(LEITE);
    jest.mocked(askYesNo).mockResolvedValueOnce(false);
    await scan(EAN);
    expect(jest.mocked(askYesNo).mock.calls[0]).toEqual([
      'Código de outro produto',
      'O código 7891000100103 está ligado a "Arroz Tio João 5kg". Passar para "Leite IL Desnatado"?',
      'Passar para este',
      'Cancelar',
    ]);
    expect(writes()).toEqual([]);
    expect(barcodeRows()).toEqual([{ gtin: GTIN, product_id: 'arroz' }]);

    jest.mocked(askYesNo).mockResolvedValueOnce(true);
    await scan(EAN);
    expect(barcodeRows()).toEqual([{ gtin: GTIN, product_id: 'leite' }]);
    expect(onProduct.mock.calls).toEqual([[LEITE]]);
  });

  it('o código que já é deste produto: avisa, sem gravar', async () => {
    mockDb.product_barcodes = [{ gtin: GTIN, product_id: 'leite' }];
    await open(LEITE);
    await scan(EAN);
    expect(notify).toHaveBeenCalledWith('Já estava ligado', 'O código 7891000100103 já é de "Leite IL Desnatado".');
    expect(writes()).toEqual([]);
  });

  it('código novo escolhido para um produto, mas outra pessoa o ligou a outro no meio: pergunta antes', async () => {
    await open();
    await scan(EAN);
    mockDb.product_barcodes = [{ gtin: GTIN, product_id: 'arroz' }];
    jest.mocked(askYesNo).mockResolvedValueOnce(false);
    await act(async () => (mockPickers['Qual produto é este?'].onSelect as (id: string) => void)('leite'));
    await settle();
    expect(askYesNo).toHaveBeenCalledTimes(1);
    expect(barcodeRows()).toEqual([{ gtin: GTIN, product_id: 'arroz' }]);
    expect(onProduct).not.toHaveBeenCalled();
  });

  it('sem a tabela no banco (migração não aplicada): não há o que mostrar, e nada quebra', async () => {
    mockDb.missing = true;
    await open();
    expect(hook.flow.available).toBe(false);
    expect(client.getQueryData(['productBarcodes'])).toBeNull();
  });
});

describe('desligar um código', () => {
  it('só apaga o código que ainda é deste produto, e o tira dos guardados', async () => {
    const seen = { unlink: undefined as unknown as ReturnType<typeof useUnlinkBarcode> };
    function Unlink() {
      seen.unlink = useUnlinkBarcode();
      return null;
    }
    mockDb.product_barcodes = [
      { gtin: GTIN, product_id: 'leite' },
      { gtin: '00000096385074', product_id: 'arroz' },
    ];
    client.setQueryData(['productBarcodes'], [...barcodeRows()]);
    act(() => {
      renderer = create(
        <QueryClientProvider client={client}>
          <Unlink />
        </QueryClientProvider>,
      );
    });
    // Outra pessoa passou o código para outro produto: desligar daqui não o tira de lá.
    await act(async () => seen.unlink.mutateAsync({ gtin: '00000096385074', productId: 'leite' }));
    expect(barcodeRows()).toHaveLength(2);
    await act(async () => seen.unlink.mutateAsync({ gtin: GTIN, productId: 'leite' }));
    expect(barcodeRows()).toEqual([{ gtin: '00000096385074', product_id: 'arroz' }]);
    expect(client.getQueryData(['productBarcodes'])).toEqual([{ gtin: '00000096385074', product_id: 'arroz' }]);
  });
});
