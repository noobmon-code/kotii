import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import PricesScreen from '@/app/precos';
import ProductScreen from '@/app/produto/[id]';
import type { Product } from '@/lib/types';
import { confirmAction } from '@/ui/dialogs';
import { Button, IconButton } from '@/ui/primitives';

// As entradas da leitura do código de barras no Preços e na tela do produto, com as buscas trocadas por respostas
// prontas e o caminho depois de ler (features/ProductBarcode, que tem os testes dele) trocado por um que guarda
// com o que a tela o chamou. Com o banco ainda sem a tabela, os botões não aparecem e a tela é a de sempre.

const loaded = (data: unknown) => ({
  data,
  isPending: false,
  isSuccess: true,
  isFetching: false,
  isError: false,
  error: null,
  isRefetching: false,
  fetchStatus: 'idle',
  refetch: jest.fn(),
});

const ARROZ: Product = { id: 'arroz', name: 'Arroz Tio João 5kg', category: 'graos', shelf_life_days: null };

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockBarcode: {
  available: boolean;
  busy: boolean;
  start: jest.Mock;
  options: { onProduct: (product: Product) => void; linkTo?: Product } | null;
  codes: { gtin: string; product_id: string }[] | null;
  unlink: jest.Mock;
} = { available: true, busy: false, start: jest.fn(), options: null, codes: [], unlink: jest.fn() };
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), replace: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'arroz' }),
}));
jest.mock('@/features/ProductBarcode', () => ({
  useProductBarcode: (options: { onProduct: (product: Product) => void; linkTo?: Product }) => {
    mockBarcode.options = options;
    return { available: mockBarcode.available, busy: mockBarcode.busy, start: mockBarcode.start, element: null };
  },
}));
jest.mock('@/data/barcodes', () => ({
  useBarcodes: () => ({ data: mockBarcode.codes }),
  useUnlinkBarcode: () => ({ mutate: mockBarcode.unlink }),
}));
jest.mock('@/data/market', () => ({
  ProductNameTakenError: class extends Error {},
  useAddToPantryList: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useLatestPrices: () => loaded([{ product_id: 'arroz', store_id: 'assai', unit: 'un', unit_price: 25.9, purchased_at: '2026-10-10T12:00:00-03:00' }]),
  useProductPurchases: () => ({ data: [] }),
  useProducts: () => loaded([ARROZ]),
  useRenameProduct: () => ({ mutate: jest.fn(), isPending: false }),
  useStorePrices: () => loaded([]),
  useStores: () => loaded([{ id: 'assai', name: 'Assaí', cnpj: null, address: null }]),
}));
jest.mock('@/data/sharedPrices', () => ({ useSharedPrices: () => ({ data: [], isSuccess: true, isFetching: false }) }));
jest.mock('@/features/market/PriceHistorySection', () => ({ PriceHistorySection: () => null }));
jest.mock('@/features/SharedPrices', () => ({ SharedPricesSection: () => null }));
jest.mock('@/features/MergeSuggestionsCard', () => ({ MergeSuggestionsCard: () => null }));
jest.mock('@/features/MergeProductsModal', () => ({ MergeProductsModal: () => null }));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: { message?: string }) => error?.message ?? String(error) }));
jest.mock('@/ui/dialogs', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/PickerModal', () => ({ PickerModal: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

let renderer: ReactTestRenderer | undefined;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
const textOf = (node: ReactTestInstance | string) => rawText(node).replace(/[\uE000-\uF8FF]|[\u{F0000}-\u{10FFFF}]/gu, '');
const page = () => textOf(renderer!.root);
const iconButton = (label: string) => renderer!.root.findAllByType(IconButton).find((node) => node.props.label === label);
const button = (label: string) => renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && textOf(node) === label)[0];

async function mount(screen: React.ReactElement) {
  await act(async () => {
    renderer = create(screen);
  });
  return page();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBarcode.available = true;
  mockBarcode.busy = false;
  mockBarcode.options = null;
  mockBarcode.codes = [];
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('Preços: ler o código ao lado de "Buscar produto"', () => {
  it('o botão abre a câmera, e o produto lido abre a tela dele', async () => {
    await mount(<PricesScreen />);
    const scan = iconButton('Ler código de barras');
    expect(scan).toBeDefined();
    act(() => scan!.props.onPress());
    expect(mockBarcode.start).toHaveBeenCalledTimes(1);
    expect(mockBarcode.options?.linkTo).toBeUndefined();
    act(() => mockBarcode.options!.onProduct(ARROZ));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/produto/[id]', params: { id: 'arroz' } });
  });

  it('enquanto o código anterior ainda está sendo visto, o botão fica desligado', async () => {
    await mount(<PricesScreen />);
    expect(iconButton('Ler código de barras')!.props.disabled).toBe(false);
    mockBarcode.busy = true;
    await act(async () => renderer!.update(<PricesScreen />));
    expect(iconButton('Ler código de barras')!.props.disabled).toBe(true);
  });

  it('sem a tabela no banco: sem o botão, e a lista de preços de sempre', async () => {
    mockBarcode.available = false;
    mockBarcode.codes = null;
    expect(await mount(<PricesScreen />)).toBe('Arroz Tio João 5kgSó em AssaíR$ 25,90');
    expect(iconButton('Ler código de barras')).toBeUndefined();
  });
});

describe('produto: os códigos ligados, ligar e desligar', () => {
  it('mostra os códigos deste produto, liga um novo a ele e desliga um, depois de confirmar', async () => {
    mockBarcode.codes = [
      { gtin: '07891000100103', product_id: 'arroz' },
      { gtin: '00000096385074', product_id: 'leite' },
    ];
    const text = await mount(<ProductScreen />);
    expect(text).toContain('Código de barras: 7891000100103');
    // O código de outro produto não aparece aqui.
    expect(text).not.toContain('96385074');
    expect(mockBarcode.options?.linkTo).toEqual(ARROZ);
    act(() => button('Ligar código de barras').props.onPress());
    expect(mockBarcode.start).toHaveBeenCalledTimes(1);

    act(() => iconButton('Desligar o código 7891000100103')!.props.onPress());
    const [title, message, label, yes] = jest.mocked(confirmAction).mock.calls[0];
    expect([title, message, label]).toEqual([
      'Desligar código',
      'O código 7891000100103 deixa de abrir "Arroz Tio João 5kg". Dá para ligar de novo depois.',
      'Desligar',
    ]);
    expect(mockBarcode.unlink).not.toHaveBeenCalled();
    act(() => yes());
    expect(mockBarcode.unlink.mock.calls[0][0]).toEqual({ gtin: '07891000100103', productId: 'arroz' });
  });

  it('enquanto o código anterior ainda está sendo visto, "Ligar código de barras" fica carregando', async () => {
    const link = () => renderer!.root.findAll((node) => node.type === Button && node.props.title === 'Ligar código de barras')[0];
    await mount(<ProductScreen />);
    expect(link().props.loading).toBe(false);
    mockBarcode.busy = true;
    await act(async () => renderer!.update(<ProductScreen />));
    expect(link().props.loading).toBe(true);
  });

  it('sem a tabela no banco: nem códigos nem o botão de ligar, e a tela abre', async () => {
    mockBarcode.available = false;
    mockBarcode.codes = null;
    const text = await mount(<ProductScreen />);
    expect(text).toContain('Nome do produto');
    expect(text).toContain('Pôr na lista');
    expect(text).not.toContain('Código de barras');
    expect(text).not.toContain('Ligar código de barras');
  });
});
