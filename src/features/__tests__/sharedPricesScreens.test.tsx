import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import FamilyScreen from '@/app/(tabs)/familia';
import PricesScreen from '@/app/precos';
import ProductScreen from '@/app/produto/[id]';
import { formatShortDate, toISODate } from '@/domain/dates';
import { SHARED_PRICES_NOTICE, SHARING_ABOUT, type SharedPrice } from '@/domain/sharedPrices';
import type { LatestPrice, PriceObservation, Product, Store } from '@/lib/types';

// As telas de verdade (produto, Preços e Família), com as buscas trocadas por respostas prontas: o que se confere
// aqui é o que elas mostram dos preços de outras casas, e que nada muda quando o banco ainda não tem a função.

interface Query {
  data: unknown;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  isRefetching: boolean;
  refetch: jest.Mock;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockQueries: Record<'products' | 'history' | 'stores' | 'prices' | 'shared', Query> = {} as never;

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'arroz' }),
}));
jest.mock('@/data/market', () => ({
  useLatestPrices: () => mockQueries.prices,
  usePriceHistory: () => mockQueries.history,
  useProductPurchases: () => ({ data: [] }),
  useProducts: () => mockQueries.products,
  useRenameProduct: () => ({ mutate: jest.fn(), isPending: false }),
  useStores: () => mockQueries.stores,
}));
jest.mock('@/data/sharedPrices', () => ({ useSharedPrices: () => mockQueries.shared }));
// O histórico de preço do produto é uma seção à parte, com os testes dela: não entra no que se confere aqui.
jest.mock('@/features/market/PriceHistorySection', () => ({ PriceHistorySection: () => null }));
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

const loaded = (data: unknown): Query => ({ data, isPending: false, isError: false, error: null, isRefetching: false, refetch: jest.fn() });
/** A primeira busca ainda anda. */
const onTheWay = (): Query => ({ ...loaded(undefined), isPending: true });
/** Nunca carregou e a busca falhou. */
const failed = (): Query => ({ ...loaded(undefined), isError: true, error: new Error('sem rede') });

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
const seen = (store_cnpj: string, store_name: string, unit_price: number, ago: number): SharedPrice => ({
  product_id: 'arroz',
  store_cnpj,
  store_name,
  unit: 'un',
  unit_price,
  seen_on: day(ago),
});

/** Os preços da casa: valem para a tela do produto (histórico) e para Preços (últimos preços). */
function household(prices: PriceObservation[]) {
  mockQueries.history = loaded(prices);
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
  Object.assign(mockQueries, { products: loaded(PRODUCTS), stores: loaded(STORES), shared: loaded([]) });
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
  /** A tela inteira de antes: o cartão do produto e o último preço da casa. */
  const USUAL = `Grãos, massas e cereaisNome do produtoÚltimo preço por mercadoMercadinhoem ${short(20)}R$ 25,00/un`;

  it('com preços de outras casas: o mais barato primeiro, o mercado como veio, o dia, e o aviso embaixo', async () => {
    mockQueries.shared = loaded([seen(ATACADAO, 'ATACADAO MOOCA', 22.9, 2), seen(SUPER, 'SUPER OUTRO', 21.9, 3)]);
    const page = await mount(<ProductScreen />);
    expect(page).toContain(
      `Visto em outras casasSUPER OUTROvisto em ${short(3)}R$ 21,90/unATACADAO MOOCAvisto em ${short(2)}R$ 22,90/un${SHARED_PRICES_NOTICE}`,
    );
    // Depois dos preços da própria casa.
    expect(page.indexOf('Visto em outras casas')).toBeGreaterThan(page.indexOf('Último preço por mercado'));
    expect(page).not.toContain('Ver mais');
    // Para o leitor de tela, cada linha é uma frase só.
    const labels = renderer!.root.findAll((node) => typeof node.props.accessibilityLabel === 'string').map((node) => node.props.accessibilityLabel);
    expect(labels).toContain(`R$ 21,90/un · SUPER OUTRO · visto em ${short(3)}`);
  });

  it('sem nada a mostrar, a seção e o aviso não aparecem', async () => {
    const page = await mount(<ProductScreen />);
    expect(page).not.toContain('Visto em outras casas');
    expect(page).not.toContain(SHARED_PRICES_NOTICE);
    expect(page).toBe(USUAL);
  });

  it('a compra da própria casa não aparece como de outra: mesmo CNPJ, no mesmo dia ou depois', async () => {
    mockQueries.shared = loaded([seen(ATACADAO, 'ATACADAO MOOCA', 22.9, 2), seen(SUPER, 'SUPER OUTRO', 21.9, 3)]);
    household([own('mercadinho', 25, 20), own('atacadao', 22.9, 2)]);
    const page = await mount(<ProductScreen />);
    expect(page).toContain(`Visto em outras casasSUPER OUTROvisto em ${short(3)}R$ 21,90/un${SHARED_PRICES_NOTICE}`);
    expect(page).not.toContain('ATACADAO MOOCA');
  });

  it('quando só havia a compra da própria casa, a seção some inteira', async () => {
    mockQueries.shared = loaded([seen(ATACADAO, 'ATACADAO MOOCA', 22.9, 2)]);
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

  it('mais de cinco: "Ver mais" mostra o resto, e o aviso continua lá', async () => {
    mockQueries.shared = loaded(Array.from({ length: 7 }, (_, n) => seen(`0000000000000${n}`, `MERCADO ${n + 1}`, 20 + n, 4)));
    const page = await mount(<ProductScreen />);
    expect(page).toContain('MERCADO 5');
    expect(page).not.toContain('MERCADO 6');
    expect(page).toContain(`Ver mais${SHARED_PRICES_NOTICE}`);
    const all = await press('Ver mais');
    expect(all).toContain('MERCADO 6');
    expect(all).toContain('MERCADO 7');
    expect(all).not.toContain('Ver mais');
    expect(all).toContain(SHARED_PRICES_NOTICE);
  });

  it('sem os preços ou os mercados da casa carregados não dá para tirar a compra dela: nada aparece', async () => {
    mockQueries.shared = loaded([seen(SUPER, 'SUPER OUTRO', 21.9, 3)]);
    mockQueries.prices = failed();
    expect(await mount(<ProductScreen />)).not.toContain('Visto em outras casas');
  });

  it.each(NOT_AVAILABLE)('%s: a tela é a de sempre', async (_name, answer) => {
    mockQueries.shared = answer();
    expect(await mount(<ProductScreen />)).toBe(USUAL);
  });
});

describe('Preços: a linha "Visto por"', () => {
  /** A tela inteira de antes: o produto, onde a casa comprou e por quanto. */
  const USUAL = 'Arroz Tio João 5kgSó em MercadinhoR$ 25,00';

  it('aparece embaixo do produto quando outra casa viu mais barato que o menor preço da casa', async () => {
    mockQueries.shared = loaded([seen(ATACADAO, 'ATACADAO MOOCA', 22.9, 2), seen(SUPER, 'SUPER OUTRO', 21.9, 3)]);
    const page = await mount(<PricesScreen />);
    expect(page).toContain(`Arroz Tio João 5kgSó em MercadinhoVisto por R$ 21,90/un · SUPER OUTRO · ${short(3)}, em outra casaR$ 25,00`);
  });

  it('não aparece quando o que outras casas viram é igual ou mais caro', async () => {
    mockQueries.shared = loaded([seen(ATACADAO, 'ATACADAO MOOCA', 25, 2), seen(SUPER, 'SUPER OUTRO', 27.5, 3)]);
    expect(await mount(<PricesScreen />)).toBe(USUAL);
  });

  it('nem quando o mais barato é a compra da própria casa', async () => {
    mockQueries.shared = loaded([seen(ATACADAO, 'ATACADAO MOOCA', 22.9, 2)]);
    household([own('mercadinho', 25, 20), own('atacadao', 22.9, 2)]);
    const page = await mount(<PricesScreen />);
    expect(page).toContain('Arroz Tio João 5kgMais barato: Atacadão · 2 mercadosR$ 22,90–25,00');
    expect(page).not.toContain('Visto por');
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

  it.each(NOT_AVAILABLE)('%s: o cartão não aparece e a aba é a de sempre', async (_name, answer) => {
    const withCard = await mount(<FamilyScreen />);
    await act(async () => renderer?.unmount());
    mockQueries.shared = answer();
    const page = await mount(<FamilyScreen />);
    // A aba inteira, menos o cartão: nada mais muda.
    expect(page).toBe(withCard.replace(`Preços compartilhados${SHARING_ABOUT}`, ''));
    expect(page).not.toContain('Preços compartilhados');
    expect(page).toContain('Casa da AnaFamília');
    expect(page).toContain('Código de conviteABC234');
  });
});
