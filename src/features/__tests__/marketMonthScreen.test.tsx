import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ActivityIndicator, ScrollView, StyleSheet, Text as RNText } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import MarketMonthScreen from '@/app/mercado';
import type { Entry } from '@/domain/finance';
import type { MarketLine, MarketReceipt, MarketTotalReceipt } from '@/domain/marketSpend';
import { BarRow } from '@/features/finance/BarRow';
import { FinanceSummaryPanel } from '@/features/finance/FinanceSummaryPanel';
import { MarketMonthLink } from '@/features/finance/MarketMonthLink';
import { MarketTrendChart } from '@/features/market/MarketTrendChart';
import { Button, Chip, IconButton, ListRow, Screen, Segmented } from '@/ui/primitives';

// A tela de verdade, com a busca das notas trocada por respostas prontas: o que se confere aqui é o que ela
// faz com cada resposta (carregada, vazia, falhou, falhou com dados na tela, sem internet) e com os toques. As
// contas e os textos são de domain/marketSpend, de verdade.

interface Query {
  data: MarketReceipt[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  isRefetching: boolean;
  refetch: jest.Mock;
}

type Params = { mes?: string; aba?: string };

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockState = {
  query: undefined as unknown as Query,
  params: {} as Params,
  /** Quem está na tela e se redesenha quando os parâmetros mudam. */
  listeners: new Set<() => void>(),
  /** Os meses que a busca da tela pediu. */
  asked: [] as string[],
  /** O que o resumo de gastos tem: os lançamentos e as notas que ele leu. */
  spending: { entries: [] as Entry[], receipts: [] as MarketTotalReceipt[], asked: [] as string[] },
};
const mockRouter = { push: jest.fn(), setParams: jest.fn() };
const mockScanner = { open: jest.fn(), busy: false, element: null };

// As funções só são lidas na hora do toque: o jest.mock roda antes de as variáveis acima existirem.
jest.mock('expo-router', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react');
  const subscribe = (listener: () => void) => {
    mockState.listeners.add(listener);
    return () => mockState.listeners.delete(listener);
  };
  return {
    router: {
      push: (...args: unknown[]) => mockRouter.push(...args),
      // Como no app: os parâmetros novos se juntam aos que a tela já tinha, e ela se redesenha com eles.
      setParams: (params: Params) => {
        mockRouter.setParams(params);
        mockState.params = { ...mockState.params, ...params };
        mockState.listeners.forEach((listener) => listener());
      },
    },
    useLocalSearchParams: () => useSyncExternalStore(subscribe, () => mockState.params),
  };
});
jest.mock('@/data/marketSpend', () => ({
  useMarketReceipts: (month: string) => {
    mockState.asked.push(month);
    return mockState.query;
  },
}));
// O resumo de gastos: só o que a entrada do "Mercado do mês" precisa dele.
jest.mock('@/data/finance', () => {
  const answer = <T,>(data: T) => ({ data, isPending: false, isError: false, error: null, refetch: jest.fn() });
  return {
    useSpending: () => answer(mockState.spending.entries),
    useSpendingReceipts: (from: string, to: string) => {
      mockState.spending.asked.push(`${from} a ${to}`);
      return answer(mockState.spending.receipts);
    },
    useBills: () => answer([]),
    useBudgets: () => answer([]),
  };
});
jest.mock('@/lib/auth', () => ({ useHousehold: () => ({ data: { members: [] } }) }));
jest.mock('@/features/finance/BudgetSection', () => ({ BudgetSection: () => null }));
jest.mock('@/features/finance/SplitSection', () => ({ SplitSection: () => null }));
jest.mock('@/features/ReceiptScanner', () => ({ useReceiptScanner: () => mockScanner }));
// Os desenhos animados (reanimated), o fundo, as imagens e os ícones (que são letras de uma fonte) não entram
// no que se confere aqui.
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

const loaded = (data: MarketReceipt[]): Query => ({ data, isPending: false, isError: false, error: null, fetchStatus: 'idle', isRefetching: false, refetch: jest.fn() });
/** Nunca carregou e a busca falhou. */
const failed = (): Query => ({ ...loaded([]), data: undefined, isError: true, error: new Error('Sem conexão com a internet.') });
/** Já tinha carregado e a nova busca falhou: os dados de antes continuam. */
const staleAfterFailure = (data: MarketReceipt[]): Query => ({ ...loaded(data), isError: true, error: new Error('Sem conexão com a internet.') });
const onTheWay = (): Query => ({ ...loaded([]), data: undefined, isPending: true, fetchStatus: 'fetching' });
/** Sem internet e nunca visto neste aparelho: a busca nem saiu, e não vira erro. */
const paused = (): Query => ({ ...loaded([]), data: undefined, isPending: true, fetchStatus: 'paused' });

const at = (month: number, day: number) => new Date(2026, month - 1, day, 12).toISOString();

const line = (name: string, category: string, totalPrice: number, quantity = 1, unit = 'un'): MarketLine => ({
  productId: `p-${name}`,
  productName: name,
  productCategory: category,
  rawDescription: name.toUpperCase(),
  suggestedName: null,
  suggestedCategory: null,
  quantity,
  unit,
  totalPrice,
});
const loose = (description: string, totalPrice: number): MarketLine => ({ ...line(description, 'outros', totalPrice), productId: null, productName: null, productCategory: null });

const receipt = (id: string, purchasedAt: string, lines: MarketLine[], partial: Partial<MarketReceipt> = {}): MarketReceipt => ({
  id,
  purchasedAt,
  status: 'confirmed',
  total: null,
  storeId: 'a1',
  storeName: 'Assaí',
  lines,
  ...partial,
});

/**
 * Outubro com duas idas (uma com desconto no total e remédio, outra com valor sem item), item sem valor e um
 * rascunho; setembro com uma ida.
 */
const HOUSE: MarketReceipt[] = [
  receipt('s1', at(9, 5), [line('Arroz', 'graos', 30), line('Picanha', 'carnes', 100, 1.5, 'kg')]),
  receipt(
    'o1',
    at(10, 3),
    [
      line('Picanha', 'carnes', 80, 1.2, 'kg'),
      line('Arroz', 'graos', 35),
      line('Feijão', 'graos', 9),
      line('Leite', 'laticinios', 24, 4),
      line('Café', 'cafe_cha', 18),
      line('Detergente', 'limpeza', 3.5),
      line('Sabonete', 'higiene', 4),
      line('Ração', 'pet', 20),
      line('Banana', 'hortifruti', 6, 1.5, 'kg'),
      line('Pão', 'padaria', 8),
      line('Queijo', 'laticinios', 22, 400, 'g'),
      line('Dipirona', 'medicamentos', 23),
      loose('SACOLA', 0.5),
    ],
    // 230 de mercado e 23 de farmácia impressos; dos 11 de desconto, 10 são do mercado e 1 da farmácia.
    { total: 242 },
  ),
  receipt('o2', at(10, 10), [line('Arroz', 'graos', 30), line('Brinde', 'outros', 0)], { total: 50, storeId: 'd1', storeName: 'Dia' }),
  receipt('rascunho', at(10, 11), [], { status: 'draft', storeId: 'd1', storeName: 'Dia' }),
];

const CLOSING = 'Inclui R$ 20,00 de notas sem item lido e R$ 10,00 de descontos. Sem contar R$ 22,00 de farmácia, 1 item sem valor e 1 nota que espera a revisão.';
/** No pé da tela, no mês corrente: por que este total não é a barra do Resumo. */
const NOT_THE_RESUMO =
  'Diferente da barra “Mercado” do Resumo: aqui só contam notas fiscais, com limpeza, higiene, papel, bebê, pet e os itens de “Outros”, sem remédio e sem nota com data depois de hoje.';

let renderer: ReactTestRenderer | undefined;

type Rendered = ReturnType<ReactTestRenderer['toJSON']> | string;
const texts = (node: Rendered): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);

/** Tudo o que a tela escreve, uma frase por linha. */
const page = () => texts(renderer!.toJSON()).join('\n');

async function mount(element = <MarketMonthScreen />) {
  await act(async () => {
    renderer = create(element);
  });
  return page();
}

/** Toca no que o leitor de tela anuncia com este texto. */
async function press(accessibilityLabel: string) {
  const [target] = renderer!.root.findAll((node) => node.props.accessibilityLabel === accessibilityLabel && typeof node.props.onPress === 'function');
  expect(target).toBeDefined();
  await act(async () => target.props.onPress());
}

async function pressButton(title: string) {
  const target = renderer!.root.findAllByType(Button).find((button) => button.props.title === title);
  expect(target).toBeDefined();
  await act(async () => target!.props.onPress());
}

/** Escolhe uma parte da tela na chave de cima, tocando nela. */
async function choose(label: string) {
  const [tab] = renderer!.root.findAll(
    (node) => node.props.accessibilityRole === 'tab' && typeof node.props.onPress === 'function' && node.findAllByType(RNText).some((text) => text.props.children === label),
  );
  expect(tab).toBeDefined();
  await act(async () => tab.props.onPress());
}

/** Qual parte está escolhida na chave. */
const chosen = () => renderer!.root.findByType(Segmented).props.value;

type Instance = ReactTestRenderer['root'];

/** A linha está no card "O que mudou" (que vem antes da chave)? */
const inChanges = (node: Instance) => {
  for (let parent = node.parent; parent; parent = parent.parent) if (typeof parent.type === 'function' && parent.type.name === 'Changes') return true;
  return false;
};

/** Os títulos das linhas de lista da parte escolhida na chave (os itens, as idas ou os mercados), na ordem. */
const rowTitles = () =>
  renderer!.root
    .findAllByType(ListRow)
    .filter((row) => !inChanges(row))
    .map((row) => row.props.title);

/** As linhas de "O que mudou". */
const changeRows = () => renderer!.root.findAllByType(ListRow).filter(inChanges);

/** O selo da categoria escolhida (o que tem o "x"), se há. */
const categoryChips = () => renderer!.root.findAllByType(Chip).filter((chip) => chip.props.icon === 'close');

/** A ordem dos itens escolhida nos selos. */
const chosenOrder = () =>
  renderer!.root
    .findAllByType(Chip)
    .filter((chip) => String(chip.props.accessibilityLabel ?? '').startsWith('Ordenar'))
    .filter((chip) => chip.props.selected)
    .map((chip) => chip.props.label);

/** Os meses de um cartão de tendência: cada um é um botão (o componente que recebe o toque, não a View de baixo). */
const monthButtons = (chart: ReactTestRenderer['root']) =>
  chart.findAll((node) => typeof node.type !== 'string' && node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function');

/** Os nomes das barras de categoria na tela. */
const barLabels = () => renderer!.root.findAllByType(BarRow).map((bar) => bar.props.label);

/** Abre (ou fecha) os detalhes de como o total fecha. */
const DETAILS = `Como este total fecha. ${CLOSING}`;

const TOP_TEN = ['Picanha', 'Arroz', 'Leite', 'Queijo', 'Ração', 'Café', 'Feijão', 'Pão', 'Banana', 'Sabonete'];

beforeAll(() => {
  // Hoje é 13 de outubro de 2026: só o relógio é de mentira, os temporizadores seguem de verdade.
  jest.useFakeTimers({
    now: new Date(2026, 9, 13, 12),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  mockState.query = loaded(HOUSE);
  mockState.params = {};
  mockState.asked = [];
  mockState.spending = { entries: [], receipts: [], asked: [] };
  mockRouter.push.mockClear();
  mockRouter.setParams.mockClear();
  mockScanner.open.mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('mês carregado', () => {
  it('abre com o total, a comparação e os itens que mais levaram dinheiro: uma parte por vez', async () => {
    const text = await mount();
    expect(mockState.asked.at(-1)).toBe('2026-10');
    // Em cima, sempre: o mês, o total em quantas idas e a comparação com o mês anterior.
    expect(text.split('\n').slice(0, 4)).toEqual(['Outubro de 2026', 'Mercado de outubro até hoje', 'R$ 270,00 em 2 idas', 'R$ 140,00 a mais que até o dia 13 de setembro']);
    // Uma linha só diz o que há no total além dos itens; os detalhes ficam fechados.
    expect(text).toContain(['Como este total fecha', CLOSING].join('\n'));
    expect(text).not.toContain('Descontos no total das notas');
    expect(text).not.toContain('Farmácia, fora desta conta');
    // A chave: itens primeiro.
    expect(renderer!.root.findByType(Segmented).props.options.map((option: { label: string }) => option.label)).toEqual(['Itens', 'Categorias', 'Idas', 'Mercados']);
    expect(chosen()).toBe('itens');
    expect(rowTitles()).toEqual(TOP_TEN);
    // Itens: o nome, quanto foi comprado, em quantas idas e o valor de setembro.
    expect(text).toContain(['Picanha', '1,2 kg · em 1 ida · setembro: R$ 100,00', 'R$ 80,00', '31%'].join('\n'));
    expect(text).toContain(['Arroz', '2 un · em 2 idas · setembro: R$ 30,00', 'R$ 65,00', '25%'].join('\n'));
    expect(text).not.toContain('Dipirona');
    // As outras partes não estão na tela.
    expect(barLabels()).toEqual([]);
    expect(text).not.toContain('3 out · 12 itens');
    expect(text).not.toContain(['Assaí', '1 ida'].join('\n'));
    // O total pago (270) não é a soma dos itens (260): a frase diz sobre o que são as porcentagens.
    expect(text).toContain('As porcentagens são sobre os itens lidos (R$ 260,00).');
    // No fim da tela, pequeno, por que este total não é a barra do Resumo.
    expect(text.split('\n').at(-1)).toBe(NOT_THE_RESUMO);
  });

  it('mostra os 10 itens que mais levaram dinheiro, e "Ver todos" abre a lista inteira', async () => {
    const text = await mount();
    expect(text).toContain('Ver todos os 13 itens');
    await pressButton('Ver todos os 13 itens');
    expect(rowTitles()).toEqual([...TOP_TEN, 'Detergente', 'SACOLA', 'Brinde']);
    expect(page()).toContain(['Brinde', '1 un · em 1 ida', 'sem valor', '0%'].join('\n'));
    await pressButton('Mostrar só os 10 primeiros');
    expect(rowTitles()).toHaveLength(10);
  });

  it('a chave troca a parte da tela, e a escolha vai para a URL', async () => {
    await mount();
    await choose('Categorias');
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ aba: 'categorias' });
    expect(chosen()).toBe('categorias');
    // Todas as categorias, da maior para a menor, com a diferença para setembro; nenhuma lista de itens.
    expect(barLabels()).toEqual(['Carnes', 'Grãos, massas e cereais', 'Laticínios', 'Pet', 'Café e chá', 'Padaria', 'Frutas e verduras', 'Higiene pessoal', 'Limpeza', 'Outros']);
    expect(rowTitles()).toEqual([]);
    let text = page();
    expect(text).toContain(['Carnes', 'R$ 80,00', '31%', 'R$ 20,00 a menos que até o dia 13 de setembro'].join('\n'));
    expect(text).toContain(['Grãos, massas e cereais', 'R$ 74,00', '28%', 'R$ 44,00 a mais que até o dia 13 de setembro'].join('\n'));
    expect(text).toContain(['Limpeza', 'R$ 3,50', '1%', 'Não teve até o dia 13 de setembro'].join('\n'));
    expect(text).toContain(['Outros', 'R$ 0,50', '<1%'].join('\n'));
    expect(text).not.toContain('Medicamentos');
    expect(text).toContain('As porcentagens são sobre os itens lidos (R$ 260,00).');
    // O topo e a frase do fim continuam.
    expect(text).toContain('R$ 270,00 em 2 idas');
    expect(text.split('\n').at(-1)).toBe(NOT_THE_RESUMO);

    await choose('Idas');
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ aba: 'idas' });
    expect(barLabels()).toEqual([]);
    text = page();
    // Da mais recente para a mais antiga.
    expect(text).toContain(['Dia', '10 out · 2 itens', 'R$ 50,00', 'Assaí', '3 out · 12 itens · farmácia fora: R$ 22,00', 'R$ 220,00'].join('\n'));
    expect(rowTitles()).toEqual(['Dia', 'Assaí']);

    await choose('Mercados');
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ aba: 'mercados' });
    expect(page()).toContain(['Assaí', '1 ida', 'R$ 220,00', 'Dia', '1 ida', 'R$ 50,00'].join('\n'));
    expect(rowTitles()).toEqual(['Assaí', 'Dia']);

    await choose('Itens');
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ aba: 'itens' });
    expect(rowTitles()).toEqual(TOP_TEN);
  });

  it('a parte pedida no endereço abre direto; valor que não existe cai nos itens', async () => {
    mockState.params = { aba: 'idas' };
    await mount();
    expect(chosen()).toBe('idas');
    expect(rowTitles()).toEqual(['Dia', 'Assaí']);
    await act(async () => renderer?.unmount());
    mockState.params = { aba: 'mercados', mes: '2026-09' };
    expect(await mount()).toContain(['Assaí', '1 ida', 'R$ 130,00'].join('\n'));
    await act(async () => renderer?.unmount());
    mockState.params = { aba: 'qualquer coisa' };
    await mount();
    expect(chosen()).toBe('itens');
    expect(rowTitles()).toEqual(TOP_TEN);
  });

  it('os nomes das categorias podem ocupar duas linhas, e cada barra lê o nome, o valor e a parte', async () => {
    mockState.params = { aba: 'categorias' };
    await mount();
    const bars = renderer!.root.findAllByType(BarRow);
    expect(bars.every((bar) => bar.props.labelLines === 2)).toBe(true);
    const name = bars[1].findAllByType(RNText).find((text) => text.props.children === 'Grãos, massas e cereais');
    expect(name?.props.numberOfLines).toBe(2);
    expect(bars[1].props.accessibilityLabel).toBe('Grãos, massas e cereais: R$ 74,00, 28% dos itens, R$ 44,00 a mais que até o dia 13 de setembro');
  });

  it('tocar numa categoria leva aos itens só dela, todos, com o nome da categoria e um jeito claro de tirar', async () => {
    // Doze itens de grãos (mais que os 10 da lista) e um de carnes.
    const grains = Array.from({ length: 12 }, (_, n) => line(`Grão ${String(n + 1).padStart(2, '0')}`, 'graos', 20 - n));
    mockState.query = loaded([receipt('g1', at(10, 3), [line('Picanha', 'carnes', 80), ...grains])]);
    mockState.params = { aba: 'categorias' };
    await mount();
    // A chave está a 400 da tela rolável, e a pessoa rolou a lista de categorias para baixo.
    const scrollTo = jest.spyOn(renderer!.root.findByType(ScrollView).instance as ScrollView, 'scrollTo').mockImplementation(() => {});
    const switchBox = renderer!.root.findByType(Segmented).parent!;
    act(() => switchBox.props.onLayout({ nativeEvent: { layout: { y: 400 } } }));
    await press('Grãos, massas e cereais: R$ 174,00, 69% do mês');
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ aba: 'itens' });
    expect(chosen()).toBe('itens');
    // A tela volta para a chave: os itens da categoria ficam à vista, logo abaixo dela.
    expect(scrollTo).toHaveBeenCalledWith({ y: 392, animated: false });
    // Os doze, sem "Ver todos": com a categoria escolhida, a lista vem inteira.
    expect(rowTitles()).toEqual(grains.map((item) => item.productName));
    expect(renderer!.root.findAllByType(Button).map((button) => button.props.title)).toEqual([]);
    const [chip] = categoryChips();
    expect(chip.props).toMatchObject({ label: 'Grãos, massas e cereais', icon: 'close', accessibilityLabel: 'Grãos, massas e cereais: mostrar os itens de todas as categorias' });
    // As partes continuam sendo do mês inteiro.
    expect(page()).toContain(['Grão 01', '1 un · em 1 ida', 'R$ 20,00', '8%'].join('\n'));
    // A categoria continua escolhida ao passear pelas outras partes.
    await choose('Idas');
    await choose('Itens');
    expect(rowTitles()).toHaveLength(12);
    // Tirar a categoria traz de volta os 10 que mais levaram dinheiro, com o "Ver todos".
    await act(async () => categoryChips()[0].props.onPress());
    expect(categoryChips()).toHaveLength(0);
    expect(rowTitles()).toEqual(['Picanha', ...grains.slice(0, 9).map((item) => item.productName)]);
    expect(page()).toContain('Ver todos os 13 itens');
  });

  it('o item com produto abre o produto; o que a casa não acompanha não abre nada', async () => {
    await mount();
    await press('Picanha: R$ 80,00, 31% dos itens, 1,2 kg, em 1 ida, setembro: R$ 100,00');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/produto/[id]', params: { id: 'p-Picanha' } });
    await pressButton('Ver todos os 13 itens');
    const sacola = renderer!.root.findAllByType(ListRow).find((row) => row.props.title === 'SACOLA');
    expect(sacola?.props.accessibilityLabel).toBe('SACOLA: R$ 0,50, menos de 1% dos itens, 1 un, em 1 ida');
    expect(sacola?.props.onPress).toBeUndefined();
  });

  it('a ida abre a nota dela, e o mercado diz o total e as idas', async () => {
    mockState.params = { aba: 'idas' };
    await mount();
    await press('Assaí: R$ 220,00, 3 out, 12 itens, farmácia fora: R$ 22,00. Abrir a nota');
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/nota/[id]', params: { id: 'o1' } });
    await choose('Mercados');
    expect(
      renderer!.root
        .findAllByType(ListRow)
        .filter((row) => !inChanges(row))
        .map((row) => row.props.accessibilityLabel),
    ).toEqual(['Assaí: R$ 220,00 em 1 ida. Ver as idas e os itens', 'Dia: R$ 50,00 em 1 ida. Ver as idas e os itens']);
  });

  it('puxar para atualizar busca as notas de novo', async () => {
    await mount();
    act(() => renderer!.root.findByType(Screen).props.onRefresh());
    expect(mockState.query.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('como este total fecha', () => {
  const toggle = () => renderer!.root.find((node) => node.props.accessibilityLabel === DETAILS && typeof node.props.onPress === 'function');

  it('a linha abre os detalhes: descontos, valor sem item lido com a nota, itens sem valor, farmácia e rascunhos', async () => {
    await mount();
    expect(toggle().props.accessibilityState).toEqual({ expanded: false });
    await press(DETAILS);
    expect(toggle().props.accessibilityState).toEqual({ expanded: true });
    const text = page();
    expect(text).toContain(['Descontos no total das notas', '−R$ 10,00'].join('\n'));
    expect(text).toContain(['Nas notas, sem item lido', 'R$ 20,00', 'A leitura pode ter perdido um item ou um valor. Abra a nota para conferir:', 'Dia', '· 10 out', 'R$ 20,00'].join('\n'));
    // Nota confirmada não se edita: a tela não manda preencher nada.
    expect(text).toContain(['1 item sem valor', 'Entra como zero neste total. Abra a nota para ver qual é.', 'Dia', '· 10 out', '1 item'].join('\n'));
    expect(text).not.toContain('preencher');
    expect(text).toContain('Farmácia, fora desta conta: R$ 22,00');
    expect(text).toContain(['1 nota de outubro ainda espera a revisão. Ela entra nesta conta quando for confirmada.', 'Dia', '· 11 out', 'Revisar'].join('\n'));
    // Aberta, a frase de resumo dá lugar às linhas.
    expect(text).not.toContain(CLOSING);
    // Os itens continuam logo abaixo.
    expect(rowTitles()).toEqual(TOP_TEN);
    await press(DETAILS);
    expect(page()).not.toContain('Descontos no total das notas');
    expect(page()).toContain(CLOSING);
  });

  it('as notas dos detalhes abrem cada uma a própria nota; o rascunho também, sem empilhar as abas', async () => {
    await mount();
    await press(DETAILS);
    await press('Dia, 10 out: R$ 20,00. Abrir a nota');
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/nota/[id]', params: { id: 'o2' } });
    await press('Dia, 10 out: 1 item. Abrir a nota');
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/nota/[id]', params: { id: 'o2' } });
    await press('Dia, 11 out. Abrir a nota para revisar');
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/nota/[id]', params: { id: 'rascunho' } });
    expect(mockRouter.push.mock.calls.every(([target]) => (target as { pathname: string }).pathname === '/nota/[id]')).toBe(true);
  });

  it('com mais de três rascunhos, os três mais recentes e o resto contado, em texto', async () => {
    const drafts = [11, 12, 13, 14].map((day) => receipt(`r${day}`, at(10, day), [], { status: 'draft' }));
    mockState.query = loaded([...HOUSE.filter((r) => r.status === 'confirmed'), ...drafts]);
    await mount();
    await press(`Como este total fecha. ${CLOSING.replace('1 nota que espera', '4 notas que esperam')}`);
    const text = page();
    expect(text).toContain(['Assaí', '· 14 out', 'Revisar', 'Assaí', '· 13 out', 'Revisar', 'Assaí', '· 12 out', 'Revisar', 'e mais 1 em Finanças > Notas'].join('\n'));
    expect(text).not.toContain('· 11 out');
    // O resto é só texto: nada na tela leva para as abas.
    expect(renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && String(node.props.accessibilityLabel ?? '').includes('Finanças'))).toEqual([]);
  });

  it('nas notas para abrir, a data nunca encolhe: só o nome do mercado é cortado', async () => {
    mockState.query = loaded([receipt('o1', at(10, 10), [line('Arroz', 'graos', 30)], { total: 50, storeName: 'SENDAS DISTRIBUIDORA S/A' })]);
    await mount();
    await press('Como este total fecha. Inclui R$ 20,00 de notas sem item lido.');
    const link = renderer!.root.find((node) => node.props.accessibilityLabel === 'SENDAS DISTRIBUIDORA S/A, 10 out: R$ 20,00. Abrir a nota' && typeof node.props.onPress === 'function');
    const store = link.findAllByType(RNText).find((text) => text.props.children === 'SENDAS DISTRIBUIDORA S/A')!;
    const date = link.findAllByType(RNText).find((text) => text.props.children === '· 10 out')!;
    expect(store.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(store.props.style).flexShrink).toBe(1);
    expect(date.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(date.props.style).flexShrink).toBe(0);
  });

  it('diferença de centavos: o valor aparece, mas sem nota para conferir não há frase nem lista', async () => {
    mockState.query = loaded([receipt('o1', at(10, 10), [line('Arroz', 'graos', 35.11)], { total: 35.12 })]);
    await mount();
    await press('Como este total fecha. Inclui R$ 0,01 de notas sem item lido.');
    const text = page();
    expect(text).toContain(['Nas notas, sem item lido', 'R$ 0,01'].join('\n'));
    expect(text).not.toContain('Abra a nota para conferir');
    expect(renderer!.root.findAll((node) => String(node.props.accessibilityLabel ?? '').endsWith('Abrir a nota'))).toEqual([]);
  });

  it('mês em que o total é só a soma dos itens: a linha não aparece', async () => {
    mockState.params = { mes: '2026-09' };
    const text = await mount();
    expect(text).toContain('R$ 130,00 em 1 ida');
    expect(text).not.toContain('Como este total fecha');
    expect(text).not.toContain('As porcentagens são sobre');
  });

  it('primeiro mês de uso: as categorias não repetem que o mês anterior não teve nota', async () => {
    mockState.params = { mes: '2026-09', aba: 'categorias' };
    const text = await mount();
    expect(text).toContain('Não teve nota de mercado em agosto');
    expect(text).toContain(['Carnes', 'R$ 100,00', '77%', 'Grãos, massas e cereais', 'R$ 30,00', '23%'].join('\n'));
    expect(text).not.toContain('Não teve em agosto');
    expect(renderer!.root.findAllByType(BarRow).map((bar) => bar.props.accessibilityLabel)).toEqual(['Carnes: R$ 100,00, 77% do mês', 'Grãos, massas e cereais: R$ 30,00, 23% do mês']);
  });
});

describe('o que mudou', () => {
  // Contra a janela até 13 de setembro (Arroz R$ 30,00 por 1 un, Picanha R$ 100,00 por 1,5 kg): o arroz ficou mais
  // caro e foi comprado em dobro, a picanha teve menos quantidade ao mesmo preço, e dez itens entraram.
  const CARD = [
    'O que mudou',
    'Nos itens, R$ 130,00 a mais que até o dia 13 de setembro',
    'Preço',
    'Os mesmos 2 itens ficaram 4% mais caros',
    '+R$ 5,00',
    'Quantidade',
    'Comprou mais dos mesmos itens',
    '+R$ 10,00',
    'Itens que não teve até o dia 13 de setembro',
    '10 itens',
    '+R$ 115,00',
    // O total pago subiu R$ 140,00 (cabeçalho), os itens R$ 130,00: uma frase diz o que mais ele conta, sem outro número.
    'O total pago, lá em cima, também conta os descontos no total das notas e os valores sem item lido.',
    'Arroz',
    'Unidade: R$ 30,00 → R$ 32,50 · 1 un → 2 un',
    '+R$ 35,00',
    'Leite',
    'Não teve até o dia 13 de setembro',
    '+R$ 24,00',
    'Queijo',
    'Não teve até o dia 13 de setembro',
    '+R$ 22,00',
    'Ver todas as 12 mudanças',
  ].join('\n');
  const ALL_CHANGES = ['Arroz', 'Leite', 'Queijo', 'Picanha', 'Ração', 'Café', 'Feijão', 'Pão', 'Banana', 'Sabonete', 'Detergente', 'SACOLA'];

  it('logo depois do cabeçalho e de "Como este total fecha", antes da chave: as partes e as 3 maiores mudanças', async () => {
    const text = await mount();
    expect(text).toContain(CARD);
    expect(text.indexOf('Como este total fecha')).toBeLessThan(text.indexOf('O que mudou'));
    expect(text.indexOf('O que mudou')).toBeLessThan(text.indexOf(['Itens', 'Categorias', 'Idas', 'Mercados'].join('\n')));
    expect(changeRows().map((row) => row.props.title)).toEqual(['Arroz', 'Leite', 'Queijo']);
    // A lista de itens da chave continua a mesma.
    expect(rowTitles()).toEqual(TOP_TEN);
    // Cada parte é lida inteira: o nome, o valor e a frase.
    const spoken = renderer!.root.findAll(
      (node) => typeof node.type === 'string' && node.props.accessible === true && /^(Preço|Quantidade|Itens que)/.test(String(node.props.accessibilityLabel ?? '')),
    );
    expect(spoken.map((node) => node.props.accessibilityLabel)).toEqual([
      'Preço: mais R$ 5,00. Os mesmos 2 itens ficaram 4% mais caros',
      'Quantidade: mais R$ 10,00. Comprou mais dos mesmos itens',
      'Itens que não teve até o dia 13 de setembro: mais R$ 115,00. 10 itens',
    ]);
  });

  it('"Ver todas" abre todas as mudanças, e "Mostrar só as 3 maiores" volta', async () => {
    await mount();
    await pressButton('Ver todas as 12 mudanças');
    expect(changeRows().map((row) => row.props.title)).toEqual(ALL_CHANGES);
    const text = page();
    expect(text).toContain(['Picanha', 'kg: R$ 66,67 → R$ 66,67 · 1,5 kg → 1,2 kg', '−R$ 20,00', 'Ração', 'Não teve até o dia 13 de setembro', '+R$ 20,00'].join('\n'));
    expect(text).toContain(['SACOLA', 'Não teve até o dia 13 de setembro', '+R$ 0,50', 'Mostrar só as 3 maiores'].join('\n'));
    // O item sem valor não mudou nada: não aparece.
    expect(changeRows().map((row) => row.props.title)).not.toContain('Brinde');
    // A lista da chave não muda com isso.
    expect(rowTitles()).toEqual(TOP_TEN);
    await pressButton('Mostrar só as 3 maiores');
    expect(changeRows().map((row) => row.props.title)).toEqual(['Arroz', 'Leite', 'Queijo']);
  });

  it('fechar a lista longa volta a tela para o card, em vez de deixar a pessoa no meio do ranking', async () => {
    await mount();
    // O card está a 300 da tela rolável.
    const scrollTo = jest.spyOn(renderer!.root.findByType(ScrollView).instance as ScrollView, 'scrollTo').mockImplementation(() => {});
    // O ScrollView de teste é um só entre os testes: as chamadas de antes não contam aqui.
    scrollTo.mockClear();
    const card = renderer!.root.find((node) => typeof node.type === 'function' && node.type.name === 'Changes').parent!;
    act(() => card.props.onLayout({ nativeEvent: { layout: { y: 300 } } }));
    // Abrir não mexe na tela: a lista cresce para baixo.
    await pressButton('Ver todas as 12 mudanças');
    expect(scrollTo).not.toHaveBeenCalled();
    await pressButton('Mostrar só as 3 maiores');
    expect(scrollTo).toHaveBeenCalledWith({ y: 292, animated: false });
    expect(changeRows()).toHaveLength(3);
  });

  it('a mudança de um produto abre o produto; a do item que a casa não acompanha não abre nada', async () => {
    await mount();
    await pressButton('Ver todas as 12 mudanças');
    await press('Picanha: menos R$ 20,00, preço do quilo de R$ 66,67 para R$ 66,67, quantidade de 1,5 kg para 1,2 kg');
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/produto/[id]', params: { id: 'p-Picanha' } });
    const sacola = changeRows().find((row) => row.props.title === 'SACOLA');
    expect(sacola?.props.accessibilityLabel).toBe('SACOLA: mais R$ 0,50, não teve até o dia 13 de setembro');
    expect(sacola?.props.onPress).toBeUndefined();
  });

  it('sem nota de mercado na janela do mês anterior não há card: o cabeçalho já diz', async () => {
    mockState.params = { mes: '2026-09' };
    const text = await mount();
    expect(text).toContain('Não teve nota de mercado em agosto');
    expect(text).not.toContain('O que mudou');
    expect(changeRows()).toEqual([]);
  });

  it('sem diferença no total das notas, a frase do total pago não aparece; com poucas mudanças, nem o botão', async () => {
    mockState.query = loaded([receipt('s1', at(9, 5), [line('Arroz', 'graos', 30)]), receipt('o1', at(10, 5), [line('Arroz', 'graos', 33), line('Café', 'cafe_cha', 18)])]);
    const text = await mount();
    expect(text).toContain(
      [
        'O que mudou',
        'Nos itens, R$ 21,00 a mais que até o dia 13 de setembro',
        'Preço',
        'O mesmo item ficou 10% mais caro',
        '+R$ 3,00',
        'Itens que não teve até o dia 13 de setembro',
        '1 item',
        '+R$ 18,00',
        'Café',
        'Não teve até o dia 13 de setembro',
        '+R$ 18,00',
        'Arroz',
        'Unidade: R$ 30,00 → R$ 33,00 · 1 un → 1 un',
        '+R$ 3,00',
      ].join('\n'),
    );
    expect(text).not.toContain('O total pago');
    expect(text).not.toContain('mudanças');
  });
});

describe('o mês', () => {
  const navLabels = () => renderer!.root.findAllByType(IconButton).map((button) => button.props.label);

  it('abre no mês corrente, sem passar dele; a seta volta um mês', async () => {
    await mount();
    expect(navLabels()).toEqual(['Mês anterior']);
    await press('Mês anterior');
    expect(mockRouter.setParams).toHaveBeenCalledWith({ mes: '2026-09' });
    expect(page()).toContain('Setembro de 2026');
  });

  it('aberta pelo resumo num mês passado, mostra aquele mês inteiro e deixa avançar', async () => {
    mockState.params = { mes: '2026-09' };
    const text = await mount();
    expect(mockState.asked.at(-1)).toBe('2026-09');
    expect(text).toContain('Setembro de 2026');
    expect(text).toContain('Mercado de setembro');
    expect(text).not.toContain('até hoje');
    expect(text).toContain('R$ 130,00 em 1 ida');
    expect(text).toContain('Não teve nota de mercado em agosto');
    expect(navLabels()).toEqual(['Mês anterior', 'Próximo mês']);
    await press('Próximo mês');
    expect(mockRouter.setParams).toHaveBeenCalledWith({ mes: '2026-10' });
  });

  it('trocar de mês mantém a parte escolhida e tira a categoria', async () => {
    mockState.params = { aba: 'categorias' };
    await mount();
    await press('Carnes: R$ 80,00, 31% dos itens, R$ 20,00 a menos que até o dia 13 de setembro');
    expect(rowTitles()).toEqual(['Picanha']);
    await press('Mês anterior');
    expect(mockState.params).toEqual({ aba: 'itens', mes: '2026-09' });
    expect(categoryChips()).toHaveLength(0);
    expect(rowTitles()).toEqual(['Picanha', 'Arroz']);
  });

  it('mês que ainda não chegou (ou endereço estranho) cai no mês corrente', async () => {
    mockState.params = { mes: '2027-01' };
    await mount();
    expect(mockState.asked.at(-1)).toBe('2026-10');
    await act(async () => renderer?.unmount());
    mockState.params = { mes: 'qualquer coisa' };
    expect(await mount()).toContain('Outubro de 2026');
  });
});

describe('sem notas, carregando e com erro', () => {
  it('mês sem nota confirmada diz isso e leva a adicionar uma nota', async () => {
    mockState.query = loaded([]);
    const text = await mount();
    expect(text).toContain('Nenhuma nota de mercado em outubro');
    expect(text).toContain('As compras aparecem aqui quando uma nota fiscal é confirmada. Fotografe o cupom ou leia o QR code da nota.');
    expect(text).not.toContain('em 0 idas');
    expect(text).not.toContain('Como este total fecha');
    expect(renderer!.root.findAllByType(Segmented)).toHaveLength(0);
    await pressButton('Adicionar nota');
    expect(mockScanner.open).toHaveBeenCalledTimes(1);
  });

  it('mês corrente com uma nota de data depois de hoje: ela fica de fora do total, e os detalhes dizem e levam à nota', async () => {
    mockState.query = loaded([
      receipt('m1', at(10, 5), [line('Arroz', 'graos', 30)]),
      receipt('m2', at(10, 20), [line('Picanha', 'carnes', 100)], { storeId: 'dia', storeName: 'Dia' }),
    ]);
    const text = await mount();
    expect(text).toContain('Mercado de outubro até hoje');
    expect(text).toContain('R$ 30,00 em 1 ida');
    expect(text).not.toContain('Picanha');
    expect(text).toContain('Sem contar 1 nota com data depois de hoje.');
    await press('Como este total fecha. Sem contar 1 nota com data depois de hoje.');
    expect(page()).toContain(
      ['1 nota com data depois de hoje', 'Fica de fora desta conta até o dia chegar. Se a data está errada, abra a nota para conferir.', 'Dia', '· 20 out', 'R$ 100,00'].join('\n'),
    );
    await press('Dia, 20 out: R$ 100,00. Abrir a nota');
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/nota/[id]', params: { id: 'm2' } });
  });

  it('mês só com rascunho e farmácia: continua sem ida, e diz logo o que está esperando e o que ficou de fora', async () => {
    mockState.query = loaded([
      receipt('f1', at(10, 2), [line('Dipirona', 'medicamentos', 12)], { storeId: 'dr', storeName: 'Drogasil' }),
      receipt('r1', at(10, 3), [], { status: 'draft' }),
      receipt('r2', at(10, 4), [], { status: 'draft' }),
    ]);
    const text = await mount();
    expect(text).toContain('Nenhuma nota de mercado em outubro');
    // Sem total na tela, não há o que abrir: as linhas já vêm à vista.
    expect(text).not.toContain('Como este total fecha');
    expect(text).toContain('Farmácia, fora desta conta: R$ 12,00');
    expect(text).toContain(['2 notas de outubro ainda esperam a revisão. Elas entram nesta conta quando forem confirmadas.', 'Assaí', '· 4 out', 'Revisar', 'Assaí', '· 3 out', 'Revisar'].join('\n'));
    await press('Assaí, 4 out. Abrir a nota para revisar');
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/nota/[id]', params: { id: 'r2' } });
  });

  it('enquanto carrega, nem números nem "nenhuma nota"', async () => {
    mockState.query = onTheWay();
    const text = await mount();
    expect(text).toBe('Outubro de 2026');
    expect(renderer!.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  });

  it('sem internet e sem o mês guardado: avisa, em vez de girar para sempre; a busca volta sozinha', async () => {
    mockState.query = paused();
    const text = await mount();
    expect(text).toBe(['Outubro de 2026', 'Sem internet. Os números aparecem quando a conexão voltar.'].join('\n'));
    expect(renderer!.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    // Sem botão de tentar: busca parada não anda com um toque.
    expect(renderer!.root.findAllByType(Button)).toHaveLength(0);
  });

  it('a busca falhou: mostra o erro com "Tentar de novo", nunca um mês sem gasto', async () => {
    mockState.query = failed();
    const text = await mount();
    expect(text).toContain('Sem conexão com a internet.');
    expect(text).not.toContain('Nenhuma nota de mercado');
    expect(text).not.toContain('R$');
    await pressButton('Tentar de novo');
    expect(mockState.query.refetch).toHaveBeenCalledTimes(1);
  });

  it('a nova busca falhou com os dados na tela: os números ficam, com o aviso de que não deu para atualizar', async () => {
    mockState.query = staleAfterFailure(HOUSE);
    const text = await mount();
    expect(text).toContain('Não deu para atualizar agora. Estes números são da última vez que a tela carregou.');
    expect(text).toContain('R$ 270,00 em 2 idas');
    expect(rowTitles()).toHaveLength(10);
    await pressButton('Tentar de novo');
    expect(mockState.query.refetch).toHaveBeenCalledTimes(1);
    // Carregado sem erro, o aviso não aparece.
    await act(async () => renderer?.unmount());
    mockState.query = loaded(HOUSE);
    expect(await mount()).not.toContain('Não deu para atualizar agora');
  });
});

describe('a entrada no resumo de gastos', () => {
  const row = () => renderer!.root.findAllByType(ListRow).find((candidate) => candidate.props.title === 'Para onde foi o dinheiro do mercado')!;

  it('faz a conta com as notas que o resumo já leu, sem a busca da tela, e abre a tela no mês', async () => {
    const text = await mount(<MarketMonthLink month="2026-09" receipts={HOUSE} />);
    // Num mês passado não há nota de data futura, e a frase não fala dela.
    expect(text).toBe(
      [
        'Para onde foi o dinheiro do mercado',
        'R$ 130,00 em 1 ida',
        'Diferente da barra “Mercado”: no Mercado do mês só contam notas fiscais, com limpeza, higiene, papel, bebê, pet e os itens de “Outros”, sem remédio.',
      ].join('\n'),
    );
    await act(async () => renderer?.unmount());
    // O mesmo total que a tela mostra para outubro.
    expect(await mount(<MarketMonthLink month="2026-10" receipts={HOUSE} />)).toContain('R$ 270,00 em 2 idas');
    expect(mockState.asked).toEqual([]);
    await act(async () => row().props.onPress());
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/mercado', params: { mes: '2026-10' } });
  });

  it('sem nota de mercado no mês, diz isso; sem as notas na mão, continua levando à tela', async () => {
    expect(await mount(<MarketMonthLink month="2026-10" receipts={[]} />)).toContain('Nenhuma nota de mercado em outubro');
    await act(async () => renderer?.unmount());
    expect(await mount(<MarketMonthLink month="2026-10" receipts={undefined} />)).toBe(
      [
        'Para onde foi o dinheiro do mercado',
        'Por categoria, por item e por mercado',
        'Diferente da barra “Mercado”: no Mercado do mês só contam notas fiscais, com limpeza, higiene, papel, bebê, pet e os itens de “Outros”, sem remédio e sem nota com data depois de hoje.',
      ].join('\n'),
    );
    expect(row().props.onPress).toBeDefined();
    expect(mockState.asked).toEqual([]);
  });

  it('no resumo: o total vem das notas do próprio resumo, e a busca da tela não é feita', async () => {
    mockState.spending.entries = [{ id: 'nota-o2', source: 'nota', refId: 'o2', date: '2026-10-10', amount: 50, category: 'mercado', description: 'Dia' }];
    mockState.spending.receipts = HOUSE.filter((r) => r.status === 'confirmed');
    await mount(<FinanceSummaryPanel />);
    expect(texts(renderer!.toJSON()).join('\n')).toContain(['Para onde foi o dinheiro do mercado', 'R$ 270,00 em 2 idas'].join('\n'));
    // As notas são as da janela de meses que o resumo já tem na mão.
    expect(mockState.spending.asked.at(-1)).toBe('2026-04 a 2026-10');
    expect(mockState.asked).toEqual([]);
    await act(async () => row().props.onPress());
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/mercado', params: { mes: '2026-10' } });
  });
});

describe('tendência dos últimos meses', () => {
  /** Os gráficos de tendência na tela: o que o leitor de tela anuncia de cada mês (cada um é um botão), em ordem. */
  const charts = () =>
    renderer!.root
      .findAllByType(MarketTrendChart)
      .map((chart) => monthButtons(chart).map((bar) => bar.props.accessibilityLabel));
  const OPEN = '. Abrir este mês';

  it('um cartão com os seis meses, o corrente "até hoje" e a média dos fechados, antes de "O que mudou"', async () => {
    const text = await mount();
    expect(charts()).toEqual([
      [
        `Maio: sem ida ao mercado${OPEN}`,
        `Junho: sem ida ao mercado${OPEN}`,
        `Julho: sem ida ao mercado${OPEN}`,
        `Agosto: sem ida ao mercado${OPEN}`,
        `Setembro: R$ 130,00${OPEN}`,
        // O mês da tela já está aberto: marcado, o rótulo diz que está aberto (também na web), e o toque não faz nada.
        'Outubro até hoje: R$ 270,00. Mês aberto',
      ],
    ]);
    const bars = monthButtons(renderer!.root.findByType(MarketTrendChart));
    expect(bars.map((bar) => [bar.props.accessibilityState, bar.props.disabled])).toEqual([
      ...Array.from({ length: 5 }, () => [{ selected: false }, false]),
      [{ selected: true }, true],
    ]);
    expect(text).toContain(['Média dos meses fechados: R$ 130,00', '4 meses sem ida ao mercado ficam fora da média.', 'Toque num mês para ver o mercado dele.'].join('\n'));
    expect(text).toContain(['Últimos 6 meses', 'mai', 'sem ida', 'jun', 'sem ida', 'jul', 'sem ida', 'ago', 'sem ida', 'set', '130', 'out', '270', 'hoje'].join('\n'));
    expect(text).toContain('Média dos meses fechados: R$ 130,00');
    // O título é lido uma vez, como cabeçalho; a imagem do gráfico começa direto nos meses.
    expect(renderer!.root.findAll((node) => node.props.accessibilityRole === 'header' && node.props.children === 'Últimos 6 meses').length).toBeGreaterThan(0);
    expect(text.indexOf('Últimos 6 meses')).toBeLessThan(text.indexOf('O que mudou'));
  });

  it('tocar numa categoria mostra como ela andou nos mesmos meses, acima dos itens dela; tirar a escolha tira o cartão', async () => {
    mockState.params = { aba: 'categorias' };
    await mount();
    await press('Grãos, massas e cereais: R$ 74,00, 28% dos itens, R$ 44,00 a mais que até o dia 13 de setembro');
    expect(charts()).toHaveLength(2);
    expect(charts()[1]).toEqual([
      `Maio: sem ida ao mercado${OPEN}`,
      `Junho: sem ida ao mercado${OPEN}`,
      `Julho: sem ida ao mercado${OPEN}`,
      `Agosto: sem ida ao mercado${OPEN}`,
      `Setembro: R$ 30,00${OPEN}`,
      'Outubro até hoje: R$ 74,00. Mês aberto',
    ]);
    expect(page()).toContain('Média dos meses fechados: R$ 30,00');
    const text = page();
    // Entre o selo da categoria e a lista dos itens dela (o Arroz também aparece antes, em O que mudou).
    expect(text.indexOf('Só os itens de')).toBeLessThan(text.indexOf('Grãos, massas e cereais nos últimos 6 meses'));
    expect(text.indexOf('Grãos, massas e cereais nos últimos 6 meses')).toBeLessThan(text.lastIndexOf('Arroz'));
    await press('Grãos, massas e cereais: mostrar os itens de todas as categorias');
    expect(charts()).toHaveLength(1);
  });

  it('mês sem nota, com notas nos meses antes: a tendência aparece embaixo do aviso', async () => {
    mockState.query = loaded([receipt('s1', at(9, 5), [line('Arroz', 'graos', 30)])]);
    const text = await mount();
    expect(text).toContain('Nenhuma nota de mercado em outubro');
    expect(charts()).toHaveLength(1);
    expect(charts()[0].slice(-2)).toEqual([`Setembro: R$ 30,00${OPEN}`, 'Outubro até hoje: sem ida ao mercado. Mês aberto']);
  });

  it('sem nota nenhuma nos seis meses, nada de cartão vazio', async () => {
    mockState.query = loaded([]);
    await mount();
    expect(charts()).toEqual([]);
  });
});

describe('a ordem dos itens', () => {
  /** Outubro com três idas: leite e pão nas três, tomate comprado por peso numa e por unidade na outra. */
  const ORDER_HOUSE: MarketReceipt[] = [
    receipt('q1', at(10, 3), [
      line('Leite', 'laticinios', 60, 12),
      line('Arroz', 'graos', 30, 5, 'kg'),
      line('Tomate', 'hortifruti', 5, 0.8, 'kg'),
      line('Suco', 'bebidas', 9, 1, 'l'),
      line('Pão', 'padaria', 8, 10),
    ]),
    receipt('q2', at(10, 8), [line('Leite', 'laticinios', 30, 6), line('Tomate', 'hortifruti', 3, 4), line('Pão', 'padaria', 8, 10), line('Café', 'cafe_cha', 18)]),
    receipt('q3', at(10, 10), [line('Leite', 'laticinios', 30, 6), line('Pão', 'padaria', 4, 5), line('Feijão', 'graos', 9, 1, 'kg')]),
  ];

  /** Os títulos dos grupos de itens na tela (por quantidade: as medidas), na ordem. */
  const groupTitles = () =>
    renderer!.root
      .findAll((node) => node.type === RNText && node.props.accessibilityRole === 'header')
      .map((node) => node.props.children)
      .filter((title) => ['Por unidade', 'Por peso', 'Por volume', 'Em medidas que não se somam'].includes(title));

  it('abre por valor; por quantidade, cada medida num grupo e o que não se soma por último, dizendo por quê; por idas, o que vai em toda ida', async () => {
    mockState.query = loaded(ORDER_HOUSE);
    await mount();
    expect(chosenOrder()).toEqual(['Valor']);
    expect(rowTitles()).toEqual(['Leite', 'Arroz', 'Pão', 'Café', 'Feijão', 'Suco', 'Tomate']);
    expect(groupTitles()).toEqual([]);

    await press('Ordenar os itens por quantidade');
    expect(chosenOrder()).toEqual(['Quantidade']);
    // 2 kg de arroz e 24 caixas de leite não se comparam: unidade com unidade, peso com peso, volume com volume.
    expect(groupTitles()).toEqual(['Por unidade', 'Por peso', 'Por volume', 'Em medidas que não se somam']);
    expect(rowTitles()).toEqual(['Pão', 'Leite', 'Café', 'Arroz', 'Feijão', 'Suco', 'Tomate']);
    const text = page();
    expect(text).toContain('A quantidade só se soma na mesma medida: o que é por unidade, por peso e por volume vem separado.');
    expect(text).toContain(['Por unidade', 'Pão', '25 un · em 3 idas', 'R$ 20,00', '9%', 'Leite', '24 un · em 3 idas'].join('\n'));
    expect(text).toContain(['Por peso', 'Arroz', '5 kg · em 1 ida'].join('\n'));
    expect(text).toContain(
      [
        'Em medidas que não se somam',
        'Comprados ora por unidade, ora por peso ou volume: a quantidade não se soma, e a linha diz quantas compras foram.',
        'Tomate',
        '2 compras · em 2 idas',
      ].join('\n'),
    );

    await press('Ordenar os itens por idas');
    expect(chosenOrder()).toEqual(['Idas']);
    expect(groupTitles()).toEqual([]);
    // Nas três idas, leite e pão (o leite levou mais dinheiro); o tomate em duas; os outros em uma, pelo valor.
    expect(rowTitles()).toEqual(['Leite', 'Pão', 'Tomate', 'Arroz', 'Café', 'Feijão', 'Suco']);
    expect(page()).not.toContain('A quantidade só se soma');
  });

  it('a ordem continua ao trocar de mês e com uma categoria escolhida', async () => {
    mockState.query = loaded([...ORDER_HOUSE, receipt('s1', at(9, 5), [line('Arroz', 'graos', 30), line('Feijão', 'graos', 18, 2, 'kg')])]);
    await mount();
    await press('Ordenar os itens por quantidade');
    await press('Mês anterior');
    expect(chosenOrder()).toEqual(['Quantidade']);
    expect(groupTitles()).toEqual(['Por unidade', 'Por peso']);
    expect(rowTitles()).toEqual(['Arroz', 'Feijão']);
  });

  it('com mais de 10 itens, o corte é por medida: o peso aparece logo, cada grupo cortado diz quantos faltam, e o "Ver todos" traz o resto', async () => {
    await mount();
    await press('Ordenar os itens por quantidade');
    // Dez itens por unidade não escondem os três por peso: a unidade fica com as vagas que sobram.
    expect(groupTitles()).toEqual(['Por unidade', 'Por peso']);
    expect(rowTitles()).toEqual(['Leite', 'Arroz', 'Ração', 'Café', 'Feijão', 'Pão', 'Sabonete', 'Banana', 'Picanha', 'Queijo']);
    let text = page();
    expect(text).toContain(['Sabonete', '1 un · em 1 ida'].join('\n'));
    expect(text).toContain('Mais 3 itens por unidade: veja em “Ver todos”.');
    expect(text.indexOf('Mais 3 itens por unidade')).toBeLessThan(text.indexOf('Por peso'));
    expect(text).toContain(['Por peso', 'Banana', '1,5 kg · em 1 ida'].join('\n'));
    await pressButton('Ver todos os 13 itens');
    expect(groupTitles()).toEqual(['Por unidade', 'Por peso']);
    expect(rowTitles()).toEqual(['Leite', 'Arroz', 'Ração', 'Café', 'Feijão', 'Pão', 'Sabonete', 'Detergente', 'SACOLA', 'Brinde', 'Banana', 'Picanha', 'Queijo']);
    text = page();
    expect(text).not.toContain('Mais 3 itens');
    // Voltar ao corte é voltar ao começo de cada medida, não aos "10 primeiros".
    await pressButton('Mostrar só os primeiros de cada medida');
    expect(rowTitles()).toHaveLength(10);
    // Por valor, o corte continua o dos 10 primeiros.
    await press('Ordenar os itens por valor');
    expect(rowTitles()).toEqual(TOP_TEN);
    expect(page()).not.toContain('Mais 3 itens');
  });
});

describe('um mercado tocado', () => {
  it('mostra as idas e os itens dele no mês; a ida abre a nota, e o selo volta à lista', async () => {
    mockState.params = { aba: 'mercados' };
    await mount();
    expect(page()).toContain('Toque num mercado para ver as idas e os itens dele.');
    // A chave está a 400 da tela rolável: a tela volta para ela, com o mercado logo abaixo.
    const scrollTo = jest.spyOn(renderer!.root.findByType(ScrollView).instance as ScrollView, 'scrollTo').mockImplementation(() => {});
    act(() => renderer!.root.findByType(Segmented).parent!.props.onLayout({ nativeEvent: { layout: { y: 400 } } }));
    await press('Assaí: R$ 220,00 em 1 ida. Ver as idas e os itens');
    expect(scrollTo).toHaveBeenCalledWith({ y: 392, animated: false });
    // Continua na parte dos mercados: nada vai para o endereço.
    expect(mockRouter.setParams).not.toHaveBeenCalled();
    const text = page();
    expect(text).toContain(['Só o mercado', 'Assaí', 'R$ 220,00 em 1 ida', 'Idas', '3 out · 12 itens · farmácia fora: R$ 22,00', 'R$ 220,00', 'Itens', 'Picanha'].join('\n'));
    expect(text).not.toContain('Toque num mercado');
    // Só os itens do Assaí, e a parte é sobre os itens dele (R$ 230,00).
    expect(rowTitles()).not.toContain('Brinde');
    expect(rowTitles()).toEqual(['3 out · 12 itens · farmácia fora: R$ 22,00', 'Picanha', 'Arroz', 'Leite', 'Queijo', 'Ração', 'Café', 'Feijão', 'Pão', 'Banana', 'Sabonete', 'Detergente', 'SACOLA']);
    const picanha = renderer!.root.findAllByType(ListRow).find((row) => row.props.title === 'Picanha' && !inChanges(row));
    expect(picanha?.props.accessibilityLabel).toBe('Picanha: R$ 80,00, 35% dos itens deste mercado, 1,2 kg, em 1 ida');
    await press('Assaí: R$ 220,00, 3 out, 12 itens, farmácia fora: R$ 22,00. Abrir a nota');
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/nota/[id]', params: { id: 'o1' } });
    await press('Assaí: mostrar todos os mercados');
    expect(rowTitles()).toEqual(['Assaí', 'Dia']);
  });

  it('dois mercados de mesmo nome: o endereço separa as linhas e vai no selo; trocar de mês volta à lista', async () => {
    mockState.query = loaded([
      receipt('a', at(10, 3), [line('Arroz', 'graos', 30)], { storeId: 'a1', storeAddress: 'Av. Brasil, 100' }),
      receipt('b', at(10, 5), [line('Feijão', 'graos', 9)], { storeId: 'a2', storeAddress: 'Rua das Flores, 5' }),
      receipt('c', at(9, 5), [line('Arroz', 'graos', 30)], { storeId: 'a1', storeAddress: 'Av. Brasil, 100' }),
    ]);
    mockState.params = { aba: 'mercados' };
    const text = await mount();
    expect(text).toContain(['Assaí', 'Av. Brasil, 100 · 1 ida', 'R$ 30,00', 'Assaí', 'Rua das Flores, 5 · 1 ida', 'R$ 9,00'].join('\n'));
    await press('Assaí, Rua das Flores, 5: R$ 9,00 em 1 ida. Ver as idas e os itens');
    expect(categoryChips().map((chip) => chip.props.label)).toEqual(['Assaí (Rua das Flores, 5)']);
    expect(rowTitles()).toEqual(['5 out · 1 item', 'Feijão']);
    await press('Mês anterior');
    // Em setembro só há um Assaí: o nome basta.
    expect(categoryChips()).toHaveLength(0);
    expect(page()).toContain(['Assaí', '1 ida', 'R$ 30,00'].join('\n'));
  });
});

describe('o mês pela tendência e a frase do pé', () => {
  it('tocar num mês da tendência abre aquele mês; no cartão da categoria, a categoria continua escolhida', async () => {
    await mount();
    await press('Setembro: R$ 130,00. Abrir este mês');
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ mes: '2026-09' });
    expect(page()).toContain(['Setembro de 2026', 'Mercado de setembro', 'R$ 130,00 em 1 ida'].join('\n'));

    await act(async () => renderer?.unmount());
    mockState.params = { aba: 'categorias' };
    await mount();
    await press('Grãos, massas e cereais: R$ 74,00, 28% dos itens, R$ 44,00 a mais que até o dia 13 de setembro');
    await press('Setembro: R$ 30,00. Abrir este mês');
    expect(mockState.params).toEqual({ aba: 'itens', mes: '2026-09' });
    expect(categoryChips().map((chip) => chip.props.label)).toEqual(['Grãos, massas e cereais']);
    expect(rowTitles()).toEqual(['Arroz']);
  });

  it('no cartão da categoria, o mês com ida mas sem nada dela mantém o selo e o cartão e diz isso; o mês sem ida tira a categoria', async () => {
    // Grãos em outubro e em julho; setembro só com carne; junho sem nota.
    mockState.query = loaded([
      receipt('o', at(10, 3), [line('Arroz', 'graos', 30), line('Picanha', 'carnes', 50, 1, 'kg')]),
      receipt('s', at(9, 5), [line('Picanha', 'carnes', 40, 1, 'kg')]),
      receipt('j', at(7, 5), [line('Feijão', 'graos', 9)]),
    ]);
    mockState.params = { aba: 'categorias' };
    await mount();
    const grains = renderer!.root.findAllByType(BarRow).find((bar) => bar.props.label === 'Grãos, massas e cereais');
    await act(async () => grains!.props.onPress());
    const categoryCard = () => renderer!.root.findAllByType(MarketTrendChart).find((chart) => chart.props.trend.title.startsWith('Grãos'));
    /** Toca num mês do cartão da categoria (o cartão do mercado todo pode ter um mês com o mesmo valor). */
    const pressInCard = async (label: string) => {
      const target = monthButtons(categoryCard()!).find((bar) => bar.props.accessibilityLabel === label);
      expect(target).toBeDefined();
      await act(async () => target!.props.onPress());
    };

    await pressInCard('Setembro: R$ 0,00. Abrir este mês');
    expect(mockState.params).toEqual({ aba: 'itens', mes: '2026-09' });
    // O selo e o cartão ficam, e a frase diz por que não há itens; nada de "sem nenhum item lido" nem lista.
    expect(categoryChips().map((chip) => chip.props.label)).toEqual(['Grãos, massas e cereais']);
    expect(categoryCard()?.props.trend.title).toBe('Grãos, massas e cereais em 6 meses até setembro');
    let text = page();
    expect(text).toContain('Nenhum item de “Grãos, massas e cereais” em setembro.');
    expect(text).not.toContain('As notas deste mês vieram sem nenhum item lido.');
    expect(rowTitles()).toEqual([]);
    expect(chosenOrder()).toEqual([]);

    // Pelo mesmo cartão, outro mês: a categoria continua.
    await pressInCard('Julho: R$ 9,00. Abrir este mês');
    expect(mockState.params.mes).toBe('2026-07');
    expect(categoryChips().map((chip) => chip.props.label)).toEqual(['Grãos, massas e cereais']);
    expect(rowTitles()).toEqual(['Feijão']);

    // Mês sem ida nenhuma: a categoria sai, e a tela diz que o mês não tem nota.
    await pressInCard('Junho: sem ida ao mercado. Abrir este mês');
    expect(mockState.params.mes).toBe('2026-06');
    text = page();
    expect(text).toContain('Nenhuma nota de mercado em junho');
    expect(categoryChips()).toHaveLength(0);
    expect(categoryCard()).toBeUndefined();
  });

  it('a frase do pé aparece também no mês sem ida; num mês passado, sem falar de data depois de hoje', async () => {
    mockState.query = loaded([]);
    let text = await mount();
    expect(text).toContain('Nenhuma nota de mercado em outubro');
    expect(text.split('\n').at(-1)).toBe(NOT_THE_RESUMO);
    await act(async () => renderer?.unmount());
    mockState.query = loaded(HOUSE);
    mockState.params = { mes: '2026-09' };
    text = await mount();
    expect(text.split('\n').at(-1)).toBe(
      'Diferente da barra “Mercado” do Resumo: aqui só contam notas fiscais, com limpeza, higiene, papel, bebê, pet e os itens de “Outros”, sem remédio.',
    );
  });
});
