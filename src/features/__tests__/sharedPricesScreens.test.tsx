import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import FamilyScreen from '@/app/(tabs)/familia';
import PricesScreen from '@/app/precos';
import ProductScreen from '@/app/produto/[id]';
import { formatShortDate, toISODate } from '@/domain/dates';
import { SHARED_PRICES_NOTICE, SHARING_ABOUT, type SharedPrice } from '@/domain/sharedPrices';
import { storePricesFromSaved } from '@/domain/storePrices';
import type { LatestPrice, PriceObservation, Product, Store } from '@/lib/types';

// As telas de verdade (produto, Preços e Família), com as buscas trocadas por respostas prontas: o que se confere
// aqui é o que elas mostram dos preços de outras casas, e que nada muda quando o banco ainda não tem a função.

interface Query {
  data: unknown;
  isPending: boolean;
  isSuccess: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isRefetching: boolean;
  refetch: jest.Mock;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockQueries: Record<'products' | 'history' | 'stores' | 'prices' | 'shared' | 'available', Query> = {} as never;
/** Quem pediu os preços de outras casas: o cartão da aba Família não pede. */
const mockSharedPrices = jest.fn(() => mockQueries.shared);

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'arroz' }),
}));
jest.mock('@/data/market', () => ({
  useLatestPrices: () => mockQueries.prices,
  useProductPurchases: () => ({ data: [] }),
  useProducts: () => mockQueries.products,
  useRenameProduct: () => ({ mutate: jest.fn(), isPending: false }),
  useStorePrices: () => mockQueries.history,
  useStores: () => mockQueries.stores,
}));
jest.mock('@/data/sharedPrices', () => ({ useSharedPrices: () => mockSharedPrices(), useSharedPricesAvailable: () => mockQueries.available }));
// O histórico de preço do produto é uma seção à parte, com os testes dela: não entra no que se confere aqui.
jest.mock('@/features/market/PriceHistorySection', () => ({ PriceHistorySection: () => null }));
// Juntar produtos (o cartão de sugestões e a confirmação) também tem os testes dele.
jest.mock('@/features/MergeSuggestionsCard', () => ({ MergeSuggestionsCard: () => null }));
jest.mock('@/features/MergeProductsModal', () => ({ MergeProductsModal: () => null }));
// A aba Família: a casa, as pessoas e as outras seções não entram no que se confere aqui.
jest.mock('@/data/health', () => ({ usePeople: () => ({ data: [] }) }));
jest.mock('@/data/home', () => ({ useKidPoints: () => ({ data: {} }) }));
jest.mock('@/data/household', () => {
  const mutation = () => ({ mutate: jest.fn(), isPending: false });
  return { LastMemberError: class extends Error {}, useLeaveHousehold: mutation, useRegenerateInviteCode: mutation, useRemoveMember: mutation };
});
jest.mock('@/lib/auth', () => {
  const me = { household_id: 'h1', user_id: 'u1', display_name: 'Ana', role: 'owner' };
  const household = { id: 'h1', name: 'Casa da Ana', invite_code: 'ABC234', created_by: 'u1' };
  return {
    signOut: jest.fn(),
    useAuth: () => ({ session: { user: { id: 'u1', email: 'ana@exemplo.com' } } }),
    useHousehold: () => ({ data: { household, members: [me], me, households: [household] }, refetch: jest.fn() }),
  };
});
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: unknown) => String(error) }));
jest.mock('@/ui/dialogs', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));
jest.mock('@/features/AiUsageSection', () => ({ AiUsageSection: () => null }));
jest.mock('@/features/DocumentsSection', () => ({ DocumentsSection: () => null }));
jest.mock('@/features/HouseRemindersSection', () => ({ HouseRemindersSection: () => null }));
// Os desenhos animados (reanimated), o fundo e as imagens não entram no que se confere aqui.
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
  refetch: jest.fn(),
});
/** A primeira busca ainda anda. */
const onTheWay = (): Query => ({ ...loaded(undefined), isPending: true, isSuccess: false, isFetching: true });
/** Nunca carregou e a busca falhou. */
const failed = (): Query => ({ ...loaded(undefined), isSuccess: false, isError: true, error: new Error('sem rede') });
/** Já tem dados e busca de novo (depois de confirmar uma nota, ou ao abrir a tela com dados de mais de meio minuto). */
const refetching = (data: unknown): Query => ({ ...loaded(data), isFetching: true, isRefetching: true });
/** A busca nova falhou e ficaram os dados de antes. */
const failedKeeping = (data: unknown): Query => ({ ...loaded(data), isSuccess: false, isError: true, error: new Error('sem rede') });

/** O dia de `ago` dias atrás: as telas dizem "visto em" com a data de hoje como referência do ano. */
const day = (ago: number) => {
  const date = new Date();
  date.setDate(date.getDate() - ago);
  return toISODate(date);
};
/** Meio-dia em São Paulo naquele dia (o mesmo dia no relógio de quem roda o teste, no Brasil ou em UTC). */
const noon = (ago: number) => `${day(ago)}T12:00:00-03:00`;
const short = (ago: number) => formatShortDate(day(ago));

const ATACADAO = '11222333000181';
const SUPER = '99888777000166';

const PRODUCTS: Product[] = [{ id: 'arroz', name: 'Arroz Tio João 5kg', category: 'graos', shelf_life_days: null }];
// A casa conhece o atacadão pelo CNPJ (de uma nota lida); o mercadinho foi criado à mão.
const STORES: Store[] = [
  { id: 'atacadao', name: 'Atacadão', cnpj: ATACADAO, address: null },
  { id: 'mercadinho', name: 'Mercadinho', cnpj: null, address: null },
];
const own = (store_id: string, unit_price: number, ago: number): PriceObservation => ({
  product_id: 'arroz',
  store_id,
  unit: 'un',
  unit_price,
  purchased_at: noon(ago),
  receipt_id: `r-${store_id}-${ago}`,
});
/** Um preço de outra casa, num mercado de São Paulo que não é da casa (salvo dito o contrário em `partial`). */
const seen = (store_cnpj: string, store_name: string, unit_price: number, ago: number, partial: Partial<SharedPrice> = {}): SharedPrice => ({
  product_id: 'arroz',
  store_cnpj,
  store_name,
  store_uf: '35',
  unit: 'un',
  unit_price,
  seen_on: day(ago),
  mine: false,
  ...partial,
});
/** O mesmo, num mercado da própria casa: o banco marca pelo CNPJ. */
const seenInMine = (store_cnpj: string, store_name: string, unit_price: number, ago: number) => seen(store_cnpj, store_name, unit_price, ago, { mine: true });

/** Os preços da casa: valem para a tela do produto (o último de cada mercado, das compras) e para Preços (últimos preços). */
function household(prices: PriceObservation[]) {
  mockQueries.history = loaded(storePricesFromSaved(prices, 'arroz'));
  mockQueries.prices = loaded(prices.map(({ receipt_id: _receipt, ...price }): LatestPrice => price));
}

let renderer: ReactTestRenderer | undefined;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
/** O que a tela escreve, sem os ícones (que são letras de uma fonte de desenhos). */
const textOf = (node: ReactTestInstance | string) => rawText(node).replace(/[-]|[󰀀-􏿿]/gu, '');

/** Abre a tela e devolve tudo o que ela escreve. */
async function mount(screen: React.ReactElement) {
  await act(async () => {
    renderer = create(screen);
  });
  return textOf(renderer!.root);
}

/** Toca no botão que tem esse texto. */
async function press(label: string) {
  const [target] = renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && textOf(node) === label);
  await act(async () => {
    target.props.onPress();
  });
  return textOf(renderer!.root);
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockQueries, { products: loaded(PRODUCTS), stores: loaded(STORES), shared: loaded([]), available: loaded(true) });
  household([own('mercadinho', 25, 20)]);
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

/** O banco ainda sem a função (null), a busca a caminho e a busca que falhou. */
const NOT_AVAILABLE: [string, () => Query][] = [
  ['o banco ainda não tem a função', () => loaded(null)],
  ['a busca ainda anda', onTheWay],
  ['a busca falhou', failed],
];

describe('tela do produto: "Visto em outras casas"', () => {
  /** A tela de antes, até onde entram os preços de outras casas: o cartão do produto e o último preço da casa. */
  const USUAL = `Grãos, massas e cereaisNome do produtoÚltimo preço por mercadoMercadinhoem ${short(20)}R$ 25,00/un`;
  /** O botão de juntar produtos, que fecha a tela. */
  const JOIN = 'Juntar com outro produto';

  it('os mercados da casa primeiro, com o nome que ela conhece; depois os outros, com o estado; e o aviso uma vez, embaixo', async () => {
    mockQueries.shared = loaded([
      seenInMine(ATACADAO, 'ATACADAO S.A.', 22.9, 2),
      seen(SUPER, 'SUPER OUTRO', 21.9, 3),
      seen('33444555000177', 'MERCADO CARIOCA', 23.5, 4, { store_uf: '33' }),
      // Lido só por foto: não se sabe o estado.
      seen('44555666000188', 'MERCADO DA FOTO', 24, 5, { store_uf: null }),
    ]);
    const page = await mount(<ProductScreen />);
    expect(page).toContain(
      `Visto em outras casasNos seus mercadosAtacadãovisto em ${short(2)}R$ 22,90/un` +
        `Em outros mercadosSUPER OUTRO (SP)visto em ${short(3)}R$ 21,90/unMERCADO CARIOCA (RJ)visto em ${short(4)}R$ 23,50/unMERCADO DA FOTOvisto em ${short(5)}R$ 24,00/un` +
        SHARED_PRICES_NOTICE,
    );
    // Depois dos preços da própria casa.
    expect(page.indexOf('Visto em outras casas')).toBeGreaterThan(page.indexOf('Último preço por mercado'));
    expect(page).not.toContain('Ver mais');
    expect(page.split(SHARED_PRICES_NOTICE)).toHaveLength(2);
    expect(page).not.toContain('ATACADAO S.A.');
  });

  it('cada lista só aparece quando tem linhas', async () => {
    mockQueries.shared = loaded([seen(SUPER, 'SUPER OUTRO', 21.9, 3)]);
    expect(await mount(<ProductScreen />)).toBe(`${USUAL}Visto em outras casasEm outros mercadosSUPER OUTRO (SP)visto em ${short(3)}R$ 21,90/un${SHARED_PRICES_NOTICE}${JOIN}`);
    await act(async () => renderer?.unmount());
    mockQueries.shared = loaded([seenInMine(ATACADAO, 'ATACADAO S.A.', 22.9, 2)]);
    expect(await mount(<ProductScreen />)).toBe(`${USUAL}Visto em outras casasNos seus mercadosAtacadãovisto em ${short(2)}R$ 22,90/un${SHARED_PRICES_NOTICE}${JOIN}`);
  });

  it('para o leitor de tela, cada linha é um elemento só, que diz a frase inteira', async () => {
    mockQueries.shared = loaded([seen(SUPER, 'SUPER OUTRO', 21.9, 3)]);
    await mount(<ProductScreen />);
    const stops = renderer!.root.findAll((node) => typeof node.type === 'string' && node.props.accessible === true && textOf(node).includes('SUPER OUTRO'));
    expect(stops.map((node) => node.props.accessibilityLabel)).toEqual([`R$ 21,90/un · SUPER OUTRO (SP) · visto em ${short(3)}`]);
  });

  it('sem nada a mostrar, a seção e o aviso não aparecem', async () => {
    const page = await mount(<ProductScreen />);
    expect(page).not.toContain('Visto em outras casas');
    expect(page).not.toContain(SHARED_PRICES_NOTICE);
    expect(page).toBe(USUAL + JOIN);
  });

  it('a compra da própria casa não aparece como de outra: mesmo CNPJ, no mesmo dia ou depois', async () => {
    // O banco já tira essa linha na leitura; se a casa comprou depois da resposta, o app tira aqui.
    mockQueries.shared = loaded([seenInMine(ATACADAO, 'ATACADAO S.A.', 22.9, 2), seen(SUPER, 'SUPER OUTRO', 21.9, 3)]);
    household([own('mercadinho', 25, 20), own('atacadao', 22.9, 2)]);
    const page = await mount(<ProductScreen />);
    expect(page).toContain(`Visto em outras casasEm outros mercadosSUPER OUTRO (SP)visto em ${short(3)}R$ 21,90/un${SHARED_PRICES_NOTICE}`);
    expect(page).not.toContain('Nos seus mercados');
  });

  it('quando só havia a compra da própria casa, a seção some inteira', async () => {
    mockQueries.shared = loaded([seenInMine(ATACADAO, 'ATACADAO S.A.', 22.9, 2)]);
    household([own('atacadao', 22.9, 1)]);
    const page = await mount(<ProductScreen />);
    expect(page).not.toContain('Visto em outras casas');
    expect(page).not.toContain(SHARED_PRICES_NOTICE);
  });

  it('a compra no mercado sem CNPJ não esconde nada', async () => {
    mockQueries.shared = loaded([seen(ATACADAO, 'ATACADAO MOOCA', 22.9, 2)]);
    household([own('mercadinho', 22.9, 2)]);
    expect(await mount(<ProductScreen />)).toContain('ATACADAO MOOCA');
  });

  it('mais de cinco: "Ver mais" traz mais 20 de cada vez, nunca a lista inteira de uma vez', async () => {
    const market = (n: number) => `MERCADO ${String(n).padStart(2, '0')}`;
    mockQueries.shared = loaded(Array.from({ length: 30 }, (_, n) => seen(`000000000000${String(n).padStart(2, '0')}`, market(n + 1), 20 + n, 4)));
    const count = (page: string) => page.split('MERCADO ').length - 1;
    const page = await mount(<ProductScreen />);
    expect(count(page)).toBe(5);
    expect(page).toContain(market(5));
    expect(page).toContain(`Ver mais${SHARED_PRICES_NOTICE}`);
    const more = await press('Ver mais');
    expect(count(more)).toBe(25);
    expect(more).toContain(`Ver mais${SHARED_PRICES_NOTICE}`);
    const all = await press('Ver mais');
    expect(count(all)).toBe(30);
    expect(all).not.toContain('Ver mais');
    expect(all).toContain(SHARED_PRICES_NOTICE);
  });

  it('cada lista tem o seu "Ver mais"', async () => {
    mockQueries.shared = loaded([
      ...Array.from({ length: 7 }, (_, n) => seenInMine(`1000000000000${n}`, `MEU MERCADO ${n + 1}`, 20 + n, 4)),
      seen(SUPER, 'SUPER OUTRO', 21.9, 3),
    ]);
    const page = await mount(<ProductScreen />);
    expect(page).toContain('MEU MERCADO 5');
    expect(page).not.toContain('MEU MERCADO 6');
    // Só a lista dos mercados da casa passa de cinco.
    expect(page).toContain(`R$ 24,00/unVer maisEm outros mercadosSUPER OUTRO (SP)visto em ${short(3)}R$ 21,90/un${SHARED_PRICES_NOTICE}`);
    const all = await press('Ver mais');
    expect(all).toContain('MEU MERCADO 7');
    expect(all).not.toContain('Ver mais');
  });

  it('para o leitor de tela, cada "Ver mais" diz de qual das duas listas é', async () => {
    mockQueries.shared = loaded([
      ...Array.from({ length: 6 }, (_, n) => seenInMine(`1000000000000${n}`, `MEU MERCADO ${n + 1}`, 20 + n, 4)),
      ...Array.from({ length: 6 }, (_, n) => seen(`2000000000000${n}`, `OUTRO MERCADO ${n + 1}`, 30 + n, 4)),
    ]);
    await mount(<ProductScreen />);
    const more = renderer!.root.findAll(
      (node) => typeof node.type === 'string' && node.props.accessibilityRole === 'button' && textOf(node) === 'Ver mais',
    );
    expect(more.map((node) => node.props.accessibilityLabel)).toEqual(['Ver mais preços de outras casas nos seus mercados', 'Ver mais preços de outras casas em outros mercados']);
  });

  it('só com os preços e os mercados da casa em dia: durante uma busca nova, ou depois de uma que falhou, a seção espera', async () => {
    const prices = [own('mercadinho', 25, 20)].map(({ receipt_id: _receipt, ...price }): LatestPrice => price);
    const waiting: [keyof typeof mockQueries, Query][] = [
      ['prices', refetching(prices)],
      ['prices', failedKeeping(prices)],
      ['prices', failed()],
      ['stores', refetching(STORES)],
    ];
    for (const [key, query] of waiting) {
      mockQueries.shared = loaded([seen(SUPER, 'SUPER OUTRO', 21.9, 3)]);
      mockQueries[key] = query;
      // A tela é a de sempre: a seção some inteira (e volta quando a busca termina).
      expect(await mount(<ProductScreen />)).toBe(USUAL + JOIN);
      await act(async () => renderer?.unmount());
      Object.assign(mockQueries, { prices: loaded(prices), stores: loaded(STORES) });
    }
    expect(await mount(<ProductScreen />)).toContain('Visto em outras casas');
  });

  it.each(NOT_AVAILABLE)('%s: a tela é a de sempre', async (_name, answer) => {
    mockQueries.shared = answer();
    expect(await mount(<ProductScreen />)).toBe(USUAL + JOIN);
  });
});

describe('Preços: a linha "Visto por"', () => {
  /** A tela inteira de antes: o produto, onde a casa comprou e por quanto. */
  const USUAL = 'Arroz Tio João 5kgSó em MercadinhoR$ 25,00';

  it('aparece embaixo do produto quando outra casa viu mais barato que o menor preço da casa, e o aviso vem uma vez, embaixo da lista', async () => {
    mockQueries.shared = loaded([seen(ATACADAO, 'ATACADAO MOOCA', 22.9, 2), seen(SUPER, 'SUPER OUTRO', 21.9, 3)]);
    expect(await mount(<PricesScreen />)).toBe(
      `Arroz Tio João 5kgSó em MercadinhoVisto por R$ 21,90/un · SUPER OUTRO (SP) · ${short(3)}, em outra casaR$ 25,00${SHARED_PRICES_NOTICE}`,
    );
  });

  it('prefere o que foi visto num mercado da própria casa, com o nome que ela conhece', async () => {
    mockQueries.shared = loaded([seenInMine(ATACADAO, 'ATACADAO S.A.', 22.9, 2), seen(SUPER, 'SUPER OUTRO', 21.9, 3)]);
    expect(await mount(<PricesScreen />)).toBe(
      `Arroz Tio João 5kgSó em MercadinhoVisto por R$ 22,90/un · Atacadão · ${short(2)}, em outra casaR$ 25,00${SHARED_PRICES_NOTICE}`,
    );
  });

  it('com dois produtos avisados, o aviso continua sendo um só', async () => {
    mockQueries.products = loaded([...PRODUCTS, { id: 'feijao', name: 'Feijão Camil 1kg', category: 'graos', shelf_life_days: null }]);
    mockQueries.prices = loaded([
      { product_id: 'arroz', store_id: 'mercadinho', unit: 'un', unit_price: 25, purchased_at: noon(20) },
      { product_id: 'feijao', store_id: 'mercadinho', unit: 'un', unit_price: 9, purchased_at: noon(20) },
    ]);
    mockQueries.shared = loaded([seen(SUPER, 'SUPER OUTRO', 21.9, 3), seen(SUPER, 'SUPER OUTRO', 7.5, 3, { product_id: 'feijao' })]);
    const page = await mount(<PricesScreen />);
    expect(page.split('Visto por')).toHaveLength(3);
    expect(page.split(SHARED_PRICES_NOTICE)).toHaveLength(2);
    expect(page.endsWith(SHARED_PRICES_NOTICE)).toBe(true);
  });

  it('não aparece quando o que outras casas viram é igual ou mais caro', async () => {
    mockQueries.shared = loaded([seen(ATACADAO, 'ATACADAO MOOCA', 25, 2), seen(SUPER, 'SUPER OUTRO', 27.5, 3)]);
    expect(await mount(<PricesScreen />)).toBe(USUAL);
  });

  it('nem quando o mais barato é a compra da própria casa', async () => {
    mockQueries.shared = loaded([seenInMine(ATACADAO, 'ATACADAO S.A.', 22.9, 2)]);
    household([own('mercadinho', 25, 20), own('atacadao', 22.9, 2)]);
    const page = await mount(<PricesScreen />);
    expect(page).toBe('Arroz Tio João 5kgMais barato: Atacadão · 2 mercadosR$ 22,90–25,00');
  });

  it('enquanto os preços ou os mercados da casa são buscados de novo, a tela é a de sempre', async () => {
    mockQueries.shared = loaded([seen(SUPER, 'SUPER OUTRO', 21.9, 3)]);
    mockQueries.prices = refetching(mockQueries.prices.data);
    expect(await mount(<PricesScreen />)).toBe(USUAL);
    await act(async () => renderer?.unmount());
    mockQueries.prices = loaded(mockQueries.prices.data);
    mockQueries.stores = refetching(STORES);
    expect(await mount(<PricesScreen />)).toBe(USUAL);
  });

  it('sem preços de outras casas, a tela é a de sempre', async () => {
    expect(await mount(<PricesScreen />)).toBe(USUAL);
  });

  it.each(NOT_AVAILABLE)('%s: a tela é a de sempre', async (_name, answer) => {
    mockQueries.shared = answer();
    expect(await mount(<PricesScreen />)).toBe(USUAL);
  });
});

describe('aba Família: "Preços compartilhados"', () => {
  it('com o compartilhamento no banco, a casa lê o que entra na base comum (mesmo sem preço nenhum para ela)', async () => {
    const page = await mount(<FamilyScreen />);
    expect(page).toContain(`Preços compartilhados${SHARING_ABOUT}`);
    // Não há chave para desligar.
    expect(renderer!.root.findAll((node) => node.props.accessibilityRole === 'switch')).toHaveLength(0);
  });

  it('o cartão só pergunta se o compartilhamento existe: a aba nunca pede os preços de outras casas', async () => {
    // Nem quando os preços já estão aí, nem quando a função dos preços falta: o cartão segue a pergunta.
    for (const shared of [loaded([seen(SUPER, 'SUPER OUTRO', 21.9, 3)]), loaded(null)]) {
      mockQueries.shared = shared;
      expect(await mount(<FamilyScreen />)).toContain(`Preços compartilhados${SHARING_ABOUT}`);
      await act(async () => renderer?.unmount());
    }
    expect(mockSharedPrices).not.toHaveBeenCalled();
  });

  /** O banco ainda sem o compartilhamento (false), a pergunta a caminho e a que falhou. */
  const CARD_NOT_AVAILABLE: [string, () => Query][] = [
    ['o banco ainda não tem o compartilhamento', () => loaded(false)],
    ['a pergunta ainda anda', onTheWay],
    ['a pergunta falhou', failed],
  ];

  it.each(CARD_NOT_AVAILABLE)('%s: o cartão não aparece e a aba é a de sempre', async (_name, answer) => {
    const withCard = await mount(<FamilyScreen />);
    await act(async () => renderer?.unmount());
    mockQueries.available = answer();
    const page = await mount(<FamilyScreen />);
    // A aba inteira, menos o cartão: nada mais muda.
    expect(page).toBe(withCard.replace(`Preços compartilhados${SHARING_ABOUT}`, ''));
    expect(page).not.toContain('Preços compartilhados');
    expect(page).toContain('Casa da AnaFamília');
    expect(page).toContain('Código de conviteABC234');
  });
});
