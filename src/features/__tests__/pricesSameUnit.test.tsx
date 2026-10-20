import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import PricesScreen from '@/app/precos';
import ProductScreen from '@/app/produto/[id]';
import { formatShortDate, toISODate } from '@/domain/dates';
import type { PurchaseLine } from '@/domain/priceHistory';
import { productNameTakenHint } from '@/domain/productMerge';
import { storePricesFromPurchases } from '@/domain/storePrices';
import type { LatestPrice, Product, Store } from '@/lib/types';
import { notify } from '@/ui/dialogs';

// As telas de verdade (produto e Preços), com as buscas trocadas por respostas prontas: os preços comparados na
// mesma unidade, os avisos de Preços quando a busca falha ou não acha nada, o nome repetido que oferece juntar os
// dois produtos e o "Pôr na lista".

interface Query {
  data: unknown;
  isPending: boolean;
  isSuccess: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isRefetching: boolean;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  refetch: jest.Mock;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockQueries: Record<'products' | 'history' | 'stores' | 'prices', Query> = {} as never;
type Rename = (input: unknown, options: { onError: (error: unknown) => void }) => void;
type AddToList = (item: unknown) => Promise<{ id: string; name: string; added: boolean }>;
const mockRename = { mutate: jest.fn<Rename>(), isPending: false };
const mockAddToList = { mutateAsync: jest.fn<AddToList>(), isPending: false };
/** As props com que a confirmação de juntar foi aberta (null: fechada). */
const mockMerge: { props: Record<string, unknown> | null } = { props: null };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'arroz' }),
}));
jest.mock('@/data/market', () => {
  class ProductNameTakenError extends Error {
    other: unknown;
    constructor(mockOther: unknown) {
      super('Já existe um produto com esse nome.');
      this.other = mockOther;
    }
  }
  return {
    ProductNameTakenError,
    useAddToPantryList: () => mockAddToList,
    useLatestPrices: () => mockQueries.prices,
    useProductPurchases: () => ({ data: [] }),
    useProducts: () => mockQueries.products,
    useRenameProduct: () => mockRename,
    useStorePrices: () => mockQueries.history,
    useStores: () => mockQueries.stores,
  };
});
jest.mock('@/data/sharedPrices', () => ({ useSharedPrices: () => ({ data: [], isSuccess: true, isFetching: false }) }));
// O histórico, os preços de outras casas e as sugestões de juntar têm os testes deles.
jest.mock('@/features/market/PriceHistorySection', () => ({ PriceHistorySection: () => null }));
jest.mock('@/features/SharedPrices', () => ({ SharedPricesSection: () => null }));
jest.mock('@/features/MergeSuggestionsCard', () => ({ MergeSuggestionsCard: () => null }));
jest.mock('@/features/MergeProductsModal', () => ({
  MergeProductsModal: (props: Record<string, unknown>) => {
    mockMerge.props = props;
    return null;
  },
}));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: { message?: string }) => error?.message ?? String(error) }));
jest.mock('@/ui/dialogs', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/PickerModal', () => ({ PickerModal: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

const loaded = (data: unknown): Query => ({
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
/** A busca nova falhou e ficaram os dados de antes. */
const failedKeeping = (data: unknown): Query => ({ ...loaded(data), isSuccess: false, isError: true, error: new Error('sem rede') });
/** Sem internet e sem nada guardado no aparelho: a busca fica parada. */
const pausedEmpty = (): Query => ({ ...loaded(undefined), isPending: true, isSuccess: false, fetchStatus: 'paused' });

const day = (ago: number) => {
  const date = new Date();
  date.setDate(date.getDate() - ago);
  return toISODate(date);
};
const noon = (ago: number) => `${day(ago)}T12:00:00-03:00`;
const short = (ago: number) => formatShortDate(day(ago));

const ARROZ: Product = { id: 'arroz', name: 'Arroz', category: 'graos', shelf_life_days: null };
const STORES: Store[] = [
  { id: 'assai', name: 'Assaí', cnpj: null, address: null },
  { id: 'dia', name: 'Dia', cnpj: null, address: null },
  { id: 'atacadao', name: 'Atacadão', cnpj: null, address: null },
];

let serial = 0;
/** Uma linha de nota confirmada do produto. */
function line(storeId: string, unitPrice: number, ago: number, description: string, unit = 'un'): PurchaseLine {
  serial += 1;
  return {
    id: `i${serial}`,
    receiptId: `r${serial}`,
    storeId,
    storeName: storeId,
    purchasedAt: noon(ago),
    quantity: 1,
    unit,
    unitPrice,
    totalPrice: unitPrice,
    description,
  };
}
const latest = (product_id: string, store_id: string, unit: LatestPrice['unit'], unit_price: number, ago = 5): LatestPrice => ({
  product_id,
  store_id,
  unit,
  unit_price,
  purchased_at: noon(ago),
});

let renderer: ReactTestRenderer | undefined;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
/** O que a tela escreve, sem os ícones (que são letras de uma fonte de desenhos). */
const textOf = (node: ReactTestInstance | string) => rawText(node).replace(/[\uE000-\uF8FF]|[\u{F0000}-\u{10FFFF}]/gu, '');
const page = () => textOf(renderer!.root);

async function mount(screen: React.ReactElement) {
  await act(async () => {
    renderer = create(screen);
  });
  return page();
}

/** Toca no botão que tem esse texto. */
async function press(label: string) {
  const [target] = renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && textOf(node) === label);
  await act(async () => {
    await target.props.onPress();
  });
  return page();
}

/** Digita no campo que tem esse texto de exemplo (ou esse rótulo, pelo valor de agora). */
async function type(find: (node: ReactTestInstance) => boolean, text: string) {
  const [field] = renderer!.root.findAll((node) => typeof node.props.onChangeText === 'function' && find(node));
  await act(async () => {
    field.props.onChangeText(text);
  });
  return page();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMerge.props = null;
  mockRename.mutate = jest.fn<Rename>();
  mockAddToList.mutateAsync = jest.fn<AddToList>();
  Object.assign(mockQueries, { products: loaded([ARROZ]), stores: loaded(STORES), prices: loaded([]), history: loaded([]) });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('tela do produto: "Último preço por mercado" na mesma unidade', () => {
  it('pacote de 5 kg e de 1 kg: pelo preço por kg, e o "Mais barato" vai para o de 5 kg', async () => {
    mockQueries.history = loaded(storePricesFromPurchases([line('assai', 24.9, 10, 'ARROZ T1 5KG'), line('dia', 5.49, 3, 'ARROZ T1 1KG')]));
    const text = await mount(<ProductScreen />);
    expect(text).toContain(
      `Último preço por mercadoAssaí5 kg por R$ 24,90 · em ${short(10)}Mais baratoR$ 4,98/kgDia1 kg por R$ 5,49 · em ${short(3)}R$ 5,49/kg`,
    );
  });

  it('kg e unidade em listas separadas: o selo só entre os da mesma unidade', async () => {
    mockQueries.history = loaded(
      storePricesFromPurchases([
        line('assai', 6.99, 10, 'BANANA PRATA KG', 'kg'),
        line('atacadao', 7.49, 4, 'BANANA PRATA', 'kg'),
        line('dia', 1.2, 3, 'BANANA PRATA UN'),
      ]),
    );
    const text = await mount(<ProductScreen />);
    expect(text).toContain(
      `Último preço por mercadoPor kgAssaíem ${short(10)}Mais baratoR$ 6,99/kgAtacadãoem ${short(4)}R$ 7,49/kgPor unidadeDiaem ${short(3)}R$ 1,20/un`,
    );
    // O R$ 1,20 por unidade não ganha o selo por ser o menor número.
    expect(text.split('Mais barato')).toHaveLength(2);
  });

  it('kg e unidade, um mercado em cada: nenhum "Mais barato"', async () => {
    mockQueries.history = loaded(storePricesFromPurchases([line('assai', 6.99, 10, 'BANANA PRATA KG', 'kg'), line('dia', 1.2, 3, 'BANANA PRATA UN')]));
    const text = await mount(<ProductScreen />);
    expect(text).not.toContain('Mais barato');
    expect(text).toContain('Por kg');
    expect(text).toContain('Por unidade');
  });

  it('sem internet, dos preços guardados: g aparece por kg, e não se compara com unidade', async () => {
    mockQueries.history = { ...loaded(undefined), isPending: true, isSuccess: false, fetchStatus: 'paused' };
    mockQueries.prices = loaded([latest('arroz', 'assai', 'g', 0.0059, 10), latest('arroz', 'dia', 'kg', 6.49, 3), latest('arroz', 'atacadao', 'un', 24.9, 2)]);
    const text = await mount(<ProductScreen />);
    expect(text).toContain(`Por kgAssaíem ${short(10)}Mais baratoR$ 5,90/kgDiaem ${short(3)}R$ 6,49/kgPor unidadeAtacadãoem ${short(2)}R$ 24,90/un`);
    expect(text).not.toContain('/g');
  });
});

describe('tela do produto: renomear para um nome que já existe', () => {
  it('avisa embaixo do campo e oferece juntar os dois, abrindo a confirmação com o outro produto', async () => {
    const other = { id: 'arroz-2', name: 'Arroz Tio João', category: 'graos' };
    const { ProductNameTakenError } = jest.requireMock<{ ProductNameTakenError: new (other: unknown) => Error }>('@/data/market');
    mockRename.mutate = jest.fn<Rename>((_input, options) => options.onError(new ProductNameTakenError(other)));
    await mount(<ProductScreen />);
    await type((node) => node.props.value === 'Arroz', 'arroz tio joão');
    const text = await press('Salvar nome');
    expect(mockRename.mutate).toHaveBeenCalledWith({ id: 'arroz', name: 'arroz tio joão', category: 'graos' }, expect.anything());
    expect(text).toContain(productNameTakenHint('Arroz Tio João'));
    expect(text).not.toContain('duplicate key');
    expect(notify).not.toHaveBeenCalled();
    // O botão de salvar some até o nome mudar; o de juntar aparece.
    expect(text).not.toContain('Salvar nome');
    await press('Juntar os dois');
    expect(mockMerge.props).toMatchObject({ opened: ARROZ, other });
    // Mudar o nome tira o aviso.
    mockMerge.props = null;
    const edited = await type((node) => node.props.value === 'arroz tio joão', 'Arroz branco');
    expect(edited).not.toContain('Já existe');
    expect(edited).toContain('Salvar nome');
  });

  it('sem saber qual é o outro produto, só o aviso', async () => {
    const { ProductNameTakenError } = jest.requireMock<{ ProductNameTakenError: new (other: unknown) => Error }>('@/data/market');
    mockRename.mutate = jest.fn<Rename>((_input, options) => options.onError(new ProductNameTakenError(null)));
    await mount(<ProductScreen />);
    await type((node) => node.props.value === 'Arroz', 'Feijão');
    const text = await press('Salvar nome');
    expect(text).toContain('Já existe um produto com esse nome.');
    expect(text).not.toContain('Juntar os dois');
  });

  it('outro erro continua no aviso de sempre', async () => {
    mockRename.mutate = jest.fn<Rename>((_input, options) => options.onError(new Error('sem rede')));
    await mount(<ProductScreen />);
    await type((node) => node.props.value === 'Arroz', 'Arroz 5kg');
    await press('Salvar nome');
    expect(notify).toHaveBeenCalledWith('Erro', 'sem rede');
  });
});

describe('tela do produto: "Pôr na lista"', () => {
  it('põe o produto na lista pelo caminho do "Acabou" da despensa e diz em qual', async () => {
    mockAddToList.mutateAsync = jest.fn(async () => ({ id: 'l1', name: 'Mercado', added: true }));
    await mount(<ProductScreen />);
    await press('Pôr na lista');
    expect(mockAddToList.mutateAsync).toHaveBeenCalledWith({ name: 'Arroz', category: 'graos', productId: 'arroz', quantity: 1, unit: 'un' });
    expect(notify).toHaveBeenCalledWith('Adicionado à lista', 'Arroz foi para "Mercado".');
  });

  it('já pendente na lista: diz isso, sem repetir', async () => {
    mockAddToList.mutateAsync = jest.fn(async () => ({ id: 'l1', name: 'Mercado', added: false }));
    await mount(<ProductScreen />);
    await press('Pôr na lista');
    expect(notify).toHaveBeenCalledWith('Já estava na lista', 'Arroz já estava pendente em "Mercado".');
  });

  it('a falha vira aviso', async () => {
    mockAddToList.mutateAsync = jest.fn(async () => {
      throw new Error('Essa lista não está mais aberta. Escolha outra.');
    });
    await mount(<ProductScreen />);
    await press('Pôr na lista');
    expect(notify).toHaveBeenCalledWith('Erro', 'Essa lista não está mais aberta. Escolha outra.');
  });
});

describe('Preços', () => {
  const QUEIJO: Product = { id: 'queijo', name: 'Queijo mussarela', category: 'frios', shelf_life_days: null };

  it('g e kg na mesma comparação, e o preço por kg (nunca por g)', async () => {
    mockQueries.products = loaded([QUEIJO]);
    mockQueries.prices = loaded([latest('queijo', 'assai', 'g', 0.0399), latest('queijo', 'dia', 'kg', 42.9)]);
    const text = await mount(<PricesScreen />);
    expect(text).toBe('Queijo mussarelaMais barato: Assaí · 2 mercadosR$ 39,90–42,90/kg');
  });

  it('ml e litro também', async () => {
    mockQueries.products = loaded([{ ...QUEIJO, id: 'leite', name: 'Leite' }]);
    mockQueries.prices = loaded([latest('leite', 'assai', 'ml', 0.0049)]);
    expect(await mount(<PricesScreen />)).toBe('LeiteSó em AssaíR$ 4,90/l');
  });

  it('busca sem resultado: "Nenhum produto com esse nome", não "Sem preços ainda"', async () => {
    mockQueries.prices = loaded([latest('arroz', 'assai', 'un', 24.9)]);
    await mount(<PricesScreen />);
    const text = await type((node) => node.props.placeholder === 'Buscar produto', 'xyz');
    expect(text).toContain('Nenhum produto com esse nome');
    expect(text).not.toContain('Sem preços ainda');
    // Sem busca, a casa sem preço nenhum continua com a frase de sempre.
    await act(async () => renderer?.unmount());
    mockQueries.prices = loaded([]);
    expect(await mount(<PricesScreen />)).toContain('Sem preços ainda');
  });

  it('a busca acha pelo nome, sem acento nem maiúscula', async () => {
    mockQueries.products = loaded([ARROZ, QUEIJO]);
    mockQueries.prices = loaded([latest('arroz', 'assai', 'un', 24.9), latest('queijo', 'dia', 'kg', 42.9)]);
    await mount(<PricesScreen />);
    const text = await type((node) => node.props.placeholder === 'Buscar produto', 'MUSSARÉLA');
    expect(text).toContain('Queijo mussarela');
    expect(text).not.toContain('Arroz');
  });

  it('uma atualização que falhou mantém a lista, com o aviso e o "Tentar de novo"', async () => {
    mockQueries.prices = failedKeeping([latest('arroz', 'assai', 'un', 24.9)]);
    const text = await mount(<PricesScreen />);
    expect(text).toBe('Não foi possível atualizar. Mostrando o que já estava carregado.Tentar de novoArrozSó em AssaíR$ 24,90');
    await press('Tentar de novo');
    expect(mockQueries.prices.refetch).toHaveBeenCalled();
  });

  it('sem nada guardado e sem internet: diz isso, em vez de girar sem fim', async () => {
    mockQueries.prices = pausedEmpty();
    expect(await mount(<PricesScreen />)).toBe('Sem internet: os preços aparecem quando a conexão voltar.');
  });

  it('nunca carregou e a busca falhou: o erro, com "Tentar de novo"', async () => {
    mockQueries.prices = { ...loaded(undefined), isPending: true, isSuccess: false, isError: true, error: new Error('sem rede') };
    expect(await mount(<PricesScreen />)).toBe('sem redeTentar de novo');
  });

  it('com muitos produtos, a lista não desenha todos de uma vez', async () => {
    const many = Array.from({ length: 400 }, (_, n): Product => ({ id: `p${n}`, name: `Produto ${String(n).padStart(3, '0')}`, category: 'graos', shelf_life_days: null }));
    mockQueries.products = loaded(many);
    mockQueries.prices = loaded(many.map((product) => latest(product.id, 'assai', 'un', 10)));
    const text = await mount(<PricesScreen />);
    expect(text).toContain('Produto 000');
    const drawn = text.split('Produto ').length - 1;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(100);
  });
});
